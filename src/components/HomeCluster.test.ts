import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';

import type { CollectionCaption, GalleryEntry } from '../lib/gallery';
import { GRID_QUALITY } from '../lib/galleryView';
import { CLUSTER_SIZES } from '../lib/homeCluster';
import { GRID_WIDTHS, imageSrcset, transformedImageUrl } from '../lib/imageUrl';
import { encodeThumbHash } from '../lib/thumbhash';
import HomeCluster from './HomeCluster.astro';

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

const ENTRIES = [
    entry('harbor', { width: 4000, height: 3000, caption: { camera: 'Canon EOS R5', iso: 400 } }),
    entry('dunes', { width: 2000, height: 3000 }),
    entry('pier'),
    entry('fog'),
];

// The markup is parsed with regular expressions, as in Gallery.test.ts: the specs run in node, and Astro's output is
// plain `name="value"` attributes.
function tagsOf(html: string, name: string): string[] {
    return html.match(new RegExp(String.raw`<${name}\b[^>]*>`, 'g')) ?? [];
}

function attributesOf(tag: string): Record<string, string> {
    return Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
}

describe('HomeCluster', () => {
    let html: string;
    let images: Record<string, string>[];

    beforeAll(async () => {
        const container = await AstroContainer.create();
        html = await container.renderToString(HomeCluster, { props: { entries: ENTRIES } });
        images = tagsOf(html, 'img').map(attributesOf);
    });

    it('renders nothing without photos', async () => {
        const container = await AstroContainer.create();

        const empty = await container.renderToString(HomeCluster, { props: { entries: [] } });

        expect(tagsOf(empty, 'img')).toEqual([]);
        expect(empty).not.toContain('data-home-cluster');
    });

    it('shows the first three photos, never a fourth', () => {
        expect(images).toHaveLength(3);
        expect(images.map((image) => image.alt)).toEqual([
            'Alt text of harbor',
            'Alt text of dunes',
            'Alt text of pier',
        ]);
    });

    it('uses only the fixed grid widths and sizes each image from its own dimensions', () => {
        const [harbor, dunes] = images;

        expect(harbor.src).toBe(transformedImageUrl('photography/harbor.jpg', { width: 640, quality: GRID_QUALITY }));
        expect(harbor.srcset).toBe(imageSrcset('photography/harbor.jpg', GRID_WIDTHS, { quality: GRID_QUALITY }));
        expect(harbor.sizes).toBe(CLUSTER_SIZES);
        expect([harbor.width, harbor.height]).toEqual(['4000', '3000']);
        expect([dunes.width, dunes.height]).toEqual(['2000', '3000']);
    });

    it('loads every image lazily with no priority hint, so the name stays the largest early paint', () => {
        for (const image of images) {
            expect(image.loading).toBe('lazy');
            expect(image.fetchpriority).toBeUndefined();
            expect(image.decoding).toBe('async');
        }
    });

    it("fixes each image's aspect ratio to the photo's own, whatever the file that loads", () => {
        expect(images.map((image) => image.style)).toEqual([
            expect.stringContaining('aspect-ratio:4000 / 3000'),
            expect.stringContaining('aspect-ratio:2000 / 3000'),
            expect.stringContaining('aspect-ratio:3000 / 2000'),
        ]);
    });

    it('paints the ThumbHash preview behind each image', () => {
        for (const image of images) {
            expect(image.style).toMatch(/background-image:\s*url\(data:image\/webp;base64,[A-Za-z0-9+/=]+\)/);
        }
    });

    it('shows no caption, even for a photo that has one', () => {
        expect(tagsOf(html, 'figcaption')).toEqual([]);
        expect(html).not.toContain('Canon EOS R5');
    });
});
