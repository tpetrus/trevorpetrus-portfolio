import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

import { SITE_URL } from './src/config/site.ts';

// Pure static output: `astro build` writes plain HTML/CSS/JS to dist/, which Cloudflare Workers static assets serve
// (wrangler.jsonc). There is deliberately no server adapter. The site URL comes from the one site-config module.
export default defineConfig({
    site: SITE_URL,
    integrations: [react()],
    vite: { plugins: [tailwindcss()] },
});
