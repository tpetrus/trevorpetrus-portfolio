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
});
