import { expect, test, type Page } from '@playwright/test';

const PAGES = ['/', '/projects/', '/photography/'];

const name = (page: Page) => page.locator('[data-header-name]');
const header = (page: Page) => page.locator('[data-site-header]');

async function scrollPastWordmark(page: Page): Promise<void> {
    await page.evaluate(() => {
        // The home page is short on a phone while the gallery is empty, so it could not scroll far enough for the
        // wordmark to pass under the header; room is added to the main element so the test does not depend on the data.
        const room = document.createElement('div');
        room.style.height = '3000px';
        document.querySelector('main')!.append(room);
        const wordmark = document.querySelector('[data-wordmark]')!.getBoundingClientRect();
        window.scrollTo(0, window.scrollY + wordmark.bottom + 200);
    });
}

test.describe('sticky header and name handoff', () => {
    for (const path of PAGES) {
        test(`${path} keeps the header at the top after scrolling`, async ({ page }) => {
            await page.goto(path);
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

            await expect.poll(async () => (await header(page).boundingBox())?.y).toBe(0);
        });
    }

    for (const path of ['/projects/', '/photography/']) {
        test(`${path} shows the header name at the top`, async ({ page }) => {
            await page.goto(path);

            await expect(name(page)).toHaveCSS('opacity', '1');
        });
    }

    test('/ hides the name at the top but keeps it focusable, and focus shows it', async ({ page }) => {
        await page.goto('/');

        await expect(name(page)).toHaveCSS('opacity', '0');
        // Focus from script, as shell.spec.ts does: WebKit does not Tab to links by default, and :focus-visible
        // matches a script focus when the last input was not a pointer.
        await name(page).focus();
        await expect(name(page)).toBeFocused();
        await expect(name(page)).toHaveCSS('opacity', '1');
    });

    test('/ docks the name after the wordmark scrolls away and undocks on the way back', async ({ page }) => {
        await page.goto('/');
        await expect(name(page)).toHaveCSS('opacity', '0');

        await scrollPastWordmark(page);
        await expect(name(page)).toHaveCSS('opacity', '1');
        await expect(name(page)).toHaveCSS('transform', 'none');

        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(name(page)).toHaveCSS('opacity', '0');
    });

    test('the handoff still works after View Transitions navigations', async ({ page }) => {
        await page.goto('/projects/');
        await expect(name(page)).toHaveCSS('opacity', '1');

        await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Home' }).click();
        await expect(page).toHaveURL(/\/$/);
        await expect(name(page)).toHaveCSS('opacity', '0');
        await scrollPastWordmark(page);
        await expect(name(page)).toHaveCSS('opacity', '1');

        await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Projects' }).click();
        await expect(page).toHaveURL(/\/projects\/$/);
        await expect(name(page)).toHaveCSS('opacity', '1');
    });

    test('reduced motion docks without a translate', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/');
        await expect(name(page)).toHaveCSS('transform', 'none');

        await scrollPastWordmark(page);
        await expect(name(page)).toHaveCSS('opacity', '1');
        await expect(name(page)).toHaveCSS('transform', 'none');
    });
});

test.describe('header and focus', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    // The header wraps on a phone, so scroll-padding-top must cover its real height or a focused link sits under it.
    test('/projects/ keeps a focused element below the fold clear of the sticky header', async ({ page }) => {
        await page.goto('/projects/');
        const target = page.locator('main a').last();
        await target.focus();
        await expect(target).toBeFocused();
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

        const headerBox = (await header(page).boundingBox())!;
        await expect
            .poll(async () => (await target.boundingBox())!.y)
            .toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
    });
});

// Without JavaScript the header name stays hidden on the home page, so the h1 must carry the name.
test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('/ still has the h1 and the Primary nav Home link', async ({ page }) => {
        await page.goto('/');

        await expect(page.getByRole('heading', { level: 1, name: 'Trevor Petrus' })).toBeVisible();
        await expect(
            page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Home' }),
        ).toBeVisible();
    });
});
