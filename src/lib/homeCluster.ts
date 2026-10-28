import type { CollectionCaption, GalleryEntry } from './gallery';
import { GRID_QUALITY } from './galleryView';
import { GRID_WIDTHS, imageSrcset, LIGHTBOX_WIDTHS, transformedImageUrl } from './imageUrl';
import { placeholderDataUrl } from './thumbhash';

/** How many photos the cluster shows when none is pinned: the first few in the gallery's order. */
export const CLUSTER_FALLBACK_SIZE = 3;

/** The most photos the cluster shows (the most compositions CLUSTER_LAYOUTS has). Pins beyond this are ignored. */
export const HOME_PIN_LIMIT = 8;

/** The cluster is a grid of this many columns, and the widest three-photo images span {@link WIDEST_IMAGE_COLUMNS} of them. */
export const CLUSTER_COLUMNS = 12;
export const WIDEST_IMAGE_COLUMNS = 5;

/** The cluster's column gap below 48rem, in pixels (0.5rem; see HomeCluster.astro). */
export const PHONE_COLUMN_GAP_PX = 8;

/**
 * The width in pixels of a five-column cluster image below 768 px, for a viewport that wide. The content column is the
 * viewport less an edge on each side (`--spacing-edge`: 4vw, but at least 16 px), and an image spans five of the twelve
 * columns and the four gaps between them.
 */
export function phoneImageWidth(viewportWidth: number): number {
    const edge = Math.max(16, viewportWidth * 0.04);
    const content = viewportWidth - 2 * edge;
    const column = (content - (CLUSTER_COLUMNS - 1) * PHONE_COLUMN_GAP_PX) / CLUSTER_COLUMNS;
    return WIDEST_IMAGE_COLUMNS * column + (WIDEST_IMAGE_COLUMNS - 1) * PHONE_COLUMN_GAP_PX;
}

// The content column is 75vw from 1024 px and, below that, the viewport less an edge on each side (92vw is the most that
// can be at 768 px and up; `phoneImageWidth` measures the phone case).
const DESKTOP_COLUMN_VW = 75;
const NARROW_COLUMN_VW = 92;

/**
 * How wide a figure is drawn, for the browser's choice among the candidates: a slot spanning `span` of the twelve
 * columns is `span / 12` of the content column (gutters ignored, so the hint errs slightly large).
 */
export function clusterSizes(span: number): string {
    const share = (column: number) => `${Math.round(((column * span) / CLUSTER_COLUMNS) * 100) / 100}vw`;
    return `(min-width: 1024px) ${share(DESKTOP_COLUMN_VW)}, ${share(NARROW_COLUMN_VW)}`;
}

/**
 * A slot this many columns wide or more can need more than 960 px on a 2x display: a 5-column slot at 1920 px is about
 * 600 CSS px, so about 1200 px on a 2x display, more than GRID_WIDTHS' largest width.
 */
export const WIDE_SLOT_COLUMNS = 5;

/**
 * The widths offered in `srcset`: only ever widths that already exist per photo (GRID_WIDTHS and LIGHTBOX_WIDTHS), so the
 * cluster adds no Cloudflare transformations. A wide slot also gets the lightbox widths, so a large image stays sharp.
 */
export function clusterSrcsetWidths(span: number): readonly number[] {
    return span >= WIDE_SLOT_COLUMNS ? [...GRID_WIDTHS, ...LIGHTBOX_WIDTHS] : GRID_WIDTHS;
}

/** The width of the variant in the `src` attribute, the fallback for a browser that ignores `srcset`. */
export const CLUSTER_SRC_WIDTH = 640;

/**
 * One image's place in the cluster. `start` and `end` are grid lines of the twelve columns (1 to 13), so the image spans
 * `end - start` columns. Row 1 images sit on the row's bottom edge and are raised by `lift` (in `cqi`, one percent of the
 * cluster's width). Row 2 images hang from the row's top edge and are pulled up over row 1 by `pull` (`cqi`, negative),
 * so the two rows overlap.
 */
export interface Slot {
    start: number;
    end: number;
    row: 1 | 2;
    lift?: number;
    pull?: number;
}

export type ClusterCount = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

