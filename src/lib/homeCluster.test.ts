import { describe, expect, it } from 'vitest';

import type { GalleryEntry } from './gallery';
import {
    CLUSTER_SIZE,
    CLUSTER_SIZES,
    CLUSTER_SRC_WIDTH,
    clusterEntries,
    clusterFigures,
    phoneImageWidth,
} from './homeCluster';
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
            src: transformedImageUrl('photography/harbor.jpg', { width: CLUSTER_SRC_WIDTH, quality: GRID_QUALITY }),
            srcset: imageSrcset('photography/harbor.jpg', GRID_WIDTHS, { quality: GRID_QUALITY }),
            sizes: CLUSTER_SIZES,
        });
        expect(GRID_WIDTHS).toContain(CLUSTER_SRC_WIDTH);
        expect(figure.placeholder).toMatch(/^data:image\/webp;base64,/);
    });

    it('stops at three figures', async () => {
        const figures = await clusterFigures(['a', 'b', 'c', 'd'].map((name) => entry(name)));

        expect(figures.map(({ key }) => key)).toEqual(['photography/a.jpg', 'photography/b.jpg', 'photography/c.jpg']);
    });
});

describe('phoneImageWidth', () => {
    it('measures the widest image at the two widths the phone layout is checked at', () => {
        // 320: edge 16, content 288, column (288 - 88) / 12. 390: edge 15.6 is under the 16 px floor.
        expect(phoneImageWidth(320)).toBeCloseTo(115.33, 1);
        expect(phoneImageWidth(390)).toBeCloseTo(144.5, 1);
    });

    it('grows the edge with the viewport once 4vw passes 16 px', () => {
        expect(phoneImageWidth(700)).toBeCloseTo(((700 * 0.92 - 88) / 12) * 5 + 32, 5);
    });

    it('stays within the phone `sizes` hint and above 35% of the viewport, at every phone width', () => {
        const hint = Number(/(\d+)vw$/.exec(CLUSTER_SIZES)?.[1]) / 100;
        for (let width = 320; width < 768; width += 8) {
            const fraction = phoneImageWidth(width) / width;
            expect(fraction).toBeLessThanOrEqual(hint);
            expect(fraction).toBeGreaterThan(0.35);
        }
    });
});
