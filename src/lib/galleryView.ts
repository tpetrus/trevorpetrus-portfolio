import { GALLERY_COLLECTIONS, type CollectionCaption, type GalleryCollectionName, type GalleryEntry } from './gallery';
import { aspectRatio, placeTiles, tileSizes, type TilePlacement } from './galleryLayout';
import { GRID_WIDTHS, imageSrcset, LIGHTBOX_WIDTHS, originalImageUrl, transformedImageUrl } from './imageUrl';
import { photoAnchorId } from './photoLink';
import { placeholderDataUrl } from './thumbhash';

// Every candidate width the site already generates: the grid set plus the lightbox set. A tile can be as wide as the
// full content column (a panorama), where the grid set alone would be upscaled. These are the same six transformations
// per photo that the lightbox already requests, so the monthly quota is unchanged.
const TILE_WIDTHS: readonly number[] = [...GRID_WIDTHS, ...LIGHTBOX_WIDTHS];

/** The width of the variant in the `src` attribute, the fallback for a browser that ignores `srcset`. */
export const GRID_SRC_WIDTH = 640;

/** How many of the first tiles load eagerly: only the LCP image, so the other photos do not compete with it on mobile. */
export const EAGER_TILE_COUNT = 1;

// Grid tiles are small and shown beside many others, and a page holds dozens; Cloudflare's default (85) spends bytes nobody can see there. The
// lightbox keeps the default. Quality is not part of the unique-transformation count.
export const GRID_QUALITY = 70;

export interface GalleryTile {
    key: string;
    /** The tile's `id` on the page, so a link such as `/photography/#photo-<name>` can open the photo (see photoLink.ts). */
    anchorId: string;
    alt: string;
    width: number;
    height: number;
    /** The full caption as one line, or an empty string: what the lightbox shows. */
    caption: string;
    /** The short line under the tile in the grid (for photography, only the place), or an empty string. */
    tileCaption: string;
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

export interface GalleryTilesOptions {
    /**
     * Whether the first tile loads eagerly with a high fetch priority. The Photography page holds several galleries, and
     * only the first photo on the page is the likely LCP element, so every later gallery passes false.
     */
    eager?: boolean;
}

/** One section of a collection's page: a category and the entries in it, in the data's order. */
export interface GallerySection {
    id: string;
    label: string;
    entries: GalleryEntry<CollectionCaption>[];
}

/**
 * The collection's categories in their render order, each with its entries in the order given. A category with no
 * entries is kept (the page shows a short "on their way" line for it); an entry in no known category is dropped, which
 * the entry schema already rules out.
 */
export function gallerySections(
    collection: GalleryCollectionName,
    entries: readonly GalleryEntry<CollectionCaption>[],
): GallerySection[] {
    return GALLERY_COLLECTIONS[collection].categories.map(({ id, label }) => ({
        id,
        label,
        entries: entries.filter((entry) => entry.category === id),
    }));
}

/** Everything the gallery template needs for each entry, in order. Decoding the placeholders is why it is async. */
export async function galleryTiles(
    collection: GalleryCollectionName,
    entries: readonly GalleryEntry<CollectionCaption>[],
    { eager = true }: GalleryTilesOptions = {},
): Promise<GalleryTile[]> {
    const { formatCaption, formatTileCaption } = GALLERY_COLLECTIONS[collection];
    const largestLightboxWidth = Math.max(...LIGHTBOX_WIDTHS);
    const placements = placeTiles(entries.map(({ width, height }) => aspectRatio(width, height)));
    return Promise.all(
        entries.map(async ({ key, alt, width, height, caption, thumbhash }, index) => ({
            key,
            anchorId: photoAnchorId(key),
            alt,
            width,
            height,
            caption: formatCaption(caption),
            tileCaption: formatTileCaption(caption),
            original: originalImageUrl(key),
            href: transformedImageUrl(key, { width: largestLightboxWidth }),
            lightboxSrcset: imageSrcset(key, LIGHTBOX_WIDTHS),
            src: transformedImageUrl(key, { width: GRID_SRC_WIDTH, quality: GRID_QUALITY }),
            srcset: imageSrcset(key, TILE_WIDTHS, { quality: GRID_QUALITY }),
            sizes: tileSizes(placements[index].span),
            placement: placements[index],
            loading: eager && index < EAGER_TILE_COUNT ? ('eager' as const) : ('lazy' as const),
            fetchpriority: eager && index === 0 ? ('high' as const) : undefined,
            placeholder: await placeholderDataUrl(thumbhash),
        })),
    );
}
