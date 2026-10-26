// Where each photo goes in the gallery's 12-column grid. Photos keep their own aspect ratio (nothing is cropped), so the
// layout is decided from the ratios alone, in the order the photos come: that order is the order of the page, of the
// lightbox and of the tab key, so a layout never reorders anything.

export const GRID_COLUMNS = 12;

/** A photo at least this much wider than tall is a panorama: it gets a row to itself. */
export const PANORAMA_MIN_RATIO = 2;

/** Below this width-to-height ratio a photo is a portrait; two of them share a row evenly. */
export const PORTRAIT_MAX_RATIO = 0.9;

/** Two photos whose ratios differ by less than this count as alike, so neither is the natural lead of the row. */
const ALIKE_RATIO_DELTA = 0.15;

/** A lone photo of this ratio or wider fills the row; a narrower one is centered at half width instead. */
const LONE_FULL_WIDTH_MIN_RATIO = 1.2;

/** The rows between panoramas alternate between two and three photos, which keeps the page from reading as a table. */
const ROW_SIZES = [2, 3] as const;

export interface TilePlacement {
    /** Zero-based row of the layout; the template turns it into the grid rows of the image and its caption. */
    row: number;
    /** One-based first grid column. */
    column: number;
    /** How many of the 12 columns the tile spans. */
    span: number;
}

export function aspectRatio(width: number, height: number): number {
    return width / height;
}

const isPanorama = (ratio: number): boolean => ratio >= PANORAMA_MIN_RATIO;

// Spans for a row of one to three photos, summing to 12 (a lone photo may be narrower and is then centered).
function spansForRow(ratios: readonly number[], rowIndex: number): number[] {
    if (ratios.length === 1) return [ratios[0] >= LONE_FULL_WIDTH_MIN_RATIO ? GRID_COLUMNS : GRID_COLUMNS / 2];
    if (ratios.length === 3) return [4, 4, 4];
    const [first, second] = ratios;
    if (first < PORTRAIT_MAX_RATIO && second < PORTRAIT_MAX_RATIO) return [6, 6];
    // The wider photo leads the row. Alike photos take turns, so a run of similar ones zigzags instead of stacking.
    const firstLeads = Math.abs(first - second) < ALIKE_RATIO_DELTA ? rowIndex % 2 === 0 : first > second;
    return firstLeads ? [8, 4] : [4, 8];
}

/** One placement per ratio, in order. Every row but a lone narrow photo's fills the 12 columns exactly. */
export function placeTiles(ratios: readonly number[]): TilePlacement[] {
    const placements: TilePlacement[] = [];
    let next = 0;
    let row = 0;
    let packedRows = 0;
    while (next < ratios.length) {
        if (isPanorama(ratios[next])) {
            placements.push({ row, column: 1, span: GRID_COLUMNS });
            next += 1;
            row += 1;
            continue;
        }
        const wanted = ROW_SIZES[packedRows % ROW_SIZES.length];
        const group: number[] = [];
        while (group.length < wanted && next < ratios.length && !isPanorama(ratios[next])) {
            group.push(ratios[next]);
            next += 1;
        }
        const spans = spansForRow(group, packedRows);
        let column = group.length === 1 ? (GRID_COLUMNS - spans[0]) / 2 + 1 : 1;
        for (const span of spans) {
            placements.push({ row, column, span });
            column += span;
        }
        row += 1;
        packedRows += 1;
    }
    return placements;
}

/** The viewport width where the grid goes from one column to twelve; the template's stylesheet uses the same value. */
export const GRID_BREAKPOINT_PX = 768;

/** The widest the gallery's content is drawn: 80 rem minus the 4 vw page edge (51.2 px) on each side at that width. */
const MAX_CONTENT_PX = 1280 - 2 * 51.2;

/** The widest column gap, reached at 1000 px and up (2 vw, at most 1.25 rem). */
const MAX_GUTTER_PX = 20;

// How wide a tile of this span is drawn, for the browser's choice among the srcset candidates. It is an upper bound:
// above the widest layout, a fixed width; between the breakpoint and that, the span's share of the viewport minus the
// 4 vw page edge on each side (the gutters are ignored, which only ever rounds the width up); below the breakpoint
// every tile is the full column. That column is 92 vw, but the phone value is 88 vw on purpose: a 412 px phone at the
// 1.75x of Lighthouse's mobile profile needs 663 px, which would take the 960 px variant (about twice the bytes of the
// 640 px one) for a difference of 3.5 percent. The first screen's images are the LCP, so the bytes matter more.
export function tileSizes(span: number): string {
    const columnPx = (MAX_CONTENT_PX - (GRID_COLUMNS - 1) * MAX_GUTTER_PX) / GRID_COLUMNS;
    const widestPx = Math.ceil(columnPx * span + (span - 1) * MAX_GUTTER_PX);
    const share = span / GRID_COLUMNS;
    return [
        `(min-width: 1280px) ${widestPx}px`,
        `(min-width: ${GRID_BREAKPOINT_PX}px) calc(92vw * ${Number(share.toFixed(4))})`,
        '88vw',
    ].join(', ');
}
