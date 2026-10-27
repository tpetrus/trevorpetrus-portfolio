import { describe, expect, it } from 'vitest';

import type { GalleryEntry } from './gallery';
import { CLUSTER_SIZE, CLUSTER_SIZES, CLUSTER_SRC_WIDTH, clusterEntries, clusterFigures } from './homeCluster';
import { GRID_QUALITY } from './galleryView';
import { GRID_WIDTHS, imageSrcset, transformedImageUrl } from './imageUrl';
import type { PhotographyCaption } from './photography';
import { encodeThumbHash } from './thumbhash';

const THUMBHASH = encodeThumbHash(4, 4, new Uint8Array(4 * 4 * 4).fill(128));

function entry(name: string, caption: PhotographyCaption = {}): GalleryEntry<PhotographyCaption> {
    return {
        key: `photography/${name}.jpg`,
        width: 3000,
        height: 2000,
        thumbhash: THUMBHASH,
        sourceSha256: 'a'.repeat(64),
        processingVersion: 1,
        alt: `Alt for ${name}`,
        caption,
    };
}

describe('clusterEntries', () => {
    it('is empty for no photos', () => {
        expect(clusterEntries([])).toEqual([]);
    });

    it('keeps fewer than three photos as they are', () => {
        expect(clusterEntries(['a', 'b'])).toEqual(['a', 'b']);
    });

    it("takes the first three in the gallery's own order", () => {
        expect(clusterEntries(['a', 'b', 'c', 'd', 'e'])).toEqual(['a', 'b', 'c']);
        expect(CLUSTER_SIZE).toBe(3);
    });
});

describe('CLUSTER_SIZES', () => {
    it('sizes a figure at the wide breakpoint as five twelfths of the 75 vw column, with no pixel cap', () => {
        expect(CLUSTER_SIZES).toMatch(/^\(min-width: 1024px\) 31\.25vw,/);
        expect(CLUSTER_SIZES).not.toMatch(/\) \d+px/);
    });
});

describe('clusterFigures', () => {
    it('is empty for no entries', async () => {
        expect(await clusterFigures([])).toEqual([]);
    });

    it('builds the image attributes from the key, with the fixed grid widths only', async () => {
        const [figure] = await clusterFigures([entry('harbor', { camera: 'Canon EOS R5', iso: 400 })]);

        expect(figure).toMatchObject({
            key: 'photography/harbor.jpg',
            alt: 'Alt for harbor',
            width: 3000,
            height: 2000,
            caption: 'Canon EOS R5 · ISO 400',
            src: transformedImageUrl('photography/harbor.jpg', { width: CLUSTER_SRC_WIDTH, quality: GRID_QUALITY }),
            srcset: imageSrcset('photography/harbor.jpg', GRID_WIDTHS, { quality: GRID_QUALITY }),
            sizes: CLUSTER_SIZES,
        });
        expect(GRID_WIDTHS).toContain(CLUSTER_SRC_WIDTH);
        expect(figure.placeholder).toMatch(/^data:image\/webp;base64,/);
    });

    it('stops at three figures and has an empty caption for a photo without one', async () => {
        const figures = await clusterFigures(['a', 'b', 'c', 'd'].map((name) => entry(name)));

        expect(figures.map(({ key }) => key)).toEqual(['photography/a.jpg', 'photography/b.jpg', 'photography/c.jpg']);
        expect(figures.map(({ caption }) => caption)).toEqual(['', '', '']);
    });
});
