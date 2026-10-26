import { expect, test, type Page } from '@playwright/test';

import { stubRemotePhotos } from './stubPhotos';

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