// Neighbors in a row overlap by one column, as the three-photo composition always did. The lifts and pulls stagger the
// rows. A single image is capped at six columns so a portrait photo stays about as tall as the wordmark above it.
export const CLUSTER_LAYOUTS: Record<ClusterCount, readonly Slot[]> = {
    1: [{ start: 4, end: 10, row: 1 }],
    // Two 6-column images overlapping by one column fill 11 of the 12 columns, so the pair is left-aligned by design.
    2: [
        { start: 1, end: 7, row: 1 },
        { start: 6, end: 12, row: 1, lift: 4.9 },
    ],
    // The original composition, kept exactly.
    3: [
        { start: 1, end: 6, row: 1 },
        { start: 5, end: 10, row: 1, lift: 4.9 },
        { start: 9, end: 13, row: 1, lift: 2.45 },
    ],
    4: [
        { start: 1, end: 5, row: 1 },
        { start: 4, end: 8, row: 1, lift: 4.9 },
        { start: 7, end: 11, row: 1, lift: 1.6 },
        { start: 10, end: 13, row: 1, lift: 3.6 },
    ],
    5: [
        { start: 1, end: 6, row: 1 },
        { start: 5, end: 9, row: 1, lift: 4.9 },
        { start: 8, end: 13, row: 1, lift: 2.45 },
        { start: 2, end: 6, row: 2, pull: -6 },
        { start: 5, end: 10, row: 2, pull: -9 },
    ],
    6: [
        { start: 1, end: 6, row: 1 },
        { start: 5, end: 9, row: 1, lift: 4.9 },
        { start: 8, end: 13, row: 1, lift: 2.45 },
        { start: 1, end: 5, row: 2, pull: -9 },
        { start: 4, end: 9, row: 2, pull: -5 },
        { start: 8, end: 12, row: 2, pull: -8 },
    ],
    7: [
        { start: 1, end: 5, row: 1 },
        { start: 4, end: 8, row: 1, lift: 4.9 },
        { start: 7, end: 11, row: 1, lift: 1.6 },
        { start: 10, end: 13, row: 1, lift: 3.6 },
        { start: 1, end: 5, row: 2, pull: -9 },
        { start: 4, end: 9, row: 2, pull: -5 },
        { start: 8, end: 12, row: 2, pull: -8 },
    ],
    8: [
        { start: 1, end: 5, row: 1 },
        { start: 4, end: 8, row: 1, lift: 4.9 },
        { start: 7, end: 11, row: 1, lift: 1.6 },
        { start: 10, end: 13, row: 1, lift: 3.6 },
        { start: 1, end: 4, row: 2, pull: -9 },
        { start: 3, end: 7, row: 2, pull: -5 },
        { start: 6, end: 10, row: 2, pull: -8 },
        { start: 9, end: 13, row: 2, pull: -4 },
    ],
};

/** The inline style that puts a figure in its slot: only CSS values, so the template just applies them. */
export function slotStyle({ start, end, row, lift = 0, pull = 0 }: Slot): Record<string, string> {
    return {
        gridColumn: `${start} / ${end}`,
        gridRow: String(row),
        alignSelf: row === 1 ? 'end' : 'start',
        marginBlockEnd: `${lift}cqi`,
        marginBlockStart: `${pull}cqi`,
    };
}

export interface ClusterFigure {
    key: string;
    alt: string;
    width: number;
    height: number;
    src: string;
    srcset: string;
    sizes: string;
    /** Inline style values (grid placement and offsets) from the layout table. */
    layout: Record<string, string>;
    /** A `data:` URL of the ThumbHash preview, painted behind the image until it loads. */
    placeholder: string;
}

/**
 * The photos the cluster shows: the pinned ones in the gallery's own order, at most HOME_PIN_LIMIT. With none pinned,
 * the first CLUSTER_FALLBACK_SIZE. Empty when there are none.
 */
export function clusterEntries<Entry extends object>(entries: readonly Entry[]): Entry[] {
    // `in` rather than a `pin` property type, so this compiles whether or not the entry type declares the field.
    const pinned = entries.filter((entry) => 'pin' in entry && entry.pin === true);
    return pinned.length > 0 ? pinned.slice(0, HOME_PIN_LIMIT) : entries.slice(0, CLUSTER_FALLBACK_SIZE);
}

/** Everything the cluster template needs for each photo. Decoding the placeholders is why it is async. */
export async function clusterFigures(entries: readonly GalleryEntry<CollectionCaption>[]): Promise<ClusterFigure[]> {
    const shown = clusterEntries(entries);
    return Promise.all(
        shown.map(async ({ key, alt, width, height, thumbhash }, index) => {
            const slot = CLUSTER_LAYOUTS[shown.length as ClusterCount][index];
            const span = slot.end - slot.start;
            return {
                key,
                alt,
                width,
                height,
                src: transformedImageUrl(key, { width: CLUSTER_SRC_WIDTH, quality: GRID_QUALITY }),
                srcset: imageSrcset(key, clusterSrcsetWidths(span), { quality: GRID_QUALITY }),
                sizes: clusterSizes(span),
                layout: slotStyle(slot),
                placeholder: await placeholderDataUrl(thumbhash),
            };
        }),
    );
}
