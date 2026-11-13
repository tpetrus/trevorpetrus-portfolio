import { expect, test, type Page } from '@playwright/test';

import { LEAF_SEED, createLeaves, leafCount, leafScale } from '../../src/lib/leaves';

// The home page's leaf layer as reduced motion (and a visitor without JavaScript) sees it: a still composition behind
// the content. The motion is covered by leavesMotion.spec.ts.

const transforms = (page: Page) =>
    page.locator('[data-leaf]').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).transform));

const visibleLeaves = (page: Page) =>
    page
        .locator('[data-leaf]')
        .evaluateAll((nodes) => nodes.filter((node) => getComputedStyle(node).display !== 'none').length);

test.describe('home leaf layer, still', () => {
    test.beforeEach(async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
    });

    test('is decorative, fixed behind the page and takes no pointer events', async ({ page }) => {
        await page.goto('/');

        const layer = page.locator('[data-leaves]');
        await expect(layer).toHaveCount(1);
        await expect(layer).toHaveAttribute('aria-hidden', 'true');
        await expect(layer).toHaveCSS('position', 'fixed');
        await expect(layer).toHaveCSS('pointer-events', 'none');
        // The first child of body, which global.css relies on to stack the content above it.
        expect(
            await layer.evaluate((node) => node.parentElement === document.body && !node.previousElementSibling),
        ).toBe(true);
    });

    test('colors every leaf with its pale fill, never the inherited ink', async ({ page }) => {
        await page.goto('/');

        const colors = await page.locator('[data-leaf]').evaluateAll((nodes) => {
            // Resolves each fill token to the rgb() string the browser computes for it.
            const probe = document.createElement('span');
            document.body.append(probe);
            const resolve = (token: string) => {
                probe.style.color = `var(--color-${token})`;
                return getComputedStyle(probe).color;
            };
            const ink = resolve('ink');
            const fills = ['paper-2', 'paper-3', 'accent-tint'].map(resolve);
            const leafColors = nodes.map((node) => getComputedStyle(node).color);
            probe.remove();
            return { ink, fills, leafColors };
        });

        expect(new Set(colors.fills).size).toBe(3);
        for (const color of colors.leafColors) {
            expect(color).not.toBe(colors.ink);
            expect(colors.fills).toContain(color);
        }
    });

    test('stays still under reduced motion and hides the pause button', async ({ page }) => {
        await page.goto('/');

        await expect(page.locator('[data-leaves]')).toHaveAttribute('data-leaves-state', 'still');
        await expect(page.locator('[data-leaves-toggle]')).toBeHidden();
        const before = await transforms(page);
        await page.waitForTimeout(1000);
        expect(await transforms(page)).toEqual(before);
    });

    for (const width of [320, 768, 1280, 1920]) {
        test(`shows the tier's leaf count at ${width}px, without scrolling sideways`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await page.goto('/');

            expect(await visibleLeaves(page)).toBe(leafCount(width));
            const overflow = await page.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            );
            expect(overflow).toBe(0);
        });
    }

    for (const width of [375, 1024, 2560]) {
        test(`sizes the leaves for a ${width}px viewport with CSS alone`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await page.goto('/');

            // The computed width is the layout size, before the rotation and flip of the transform.
            const widths = await page.locator('[data-leaf]').evaluateAll((nodes) =>
                nodes.map((node) => {
                    const style = getComputedStyle(node);
                    return style.display === 'none' ? null : parseFloat(style.width);
                }),
            );
            const leaves = createLeaves(LEAF_SEED);
            expect(widths.filter((rendered) => rendered !== null)).toHaveLength(leafCount(width));
            for (const [index, rendered] of widths.entries()) {
                if (rendered === null) continue;
                expect(rendered).toBeCloseTo((leaves[index]?.size ?? 0) * leafScale(width), 0);
            }
        });
    }

    test('never covers the content: the topmost element over each part of the page is the page, not a leaf', async ({
        page,
    }) => {
        await page.goto('/');

        const targets = ['h1', 'main p', '[data-home-cluster] img', 'footer p'];
        for (const selector of targets) {
            const target = page.locator(selector).first();
            if ((await target.count()) === 0) continue;
            await target.scrollIntoViewIfNeeded();
            const hit = await target.evaluate((node) => {
                const box = node.getBoundingClientRect();
                const topmost = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
                return { inLayer: Boolean(topmost?.closest('[data-leaves]')), inTarget: node.contains(topmost) };
            });
            expect(hit, selector).toEqual({ inLayer: false, inTarget: true });
        }
    });

    test('stacks the running head above the layer', async ({ page, viewport }) => {
        test.skip((viewport?.width ?? 0) < 1280, 'The running head is hidden below 1280px.');
        await page.goto('/');

        // It takes no pointer events, so elementFromPoint cannot see it; its z-index is what puts it above the layer.
        await expect(page.locator('[data-running-head]')).toHaveCSS('z-index', '10');
        await expect(page.locator('[data-leaves]')).toHaveCSS('z-index', '0');
        await expect(page.locator('body')).toHaveCSS('isolation', 'isolate');
    });

    test('lifts main and the footer above the layer', async ({ page }) => {
        await page.goto('/');

        // elementFromPoint looks through the layer (it takes no pointer events), so the stacking itself is asserted: a
        // broken global.css selector would otherwise let the leaves paint over the content unnoticed.
        await expect(page.locator('body')).toHaveCSS('isolation', 'isolate');
        await expect(page.locator('[data-leaves]')).toHaveCSS('z-index', '0');
        for (const selector of ['main', 'body > footer']) {
            await expect(page.locator(selector)).toHaveCSS('position', 'relative');
            await expect(page.locator(selector)).toHaveCSS('z-index', '10');
        }
    });

    test('holds nothing that can take focus', async ({ page }) => {
        await page.goto('/');

        await expect(page.locator('[data-leaves] :is(a, button, input, [tabindex])')).toHaveCount(0);
        await expect(page.locator('[data-leaf][focusable="false"]')).toHaveCount(
            await page.locator('[data-leaf]').count(),
        );
    });

    for (const path of ['/photography/', '/projects/']) {
        test(`is not on ${path}`, async ({ page }) => {
            await page.goto(path);

            await expect(page.locator('[data-leaves], [data-leaves-toggle]')).toHaveCount(0);
        });
    }
});
