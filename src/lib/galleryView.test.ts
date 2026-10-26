import { describe, expect, it } from 'vitest';

import type { GalleryEntry } from './gallery';
import { tileSizes } from './galleryLayout';
import { EAGER_TILE_COUNT, GRID_SRC_WIDTH, galleryTiles } from './galleryView';
import { GRID_WIDTHS, LIGHTBOX_WIDTHS, imageSrcset, originalImageUrl, transformedImageUrl } from './imageUrl';
import { encodeThumbHash } from './thumbhash';
import type { PhotographyCaption } from './photography';

const THUMBHASH = encodeThumbHash(4, 4, new Uint8Array(4 * 4 * 4).fill(128));

function entry(
    name: string,
    caption: PhotographyCaption = {},
    width = 3000,
    height = 2000,
): GalleryEntry<PhotographyCaption> {
    return {
        key: `photography/${name}.jpg`,
        width,
        height,
        thumbhash: THUMBHASH,
        sourceSha256: 'a'.repeat(64),
        processingVersion: 1,
        alt: `Alt for ${name}`,
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
            src: transformedImageUrl('photography/harbor.jpg', { width: GRID_SRC_WIDTH }),
            srcset: imageSrcset('photography/harbor.jpg', [...GRID_WIDTHS, ...LIGHTBOX_WIDTHS]),
            sizes: tileSizes(12),
            placement: { row: 0, column: 1, span: 12 },
        });
    });

    it('serves the 640 px variant as src, and that width is one of the grid candidates', async () => {
        const [tile] = await galleryTiles('photography', [entry('a')]);

        expect(tile.src).toContain('width=640,');
        expect(GRID_WIDTHS).toContain(GRID_SRC_WIDTH);
    });

    it('links to the largest lightbox variant', async () => {
        const [tile] = await galleryTiles('photography', [entry('a')]);

        expect(tile.href).toContain('width=2560,');
    });

    it("formats the caption with the collection's formatter", async () => {
        const [full, bare] = await galleryTiles('photography', [
            entry('full', { camera: 'Canon EOS R5', iso: 400 }),
            entry('bare'),
        ]);

        expect(full.caption).toBe('Canon EOS R5 · ISO 400');
        expect(bare.caption).toBe('');
    });

    it('loads the first screenful eagerly and the rest lazily', async () => {
        const tiles = await galleryTiles('photography', FIVE);

        expect(tiles.map((tile) => tile.loading)).toEqual(
            FIVE.map((_, index) => (index < EAGER_TILE_COUNT ? 'eager' : 'lazy')),
        );
        expect(EAGER_TILE_COUNT).toBe(3);
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
