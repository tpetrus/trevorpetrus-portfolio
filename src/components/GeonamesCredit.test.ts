import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';

import GeonamesCredit from './GeonamesCredit.astro';

describe('GeonamesCredit', () => {
    it('credits GeoNames and the CC BY 4.0 license with links', async () => {
        const html = await (await AstroContainer.create()).renderToString(GeonamesCredit);

        expect(html).toMatch(/Place names from\s*<a[^>]*href="https:\/\/www\.geonames\.org\/"[^>]*>GeoNames<\/a>/);
        expect(html).toMatch(/<a[^>]*href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/"[^>]*>CC BY 4\.0<\/a>/);
        // Link text and the punctuation between the links, in order.
        expect(html).toMatch(/Place names from\s*<a[^>]*>GeoNames<\/a>\s*,\s*<a[^>]*>CC BY 4\.0<\/a>\s*\./);
    });
});
