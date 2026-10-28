import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';

import Wordmark from './Wordmark.astro';

describe('Wordmark', () => {
    it("is one h1 of real text in the reader's case, with the two lines as separate blocks", async () => {
        const container = await AstroContainer.create();

        const html = await container.renderToString(Wordmark, { props: { first: 'Trevor', second: 'Petrus' } });

        expect(html.match(/<h1\b/g)).toHaveLength(1);
        // The space between the lines keeps the accessible name "Trevor Petrus"; the capitals are CSS only.
        expect(html).toMatch(/<h1[^>]*>Trevor <span[^>]*>Petrus<\/span><\/h1>/);
        expect(html).not.toMatch(/<svg|<img|aria-hidden/);
    });

    // The marker is what the header's CSS and the handoff script key on; without it the header name never hides.
    it('carries the data-wordmark marker the header handoff uses', async () => {
        const container = await AstroContainer.create();

        const html = await container.renderToString(Wordmark, { props: { first: 'Trevor', second: 'Petrus' } });

        expect(html).toMatch(/<div[^>]*\bdata-wordmark\b/);
    });
});
