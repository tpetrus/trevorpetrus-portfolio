// Runs the `@smoke` Playwright tests against a deployed site. BASE_URL picks the site and defaults to the configured
// SITE_URL, so `npm run test:smoke` works with no setup. It is a script rather than inline in package.json because
// setting an environment variable inline is not portable between shells (Windows vs. Linux).
//
// Only the Chromium projects (`chromium-*` in playwright.config.ts) run: the shared smoke workflow installs Chromium alone, so selecting the WebKit project
// there would fail with "browser not installed".
import { spawnSync } from 'node:child_process';

import { SITE_URL } from '../src/config/site.ts';

const baseURL = process.env.BASE_URL || SITE_URL;
console.log(`Running @smoke tests against ${baseURL}`);

const result = spawnSync(
    'npx',
    ['playwright', 'test', '--grep', '@smoke', '--project', 'chromium-*', ...process.argv.slice(2)],
    {
        stdio: 'inherit',
        env: { ...process.env, BASE_URL: baseURL },
        // npx is a .cmd shim on Windows.
        shell: process.platform === 'win32',
    },
);
process.exit(result.status ?? 1);
