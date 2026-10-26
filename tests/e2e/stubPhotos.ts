import type { Page } from '@playwright/test';

import { PHOTOS_ORIGIN } from '../../src/config/site';
import { readGalleryEntries } from './galleryData';

// A remote gallery image (from R2 / Cloudflare Images on PHOTOS_ORIGIN) is replaced by a flat gray SVG with the photo's
// own aspect ratio, so a spec never depends on the network or on which photos exist, and the loaded image keeps the
// ratio the page reserved for it (a loaded image's intrinsic ratio wins over the width and height attributes, so a stub
// of another ratio would change the layout). Requests that match no entry get a 3:2 image.
function stubSvg(width: number, height: number): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#808080"/></svg>`;
}

/** Answers every request to the photo host with a gray stand-in image of the right proportions. */
export async function stubRemotePhotos(page: Page): Promise<void> {
    const entries = readGalleryEntries('photography');
    await page.route(`${PHOTOS_ORIGIN}/**`, async (route) => {
        const url = decodeURIComponent(route.request().url());
        const entry = entries.find(({ key }) => url.endsWith(`/${key}`));
        await route.fulfill({
            status: 200,
            contentType: 'image/svg+xml',
            body: stubSvg(entry?.width ?? 3, entry?.height ?? 2),
        });
    });
}
