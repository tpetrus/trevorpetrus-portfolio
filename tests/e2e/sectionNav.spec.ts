import { expect, test, type Page } from '@playwright/test';

import { PHOTOGRAPHY_CATEGORIES, entriesInPageOrder, readGalleryEntries } from './galleryData';
import { stubRemotePhotos } from './stubPhotos';

const entries = entriesInPageOrder(readGalleryEntries('photography'));

test.describe('photography section navigation', () => {
    test.skip(entries.length === 0, 'There are no photos yet (src/data/gallery/photography.json is empty).');

    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
        test.describe(`with ${reducedMotion} motion`, () => {
            test.beforeEach(async ({ page }) => {
                await stubRemotePhotos(page);
                await page.emulateMedia({ reducedMotion });
                await page.goto('/photography/');
                // The script marks the root once it has run; until then the links are plain and visible.
                await expect(page.locator('[data-sections-root][data-js]')).toBeAttached();
            });

            const backToTop = (page: Page) => page.getByRole('link', { name: 'Back to top' });
            const legend = (page: Page) => page.getByRole('navigation', { name: 'Jump to a section' });

            test('hides the back-to-top links at the top and shows them once scrolled', async ({ page }) => {
                expect(await page.evaluate(() => window.scrollY)).toBe(0);
                await expect(backToTop(page)).toHaveCount(PHOTOGRAPHY_CATEGORIES.length);
                for (const link of await backToTop(page).all()) await expect(link).toBeHidden();

                await page.evaluate(() => window.scrollTo(0, 400));
                await expect(page.locator('[data-sections-root]')).toHaveAttribute('data-scrolled', '');
                await expect(backToTop(page).first()).toBeVisible();
                await expect(backToTop(page).first()).toHaveAttribute('href', '#main');
            });

            test('returns to the very top and focuses main when a back-to-top link is clicked', async ({ page }) => {
                await page.locator('section').last().scrollIntoViewIfNeeded();
                const link = backToTop(page).last();
                await expect(link).toBeVisible();
                await link.click();

                await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
                await expect(page.locator('main#main')).toBeFocused();
            });

            test('shows the legend only after the inline category nav has scrolled away', async ({ page }) => {
                await expect(legend(page)).toBeHidden();
                await expect(page.locator('[data-section-legend]')).toHaveAttribute('inert', '');

                await page.locator('section#portrait').scrollIntoViewIfNeeded();
                await expect(legend(page)).toBeVisible();
                await expect(page.locator('[data-section-legend]')).not.toHaveAttribute('inert', '');

                await page.evaluate(() => window.scrollTo(0, 0));
                await expect(legend(page)).toBeHidden();
            });

            test('jumps to a section from the legend and marks it as current', async ({ page }) => {
                await page.locator('section#landscape').scrollIntoViewIfNeeded();
                await expect(legend(page)).toBeVisible();

                const target = PHOTOGRAPHY_CATEGORIES[1];
                const link = legend(page).getByRole('link', { name: target.label });
                await link.click();

                const heading = page.locator(`#${target.id}-heading`);
                await expect
                    .poll(async () => (await heading.boundingBox())?.y ?? Number.POSITIVE_INFINITY, {
                        message: 'the heading should settle near the top, below the sticky header',
                    })
                    .toBeLessThan(200);
                await expect(link).toHaveAttribute('aria-current', 'true');
                await expect(legend(page).locator('[aria-current="true"]')).toHaveCount(1);
            });

            test('places the legend by viewport: bottom pill below lg, right margin from lg', async ({ page }) => {
                await page.locator('section#portrait').scrollIntoViewIfNeeded();
                await expect(legend(page)).toBeVisible();
                const box = await legend(page).boundingBox();
                const viewport = page.viewportSize()!;
                expect(box).not.toBeNull();
                if (viewport.width < 1024) {
                    expect(box!.y + box!.height).toBeGreaterThan(viewport.height - 40);
                    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
                    expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(2);
                } else {
                    expect(box!.x).toBeGreaterThan(viewport.width * 0.75);
                    expect(Math.abs(box!.y + box!.height / 2 - viewport.height / 2)).toBeLessThan(2);
                }
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            });
        });
    }

    test('does not overflow horizontally at 320px wide', async ({ page }) => {
        await stubRemotePhotos(page);
        await page.setViewportSize({ width: 320, height: 640 });
        await page.goto('/photography/');
        await page.locator('section#portrait').scrollIntoViewIfNeeded();
        await expect(page.getByRole('navigation', { name: 'Jump to a section' })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
});

test.describe('photography section navigation without JavaScript', () => {
    test.use({ javaScriptEnabled: false });
    test.skip(entries.length === 0, 'There are no photos yet (src/data/gallery/photography.json is empty).');

    test('keeps the back-to-top links visible and the legend hidden', async ({ page }) => {
        await page.goto('/photography/');

        await expect(page.getByRole('link', { name: 'Back to top' }).first()).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Jump to a section' })).toBeHidden();
    });
});
