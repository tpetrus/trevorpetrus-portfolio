import { expect, test, type Page } from '@playwright/test';

const WIDTHS = [320, 375, 768, 1024, 1440, 1920];

interface TitleMetrics {
    column: number;
    text: number;
    fontSize: number;
    boxHeight: number;
}

// The width of the letters (a Range over the text, so the clipped box does not matter), of the column that holds
// them, and the h1's computed size and box height.
async function titleMetrics(page: Page): Promise<TitleMetrics> {
    return page.evaluate(() => {
        const h1 = document.querySelector('h1');
        const column = document.querySelector('.page-title');
        if (!h1 || !column) throw new Error('No page title.');
        const range = document.createRange();
        range.selectNodeContents(h1);
        return {
            column: column.getBoundingClientRect().width,
            text: range.getBoundingClientRect().width,
            fontSize: parseFloat(getComputedStyle(h1).fontSize),
            boxHeight: h1.getBoundingClientRect().height,
        };
    });
}

async function open(page: Page, path: string): Promise<void> {
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
}

const video = (page: Page) => page.locator('[data-title-video]');
const toggle = (page: Page) => page.locator('[data-title-video-toggle]');

test.describe('page titles', () => {
    for (const [path, name] of [
        ['/photography/', 'Photography'],
        ['/projects/', 'Projects'],
    ] as const) {
        test(`${path} has the title as its one h1, with no wordmark marker`, async ({ page }) => {
            await open(page, path);

            await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
            await expect(page.getByRole('main').getByRole('heading', { level: 1, name })).toBeVisible();
            await expect(page.locator('[data-wordmark]')).toHaveCount(0);
            await expect(page.locator('[data-header-name]')).toHaveCSS('opacity', '1');
        });

        test(`${path} reserves the title height from the font size and has no console errors`, async ({ page }) => {
            const errors: string[] = [];
            page.on('pageerror', (error) => errors.push(error.message));
            page.on('console', (message) => {
                if (message.type() === 'error') errors.push(message.text());
            });
            await open(page, path);

            const { fontSize, boxHeight } = await titleMetrics(page);
            expect(Math.abs(boxHeight - fontSize * 0.85)).toBeLessThanOrEqual(1);
            expect(errors).toEqual([]);
        });
    }

    for (const width of WIDTHS) {
        test(`PHOTOGRAPHY spans 65% to 75% of the column at ${width}px, and Projects matches its size`, async ({
            page,
        }) => {
            await page.setViewportSize({ width, height: 900 });
            await open(page, '/photography/');
            const photography = await titleMetrics(page);

            expect(photography.text).toBeGreaterThanOrEqual(photography.column * 0.65);
            expect(photography.text).toBeLessThanOrEqual(photography.column * 0.75);

            await open(page, '/projects/');
            const projects = await titleMetrics(page);
            expect(projects.fontSize / projects.column).toBeCloseTo(photography.fontSize / photography.column, 3);
            expect(projects.text).toBeLessThan(photography.text);
        });
    }

    test('does not scroll sideways at 320px on either page', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 800 });
        for (const path of ['/photography/', '/projects/']) {
            await open(page, path);
            const overflow = await page.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            );
            expect(overflow).toBeLessThanOrEqual(0);
        }
    });

    test('puts the decorative video on Photography only, clear of what follows', async ({ page }) => {
        await open(page, '/projects/');
        await expect(video(page)).toHaveCount(0);
        await expect(toggle(page)).toHaveCount(0);

        for (const width of [375, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            await open(page, '/photography/');
            await expect(video(page)).toHaveCount(1);
            await expect(video(page)).toHaveAttribute('aria-hidden', 'true');
            await expect(video(page)).not.toHaveAttribute('autoplay', /.*/);
            await expect(video(page)).toHaveAttribute('tabindex', '-1');
            // The framed video is the play/pause button itself, with no separate control drawn over it.
            await expect(toggle(page).locator('[data-title-video]')).toHaveCount(1);
            await expect(toggle(page)).toHaveAccessibleName(/background video/);
            const frame = await toggle(page).evaluate((el) => {
                const style = getComputedStyle(el);
                const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
                const probe = document.createElement('div');
                probe.style.color = accent;
                document.body.append(probe);
                const accentRgb = getComputedStyle(probe).color;
                probe.remove();
                return { width: style.borderTopWidth, color: style.borderTopColor, accentRgb };
            });
            expect(parseFloat(frame.width)).toBeGreaterThan(0);
            expect(frame.color).toBe(frame.accentRgb);

            const boxes = await page.evaluate(() => {
                // The framed box (the toggle button) is what is placed and sized; the video fills it inside the frame.
                const media = document.querySelector('[data-title-video-toggle]')!.getBoundingClientRect();
                // The component's own module script sits right after the title and has no box, so it is skipped.
                let next = document.querySelector('.page-title')!.nextElementSibling;
                while (next && next.tagName === 'SCRIPT') next = next.nextElementSibling;
                const column = document.querySelector('.page-title')!.getBoundingClientRect();
                return {
                    mediaLeft: media.left - column.left,
                    mediaWidth: media.width,
                    column: column.width,
                    mediaBottom: media.bottom,
                    nextTop: next ? next.getBoundingClientRect().top : null,
                };
            });
            // A third of the column on wide screens; below 48rem it runs from its left edge to the column's right edge.
            if (width < 768) {
                expect(boxes.mediaWidth / boxes.column).toBeCloseTo(1 / 2, 2);
                expect(boxes.mediaLeft + boxes.mediaWidth).toBeCloseTo(boxes.column, 0);
            } else {
                expect(boxes.mediaWidth / boxes.column).toBeCloseTo(1 / 3, 2);
            }
            expect(boxes.mediaLeft / boxes.column).toBeGreaterThanOrEqual(0.45);
            expect(boxes.mediaLeft / boxes.column).toBeLessThanOrEqual(0.55);
            if (boxes.nextTop !== null) expect(boxes.mediaBottom).toBeLessThanOrEqual(boxes.nextTop + 0.5);
        }
    });

    test('keeps the video paused under reduced motion, and the toggle can still play it', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await open(page, '/photography/');

        await expect(toggle(page)).toBeVisible();
        await expect(toggle(page)).toHaveAttribute('aria-label', 'Play background video');
        expect(await video(page).evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);

        await toggle(page).click();
        await expect.poll(() => video(page).evaluate((el: HTMLVideoElement) => el.paused)).toBe(false);
        await expect(toggle(page)).toHaveAttribute('aria-label', 'Pause background video');
    });

    test('plays the video and the toggle pauses and resumes it', async ({ page }) => {
        await open(page, '/photography/');

        await expect.poll(() => video(page).evaluate((el: HTMLVideoElement) => el.paused)).toBe(false);
        await expect(toggle(page)).toHaveAttribute('aria-label', 'Pause background video');

        await toggle(page).click();
        await expect.poll(() => video(page).evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);
        await expect(toggle(page)).toHaveAttribute('aria-label', 'Play background video');

        await toggle(page).click();
        await expect.poll(() => video(page).evaluate((el: HTMLVideoElement) => el.paused)).toBe(false);
        await expect(toggle(page)).toHaveAttribute('aria-label', 'Pause background video');
    });

    test('pauses the video off-screen and resumes it on return, unless the visitor paused it', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 600 });
        await open(page, '/photography/');
        const isPaused = () => video(page).evaluate((el: HTMLVideoElement) => el.paused);
        await expect.poll(isPaused).toBe(false);

        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expect.poll(isPaused).toBe(true);
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect.poll(isPaused).toBe(false);

        await toggle(page).click();
        await expect.poll(isPaused).toBe(true);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(500);
        expect(await isPaused()).toBe(true);
    });
});
