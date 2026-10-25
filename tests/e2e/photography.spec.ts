import { expect, test } from '@playwright/test';

import { readGalleryEntries } from './galleryData';

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

        const tiles = page.locator('#gallery li');
        await expect(tiles).toHaveCount(entries.length);
        for (const [index, { alt }] of entries.entries()) {
            await expect(tiles.nth(index).getByRole('img', { name: alt })).toBeVisible();
            await expect(tiles.nth(index).getByRole('link')).toHaveAttribute('href', /\/cdn-cgi\/image\/width=2560,/);
        }
        await expect(page.getByText('Photos are on their way.')).toHaveCount(0);
    });
});
