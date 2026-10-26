import { GALLERY_COLLECTIONS, type CollectionCaption, type GalleryCollectionName, type GalleryEntry } from './gallery';
import { aspectRatio, placeTiles, tileSizes, type TilePlacement } from './galleryLayout';
import { GRID_WIDTHS, imageSrcset, LIGHTBOX_WIDTHS, originalImageUrl, transformedImageUrl } from './imageUrl';
import { placeholderDataUrl } from './thumbhash';

// Every candidate width the site already generates: the grid set plus the lightbox set. A tile can be as wide as the
// full content column (a panorama), where the grid set alone would be upscaled. These are the same six transformations
// per photo that the lightbox already requests, so the monthly quota is unchanged.
const TILE_WIDTHS: readonly number[] = [...GRID_WIDTHS, ...LIGHTBOX_WIDTHS];

// Tiles are shown small beside their neighbors, and a page holds dozens, so they are encoded a little lighter than
// Cloudflare's default (85). The quality does not count toward the transformation quota; the lightbox keeps the default.
export const TILE_QUALITY = 75;

/** The width of the variant in the `src` attribute, the fallback for a browser that ignores `srcset`. */
export const GRID_SRC_WIDTH = 640;

/** How many of the first tiles load eagerly: about a screenful of the grid, so the LCP image is not lazy. */
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
    /** Where the tile sits in the 12-column grid (see galleryLayout.ts). */
    placement: TilePlacement;
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
    const placements = placeTiles(entries.map(({ width, height }) => aspectRatio(width, height)));
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
            src: transformedImageUrl(key, { width: GRID_SRC_WIDTH, quality: TILE_QUALITY }),
            srcset: imageSrcset(key, TILE_WIDTHS, { quality: TILE_QUALITY }),
            sizes: tileSizes(placements[index].span),
            placement: placements[index],
            loading: index < EAGER_TILE_COUNT ? ('eager' as const) : ('lazy' as const),
            fetchpriority: index === 0 ? ('high' as const) : undefined,
            placeholder: await placeholderDataUrl(thumbhash),
        })),
    );
}
