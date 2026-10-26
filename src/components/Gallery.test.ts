import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';

import type { CollectionCaption, GalleryEntry } from '../lib/gallery';
import { tileSizes } from '../lib/galleryLayout';
import { TILE_QUALITY } from '../lib/galleryView';
import { GRID_WIDTHS, LIGHTBOX_WIDTHS, imageSrcset, originalImageUrl, transformedImageUrl } from '../lib/imageUrl';
import { encodeThumbHash } from '../lib/thumbhash';
import Gallery from './Gallery.astro';

const THUMBHASH = encodeThumbHash(4, 4, new Uint8Array(4 * 4 * 4).fill(128));

function entry(
    name: string,
    overrides: Partial<GalleryEntry<CollectionCaption>> = {},
): GalleryEntry<CollectionCaption> {
    return {
        key: `photography/${name}.jpg`,
        width: 3000,
        height: 2000,
        thumbhash: THUMBHASH,
        sourceSha256: 'a'.repeat(64),
        processingVersion: 1,
        alt: `Alt text of ${name}`,
        caption: {},
        ...overrides,
    };
}

// Landscape, portrait, square and a very wide panorama, then a pair that follows it.
const ENTRIES = [
    entry('harbor', { width: 4000, height: 3000, caption: { camera: 'Canon EOS R5', iso: 400, taken: '2026-10-01' } }),
    entry('dunes', { width: 2000, height: 3000 }),
    entry('ridge-Pano', { width: 9000, height: 2000 }),
    entry('tile', { width: 2400, height: 2400 }),
    entry('cliff'),
];

// The rendered markup is parsed with regular expressions rather than a DOM: the specs run in node, and the markup is
// Astro's plain output (`name="value"` attributes with no unquoted values).
function tagsOf(html: string, name: string): string[] {
    return html.match(new RegExp(String.raw`<${name}\b[^>]*>`, 'g')) ?? [];
}

function attributesOf(tag: string): Record<string, string> {
    return Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
}

describe('Gallery', () => {
    let html: string;
    let links: Record<string, string>[];
    let images: Record<string, string>[];

    beforeAll(async () => {
        const container = await AstroContainer.create();
        html = await container.renderToString(Gallery, { props: { collection: 'photography', entries: ENTRIES } });
        links = tagsOf(html, 'a').map(attributesOf);
        images = tagsOf(html, 'img').map(attributesOf);
    });

    it('is one list with the id the lightbox binds to, an explicit role and a tile per entry', () => {
        expect(tagsOf(html, 'ul').map(attributesOf)).toEqual([
            expect.objectContaining({ id: 'gallery', role: 'list' }),
        ]);
        expect(tagsOf(html, 'li')).toHaveLength(ENTRIES.length);
        expect(links).toHaveLength(ENTRIES.length);
        expect(images).toHaveLength(ENTRIES.length);
    });

    it('places each tile in the 12-column grid from its own aspect ratio', () => {
        const styles = tagsOf(html, 'li').map((tag) => attributesOf(tag).style);

        expect(styles).toEqual([
            '--row: 0; --column: 1; --span: 8',
            '--row: 0; --column: 9; --span: 4',
            '--row: 1; --column: 1; --span: 12',
            '--row: 2; --column: 1; --span: 4',
            '--row: 2; --column: 5; --span: 8',
        ]);
    });

    it('links each tile to the largest lightbox variant and carries what the lightbox reads', () => {
        const [harbor] = links;

        expect(harbor.href).toBe(
            transformedImageUrl('photography/harbor.jpg', { width: Math.max(...LIGHTBOX_WIDTHS) }),
        );
        expect(harbor['data-pswp-width']).toBe('4000');
        expect(harbor['data-pswp-height']).toBe('3000');
        expect(harbor['data-pswp-srcset']).toBe(imageSrcset('photography/harbor.jpg', LIGHTBOX_WIDTHS));
        expect(harbor['data-original']).toBe(originalImageUrl('photography/harbor.jpg'));
        expect(harbor['data-caption']).toBe('Canon EOS R5 · ISO 400 · 2026-10-01');
    });

    it("uses each entry's own dimensions and an empty caption when there is none", () => {
        const dunes = links[1];

        expect(dunes['data-pswp-width']).toBe('2000');
        expect(dunes['data-pswp-height']).toBe('3000');
        // Astro renders an empty string as a bare attribute, which the lightbox reads from `dataset` as "".
        expect(dunes['data-caption']).toBeUndefined();
        expect(tagsOf(html, 'a')[1]).toMatch(/ data-caption /);
    });

    it('gives each image a 640 px src, the grid srcset, sizes, its real dimensions and its alt text', () => {
        const [harbor] = images;

        expect(harbor.src).toBe(transformedImageUrl('photography/harbor.jpg', { width: 640, quality: TILE_QUALITY }));
        expect(harbor.srcset).toBe(
            imageSrcset('photography/harbor.jpg', [...GRID_WIDTHS, ...LIGHTBOX_WIDTHS], { quality: TILE_QUALITY }),
        );
        expect(harbor.sizes).toBe(tileSizes(8));
        expect(harbor.width).toBe('4000');
        expect(harbor.height).toBe('3000');
        expect(harbor.alt).toBe('Alt text of harbor');
        expect(harbor.decoding).toBe('async');
    });

    it('never crops a tile or marks it cropped: the image keeps its own ratio and the space is reserved by width and height', () => {
        expect(html).not.toContain('cropped');
        for (const image of images) {
            expect(image.class).not.toContain('object-cover');
            expect(image.class).not.toContain('aspect-');
        }
        expect(images.map((image) => `${image.width}x${image.height}`)).toEqual([
            '4000x3000',
            '2000x3000',
            '9000x2000',
            '2400x2400',
            '3000x2000',
        ]);
    });

    it('shows the caption under the photo only for a tile that has one', () => {
        const captions = html.match(/<p class="[^"]*font-mono[^"]*"[^>]*>([^<]*)<\/p>/g) ?? [];

        expect(captions).toHaveLength(1);
        expect(captions[0]).toContain('Canon EOS R5 · ISO 400 · 2026-10-01');
    });

    it('paints the ThumbHash preview behind each image', () => {
        for (const image of images) {
            expect(image.style).toMatch(/^background-image:\s*url\(data:image\/webp;base64,[A-Za-z0-9+/=]+\)/);
        }
    });

    it('loads the first three eagerly, only the first with high priority, and the rest lazily', () => {
        expect(images.map((image) => image.loading)).toEqual(['eager', 'eager', 'eager', 'lazy', 'lazy']);
        expect(images.map((image) => image.fetchpriority)).toEqual([
            'high',
            undefined,
            undefined,
            undefined,
            undefined,
        ]);
    });

    it('renders an empty list for no entries', async () => {
        const container = await AstroContainer.create();

        const empty = await container.renderToString(Gallery, { props: { collection: 'photography', entries: [] } });

        expect(tagsOf(empty, 'li')).toEqual([]);
        expect(tagsOf(empty, 'img')).toEqual([]);
    });
});
