import { GALLERY_COLLECTIONS, type CollectionCaption, type GalleryEntry } from './gallery';
import { GRID_QUALITY } from './galleryView';
import { GRID_WIDTHS, imageSrcset, transformedImageUrl } from './imageUrl';
import { placeholderDataUrl } from './thumbhash';

/** How many photos the home page's image cluster shows. */
export const CLUSTER_SIZE = 3;

// How wide a figure is drawn, for the browser's choice among the grid candidates (the fixed GRID_WIDTHS only, so the
// cluster adds no Cloudflare transformations beyond the ones the Photography page already uses). Below 768 px a figure
// is about 40% of the viewport (half of a figure that spans three quarters of the column; see HomeCluster.astro), which
// keeps every image smaller than the wordmark's text block, so the name stays the largest contentful paint and the images can all be lazy; from 768 px up the figures
// share a row, each about five of twelve columns of the content column, which is 75vw from 1024 px (5/12 of 75vw, gutters ignored).
export const CLUSTER_SIZES = '(min-width: 1024px) 31.25vw, (min-width: 768px) 42vw, 40vw';

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
