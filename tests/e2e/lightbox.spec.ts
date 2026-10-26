import { expect, test, type Locator, type Page } from '@playwright/test';

import { originalImageUrl } from '../../src/lib/imageUrl';
import { readGalleryEntries } from './galleryData';
import { stubRemotePhotos } from './stubPhotos';

const entries = readGalleryEntries('photography');

// Opens the first photo, checks the dialog and its "View original" link, closes it with Escape and checks that focus
// went back to the thumbnail. Used before and after a View Transitions round trip: PhotoSwipe binds to the elements
// present when it is created, so the second pass proves the lightbox was re-created for the swapped-in page.
async function openAndCloseFirstPhoto(
    page: Page,
    first: (typeof entries)[number],
    browserName: string,
): Promise<Locator> {
    const thumbnail = page.locator('#gallery a').first();
    await thumbnail.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const viewOriginal = dialog.getByRole('link', { name: 'View original' });
    await expect(viewOriginal).toHaveAttribute('href', originalImageUrl(first.key));
    await expect(viewOriginal).toHaveAttribute('target', '_blank');
    await expect(viewOriginal).toHaveAttribute('rel', /noopener/);
    // The caption element shows what the thumbnail link carries, and is hidden when there is none.
    const caption = (await thumbnail.getAttribute('data-caption')) ?? '';
    const captionElement = dialog.locator('.pswp__gallery-caption');
    if (caption === '') {
        await expect(captionElement).toBeHidden();
    } else {
        await expect(captionElement).toHaveText(caption);
    }

    // PhotoSwipe ignores a close request while its opening animation runs, so press Escape until it takes.
    await expect(async () => {
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden({ timeout: 1000 });
    }).toPass();
    // WebKit does not focus a link when it is clicked, so there is no previously focused element to return to.
    if (browserName !== 'webkit') await expect(thumbnail).toBeFocused();
    return thumbnail;
}

test.describe('photography lightbox', () => {
    test.skip(entries.length === 0, 'There are no photos yet (src/data/gallery/photography.json is empty).');

    test('opens a photo with a View original link, and Escape returns focus to the thumbnail', async ({
        page,
        browserName,
    }) => {
        await page.goto('/photography/');

        await openAndCloseFirstPhoto(page, entries[0], browserName);
    });

    test('opens from every tile with its own original-image link, and no tile is marked cropped', async ({ page }) => {
        test.slow();
        await stubRemotePhotos(page);
        await page.goto('/photography/');
        await expect(page.locator('#gallery [data-cropped]')).toHaveCount(0);

        for (const [index, { key }] of entries.entries()) {
            await page.locator('#gallery a').nth(index).scrollIntoViewIfNeeded();
            await page.locator('#gallery a').nth(index).click();
            const dialog = page.getByRole('dialog');
            await expect(dialog).toBeVisible();
            await expect(dialog.getByRole('link', { name: 'View original' })).toHaveAttribute(
                'href',
                originalImageUrl(key),
            );
            await expect(async () => {
                await page.keyboard.press('Escape');
                await expect(dialog).toBeHidden({ timeout: 1000 });
            }).toPass();
        }
    });

    test('still works after navigating away and back with View Transitions', async ({ page, browserName }) => {
        await page.goto('/photography/');
        await openAndCloseFirstPhoto(page, entries[0], browserName);
        // A full page load would discard this window property; View Transitions navigation keeps it.
        await page.evaluate(() => Reflect.set(window, 'navMarker', true));

        const nav = page.getByRole('navigation', { name: 'Primary' });
        await nav.getByRole('link', { name: 'Projects' }).click();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Projects');
        await nav.getByRole('link', { name: 'Photography' }).click();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Photography');
        expect(await page.evaluate(() => Reflect.get(window, 'navMarker') as unknown)).toBe(true);

        await openAndCloseFirstPhoto(page, entries[0], browserName);
    });

    // Regression: leaving the page with the viewer open used to crash the WebKit page process, so the navigation never
    // finished. The first tile is clicked and the page is left straight away, without closing the viewer.
    test('closes the viewer when navigating away with it open, and works again on return', async ({
        page,
        browserName,
    }) => {
        await page.goto('/photography/');
        await page.locator('#gallery a').first().click();
        await expect(page.getByRole('dialog')).toBeVisible();

        // The open viewer covers the nav, so a real click would be intercepted; this is what following the link does.
        await page
            .getByRole('navigation', { name: 'Primary' })
            .getByRole('link', { name: 'Projects' })
            .evaluate((link: HTMLElement) => link.click());
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Projects');
        await expect(page.getByRole('dialog')).toHaveCount(0);

        await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Photography' }).click();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Photography');
        await openAndCloseFirstPhoto(page, entries[0], browserName);
    });
});
