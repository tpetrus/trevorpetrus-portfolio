import { describe, expect, it } from 'vitest';

import type { GalleryEntry } from './gallery';
import {
    CLUSTER_COLUMNS,
    CLUSTER_FALLBACK_SIZE,
    CLUSTER_LAYOUTS,
    CLUSTER_SRC_WIDTH,
    HOME_PIN_LIMIT,
    WIDE_SLOT_COLUMNS,
    clusterEntries,
    clusterFigures,
    clusterSizes,
    clusterSrcsetWidths,
    phoneImageWidth,
    slotStyle,
    type ClusterCount,
} from './homeCluster';
import { GRID_QUALITY } from './galleryView';
import { GRID_WIDTHS, LIGHTBOX_WIDTHS, imageSrcset, transformedImageUrl } from './imageUrl';
import type { PhotographyCaption } from './photography';
import { encodeThumbHash } from './thumbhash';

const THUMBHASH = encodeThumbHash(4, 4, new Uint8Array(4 * 4 * 4).fill(128));

function entry(name: string, extra: { pin?: true } = {}): GalleryEntry<PhotographyCaption> {
    return {
        key: `photography/${name}.jpg`,
        width: 3000,
        height: 2000,
        thumbhash: THUMBHASH,
        sourceSha256: 'a'.repeat(64),
        processingVersion: 1,
        alt: `Alt for ${name}`,
        category: 'landscape',
        caption: {},
        ...extra,
    };
}

const COUNTS: ClusterCount[] = [1, 2, 3, 4, 5, 6, 7, 8];

describe('clusterEntries', () => {
    it('is empty for no photos', () => {
        expect(clusterEntries([])).toEqual([]);
    });

    it('falls back to the first three when nothing is pinned', () => {
        const plain = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name }));
        expect(clusterEntries(plain)).toEqual(plain.slice(0, 3));
        expect(CLUSTER_FALLBACK_SIZE).toBe(3);
        expect(clusterEntries(plain.slice(0, 2))).toEqual(plain.slice(0, 2));
    });

    it("takes the pinned photos in the gallery's own order, and only those", () => {
        const photos = [
            { name: 'a' },
            { name: 'b', pin: true },
            { name: 'c', pin: false },
            { name: 'd', pin: true },
            { name: 'e' },
        ];
        expect(clusterEntries(photos).map(({ name }) => name)).toEqual(['b', 'd']);
    });

    it('keeps a single pin as a single photo', () => {
        expect(clusterEntries([{ name: 'a' }, { name: 'b', pin: true }, { name: 'c' }])).toEqual([
            { name: 'b', pin: true },
        ]);
    });

    it('stops at the pin limit', () => {
        const photos = Array.from({ length: 12 }, (_, index) => ({ index, pin: true as const }));
        expect(clusterEntries(photos).map(({ index }) => index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        expect(HOME_PIN_LIMIT).toBe(8);
    });
});

