import { describe, expect, it } from 'vitest';

import {
    GRID_BREAKPOINT_PX,
    GRID_COLUMNS,
    WIDE_COLUMN_BREAKPOINT_PX,
    aspectRatio,
    placeTiles,
    tileSizes,
} from './galleryLayout';

const LANDSCAPE = 1.5;
const PORTRAIT = 2 / 3;
const SQUARE = 1;
const PANORAMA = 4;

const spansOf = (ratios: number[]): number[] => placeTiles(ratios).map((placement) => placement.span);
const rowsOf = (ratios: number[]): number[] => placeTiles(ratios).map((placement) => placement.row);

describe('aspectRatio', () => {
    it('is width over height', () => {
        expect(aspectRatio(3000, 2000)).toBe(1.5);
        expect(aspectRatio(2000, 3000)).toBeCloseTo(2 / 3);
    });
});

describe('placeTiles', () => {
    it('places nothing for no photos', () => {
        expect(placeTiles([])).toEqual([]);
    });

    it('gives a panorama a full row to itself, whatever its neighbors', () => {
        const ratios = [LANDSCAPE, PANORAMA, LANDSCAPE];

        expect(placeTiles(ratios)[1]).toEqual({ row: 1, column: 1, span: GRID_COLUMNS });
        expect(rowsOf(ratios)).toEqual([0, 1, 2]);
    });

    it('treats a ratio of exactly 2 as a panorama', () => {
        expect(spansOf([2])).toEqual([GRID_COLUMNS]);
    });

    it('alternates rows of two and three photos', () => {
        expect(rowsOf([PORTRAIT, PORTRAIT, LANDSCAPE, LANDSCAPE, LANDSCAPE, SQUARE, SQUARE])).toEqual([
            0, 0, 1, 1, 1, 2, 2,
        ]);
    });

    it('splits two portraits evenly', () => {
        expect(spansOf([PORTRAIT, PORTRAIT])).toEqual([6, 6]);
    });

    it('gives the wider photo of a pair the wide span, on either side', () => {
        expect(spansOf([LANDSCAPE, PORTRAIT])).toEqual([8, 4]);
        expect(spansOf([PORTRAIT, LANDSCAPE])).toEqual([4, 8]);
    });

    it('makes alike photos take turns leading, row after row', () => {
        // The first pair is packed row 0 (the first leads); the second pair comes after a short row, as packed row 1.
        expect(spansOf([LANDSCAPE, LANDSCAPE, LANDSCAPE, LANDSCAPE, PANORAMA])).toEqual([8, 4, 4, 8, 12]);
    });

    it('splits three photos into equal spans', () => {
        expect(spansOf([PORTRAIT, PORTRAIT, PORTRAIT, LANDSCAPE, SQUARE])).toEqual([6, 6, 4, 4, 4]);
    });

    it('fills a lone landscape across the row and centers a lone portrait or square at half width', () => {
        expect(placeTiles([LANDSCAPE])).toEqual([{ row: 0, column: 1, span: 12 }]);
        expect(placeTiles([PORTRAIT])).toEqual([{ row: 0, column: 4, span: 6 }]);
        expect(placeTiles([SQUARE])).toEqual([{ row: 0, column: 4, span: 6 }]);
    });

    it('handles a short row before a panorama', () => {
        expect(placeTiles([PORTRAIT, PANORAMA])).toEqual([
            { row: 0, column: 4, span: 6 },
            { row: 1, column: 1, span: 12 },
        ]);
    });

    it('never overlaps tiles, stays inside 12 columns and fills every row but a lone narrow photo', () => {
        const pattern = [LANDSCAPE, PORTRAIT, SQUARE, PANORAMA, 1.3, 1.7, PORTRAIT];
        const ratios = Array.from({ length: 70 }, (_, index) => pattern[index % pattern.length]);
        const placements = placeTiles(ratios);

        expect(placements).toHaveLength(ratios.length);
        const rows = Map.groupBy(placements, (placement) => placement.row);
        for (const row of rows.values()) {
            const last = row[row.length - 1];
            expect(last.column + last.span - 1).toBeLessThanOrEqual(GRID_COLUMNS);
            for (let index = 1; index < row.length; index += 1) {
                expect(row[index].column).toBe(row[index - 1].column + row[index - 1].span);
            }
            if (row.length > 1) expect(row.reduce((total, { span }) => total + span, 0)).toBe(GRID_COLUMNS);
        }
    });
});

describe('tileSizes', () => {
    it('is the span share of the 75 vw column from 1024 px, of the 92 vw column below it and the column below the grid breakpoint', () => {
        expect(tileSizes(6)).toBe(
            `(min-width: ${WIDE_COLUMN_BREAKPOINT_PX}px) calc(75vw * 0.5), (min-width: ${GRID_BREAKPOINT_PX}px) calc(92vw * 0.5), 88vw`,
        );
        expect(tileSizes(4)).toContain('calc(75vw * 0.3333)');
        expect(tileSizes(12)).toMatch(/^\(min-width: 1024px\) calc\(75vw \* 1\),/);
    });

    it('never names a pixel width, so the hint follows the column at every viewport', () => {
        expect(tileSizes(8)).not.toMatch(/\) \d+px/);
    });
});
