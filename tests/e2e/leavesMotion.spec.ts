import { expect, test, type Page } from '@playwright/test';

// The home page's leaves in motion: the loop, its pause button, the tab and preference changes, the wind and the View
// Transitions lifecycle. The still composition is covered by leavesStill.spec.ts.

const layer = (page: Page) => page.locator('[data-leaves]');
const toggle = (page: Page) => page.locator('[data-leaves-toggle]');

const transforms = (page: Page) =>
    page
        .locator('[data-leaf]')
        .evaluateAll((nodes) =>
            nodes.filter((node) => getComputedStyle(node).display !== 'none').map((node) => node.style.transform),
        );

// The horizontal centers of the visible leaves; rotation and the flip turn a leaf about its center, so only the motion
// across the screen moves these.
const centers = (page: Page) =>
    page.locator('[data-leaf]').evaluateAll((nodes) =>
        nodes
            .filter((node) => getComputedStyle(node).display !== 'none')
            .map((node) => {
                const box = node.getBoundingClientRect();
                return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
            }),
    );

const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

// Playwright cannot hide a tab, so the page is told it is hidden the way the browser would tell it.
async function setHidden(page: Page, hidden: boolean): Promise<void> {
    await page.evaluate((value) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => (value ? 'hidden' : 'visible'),
        });
        document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
}

async function openRunning(page: Page): Promise<void> {
    await page.goto('/');
    await expect(layer(page)).toHaveAttribute('data-leaves-state', 'running');
}

