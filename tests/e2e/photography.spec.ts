import { expect, test } from '@playwright/test';

import { photoAnchorId } from '../../src/lib/photoLink';
import { PHOTOGRAPHY_CATEGORIES, entriesInPageOrder, readGalleryEntries } from './galleryData';
import { stubRemotePhotos } from './stubPhotos';

const entries = entriesInPageOrder(readGalleryEntries('photography'));

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
        await expect(page.locator('[data-gallery]')).toHaveCount(0);
    });

    test('lists the category sections in order, each with a heading, and a jump nav that links to them', async ({
        page,
    }) => {
        test.skip(entries.length === 0, 'There are no photos yet (src/data/gallery/photography.json is empty).');

        const headings = page.getByRole('main').getByRole('heading', { level: 2 });
        await expect(headings).toHaveText(PHOTOGRAPHY_CATEGORIES.map(({ label }) => label));

        const nav = page.getByRole('navigation', { name: 'Photo categories' });
        const links = nav.getByRole('link');
        await expect(links).toHaveText(PHOTOGRAPHY_CATEGORIES.map(({ label }) => label));
        for (const [index, { id }] of PHOTOGRAPHY_CATEGORIES.entries()) {
            await expect(links.nth(index)).toHaveAttribute('href', `#${id}`);
            await expect(page.locator(`section#${id}`)).toHaveAttribute('aria-labelledby', `${id}-heading`);
        }
    });

    test('shows one tile per photo, each with alt text and a link to the large variant', async ({ page }) => {
        test.skip(entries.length === 0, 'There are no photos yet (src/data/gallery/photography.json is empty).');

        await stubRemotePhotos(page);
        await page.reload();
        const tiles = page.locator('[data-gallery] li');
        await expect(tiles).toHaveCount(entries.length);
        for (const [index, { alt, key }] of entries.entries()) {
            await expect(tiles.nth(index)).toHaveAttribute('id', photoAnchorId(key));
            await expect(tiles.nth(index).getByRole('img', { name: alt })).toBeAttached();
            await expect(tiles.nth(index).getByRole('link')).toHaveAttribute('href', /\/cdn-cgi\/image\/width=2560,/);
        }
        await expect(page.getByText('Photos are on their way.', { exact: true })).toHaveCount(0);
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
        const images = page.locator('[data-gallery] img');
        for (const [index, { width, height }] of entries.entries()) {
            const box = await images.nth(index).boundingBox();
            expect(box).not.toBeNull();
            expect(box!.height).toBeCloseTo((box!.width * height) / width, 0);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

    // Under a tile there is only the place (or nothing); the camera line and the photo number are gone from the grid.
    test('shows only the location under a tile, never camera settings or a number', async ({ page }) => {
        test.skip(entries.length === 0, 'There are no photos yet (src/data/gallery/photography.json is empty).');

        await stubRemotePhotos(page);
        await page.reload();
        const tiles = page.locator('[data-gallery] li');
        for (const [index, { caption }] of entries.entries()) {
            const expected =
                caption.location === undefined ? '' : `${caption.location.city}, ${caption.location.country}`;
            // textContent, not innerText: a tile far below the fold is unrendered (content-visibility) and the
            // caption is outside that photo link anyway.
            const text = ((await tiles.nth(index).textContent()) ?? '').trim();
            expect(text).toBe(expected);
            expect(text).not.toMatch(/ISO|\bmm\b|f\/|Canon|Nikon|Sony/);
        }
    });
});

test.describe('photography reveal', () => {
    test.skip(entries.length === 0, 'There are no photos yet (src/data/gallery/photography.json is empty).');

    test('reveals a photo that starts below the fold once it scrolls into view', async ({ page }) => {
        await stubRemotePhotos(page);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.goto('/photography/');
        const last = page.locator('[data-gallery] .photo').last();
        await expect(page.locator('[data-gallery]').first()).toHaveAttribute('data-reveal', '');
        await expect(last).not.toHaveAttribute('data-revealed', '');
        expect(await last.evaluate((element) => getComputedStyle(element).opacity)).toBe('0');

        await last.scrollIntoViewIfNeeded();

        await expect(last).toHaveAttribute('data-revealed', '');
        await expect(last).toHaveCSS('opacity', '1');
        await expect(last).toHaveCSS('transform', 'none');
    });

    test('shows the first photo at once: it is never delayed by the animation', async ({ page }) => {
        await stubRemotePhotos(page);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.goto('/photography/');

        await expect(page.locator('[data-gallery] .photo').first()).toHaveAttribute('data-revealed', '');
    });

    test('does not animate under reduced motion: every photo is visible at once', async ({ page }) => {
        await stubRemotePhotos(page);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/photography/');

        await expect(page.locator('[data-gallery][data-reveal]')).toHaveCount(0);
        const opacities = await page
            .locator('[data-gallery] .photo')
            .evaluateAll((photos) => photos.map((photo) => getComputedStyle(photo).opacity));
        expect(new Set(opacities)).toEqual(new Set(['1']));
    });
});

test.describe('photography without JavaScript', () => {
    test.use({ javaScriptEnabled: false });
    test.skip(entries.length === 0, 'There are no photos yet (src/data/gallery/photography.json is empty).');

    test('shows every photo at full opacity', async ({ page }) => {
        await page.goto('/photography/');

        const opacities = await page
            .locator('[data-gallery] .photo')
            .evaluateAll((photos) => photos.map((photo) => getComputedStyle(photo).opacity));
        expect(opacities).toHaveLength(entries.length);
        expect(new Set(opacities)).toEqual(new Set(['1']));
    });
});
