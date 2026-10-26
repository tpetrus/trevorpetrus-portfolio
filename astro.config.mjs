import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, fontProviders } from 'astro/config';

import { SITE_URL } from './src/config/site.ts';

// The build must stay offline (AGENTS.md: the build makes no network calls). The remote providers (`fontsource()`,
// `google()`, ...) download at build time, and the `npm` provider hands the build `file:` URLs it then tries to
// `fetch()` (Astro 7.4.2 fails with CannotFetchFontFile) and does not honor `subsets`. So each face is declared with
// the `local` provider, pointing at the one latin woff2 inside the installed @fontsource package.
const fontFile = (packageFile) => `./node_modules/${packageFile}`;

// Pure static output: `astro build` writes plain HTML/CSS/JS to dist/, which Cloudflare Workers static assets serve
// (wrangler.jsonc). There is deliberately no server adapter. The site URL comes from the one site-config module.
export default defineConfig({
    site: SITE_URL,
    integrations: [react()],
    vite: { plugins: [tailwindcss()] },
    // Latin only, `font-display: swap` (Astro's default) and Astro's generated metric-matched fallbacks. Archivo is the
    // width+weight file (90,104 bytes; the weight-only file is 34,928): the giant home-page name sets `wdth` low on
    // narrow screens so it fills the width without shrinking. The `stretch` range declares the axis (62 to 125) to the
    // browser.
    fonts: [
        {
            name: 'Archivo Variable',
            cssVariable: '--font-archivo',
            provider: fontProviders.local(),
            options: {
                variants: [
                    {
                        src: [fontFile('@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2')],
                        weight: '100 900',
                        stretch: '62% 125%',
                        style: 'normal',
                    },
                ],
            },
            fallbacks: ['Arial', 'sans-serif'],
        },
        {
            name: 'Inter Variable',
            cssVariable: '--font-inter',
            provider: fontProviders.local(),
            options: {
                variants: [
                    {
                        src: [fontFile('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')],
                        weight: '100 900',
                        style: 'normal',
                    },
                ],
            },
            fallbacks: ['Arial', 'sans-serif'],
        },
        {
            name: 'IBM Plex Mono',
            cssVariable: '--font-plex-mono',
            provider: fontProviders.local(),
            options: {
                variants: [
                    {
                        src: [fontFile('@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2')],
                        weight: 400,
                        style: 'normal',
                    },
                ],
            },
            fallbacks: ['ui-monospace', 'monospace'],
        },
    ],
});
