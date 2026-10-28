import { expect, test, type Page } from '@playwright/test';

import { clusterEntries } from '../../src/lib/homeCluster';
import { GRID_WIDTHS, LIGHTBOX_WIDTHS } from '../../src/lib/imageUrl';
import { photoAnchorId } from '../../src/lib/photoLink';
import { readGalleryEntries } from './galleryData';

const entries = readGalleryEntries('photography');
const shown = clusterEntries(entries);
const CLUSTER_COUNT = shown.length;

// The widths, in pixels, of the two lines of the name, and of the box that holds them.
async function nameMetrics(page: Page): Promise<{ container: number; lines: number[]; height: number }> {
    return page.evaluate(() => {
        const h1 = document.querySelector('h1');
        if (!h1) throw new Error('No h1.');
        const lineWidth = (node: Node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return range.getBoundingClientRect().width;
        };
        const second = h1.querySelector('span');
        if (!second) throw new Error('No second line.');
        return {
            container: h1.getBoundingClientRect().width,
            lines: [lineWidth(h1.firstChild!), lineWidth(second)],
            height: h1.getBoundingClientRect().height,
        };
    });
}

test.describe('home page', () => {
    test('has the name as its one h1, in the accessibility tree, and no placeholder note', async ({ page }) => {
        await page.goto('/');

        const heading = page.getByRole('main').getByRole('heading', { level: 1, name: 'Trevor Petrus' });
        await expect(heading).toBeVisible();
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        // Real text, not an image: the capitals come from CSS.
        await expect(heading).toHaveCSS('text-transform', 'uppercase');
        await expect(heading.locator('svg, img')).toHaveCount(0);
        await expect(page.getByText(/placeholder/i)).toHaveCount(0);
    });

    test('says what the site holds, with links to the two sections', async ({ page }) => {
        await page.goto('/');

        const main = page.getByRole('main');
        await expect(main.getByRole('link', { name: 'photography', exact: true })).toHaveAttribute(
            'href',
            '/photography/',
        );
        await expect(main.getByRole('link', { name: 'coding projects' })).toHaveAttribute('href', '/projects/');
    });

    test('sets each line of the name to fill the width of its container, without scrolling sideways', async ({
        page,
    }) => {
        await page.goto('/');
        await page.evaluate(() => document.fonts.ready);

        const { container, lines } = await nameMetrics(page);

        for (const line of lines) {
            // The tracking leaves the last letter's right side empty, so a line can read a little short of the edge.
            expect(line).toBeGreaterThan(container * 0.9);
            expect(line).toBeLessThanOrEqual(container * 1.01);
        }
        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBe(0);
    });

    test('reserves the height of the name, so the font swap moves nothing', async ({ page }) => {
        // Block the fonts so the page paints with the fallback, then let them load and compare the heights.
        await page.route('**/_astro/fonts/*', (route) => route.abort());
        await page.goto('/');
        const before = await nameMetrics(page);
        await page.unroute('**/_astro/fonts/*');
        await page.reload();
        await page.evaluate(() => document.fonts.ready);
        const after = await nameMetrics(page);

        expect(before.height).toBeGreaterThan(0);
        expect(after.height).toBe(before.height);
    });

    test('keeps the name clear of the vertical running head', async ({ page, viewport }) => {
        test.skip((viewport?.width ?? 0) < 1280, 'The running head is hidden below 1280px.');
        await page.goto('/');

        const head = await page.locator('[data-running-head]').boundingBox();
        const name = await page.getByRole('heading', { level: 1 }).boundingBox();

        expect(head).not.toBeNull();
        expect(name).not.toBeNull();
        expect(head!.x + head!.width).toBeLessThanOrEqual(name!.x);
    });

    test('shows no image cluster while there are no photos', async ({ page }) => {
        test.skip(entries.length > 0, 'Photos have been added, so the cluster is shown.');
        await page.goto('/');

        await expect(page.locator('[data-home-cluster]')).toHaveCount(0);
        await expect(page.getByRole('main').getByRole('img')).toHaveCount(0);
    });

    test.describe('image cluster', () => {
        test.skip(entries.length === 0, 'There are no photos yet (src/data/gallery/photography.json is empty).');

        test('shows the pinned photos (or the first three) with their alt text, from the existing widths only', async ({
            page,
        }) => {
            await page.goto('/');

            const images = page.locator('[data-home-cluster] img');
            await expect(images).toHaveCount(CLUSTER_COUNT);
            for (const [index, { alt }] of shown.entries()) {
                await expect(images.nth(index)).toHaveAttribute('alt', alt);
                const srcset = (await images.nth(index).getAttribute('srcset')) ?? '';
                const widths = [...srcset.matchAll(/width=(\d+),/g)].map(([, width]) => Number(width));
                expect(widths.length).toBeGreaterThan(0);
                for (const width of widths) expect([...GRID_WIDTHS, ...LIGHTBOX_WIDTHS]).toContain(width);
            }
        });

        test('shows the photos without any caption or text', async ({ page }) => {
            await page.goto('/');

            const cluster = page.locator('[data-home-cluster]');
            await expect(cluster.locator('figcaption, figure')).toHaveCount(0);
            expect(await cluster.innerText()).toBe('');
            expect((await cluster.textContent())?.trim()).toBe('');
        });

        test('links every photo to its place on the Photography page, named by its alt text', async ({ page }) => {
            await page.goto('/');

            const links = page.locator('[data-home-cluster] a');
            await expect(links).toHaveCount(CLUSTER_COUNT);
            for (const [index, { alt, key }] of shown.entries()) {
                const link = links.nth(index);
                await expect(link.locator('img')).toHaveCount(1);
                await expect(link).toHaveAttribute('href', /\/photography\/#photo-/);
                await expect(link).toHaveAttribute('href', `/photography/#${photoAnchorId(key)}`);
                await expect(page.getByRole('link', { name: alt, exact: true })).toHaveAttribute(
                    'href',
                    `/photography/#${photoAnchorId(key)}`,
                );
            }
        });

        test('navigates to the photo on the Photography page without a full page load', async ({
            page,
            browserName,
        }) => {
            // Local WebKit crashes the page when a View Transitions navigation to /photography starts from a scrolled
            // home page, whichever link starts it (the primary nav link crashes the same way). The cluster is below the
            // fold on a phone, so the click scrolls first. Chromium covers this check.
            test.skip(browserName === 'webkit', 'WebKit crashes on a scrolled navigation to /photography.');
            await page.goto('/');
            await page.evaluate(() => {
                (window as unknown as { __marker: boolean }).__marker = true;
            });

            const first = page.locator('[data-home-cluster] a').first();
            const href = await first.getAttribute('href');
            await first.click();

            await expect(page).toHaveURL(/\/photography\/?#photo-/);
            expect(new URL(page.url()).hash).toBe(`#${href!.split('#')[1]}`);
            // The marker survives only if View Transitions swapped the page instead of loading it.
            expect(await page.evaluate(() => (window as unknown as { __marker?: boolean }).__marker)).toBe(true);
            const id = new URL(page.url()).hash.slice(1);
            await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
            await expect(page.getByRole('dialog')).toBeVisible();
        });

        test('reaches a photo link with the keyboard and shows a focus outline', async ({ page, browserName }) => {
            test.skip(browserName === 'webkit', 'Safari does not Tab to links by default.');
            await page.goto('/');

            const first = page.locator('[data-home-cluster] a').first();
            for (let presses = 0; presses < 20; presses += 1) {
                await page.keyboard.press('Tab');
                if (await first.evaluate((node) => node === document.activeElement)) break;
            }

            await expect(first).toBeFocused();
            await expect(first).toHaveCSS('outline-style', 'solid');
            expect(parseFloat(await first.evaluate((node) => getComputedStyle(node).outlineWidth))).toBeGreaterThan(0);
        });

        for (const width of [320, 390, 1280]) {
            test(`composes the three images as one overlapping cluster at ${width}px, without scrolling sideways`, async ({
                page,
            }) => {
                test.skip(CLUSTER_COUNT !== 3, 'This checks the three-photo composition.');
                await page.setViewportSize({ width, height: 900 });
                await page.goto('/');

                const [first, second, third] = await page.locator('[data-home-cluster] a').evaluateAll((nodes) =>
                    nodes.map((node) => {
                        const { left, right, top, bottom } = node.getBoundingClientRect();
                        return { left, right, top, bottom };
                    }),
                );
                type Box = typeof first;
                const intersects = (a: Box, b: Box) =>
                    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

                // As designed: each image overlaps the next, and the first and the third stay apart.
                expect(intersects(first, second)).toBe(true);
                expect(intersects(second, third)).toBe(true);
                expect(intersects(first, third)).toBe(false);
                // The second is raised above the first and the third (the tops follow each photo's shape, the bottoms
                // follow the offsets).
                expect(second.top).toBeLessThan(first.top);
                expect(second.top).toBeLessThan(third.top);

                if (width < 768) {
                    // The first two span five of the twelve columns, the third four (as on desktop), so it is narrower.
                    expect(first.right - first.left).toBeGreaterThanOrEqual(width * 0.35);
                    expect(second.right - second.left).toBeGreaterThanOrEqual(width * 0.35);
                    expect(third.right - third.left).toBeGreaterThanOrEqual(width * 0.28);
                }
                const overflow = await page.evaluate(
                    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
                );
                expect(overflow).toBe(0);
            });
        }

        test('never scrolls sideways', async ({ page }) => {
            await page.goto('/');

            const overflow = await page.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            );
            expect(overflow).toBe(0);
        });
    });
});
