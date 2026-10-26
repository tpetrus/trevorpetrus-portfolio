import { expect, test, type Page } from '@playwright/test';

import { PHOTOS_ORIGIN } from '../../src/config/site';

// Full-page visual baselines for every page, once per Playwright project (desktop Chrome, Pixel 7, iPhone 15).
//
// Baselines are rendered by .github/workflows/update-snapshots.yml in the Playwright container image on Linux, the same
// image CI's e2e job uses, and committed by that workflow. Playwright puts the platform in each snapshot's file name
// (`home-chromium-desktop-linux.png`), so a baseline made on Windows or macOS would never match CI's run. Those runs
// are therefore skipped unless VISUAL_LOCAL=1, which is for proving the spec works, and their files are git-ignored.
test.skip(
    process.platform !== 'linux' && !process.env.VISUAL_LOCAL,
    'Visual baselines are Linux-only; regenerate them with the "Update visual snapshots" workflow (VISUAL_LOCAL=1 forces a local run).',
);

const PAGES = [
    { name: 'home', path: '/' },
    { name: 'photography', path: '/photography/' },
    { name: 'projects', path: '/projects/' },
] as const;

// One fixed 1x1 gray PNG stands in for every remote gallery image (they come from R2 / Cloudflare Images on
// PHOTOS_ORIGIN), so a snapshot never depends on the network or on which photos exist. The tiles keep their real
// width and height attributes, so the layout is the real one.
const PLACEHOLDER_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
);

// Photos are the only remote content; stubbing them keeps a snapshot a function of the build alone.
async function stubRemotePhotos(page: Page): Promise<void> {
    await page.route(`${PHOTOS_ORIGIN}/**`, (route) =>
        route.fulfill({ status: 200, contentType: 'image/png', body: PLACEHOLDER_PNG }),
    );
}

async function waitForStablePage(page: Page): Promise<void> {
    // The fonts are swapped in after first paint; a screenshot before then would catch the fallback faces.
    await page.evaluate(() => document.fonts.ready);
    // A full-page screenshot does not scroll, so lazy images below the fold would never load without this.
    await page.evaluate(async () => {
        const images = [...document.images];
        for (const image of images) image.loading = 'eager';
        await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
    });
}

test.describe('visual baseline', () => {
    test.use({ reducedMotion: 'reduce' });

    for (const { name, path } of PAGES) {
        test(`${path} matches its baseline`, async ({ page }) => {
            await stubRemotePhotos(page);
            await page.goto(path);
            await waitForStablePage(page);

            await expect(page).toHaveScreenshot(`${name}.png`, {
                fullPage: true,
                animations: 'disabled',
                // The footer carries the build year and the project cards a last-commit date; both change with time
                // alone, so they are masked rather than baked into a baseline that would break on its own.
                mask: [page.locator('footer'), page.locator('time')],
                maxDiffPixelRatio: 0.001,
            });
        });
    }
});