test.describe('home leaf layer, in motion', () => {
    test.beforeEach(async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
    });

    test('starts falling after load and offers an enabled pause button', async ({ page }) => {
        await openRunning(page);

        await expect(toggle(page)).toBeVisible();
        await expect(toggle(page)).toBeEnabled();
        await expect(toggle(page)).toHaveAccessibleName('Pause falling leaves');
        await expect(toggle(page)).toHaveAttribute('data-state', 'running');
        const before = await centers(page);
        await page.waitForTimeout(1000);
        const after = await centers(page);
        // Every leaf has moved down (or wrapped back to the top).
        for (const [index, point] of after.entries()) expect(point.y).not.toBe(before[index]?.y);
    });

    test('keeps falling at any scroll position, fixed to the viewport', async ({ page }) => {
        await openRunning(page);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

        const box = await layer(page).boundingBox();
        expect(box?.y).toBe(0);
        const before = await transforms(page);
        await page.waitForTimeout(500);
        expect(await transforms(page)).not.toEqual(before);
    });

    test('pauses and resumes with the button, by pointer and by keyboard', async ({ page }) => {
        await openRunning(page);

        await toggle(page).click();
        await expect(layer(page)).toHaveAttribute('data-leaves-state', 'paused');
        await expect(toggle(page)).toHaveAccessibleName('Play falling leaves');
        await expect(toggle(page)).toHaveText('Play falling leaves');
        await expect(toggle(page)).toHaveAttribute('data-state', 'paused');
        const paused = await transforms(page);
        await page.waitForTimeout(500);
        expect(await transforms(page)).toEqual(paused);

        // Safari does not Tab to buttons by default, so the button is focused directly and activated with the keyboard.
        await toggle(page).focus();
        await page.keyboard.press('Enter');
        await expect(layer(page)).toHaveAttribute('data-leaves-state', 'running');
        await expect(toggle(page)).toHaveAccessibleName('Pause falling leaves');
        await page.keyboard.press('Space');
        await expect(layer(page)).toHaveAttribute('data-leaves-state', 'paused');
    });

    test('pauses while the tab is hidden and resumes without a jump', async ({ page }) => {
        await openRunning(page);

        await setHidden(page, true);
        await expect(layer(page)).toHaveAttribute('data-leaves-state', 'paused');
        const hidden = await centers(page);
        await page.waitForTimeout(1500);
        await setHidden(page, false);
        await expect(layer(page)).toHaveAttribute('data-leaves-state', 'running');
        // A leaf falls a few percent of the viewport per second, so if the hidden time had been added at once a leaf
        // would have leapt; resumed, each moves only a frame or two.
        const resumed = await centers(page);
        const viewportHeight = page.viewportSize()?.height ?? 0;
        for (const [index, point] of resumed.entries()) {
            const moved = Math.abs(point.y - (hidden[index]?.y ?? 0));
            // A leaf that wrapped from the bottom to the top in the resume's first frames moved by most of the viewport;
            // that is the wrap, not a jump.
            if (moved > viewportHeight / 2) continue;
            expect(moved).toBeLessThan(20);
        }
        // The visitor did not pause it, so the button still offers to pause.
        await expect(toggle(page)).toHaveAccessibleName('Pause falling leaves');
    });

    test('freezes in place when reduced motion is switched on, and moves again when it is off', async ({ page }) => {
        await openRunning(page);

        await page.emulateMedia({ reducedMotion: 'reduce' });
        await expect(layer(page)).toHaveAttribute('data-leaves-state', 'still');
        await expect(toggle(page)).toBeHidden();
        const frozen = await transforms(page);
        await page.waitForTimeout(500);
        expect(await transforms(page)).toEqual(frozen);

        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await expect(layer(page)).toHaveAttribute('data-leaves-state', 'running');
        await expect(toggle(page)).toBeVisible();
    });

    test('starts once the preference changes, after a load under reduced motion', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/');
        await expect(layer(page)).toHaveAttribute('data-leaves-state', 'still');
        await expect(toggle(page)).toBeDisabled();

        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await expect(layer(page)).toHaveAttribute('data-leaves-state', 'running');
        await expect(toggle(page)).toBeEnabled();
    });

    test('a scroll blows the leaves sideways, in the scroll direction', async ({ page }) => {
        await openRunning(page);
        // A calm baseline: how far the leaves drift on their own in the same time.
        const calmBefore = await centers(page);
        await page.waitForTimeout(500);
        const calm = (await centers(page)).map((point, index) => point.x - (calmBefore[index]?.x ?? 0));

        const before = await centers(page);
        await page.evaluate(() => window.scrollBy(0, 400));
        // The gust comes from the scroll, so the page must actually have scrolled.
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
        await page.waitForTimeout(500);
        const gust = (await centers(page)).map((point, index) => point.x - (before[index]?.x ?? 0));

        // Scrolling down blows to the right; the median ignores a leaf that wrapped around an edge.
        expect(median(gust)).toBeGreaterThan(median(calm) + 20);
    });

    test('moves every leaf the tier CSS shows when the layer is narrower than the viewport', async ({ page }) => {
        // The tier media queries measure the viewport including a classic scrollbar (15-17 px on Windows), which the
        // fixed layer does not cover. At 1290 px they show all 15 leaves while the layer is about 1273 px wide, so a
        // count taken from the layer would leave the top tier's extra leaves frozen. Headless browsers hide their
        // scrollbars, so the layer is narrowed by the same amount instead.
        await page.setViewportSize({ width: 1290, height: 900 });
        await page.addInitScript(() => {
            document.addEventListener('DOMContentLoaded', () => {
                const style = document.createElement('style');
                style.textContent = '[data-leaves] { right: 20px !important; }';
                document.head.append(style);
            });
        });
        await openRunning(page);
        expect(await layer(page).evaluate((node) => window.innerWidth - node.clientWidth)).toBe(20);

        const before = await transforms(page);
        await page.waitForTimeout(500);
        const after = await transforms(page);
        expect(after).toHaveLength(15);
        for (const [index, transform] of after.entries()) expect(transform, `leaf ${index}`).not.toBe(before[index]);
    });

    test('saves up no gust while paused, so resuming after a scroll does not blow the leaves sideways', async ({
        page,
    }) => {
        await openRunning(page);
        const calmBefore = await centers(page);
        await page.waitForTimeout(500);
        const calm = (await centers(page)).map((point, index) => point.x - (calmBefore[index]?.x ?? 0));

        await toggle(page).click();
        await page.evaluate(() => window.scrollBy(0, 400));
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
        await page.waitForTimeout(100);
        const before = await centers(page);
        await toggle(page).click();
        await page.waitForTimeout(500);
        const resumed = (await centers(page)).map((point, index) => point.x - (before[index]?.x ?? 0));

        expect(median(resumed)).toBeLessThan(median(calm) + 10);
    });

    test('a mouse nudges a nearby leaf away from it', async ({ page, isMobile }) => {
        test.skip(isMobile, 'Only a mouse or a pen pushes the leaves; a finger does not.');
        await openRunning(page);
        await toggle(page).click();

        // The first visible leaf below the header; the pointer goes 30 px to its left.
        const target = await page.locator('[data-leaf]').evaluateAll((nodes) => {
            const visible = nodes.filter((node) => getComputedStyle(node).display !== 'none');
            const index = visible.findIndex((node) => {
                const box = node.getBoundingClientRect();
                return box.top > 120 && box.left > 60 && box.right < window.innerWidth - 60;
            });
            const node = visible[index];
            if (!node) throw new Error('No visible leaf clear of the header and the edges.');
            const box = node.getBoundingClientRect();
            return { index, x: box.left + box.width / 2, y: box.top + box.height / 2 };
        });
        await page.mouse.move(target.x - 30, target.y);
        const before = await centers(page);
        await toggle(page).focus();
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
        const after = await centers(page);

        const pushed = (after[target.index]?.x ?? 0) - (before[target.index]?.x ?? 0);
        const others = after
            .map((point, index) => point.x - (before[index]?.x ?? 0))
            .filter((_, index) => index !== target.index);
        expect(pushed).toBeGreaterThan(median(others) + 15);
    });

    test('stops on leaving the page, leaves nothing behind and starts fresh on return', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
            if (message.type() === 'error') errors.push(message.text());
        });

        // Away straight after load, then back, then away from a running layer. Leaving before the idle start has run is
        // covered deterministically by the held-idle test below.
        await page.goto('/');
        await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Projects' }).click();
        await expect(page).toHaveURL(/\/projects\/$/);
        await expect(page.locator('[data-leaves], [data-leaves-toggle]')).toHaveCount(0);
        await page.waitForTimeout(500);

        await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Home' }).click();
        await expect(layer(page)).toHaveCount(1);
        await expect(layer(page)).toHaveAttribute('data-leaves-state', 'running');

        await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Projects' }).click();
        await expect(page.locator('[data-leaves]')).toHaveCount(0);
        await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Home' }).click();
        await expect(layer(page)).toHaveAttribute('data-leaves-state', 'running');
        await expect(layer(page)).toHaveCount(1);

        // One loop, not two: a paused layer stays still, which a leaked second loop would not.
        await toggle(page).click();
        const paused = await transforms(page);
        await page.waitForTimeout(500);
        expect(await transforms(page)).toEqual(paused);
        expect(errors).toEqual([]);
    });

    test('a start still pending when the visitor leaves never runs, and the next visit starts once', async ({
        page,
    }) => {
        // Holds every idle callback until the test releases it, and makes cancelling a no-op, so the callback of the
        // page that was left fires after the swap: the script must ignore it.
        await page.addInitScript(() => {
            const held: IdleRequestCallback[] = [];
            window.requestIdleCallback = (callback: IdleRequestCallback) => held.push(callback);
            window.cancelIdleCallback = () => undefined;
            (window as unknown as { releaseIdle: () => void }).releaseIdle = () => {
                for (const callback of held.splice(0)) callback({ didTimeout: false, timeRemaining: () => 50 });
            };
        });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const release = () => page.evaluate(() => (window as unknown as { releaseIdle: () => void }).releaseIdle());
        const nav = page.getByRole('navigation', { name: 'Primary' });

        await page.goto('/');
        await expect(layer(page)).toHaveAttribute('data-leaves-state', 'still');
        await expect(toggle(page)).toBeDisabled();
        await nav.getByRole('link', { name: 'Projects' }).click();
        await expect(page).toHaveURL(/\/projects\/$/);
        await release();
        await expect(page.locator('[data-leaves], [data-leaves-toggle]')).toHaveCount(0);

        await nav.getByRole('link', { name: 'Home' }).click();
        await expect(layer(page)).toHaveAttribute('data-leaves-state', 'still');
        await release();
        await expect(layer(page)).toHaveAttribute('data-leaves-state', 'running');
        await toggle(page).click();
        const paused = await transforms(page);
        await page.waitForTimeout(500);
        expect(await transforms(page)).toEqual(paused);
        expect(errors).toEqual([]);
    });

    test('starts when the visitor arrives from another page', async ({ page }) => {
        // The script first runs during a View Transitions swap here, not on a full load of the home page.
        await page.goto('/projects/');
        await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Home' }).click();
        await expect(layer(page)).toHaveAttribute('data-leaves-state', 'running');
        await expect(toggle(page)).toBeEnabled();
    });
});
