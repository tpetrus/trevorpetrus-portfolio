import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env.CI);
// E2E_PORT lets a second checkout run the suite while another dev server already holds the default port.
const PORT = Number(process.env.E2E_PORT ?? 8787);

// Set BASE_URL to run the suite (or just the `@smoke` tests) against an already-running site, e.g. production:
//   BASE_URL=https://example.com npx playwright test --grep @smoke
// When it is unset, the build in dist/ is served locally with `wrangler dev`, which applies the same static-asset
// rules as Cloudflare in production.
const externalBaseURL = process.env.BASE_URL;
const baseURL = externalBaseURL ?? `http://localhost:${PORT}`;

// Project names are prefixed with their browser engine (chromium-*, webkit-*): scripts/smoke.ts selects `chromium-*`
// only, because the shared smoke workflow installs Chromium alone. The full suite (CI's e2e job runs in the Playwright
// container image, which has every browser) also runs the WebKit project; locally, install it with
// `npm run test:e2e:install`.
export default defineConfig({
    testDir: 'tests/e2e',
    fullyParallel: true,
    forbidOnly: CI,
    retries: CI ? 2 : 0,
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
        { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
        { name: 'webkit-mobile', use: { ...devices['iPhone 15'] } },
    ],
    webServer: externalBaseURL
        ? undefined
        : {
              command: `npx wrangler dev --port ${PORT}`,
              url: baseURL,
              // Requires `npm run build` first; wrangler serves whatever is in dist/.
              reuseExistingServer: !CI,
              timeout: 120_000,
              env: { WRANGLER_SEND_METRICS: 'false' },
          },
});
