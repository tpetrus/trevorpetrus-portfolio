import { expect, test } from '@playwright/test';

// The one project that exists at launch. Smoke-safe: every assertion is about the committed content and markup, none
// depends on the project's own site being up (the links are only read, never followed).
const PROJECT = {
    title: 'AudioVisualizer',
    href: 'https://audio-visualizer.mypoke.workers.dev',
    repo: 'https://github.com/tpetrus/AudioVisualizer',
};

test.describe('projects page @smoke', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/projects/');
    });

    test('shows the project card with its description, tech tags and status', async ({ page }) => {
        const card = page.getByRole('article');

        await expect(card).toHaveCount(1);
        await expect(card.getByRole('heading', { level: 2, name: PROJECT.title })).toBeVisible();
        await expect(card.getByRole('list', { name: 'Technologies' }).getByRole('listitem')).toContainText([
            'TypeScript',
            'React',
            'three.js',
            'Web Audio API',
            'Tailwind CSS',
        ]);
        await expect(card.getByText('Live', { exact: true })).toBeVisible();
    });

    test('the title links to the live subdomain and the icon links to the repo', async ({ page }) => {
        await expect(
            page.getByRole('heading', { level: 2 }).getByRole('link', { name: PROJECT.title }),
        ).toHaveAttribute('href', PROJECT.href);
        await expect(page.getByRole('link', { name: `${PROJECT.title} on GitHub` })).toHaveAttribute(
            'href',
            PROJECT.repo,
        );
    });

    test('the thumbnail is responsive, sized, and loaded eagerly as the first card', async ({ page }) => {
        const image = page.getByRole('img', { name: `Screenshot of ${PROJECT.title}` });

        await expect(image).toHaveAttribute('width', '1280');
        await expect(image).toHaveAttribute('height', '800');
        await expect(image).toHaveAttribute('srcset', /480w.*1280w/);
        await expect(image).toHaveAttribute('loading', 'eager');
        await expect(image).toHaveAttribute('fetchpriority', 'high');
        await expect(image.locator('xpath=preceding-sibling::source')).toHaveAttribute('type', 'image/avif');
        // `complete` and a non-zero natural size prove the file actually decoded, not just that the markup is right.
        await expect
            .poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0))
            .toBe(true);
    });

    test('shows when the project was last updated', async ({ page }) => {
        const updated = page.locator('article time[datetime]');

        await expect(updated).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}$/);
        await expect(updated).toHaveText(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    });

    test('keyboard focus reaches the title link, then the GitHub link, each with a visible focus ring', async ({
        page,
        browserName,
    }) => {
        // WebKit does not tab to links by default (macOS "Full Keyboard Access"), so the keyboard path is meaningless.
        test.skip(browserName === 'webkit', 'WebKit does not tab to links by default.');
        const titleLink = page.getByRole('heading', { level: 2 }).getByRole('link', { name: PROJECT.title });
        const githubLink = page.getByRole('link', { name: `${PROJECT.title} on GitHub` });
        await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Projects' }).focus();

        await page.keyboard.press('Tab');
        await expect(titleLink).toBeFocused();
        // The ring is drawn on the link's stretched ::after overlay so it outlines the whole card.
        const overlayOutline = await titleLink.evaluate((element) => getComputedStyle(element, '::after').outlineStyle);
        expect(overlayOutline).not.toBe('none');

        await page.keyboard.press('Tab');
        await expect(githubLink).toBeFocused();
        await expect(githubLink).not.toHaveCSS('outline-style', 'none');
    });
});
