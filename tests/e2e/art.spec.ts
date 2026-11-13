import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { collectionAnchorId } from '../../src/lib/photoLink';
import { stubRemotePhotos } from './stubPhotos';

// Read when the spec file loads (cwd is the repo root); the tests that need pieces skip while the file is `[]`.
const entries = JSON.parse(readFileSync('src/data/gallery/art.json', 'utf8')) as { key: string }[];

test.describe('art page', () => {
    test('has the Art heading as its one h1 in the main landmark', async ({ page }) => {
        await page.goto('/art/');

        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Art' })).toBeVisible();
    });

    test('says art is on its way, and shows no gallery, while there are no pieces', async ({ page }) => {
        test.skip(entries.length > 0, 'Art has been added, so the empty state is not shown.');
        await page.goto('/art/');

        await expect(page.getByText('Art is on its way.')).toBeVisible();
        await expect(page.locator('[data-gallery]')).toHaveCount(0);
    });

    test('loads no PhotoSwipe JavaScript or CSS while there are no pieces', async ({ page }) => {
        test.skip(entries.length > 0, 'Art has been added, so the lightbox loads.');
        const assets: string[] = [];
        page.on('request', (request) => assets.push(request.url()));
        await page.goto('/art/');
        await page.waitForLoadState('networkidle');

        expect(assets.filter((url) => /galleryLightbox|photoswipe|pswp/i.test(url))).toEqual([]);
        await expect(page.locator('link[href*="photoswipe"], style:has-text(".pswp")')).toHaveCount(0);
    });

    test('asks search engines not to index it while it is not in the nav, unlike the linked pages', async ({
        page,
    }) => {
        await page.goto('/art/');
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');

        await page.goto('/photography/');
        await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    });

    test('has no video in its title', async ({ page }) => {
        await page.goto('/art/');

        await expect(page.locator('video')).toHaveCount(0);
    });

    test('shifts no layout while it loads', async ({ page }) => {
        await page.addInitScript(() => {
            const w = window as unknown as { __shift: number };
            w.__shift = 0;
            new PerformanceObserver((list) => {
                for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
                    if (!entry.hadRecentInput) w.__shift += entry.value;
                }
            }).observe({ type: 'layout-shift', buffered: true });
        });
        await page.goto('/art/');
        await page.waitForLoadState('networkidle');

        const shift = await page.evaluate(() => (window as unknown as { __shift: number }).__shift);
        expect(shift).toBeLessThan(0.01);
    });
});

test.describe('art lightbox', () => {
    test.skip(entries.length === 0, 'There are no art pieces yet (src/data/gallery/art.json is empty).');

    test('opens a piece from its tile, on a paper backdrop', async ({ page }) => {
        await stubRemotePhotos(page);
        await page.goto('/art/');
        await expect(page.locator('[data-gallery][data-collection="art"]').first()).toBeVisible();

        await page.locator('[data-gallery] a').first().click();

        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.locator('.pswp__img--on-paper').first()).toBeVisible();
    });

    test('opens the piece an #art- fragment names, and drops the fragment on close', async ({ page }) => {
        await stubRemotePhotos(page);
        const id = collectionAnchorId('art', entries[0].key);
        await page.goto(`/art/#${id}`);

        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(async () => {
            await page.keyboard.press('Escape');
            await expect(dialog).toBeHidden({ timeout: 1000 });
        }).toPass();
        expect(new URL(page.url()).hash).toBe('');
    });
});
