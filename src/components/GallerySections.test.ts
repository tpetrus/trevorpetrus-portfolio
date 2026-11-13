import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';

import type { AnyCollectionCaption, GalleryEntry } from '../lib/gallery';
import { encodeThumbHash } from '../lib/thumbhash';
import GallerySections from './GallerySections.astro';

const THUMBHASH = encodeThumbHash(4, 4, new Uint8Array(4 * 4 * 4).fill(128));

function piece(
    file: string,
    category: string,
    caption: AnyCollectionCaption,
    width = 3000,
    height = 2000,
): GalleryEntry<AnyCollectionCaption> {
    return {
        key: `art/${file}`,
        width,
        height,
        thumbhash: THUMBHASH,
        sourceSha256: 'a'.repeat(64),
        processingVersion: 1,
        alt: `Alt text of ${file}`,
        category,
        caption,
    };
}

// Drawing has two pieces (one a PNG) and digital none, so one section renders a gallery and the other its empty line.
const ART = [
    piece('Ink Study.png', 'drawing', {
        title: 'Ink study',
        medium: 'Ink on paper',
        dimensions: '24 x 36 in',
        year: 2024,
    }),
    piece('harbor.jpg', 'drawing', { title: 'Harbor', year: 2025 }, 2000, 3000),
];

const PROPS = {
    jumpLabel: 'Art categories',
    emptyLine: 'Art is on its way.',
    sectionEmptyLine: (label: string) => `${label} pieces are on their way.`,
};

function tagsOf(html: string, name: string): string[] {
    return html.match(new RegExp(String.raw`<${name}\b[^>]*>`, 'g')) ?? [];
}

function textOf(html: string, name: string): string[] {
    return [...html.matchAll(new RegExp(String.raw`<${name}\b[^>]*>([\s\S]*?)</${name}>`, 'g'))].map(([, inner]) =>
        inner.replace(/<[^>]*>/g, '').trim(),
    );
}

describe('GallerySections with the art collection', () => {
    let html: string;

    beforeAll(async () => {
        const container = await AstroContainer.create();
        html = await container.renderToString(GallerySections, {
            props: { collection: 'art', entries: ART, ...PROPS },
        });
    });

    it('has one h2 section per category, in the registry order', () => {
        expect(textOf(html, 'h2')).toEqual(['Drawing', 'Digital']);
        expect(tagsOf(html, 'section').map((tag) => /id="([^"]*)"/.exec(tag)?.[1])).toEqual(['drawing', 'digital']);
    });

    it('names the jump nav and links every section', () => {
        expect(html).toContain('aria-label="Art categories"');
        const nav = /<nav\b[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
        expect([...nav.matchAll(/href="([^"]*)"/g)].map(([, href]) => href)).toEqual(['#drawing', '#digital']);
    });

    it('has a back-to-top link per section and the legend', () => {
        expect(html.match(/data-back-to-top/g)).toHaveLength(2);
        expect(html).toContain('Jump to a section');
    });

    it("shows an empty category's line instead of a gallery", () => {
        expect(html).toContain('Digital pieces are on their way.');
        expect(html).not.toContain('Drawing pieces are on their way.');
        expect(html.match(/data-gallery/g)).toHaveLength(1);
    });

    it('shows the title under a tile and the full line in the lightbox caption', () => {
        expect(textOf(html, 'p')).toEqual(expect.arrayContaining(['Ink study', 'Harbor']));
        const captions = [...html.matchAll(/data-caption="([^"]*)"/g)].map(([, caption]) => caption);
        expect(captions).toEqual(['Ink study, Ink on paper, 24 x 36 in, 2024', 'Harbor, 2025']);
    });

    it('never credits GeoNames, since art has no places', () => {
        expect(html).not.toContain('GeoNames');
    });

    it('shows only the whole-collection line while there are no entries', async () => {
        const container = await AstroContainer.create();
        const empty = await container.renderToString(GallerySections, {
            props: { collection: 'art', entries: [], ...PROPS },
        });
        expect(empty).toContain('Art is on its way.');
        expect(empty).not.toContain('<section');
        expect(empty).not.toContain('data-gallery');
    });
});
