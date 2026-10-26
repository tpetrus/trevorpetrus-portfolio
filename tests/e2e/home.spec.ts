import { expect, test, type Page } from '@playwright/test';

import { GRID_WIDTHS } from '../../src/lib/imageUrl';
import { readGalleryEntries } from './galleryData';

const entries = readGalleryEntries('photography');
const CLUSTER_COUNT = Math.min(entries.length, 3);

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
        await expect(main.getByRole('link', { name: 'photographs' })).toHaveAttribute('href', '/photography/');
        await expect(main.getByRole('link', { name: 'projects' })).toHaveAttribute('href', '/projects/');
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

        test('shows the first three photos with their alt text, from the fixed grid widths only', async ({ page }) => {
            await page.goto('/');

            const images = page.locator('[data-home-cluster] img');
            await expect(images).toHaveCount(CLUSTER_COUNT);
            for (const [index, { alt }] of entries.slice(0, CLUSTER_COUNT).entries()) {
                await expect(images.nth(index)).toHaveAttribute('alt', alt);
                const srcset = (await images.nth(index).getAttribute('srcset')) ?? '';
                const widths = [...srcset.matchAll(/width=(\d+),/g)].map(([, width]) => Number(width));
                expect(widths).toEqual([...GRID_WIDTHS]);
            }
        });

        test('keeps the captions below the images and, from 48rem up, on one baseline with overlapping images', async ({
            page,
            viewport,
        }) => {
            test.skip(CLUSTER_COUNT < 3, 'The overlap needs three photos.');
            test.skip((viewport?.width ?? 0) < 768, 'The figures stack below 48rem.');
            await page.goto('/');

            const figures = page.locator('[data-home-cluster] figure');
            const images = await figures.locator('img').evaluateAll((nodes) =>
                nodes.map((node) => {
                    const { left, right } = node.getBoundingClientRect();
                    return { left, right };
                }),
            );
            const captionTops = await figures
                .locator('figcaption')
                .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));

            expect(images[1].left).toBeLessThan(images[0].right);
            expect(images[2].left).toBeLessThan(images[1].right);
            expect(new Set(captionTops.map(Math.round)).size).toBeLessThanOrEqual(1);
        });

        test('never scrolls sideways', async ({ page }) => {
            await page.goto('/');

            const overflow = await page.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            );
            expect(overflow).toBe(0);
        });
    });
});
