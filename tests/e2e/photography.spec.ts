import { expect, test } from '@playwright/test';

import { readGalleryEntries } from './galleryData';
import { stubRemotePhotos } from './stubPhotos';

const entries = readGalleryEntries('photography');

test.describe('photography page @smoke', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/photography/');
    });

    test('has the Photography heading in the main landmark', async ({ page }) => {
        await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Photography' })).toBeVisible();
    });

    test('says photos are on their way, and shows no gallery, while there are no photos', async ({ page }) => {
        test.skip(entries.length > 0, 'Photos have been added, so the empty state is not shown.');

        await expect(page.getByText('Photos are on their way.')).toBeVisible();
        await expect(page.locator('#gallery')).toHaveCount(0);
    });

    test('shows one tile per photo, each with alt text and a link to the large variant', async ({ page }) => {
        test.skip(entries.length === 0, 'There are no photos yet (src/data/gallery/photography.json is empty).');

        await stubRemotePhotos(page);
        await page.reload();
        const tiles = page.locator('#gallery li');
        await expect(tiles).toHaveCount(entries.length);
        for (const [index, { alt }] of entries.entries()) {
            await expect(tiles.nth(index).getByRole('img', { name: alt })).toBeVisible();
            await expect(tiles.nth(index).getByRole('link')).toHaveAttribute('href', /\/cdn-cgi\/image\/width=2560,/);
        }
        await expect(page.getByText('Photos are on their way.')).toHaveCount(0);
    });

    // The space for a tile is reserved from its width and height, and nothing is cropped: the drawn image has the
    // photo's own aspect ratio (within a pixel of rounding), which also means the lazy images cause no layout shift.
    test('draws every photo at its own aspect ratio inside the 12-column grid, without horizontal overflow', async ({
        page,
    }) => {
        test.skip(entries.length === 0, 'There are no photos yet (src/data/gallery/photography.json is empty).');

        // The page is already loaded by beforeEach, so reload it with the photo host stubbed.
        await stubRemotePhotos(page);
        await page.reload();
        const images = page.locator('#gallery img');
        for (const [index, { width, height }] of entries.entries()) {
            const box = await images.nth(index).boundingBox();
            expect(box).not.toBeNull();
            expect(box!.height).toBeCloseTo((box!.width * height) / width, 0);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
});
