import { expect, test } from '@playwright/test';

// The computed values of the focus-ring tokens in src/styles/global.css: --color-accent-deep and --color-accent.
const ACCENT_DEEP = 'rgb(184, 46, 0)';
const ACCENT = 'rgb(255, 77, 31)';

test.describe('site shell', () => {
    test('a focused header nav link shows the accent-deep ring on paper', async ({ page }) => {
        await page.goto('/');
        const link = page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Projects' });

        await link.focus();
        // :focus-visible matches after a keyboard-driven focus; focus() from a script counts when the last input was
        // not a pointer, which holds on a fresh page.
        await expect(link).toBeFocused();

        await expect(link).toHaveCSS('outline-color', ACCENT_DEEP);
        await expect(link).toHaveCSS('outline-width', '2px');
        await expect(link).toHaveCSS('outline-style', 'solid');
        await expect(link).toHaveCSS('outline-offset', '2px');
    });

    test('a focused footer link shows the accent ring on ink', async ({ page }) => {
        await page.goto('/');
        const link = page.getByRole('contentinfo').getByRole('link').first();

        await link.focus();
        await expect(link).toBeFocused();

        await expect(link).toHaveCSS('outline-color', ACCENT);
        await expect(link).toHaveCSS('outline-width', '2px');
        await expect(link).toHaveCSS('outline-offset', '2px');
    });

    test('the footer is an ink band', async ({ page }) => {
        await page.goto('/');

        await expect(page.getByRole('contentinfo')).toHaveCSS('background-color', 'rgb(14, 14, 12)');
    });

    for (const { path, text } of [
        { path: '/', text: 'Trevor Petrus' },
        { path: '/photography/', text: 'Trevor Petrus — Photography' },
        { path: '/projects/', text: 'Trevor Petrus — Projects' },
    ]) {
        test(`${path} has a decorative running head that assistive tech does not see`, async ({ page }) => {
            await page.goto(path);

            const head = page.locator('[data-running-head]');
            await expect(head).toHaveAttribute('aria-hidden', 'true');
            await expect(head).toHaveText(text);
        });
    }

    test('the running head shows only at wide viewports and never causes horizontal scroll', async ({
        page,
        viewport,
    }) => {
        await page.goto('/projects/');
        const head = page.locator('[data-running-head]');

        const wide = (viewport?.width ?? 0) >= 1280;
        await expect(head).toBeVisible({ visible: wide });
        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBe(0);
    });

    test('the running head does not overlap the main content', async ({ page, viewport }) => {
        test.skip((viewport?.width ?? 0) < 1280, 'The running head is hidden below 1280px.');
        await page.goto('/projects/');

        const head = await page.locator('[data-running-head]').boundingBox();
        const main = await page.getByRole('main').locator('h1').boundingBox();

        expect(head).not.toBeNull();
        expect(main).not.toBeNull();
        expect(head!.x + head!.width).toBeLessThanOrEqual(main!.x);
    });

    test('exactly one header nav link is current on each page', async ({ page }) => {
        for (const [path, name] of [
            ['/', 'Home'],
            ['/photography/', 'Photography'],
            ['/projects/', 'Projects'],
        ] as const) {
            await page.goto(path);
            const nav = page.getByRole('navigation', { name: 'Primary' });

            await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
            await expect(nav.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
        }
    });

    // WCAG 1.4.10 Reflow: no sideways scrolling down to 320 CSS px wide.
    for (const width of [320, 360]) {
        for (const path of ['/', '/photography/', '/projects/']) {
            test(`${path} does not scroll sideways at ${width}px wide`, async ({ page }) => {
                await page.setViewportSize({ width, height: 800 });
                await page.goto(path);

                const { scrollWidth, innerWidth } = await page.evaluate(() => ({
                    scrollWidth: document.documentElement.scrollWidth,
                    innerWidth: window.innerWidth,
                }));
                expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
            });
        }
    }
});
