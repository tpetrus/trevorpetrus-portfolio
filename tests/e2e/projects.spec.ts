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

    test('shows each project number as zero-padded text, highest first', async ({ page }) => {
        const numbers = await page.locator('[data-index]').allTextContents();

        expect(numbers.length).toBeGreaterThan(0);
        for (const number of numbers) expect(number).toMatch(/^\d{2,}$/);
        expect(numbers.map(Number)).toEqual([...numbers.map(Number)].sort((a, b) => b - a));
    });

    test('shows the status as plain bold text above the title', async ({ page }) => {
        const status = page.getByRole('article').getByText('Live', { exact: true });

        await expect(status).toHaveCSS('font-weight', '700');
        await expect(status).toHaveCSS('text-transform', 'uppercase');
        // Text, not a chip: no fill and no border to carry the meaning.
        await expect(status).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(status).toHaveCSS('border-top-width', '0px');
    });

    test('the whole card is the title link, except the GitHub icon on top of it', async ({ page }) => {
        const card = page.getByRole('article');
        const githubLink = page.getByRole('link', { name: `${PROJECT.title} on GitHub` });
        // The link under a point (viewport coordinates), which is what a click there would follow.
        const hrefAt = ({ x, y }: { x: number; y: number }) =>
            page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('a')?.href, [x, y] as const);
        const centerOf = async (locator: typeof card) => {
            await locator.scrollIntoViewIfNeeded();
            const box = await locator.boundingBox();
            if (!box) throw new Error('The element has no layout box.');
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        };

        expect(await hrefAt(await centerOf(card.locator('picture')))).toBe(`${PROJECT.href}/`);
        expect(await hrefAt(await centerOf(card.locator('p').last()))).toBe(`${PROJECT.href}/`);
        expect(await hrefAt(await centerOf(githubLink))).toBe(PROJECT.repo);
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
