import { GALLERY_COLLECTIONS, type CollectionCaption, type GalleryEntry } from './gallery';
import { GRID_QUALITY } from './galleryView';
import { GRID_WIDTHS, imageSrcset, transformedImageUrl } from './imageUrl';
import { placeholderDataUrl } from './thumbhash';

/** How many photos the home page's image cluster shows. */
export const CLUSTER_SIZE = 3;

/** The cluster is a grid of this many columns, and the widest images span {@link WIDEST_IMAGE_COLUMNS} of them. */
export const CLUSTER_COLUMNS = 12;
export const WIDEST_IMAGE_COLUMNS = 5;

/** The cluster's column gap below 48rem, in pixels (0.5rem; see HomeCluster.astro). */
export const PHONE_COLUMN_GAP_PX = 8;

/**
 * The width in pixels of the widest cluster image below 768 px, for a viewport that wide. The content column is the
 * viewport less an edge on each side (`--spacing-edge`: 4vw, but at least 16 px), and an image spans five of the twelve
 * columns and the four gaps between them.
 */
export function phoneImageWidth(viewportWidth: number): number {
    const edge = Math.max(16, viewportWidth * 0.04);
    const content = viewportWidth - 2 * edge;
    const column = (content - (CLUSTER_COLUMNS - 1) * PHONE_COLUMN_GAP_PX) / CLUSTER_COLUMNS;
    return WIDEST_IMAGE_COLUMNS * column + (WIDEST_IMAGE_COLUMNS - 1) * PHONE_COLUMN_GAP_PX;
}

// How wide a figure is drawn, for the browser's choice among the grid candidates (the fixed GRID_WIDTHS only, so the
// cluster adds no Cloudflare transformations beyond the ones the Photography page already uses). Below 768 px the
// widest image is 36% to 38% of the viewport (`phoneImageWidth`), so 38vw; from 768 px up the figures share a row, each
// about five of twelve columns of the 976 px content column (the column is capped at 5xl).
export const CLUSTER_SIZES = '(min-width: 1024px) 400px, (min-width: 768px) 42vw, 38vw';

/** The width of the variant in the `src` attribute, the fallback for a browser that ignores `srcset`. */
export const CLUSTER_SRC_WIDTH = 640;

export interface ClusterFigure {
    key: string;
    alt: string;
    width: number;
    height: number;
    /** The caption as one line, or an empty string. */
    caption: string;
    src: string;
    srcset: string;
    sizes: string;
    /** A `data:` URL of the ThumbHash preview, painted behind the image until it loads. */
    placeholder: string;
}

/** The photos the cluster shows: the first ones in the gallery's own order. Empty when there are none. */
export function clusterEntries<Entry>(entries: readonly Entry[]): Entry[] {
    return entries.slice(0, CLUSTER_SIZE);
}

/** Everything the cluster template needs for each photo. Decoding the placeholders is why it is async. */
export async function clusterFigures(entries: readonly GalleryEntry<CollectionCaption>[]): Promise<ClusterFigure[]> {
    const { formatCaption } = GALLERY_COLLECTIONS.photography;
    return Promise.all(
        clusterEntries(entries).map(async ({ key, alt, width, height, caption, thumbhash }) => ({
            key,
            alt,
            width,
            height,
            caption: formatCaption(caption),
            src: transformedImageUrl(key, { width: CLUSTER_SRC_WIDTH, quality: GRID_QUALITY }),
            srcset: imageSrcset(key, GRID_WIDTHS, { quality: GRID_QUALITY }),
            sizes: CLUSTER_SIZES,
            placeholder: await placeholderDataUrl(thumbhash),
        })),
    );
}
