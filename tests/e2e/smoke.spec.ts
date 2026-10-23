import { expect, test, type Page } from '@playwright/test';

const PAGES = [
    { path: '/', link: 'Home', heading: 'Trevor Petrus' },
    { path: '/photography/', link: 'Photography', heading: 'Photography' },
    { path: '/projects/', link: 'Projects', heading: 'Projects' },
] as const;

// Collects everything that would show up as a red entry in the browser console.
function collectErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    return errors;
}

test.describe('site @smoke', () => {
    for (const { path, heading } of PAGES) {
        test(`${path} loads with one h1 "${heading}"`, async ({ page }) => {
            const errors = collectErrors(page);

            const response = await page.goto(path);

            expect(response?.ok()).toBe(true);
            await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
            await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
            await expect(page).toHaveTitle(/ \| Trevor Petrus$/);
            expect(errors).toEqual([]);
        });
    }

    test('nav links navigate between pages and mark the current one', async ({ page }) => {
        const errors = collectErrors(page);
        await page.goto('/');
        // A full page load would discard this window property; View Transitions navigation keeps it.
        await page.evaluate(() => Reflect.set(window, 'navMarker', true));

        const nav = page.getByRole('navigation', { name: 'Primary' });
        for (const { path, link, heading } of PAGES.slice(1)) {
            await nav.getByRole('link', { name: link }).click();

            await expect(page).toHaveURL(new RegExp(`${path}$`));
            await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
            await expect(nav.getByRole('link', { name: link })).toHaveAttribute('aria-current', 'page');
            await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
        }

        await nav.getByRole('link', { name: 'Home' }).click();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Trevor Petrus');
        expect(await page.evaluate(() => Reflect.get(window, 'navMarker') as unknown)).toBe(true);
        expect(errors).toEqual([]);
    });

    test('the skip link is the first tab stop and moves focus to the main landmark', async ({ page, browserName }) => {
        // WebKit does not tab to links by default (macOS "Full Keyboard Access"), so the keyboard path is meaningless.
        test.skip(browserName === 'webkit', 'WebKit does not tab to links by default.');
        await page.goto('/');

        await page.keyboard.press('Tab');
        const skipLink = page.getByRole('link', { name: 'Skip to main content' });
        await expect(skipLink).toBeFocused();
        await page.keyboard.press('Enter');

        await expect(page.getByRole('main')).toBeFocused();
    });
});
