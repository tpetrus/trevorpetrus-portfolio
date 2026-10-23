import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const path of ['/', '/photography/', '/projects/']) {
    test(`${path} has no axe violations`, async ({ page }) => {
        await page.goto(path);

        const results = await new AxeBuilder({ page }).analyze();

        expect(results.violations).toEqual([]);
    });
}
