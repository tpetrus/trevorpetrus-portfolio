import { expect, test, type Locator } from '@playwright/test';

// The cover project. Smoke-safe: every assertion is about the committed content and markup, none
// depends on the project's own site being up (the links are only read, never followed).
const PROJECT = {
    title: 'AudioVisualizer',
    href: 'https://audiovisualizer.trevorpetr.us',
    repo: 'https://github.com/tpetrus/AudioVisualizer',
};

const OTHER_PROJECTS = [
    { title: 'claude-code-workflows', repo: 'https://github.com/tpetrus/claude-code-workflows' },
    { title: 'trevorpetrus-portfolio', repo: 'https://github.com/tpetrus/trevorpetrus-portfolio' },
    { title: 'ci-workflows', repo: 'https://github.com/tpetrus/ci-workflows' },
];

// The hover box's two colors as the browser reports them (accent and accent-deep in global.css).
const ACCENT = 'rgb(255, 77, 31)';
const ACCENT_DEEP = 'rgb(184, 46, 0)';

// The card's computed box-shadow, compared as plain text: at rest it holds neither accent, and hovered or focused it
// lists the accent-deep ring and the accent offset.
const boxShadow = (card: Locator) => card.evaluate((element) => getComputedStyle(element).boxShadow);
const accentsIn = (shadow: string) => ({ accent: shadow.includes(ACCENT), accentDeep: shadow.includes(ACCENT_DEEP) });