describe('CLUSTER_LAYOUTS', () => {
    it('has a composition for every pin count up to the limit', () => {
        expect(COUNTS.length).toBe(HOME_PIN_LIMIT);
        expect(Object.keys(CLUSTER_LAYOUTS).map(Number)).toEqual(COUNTS);
    });

    it.each(COUNTS)('has exactly %i slots, inside the twelve columns', (count) => {
        const slots = CLUSTER_LAYOUTS[count];
        expect(slots).toHaveLength(count);
        for (const { start, end, row } of slots) {
            expect(Number.isInteger(start) && Number.isInteger(end)).toBe(true);
            expect(start).toBeGreaterThanOrEqual(1);
            expect(end).toBeLessThanOrEqual(CLUSTER_COLUMNS + 1);
            expect(end - start).toBeGreaterThanOrEqual(3);
            expect([1, 2]).toContain(row);
        }
    });

    it.each(COUNTS)('lists the slots of %i row by row, left to right, so the later ones paint on top', (count) => {
        const slots = CLUSTER_LAYOUTS[count];
        for (const [index, slot] of slots.slice(1).entries()) {
            const previous = slots[index];
            expect(slot.row).toBeGreaterThanOrEqual(previous.row);
            if (slot.row === previous.row) expect(slot.start).toBeGreaterThan(previous.start);
        }
    });

    it.each(COUNTS)('fills row one before row two, and only pulls row-two slots up (%i)', (count) => {
        const slots = CLUSTER_LAYOUTS[count];
        expect(slots[0].row).toBe(1);
        for (const { row, lift = 0, pull = 0 } of slots) {
            expect(lift).toBeGreaterThanOrEqual(0);
            expect(pull).toBeLessThanOrEqual(0);
            if (row === 1) expect(pull).toBe(0);
            else expect(lift).toBe(0);
        }
    });

    it.each(COUNTS)('has one row for %i only up to four photos, and two rows above that', (count) => {
        const rows = new Set(CLUSTER_LAYOUTS[count].map(({ row }) => row));
        expect(rows.size).toBe(count <= 4 ? 1 : 2);
    });

    it('keeps a lone image centered and no wider than six columns', () => {
        const [{ start, end }] = CLUSTER_LAYOUTS[1];
        expect(end - start).toBeLessThanOrEqual(6);
        expect(start - 1).toBe(CLUSTER_COLUMNS + 1 - end);
    });

    it('overlaps neighbors in a row by a column, and keeps the first and third of a row apart', () => {
        for (const count of COUNTS.filter((value) => value > 1)) {
            const slots = CLUSTER_LAYOUTS[count];
            for (const row of [1, 2]) {
                const inRow = slots.filter((slot) => slot.row === row);
                for (const [index, slot] of inRow.slice(1).entries()) {
                    expect(inRow[index].end - slot.start).toBe(1);
                }
                for (const [index, slot] of inRow.slice(2).entries()) {
                    expect(inRow[index].end).toBeLessThanOrEqual(slot.start);
                }
            }
        }
    });

    it('keeps three photos exactly as the original composition was', () => {
        expect(CLUSTER_LAYOUTS[3]).toEqual([
            { start: 1, end: 6, row: 1 },
            { start: 5, end: 10, row: 1, lift: 4.9 },
            { start: 9, end: 13, row: 1, lift: 2.45 },
        ]);
    });
});

describe('slotStyle', () => {
    it('puts a row-one slot on the bottom edge, raised by its lift', () => {
        expect(slotStyle({ start: 5, end: 10, row: 1, lift: 4.9 })).toEqual({
            gridColumn: '5 / 10',
            gridRow: '1',
            alignSelf: 'end',
            marginBlockEnd: '4.9cqi',
            marginBlockStart: '0cqi',
        });
    });

    it('hangs a row-two slot from the top edge, pulled up over row one', () => {
        expect(slotStyle({ start: 1, end: 5, row: 2, pull: -9 })).toEqual({
            gridColumn: '1 / 5',
            gridRow: '2',
            alignSelf: 'start',
            marginBlockEnd: '0cqi',
            marginBlockStart: '-9cqi',
        });
    });
});

describe('clusterSizes', () => {
    it('sizes a slot as its share of the 75 vw column from 1024 px, with no pixel cap', () => {
        expect(clusterSizes(5)).toBe('(min-width: 1024px) 31.25vw, 38.33vw');
        expect(clusterSizes(6)).toBe('(min-width: 1024px) 37.5vw, 46vw');
        expect(clusterSizes(5)).not.toMatch(/\) \d+px/);
    });

    it('shrinks with the span', () => {
        expect(clusterSizes(3)).toBe('(min-width: 1024px) 18.75vw, 23vw');
    });
});

describe('CLUSTER_LAYOUTS reach', () => {
    it('has a slot ending at grid line 13 in every layout of 3 or more photos', () => {
        for (const count of [3, 4, 5, 6, 7, 8] as const) {
            expect(Math.max(...CLUSTER_LAYOUTS[count].map((slot) => slot.end))).toBe(13);
        }
    });
});

