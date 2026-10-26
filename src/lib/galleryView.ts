import { GALLERY_COLLECTIONS, type CollectionCaption, type GalleryCollectionName, type GalleryEntry } from './gallery';
import { aspectRatio, placeTiles, tileSizes, type TilePlacement } from './galleryLayout';
import { GRID_WIDTHS, imageSrcset, LIGHTBOX_WIDTHS, originalImageUrl, transformedImageUrl } from './imageUrl';
import { formatNumber, numberItems } from './numbering';
import { placeholderDataUrl } from './thumbhash';

// Every candidate width the site already generates: the grid set plus the lightbox set. A tile can be as wide as the
// full content column (a panorama), where the grid set alone would be upscaled. These are the same six transformations
// per photo that the lightbox already requests, so the monthly quota is unchanged.
const TILE_WIDTHS: readonly number[] = [...GRID_WIDTHS, ...LIGHTBOX_WIDTHS];

/** The width of the variant in the `src` attribute, the fallback for a browser that ignores `srcset`. */
export const GRID_SRC_WIDTH = 640;

/** How many of the first tiles load eagerly: about a screenful of the grid, so the LCP image is not lazy. */
export const EAGER_TILE_COUNT = 3;

// Grid tiles are small and shown beside many others, and a page holds dozens; Cloudflare's default (85) spends bytes nobody can see there. The
// lightbox keeps the default. Quality is not part of the unique-transformation count.
export const GRID_QUALITY = 70;

export interface GalleryTile {
    key: string;
    /** The photo's stable index as shown ("01"): by capture date, not by position, so it survives reordering. */
    number: string;
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

// The capture date as a UTC midnight, or undefined for a photo whose EXIF had no usable date (numberItems puts those last).
function capturedAt({ taken }: CollectionCaption): Date | undefined {
    return taken === undefined ? undefined : new Date(`${taken}T00:00:00Z`);
}

/** Each entry's formatted number by key. Numbers come from the data alone, never from the order the tiles display in. */
function numbersByKey(entries: readonly GalleryEntry<CollectionCaption>[]): Map<string, string> {
    const numbered = numberItems(entries.map(({ key, caption }) => ({ key, date: capturedAt(caption) })));
    return new Map(numbered.map(({ key, number }) => [key, formatNumber(number)]));
}

/** Everything the gallery template needs for each entry, in order. Decoding the placeholders is why it is async. */
export async function galleryTiles(
    collection: GalleryCollectionName,
    entries: readonly GalleryEntry<CollectionCaption>[],
): Promise<GalleryTile[]> {
    const { formatCaption } = GALLERY_COLLECTIONS[collection];
    const largestLightboxWidth = Math.max(...LIGHTBOX_WIDTHS);
    const numbers = numbersByKey(entries);
    const placements = placeTiles(entries.map(({ width, height }) => aspectRatio(width, height)));
    return Promise.all(
        entries.map(async ({ key, alt, width, height, caption, thumbhash }, index) => ({
            key,
            number: numbers.get(key)!,
            alt,
            width,
            height,
            caption: formatCaption(caption),
            original: originalImageUrl(key),
            href: transformedImageUrl(key, { width: largestLightboxWidth }),
            lightboxSrcset: imageSrcset(key, LIGHTBOX_WIDTHS),
            src: transformedImageUrl(key, { width: GRID_SRC_WIDTH, quality: GRID_QUALITY }),
            srcset: imageSrcset(key, TILE_WIDTHS, { quality: GRID_QUALITY }),
            sizes: tileSizes(placements[index].span),
            placement: placements[index],
            loading: index < EAGER_TILE_COUNT ? ('eager' as const) : ('lazy' as const),
            fetchpriority: index === 0 ? ('high' as const) : undefined,
            placeholder: await placeholderDataUrl(thumbhash),
        })),
    );
}