test.describe('projects page @smoke', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/projects/');
    });

    test('renders the cover and three index rows, the new ones linking to their repos', async ({ page }) => {
        const cards = page.getByRole('article');

        await expect(cards).toHaveCount(4);
        await expect(cards.first().getByRole('heading', { level: 2, name: PROJECT.title })).toBeVisible();
        for (const { title, repo } of OTHER_PROJECTS) {
            const card = cards.filter({ has: page.getByRole('heading', { level: 2, name: title }) });
            await expect(card).toHaveCount(1);
            // No subdomain: both the title and the icon go to the repo.
            await expect(card.getByRole('heading', { level: 2 }).getByRole('link')).toHaveAttribute('href', repo);
            await expect(card.getByRole('link', { name: `${title} on GitHub` })).toHaveAttribute('href', repo);
        }
    });

    test('hovering a card draws an accent box without moving anything', async ({ page }) => {
        const hoverCapable = await page.evaluate(() => matchMedia('(hover: hover)').matches);
        test.skip(!hoverCapable, 'Touch devices have no hover.');
        const cards = page.getByRole('article');

        for (let index = 0; index < 4; index++) {
            const card = cards.nth(index);
            await card.scrollIntoViewIfNeeded();
            await page.mouse.move(0, 0);
            // At rest both shadows are transparent: no accent color anywhere in the value.
            await expect
                .poll(async () => accentsIn(await boxShadow(card)))
                .toEqual({ accent: false, accentDeep: false });
            await expect(card).not.toHaveCSS('box-shadow', 'none');
            // Page coordinates, not the viewport's: under the sticky header, hover() may scroll the title into view
            // first, which moves the viewport box without anything shifting.
            const pageBox = () =>
                card.evaluate((element) => {
                    const { x, y, width, height } = element.getBoundingClientRect();
                    return { x: x + scrollX, y: y + scrollY, width, height };
                });
            const before = await pageBox();

            // Hover the title area, which the stretched link makes part of the card.
            await card.getByRole('heading', { level: 2 }).hover();
            await expect.poll(async () => accentsIn(await boxShadow(card))).toEqual({ accent: true, accentDeep: true });
            expect(await pageBox()).toEqual(before);
        }
    });

    test('tabbing to a card shows the same box', async ({ page, browserName }) => {
        test.skip(browserName === 'webkit', 'WebKit does not tab to links by default.');
        const card = page.getByRole('article').first();
        await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Projects' }).focus();
        await page.mouse.move(0, 0);
        // Document coordinates: focusing scrolls the page, which moves the viewport box without moving the card.
        const documentBox = () =>
            card.evaluate((element) => {
                const { x, y, width, height } = element.getBoundingClientRect();
                return { x: x + scrollX, y: y + scrollY, width, height };
            });
        const before = await documentBox();

        await page.keyboard.press('Tab');
        await expect(card.getByRole('heading', { level: 2 }).getByRole('link')).toBeFocused();
        await expect.poll(async () => accentsIn(await boxShadow(card))).toEqual({ accent: true, accentDeep: true });
        expect(await documentBox()).toEqual(before);
    });

    test('each index row box encloses its number', async ({ page }) => {
        const rows = page.getByRole('list', { name: 'More projects' }).getByRole('article');

        await expect(rows).toHaveCount(3);
        for (let index = 0; index < 3; index++) {
            const row = rows.nth(index);
            const card = await row.boundingBox();
            const number = await row.locator('[data-index]').boundingBox();
            if (!card || !number) throw new Error('The row or its number has no layout box.');
            expect(number.x).toBeGreaterThanOrEqual(card.x);
            expect(number.y).toBeGreaterThanOrEqual(card.y);
            expect(number.x + number.width).toBeLessThanOrEqual(card.x + card.width);
            expect(number.y + number.height).toBeLessThanOrEqual(card.y + card.height);
        }
    });

    test('the title and GitHub links open in a new tab without leaking the opener', async ({ page }) => {
        const cards = page.getByRole('article');

        for (let index = 0; index < 4; index++) {
            const card = cards.nth(index);
            const links = [
                card.getByRole('heading', { level: 2 }).getByRole('link'),
                card.getByRole('link', { name: /on GitHub \(opens in a new tab\)$/ }),
            ];
            for (const link of links) {
                await expect(link).toHaveAttribute('target', '_blank');
                await expect(link).toHaveAttribute('rel', /noopener/);
            }
        }
    });

    test('on a wide desktop the cover is a smaller screenshot and the numeral lines up with the title', async ({
        page,
    }) => {
        test.skip((page.viewportSize()?.width ?? 0) < 1280, 'The two-column cover is measured on desktop widths.');
        const card = page.getByRole('article').first();
        const articleBox = await card.boundingBox();
        const imageBox = await card.locator('picture').boundingBox();
        const numeralBox = await card.locator('[data-index]').boundingBox();
        const titleBox = await card.getByRole('heading', { level: 2 }).boundingBox();
        if (!articleBox || !imageBox || !numeralBox || !titleBox) throw new Error('A cover element has no layout box.');

        expect(imageBox.width).toBeLessThanOrEqual(articleBox.width * 0.65);
        expect(Math.abs(numeralBox.x - titleBox.x)).toBeLessThanOrEqual(1);
    });

    test('shows the project card with its description, tech tags and status', async ({ page }) => {
        const card = page.getByRole('article').first();

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
        // Only the index rows are ordered; the cover is the lowest `order`, whatever its number is.
        const rowNumbers = await page
            .getByRole('list', { name: 'More projects' })
            .locator('[data-index]')
            .allTextContents();

        expect(numbers.length).toBeGreaterThan(0);
        for (const number of numbers) expect(number).toMatch(/^\d{2,}$/);
        expect(rowNumbers.map(Number)).toEqual([...rowNumbers.map(Number)].sort((a, b) => b - a));
    });

    test('shows the status as plain bold text above the title', async ({ page }) => {
        const status = page.getByRole('article').first().getByText('Live', { exact: true });

        await expect(status).toHaveCSS('font-weight', '700');
        await expect(status).toHaveCSS('text-transform', 'uppercase');
        // Text, not a chip: no fill and no border to carry the meaning.
        await expect(status).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(status).toHaveCSS('border-top-width', '0px');
    });

    test('the whole card is the title link, except the GitHub icon on top of it', async ({ page }) => {
        const card = page.getByRole('article').first();
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
        // The cover's last paragraph is the description.
        expect(await hrefAt(await centerOf(card.locator('p').last()))).toBe(`${PROJECT.href}/`);
        expect(await hrefAt(await centerOf(githubLink))).toBe(PROJECT.repo);
    });

    test('the thumbnail is responsive, sized, and loaded eagerly as the first card', async ({ page }) => {
        const image = page.getByRole('img', { name: `Screenshot of ${PROJECT.title}` });

        // The source is 1280x800 until the screenshot is recaptured at 2x (2560x1600); the 16:10 ratio holds for both.
        const width = Number(await image.getAttribute('width'));
        const height = Number(await image.getAttribute('height'));
        expect(width).toBeGreaterThanOrEqual(1280);
        expect(width / height).toBe(1.6);
        await expect(image).toHaveAttribute('srcset', /640w.*1280w/);
        await expect(image).toHaveAttribute('loading', 'eager');
        await expect(image).toHaveAttribute('fetchpriority', 'high');
        await expect(image.locator('xpath=preceding-sibling::source')).toHaveAttribute('type', 'image/avif');
        // `complete` and a non-zero natural size prove the file actually decoded, not just that the markup is right.
        await expect
            .poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0))
            .toBe(true);
    });

    test('shows when the project was last updated', async ({ page }) => {
        const updated = page.locator('article time[datetime]').first();

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