describe('clusterSrcsetWidths', () => {
    it('stays on the grid widths for a narrow slot', () => {
        expect(clusterSrcsetWidths(WIDE_SLOT_COLUMNS - 1)).toEqual(GRID_WIDTHS);
    });

    it('adds the lightbox widths for a wide slot, and never any other width', () => {
        const widths = clusterSrcsetWidths(WIDE_SLOT_COLUMNS);
        expect(widths).toEqual([...GRID_WIDTHS, ...LIGHTBOX_WIDTHS]);
    });
});

describe('clusterFigures', () => {
    it('is empty for no entries', async () => {
        expect(await clusterFigures([])).toEqual([]);
    });

    it('builds the image attributes from the key and the slot', async () => {
        const [figure] = await clusterFigures([entry('harbor', { pin: true })]);

        expect(figure).toMatchObject({
            key: 'photography/harbor.jpg',
            alt: 'Alt for harbor',
            width: 3000,
            height: 2000,
            src: transformedImageUrl('photography/harbor.jpg', { width: CLUSTER_SRC_WIDTH, quality: GRID_QUALITY }),
            // A lone image spans six columns, so it also gets the lightbox widths.
            srcset: imageSrcset('photography/harbor.jpg', [...GRID_WIDTHS, ...LIGHTBOX_WIDTHS], {
                quality: GRID_QUALITY,
            }),
            sizes: clusterSizes(6),
            layout: slotStyle(CLUSTER_LAYOUTS[1][0]),
        });
        expect(GRID_WIDTHS).toContain(CLUSTER_SRC_WIDTH);
        expect(figure.placeholder).toMatch(/^data:image\/webp;base64,/);
    });

    it('uses the layout for the number of photos shown, one slot each', async () => {
        for (const count of COUNTS) {
            const figures = await clusterFigures(
                Array.from({ length: count + 2 }, (_, index) => entry(`p${index}`, { pin: true })),
            );
            // Pins past the limit are cut, so a count above it still shows the limit.
            const shown = Math.min(count + 2, HOME_PIN_LIMIT);
            expect(figures).toHaveLength(shown);
            expect(figures.map(({ layout }) => layout)).toEqual(
                CLUSTER_LAYOUTS[shown as ClusterCount].map((slot) => slotStyle(slot)),
            );
        }
    });

    it('offers only widths that already exist for every photo', async () => {
        const known = new Set([...GRID_WIDTHS, ...LIGHTBOX_WIDTHS]);
        for (const count of COUNTS) {
            const figures = await clusterFigures(
                Array.from({ length: count }, (_, i) => entry(`p${i}`, { pin: true })),
            );
            for (const { srcset } of figures) {
                const widths = [...srcset.matchAll(/width=(\d+),/g)].map(([, width]) => Number(width));
                expect(widths.length).toBeGreaterThan(0);
                for (const width of widths) expect(known.has(width)).toBe(true);
            }
        }
    });

    it('falls back to three figures when nothing is pinned', async () => {
        const figures = await clusterFigures(['a', 'b', 'c', 'd'].map((name) => entry(name)));

        expect(figures.map(({ key }) => key)).toEqual(['photography/a.jpg', 'photography/b.jpg', 'photography/c.jpg']);
    });
});

describe('phoneImageWidth', () => {
    it('measures a five-column image at the two widths the phone layout is checked at', () => {
        // 320: edge 16, content 288, column (288 - 88) / 12. 390: edge 15.6 is under the 16 px floor.
        expect(phoneImageWidth(320)).toBeCloseTo(115.33, 1);
        expect(phoneImageWidth(390)).toBeCloseTo(144.5, 1);
    });

    it('grows the edge with the viewport once 4vw passes 16 px', () => {
        expect(phoneImageWidth(700)).toBeCloseTo(((700 * 0.92 - 88) / 12) * 5 + 32, 5);
    });

    it('stays within the phone `sizes` hint for five columns, at every phone width', () => {
        const hint = Number(/, ([\d.]+)vw$/.exec(clusterSizes(5))?.[1]) / 100;
        for (let width = 320; width < 768; width += 8) {
            const fraction = phoneImageWidth(width) / width;
            expect(fraction).toBeLessThanOrEqual(hint);
            expect(fraction).toBeGreaterThan(0.35);
        }
    });
});
