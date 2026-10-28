import { describe, expect, it } from 'vitest';

import type { GalleryEntry } from './gallery';
import { tileSizes } from './galleryLayout';
import { EAGER_TILE_COUNT, GRID_SRC_WIDTH, GRID_QUALITY, galleryTiles, gallerySections } from './galleryView';
import { GRID_WIDTHS, LIGHTBOX_WIDTHS, imageSrcset, originalImageUrl, transformedImageUrl } from './imageUrl';
import { photoAnchorId } from './photoLink';
import { encodeThumbHash } from './thumbhash';
import type { PhotographyCaption } from './photography';

const THUMBHASH = encodeThumbHash(4, 4, new Uint8Array(4 * 4 * 4).fill(128));

function entry(
    name: string,
    caption: PhotographyCaption = {},
    width = 3000,
    height = 2000,
    category = 'landscape',
): GalleryEntry<PhotographyCaption> {
    return {
        key: `photography/${name}.jpg`,
        width,
        height,
        thumbhash: THUMBHASH,
        sourceSha256: 'a'.repeat(64),
        processingVersion: 1,
        alt: `Alt for ${name}`,
        category,
        caption,
    };
}

const FIVE = ['a', 'b', 'c', 'd', 'e'].map((name) => entry(name));

describe('galleryTiles', () => {
    it('is empty for no entries', async () => {
        expect(await galleryTiles('photography', [])).toEqual([]);
    });

    it('builds every URL from the key with the shared helpers', async () => {
        const [tile] = await galleryTiles('photography', [entry('harbor')]);

        expect(tile).toMatchObject({
            key: 'photography/harbor.jpg',
            alt: 'Alt for harbor',
            width: 3000,
            height: 2000,
            original: originalImageUrl('photography/harbor.jpg'),
            href: transformedImageUrl('photography/harbor.jpg', { width: Math.max(...LIGHTBOX_WIDTHS) }),
            lightboxSrcset: imageSrcset('photography/harbor.jpg', LIGHTBOX_WIDTHS),
            src: transformedImageUrl('photography/harbor.jpg', { width: GRID_SRC_WIDTH, quality: GRID_QUALITY }),
            srcset: imageSrcset('photography/harbor.jpg', [...GRID_WIDTHS, ...LIGHTBOX_WIDTHS], {
                quality: GRID_QUALITY,
            }),
            sizes: tileSizes(12),
            placement: { row: 0, column: 1, span: 12 },
        });
    });

    it('serves the 640 px variant as src, and that width is one of the grid candidates', async () => {
        const [tile] = await galleryTiles('photography', [entry('a')]);

        expect(tile.src).toContain('width=640,');
        expect(GRID_WIDTHS).toContain(GRID_SRC_WIDTH);
    });

    it('encodes the tile variants lighter than the lightbox ones, which keep the default quality', async () => {
        const [tile] = await galleryTiles('photography', [entry('a')]);

        expect(tile.src).toContain(`quality=${GRID_QUALITY},`);
        expect(tile.srcset.match(/quality=/g)).toHaveLength(6);
        expect(tile.href).not.toContain('quality');
        expect(tile.lightboxSrcset).not.toContain('quality');
    });

    it('links to the largest lightbox variant', async () => {
        const [tile] = await galleryTiles('photography', [entry('a')]);

        expect(tile.href).toContain('width=2560,');
    });

    it('keeps the full caption for the lightbox and shows only the place under the tile', async () => {
        const [full, bare] = await galleryTiles('photography', [
            entry('full', {
                camera: 'Canon EOS R5',
                iso: 400,
                location: { city: 'Lisbon', country: 'Portugal', source: 'sidecar' },
            }),
            entry('bare'),
        ]);

        expect(full.caption).toBe('Lisbon, Portugal · Canon EOS R5 · ISO 400');
        expect(full.tileCaption).toBe('Lisbon, Portugal');
        expect(bare.caption).toBe('');
        expect(bare.tileCaption).toBe('');
    });

    it('gives a camera-only photo no tile caption and no number', async () => {
        const [tile] = await galleryTiles('photography', [entry('a', { camera: 'Canon EOS R5', iso: 400 })]);

        expect(tile.tileCaption).toBe('');
        expect(tile).not.toHaveProperty('number');
    });

    it('gives each tile the anchor id the deep link uses', async () => {
        const [tile] = await galleryTiles('photography', [entry('DSC_0098-Edit')]);

        expect(tile.anchorId).toBe(photoAnchorId('photography/DSC_0098-Edit.jpg'));
        expect(tile.anchorId).toBe('photo-DSC_0098-Edit');
    });

    it('loads no tile eagerly and gives none a priority when eager is false', async () => {
        const tiles = await galleryTiles('photography', FIVE, { eager: false });

        expect(tiles.every((tile) => tile.loading === 'lazy')).toBe(true);
        expect(tiles.every((tile) => tile.fetchpriority === undefined)).toBe(true);
    });

    it('loads the first screenful eagerly and the rest lazily', async () => {
        const tiles = await galleryTiles('photography', FIVE);

        expect(tiles.map((tile) => tile.loading)).toEqual(
            FIVE.map((_, index) => (index < EAGER_TILE_COUNT ? 'eager' : 'lazy')),
        );
        expect(EAGER_TILE_COUNT).toBe(1);
    });

    it('gives only the first tile a high fetch priority', async () => {
        const tiles = await galleryTiles('photography', FIVE);

        expect(tiles.map((tile) => tile.fetchpriority)).toEqual(['high', undefined, undefined, undefined, undefined]);
    });

    it('decodes each ThumbHash to a WebP data URL', async () => {
        const [tile] = await galleryTiles('photography', [entry('a')]);

        expect(tile.placeholder.startsWith('data:image/webp;base64,')).toBe(true);
    });

    it('places the tiles from their own aspect ratios and sizes each for its span', async () => {
        const tiles = await galleryTiles('photography', [
            entry('wide', {}, 3000, 2000),
            entry('tall', {}, 2000, 3000),
            entry('pano', {}, 8000, 2000),
        ]);

        expect(tiles.map((tile) => tile.placement)).toEqual([
            { row: 0, column: 1, span: 8 },
            { row: 0, column: 9, span: 4 },
            { row: 1, column: 1, span: 12 },
        ]);
        expect(tiles.map((tile) => tile.sizes)).toEqual([tileSizes(8), tileSizes(4), tileSizes(12)]);
    });

    it('offers the grid and the lightbox widths as candidates, and no others', async () => {
        const [tile] = await galleryTiles('photography', [entry('a')]);
        const widths = [...tile.srcset.matchAll(/width=(\d+),/g)].map(([, width]) => Number(width));

        expect(widths).toEqual([...GRID_WIDTHS, ...LIGHTBOX_WIDTHS]);
    });

    it('keeps the order of the entries', async () => {
        const tiles = await galleryTiles('photography', FIVE);

        expect(tiles.map((tile) => tile.key)).toEqual(FIVE.map((e) => e.key));
    });
});

describe('gallerySections', () => {
    it('returns every category in render order, with empty ones kept', () => {
        const sections = gallerySections('photography', [entry('a')]);

        expect(sections.map(({ id, label }) => [id, label])).toEqual([
            ['landscape', 'Landscape'],
            ['portrait', 'Portrait'],
            ['car', 'Car'],
        ]);
        expect(sections.map((section) => section.entries.length)).toEqual([1, 0, 0]);
    });

    it('groups entries by category and keeps the data order within each', () => {
        const entries = [
            entry('car1', {}, 3000, 2000, 'car'),
            entry('land1'),
            entry('port1', {}, 2000, 3000, 'portrait'),
            entry('land2'),
            entry('car2', {}, 3000, 2000, 'car'),
        ];

        const sections = gallerySections('photography', entries);

        expect(sections.map((section) => section.entries.map((e) => e.key.slice(12, -4)))).toEqual([
            ['land1', 'land2'],
            ['port1'],
            ['car1', 'car2'],
        ]);
    });

    it('is three empty sections for no entries', () => {
        expect(gallerySections('photography', []).map((section) => section.entries)).toEqual([[], [], []]);
    });
});
