import { GALLERY_COLLECTIONS, type CollectionCaption, type GalleryCollectionName, type GalleryEntry } from './gallery';
import { GRID_WIDTHS, imageSrcset, LIGHTBOX_WIDTHS, originalImageUrl, transformedImageUrl } from './imageUrl';
import { placeholderDataUrl } from './thumbhash';

// How wide a tile is drawn, for the browser's choice among the grid candidates. The page's content column is capped at
// 5xl (1024 px) minus 1.5 rem of padding on each side, so 976 px; the grid has one column below 640 px, two up to
// 1024 px and three above, with a 1 rem gap. At 1024 px and wider that makes each tile (976 - 2 x 16) / 3 = 315 px.
export const GRID_SIZES = '(min-width: 1024px) 315px, (min-width: 640px) calc((100vw - 4rem) / 2), calc(100vw - 3rem)';

/** The width of the variant in the `src` attribute, the fallback for a browser that ignores `srcset`. */
export const GRID_SRC_WIDTH = 640;

/** How many of the first tiles load eagerly: about a screenful of the three-column grid, so the LCP image is not lazy. */
export const EAGER_TILE_COUNT = 3;

export interface GalleryTile {
    key: string;
    alt: string;
    width: number;
    height: number;
    /** The caption as one line, or an empty string. */
    caption: string;
    /** The URL of the untouched original in the bucket. */
    original: string;
    /** The largest lightbox variant: where the link goes without JavaScript. */
    href: string;
    lightboxSrcset: string;
    src: string;
    srcset: string;
    sizes: string;
    loading: 'eager' | 'lazy';
    /** Set on the first tile only: it is the likely LCP element. */
    fetchpriority: 'high' | undefined;
    /** A `data:` URL of the ThumbHash preview, painted behind the image until it loads. */
    placeholder: string;
}

/** Everything the gallery template needs for each entry, in order. Decoding the placeholders is why it is async. */
export async function galleryTiles(
    collection: GalleryCollectionName,
    entries: readonly GalleryEntry<CollectionCaption>[],
): Promise<GalleryTile[]> {
    const { formatCaption } = GALLERY_COLLECTIONS[collection];
    const largestLightboxWidth = Math.max(...LIGHTBOX_WIDTHS);
    return Promise.all(
        entries.map(async ({ key, alt, width, height, caption, thumbhash }, index) => ({
            key,
            alt,
            width,
            height,
            caption: formatCaption(caption),
            original: originalImageUrl(key),
            href: transformedImageUrl(key, { width: largestLightboxWidth }),
            lightboxSrcset: imageSrcset(key, LIGHTBOX_WIDTHS),
            src: transformedImageUrl(key, { width: GRID_SRC_WIDTH }),
            srcset: imageSrcset(key, GRID_WIDTHS),
            sizes: GRID_SIZES,
            loading: index < EAGER_TILE_COUNT ? ('eager' as const) : ('lazy' as const),
            fetchpriority: index === 0 ? ('high' as const) : undefined,
            placeholder: await placeholderDataUrl(thumbhash),
        })),
    );
}
