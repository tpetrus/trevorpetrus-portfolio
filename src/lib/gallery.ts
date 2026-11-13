import { z } from 'astro/zod';

import { captionWithLocation, type PhotoLocation } from './location';
import {
    comparePhotographyEntries,
    formatPhotographyCaption,
    formatPhotographyTileCaption,
    PHOTOGRAPHY_CATEGORIES,
    photographyCaptionSchema,
    photographySidecarSchema,
    photographySidecarTemplate,
} from './photography';
import { isThumbHash } from './thumbhash';

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The source formats a collection accepts, which are also the extensions of its R2 keys. */
export type GalleryExtension = 'jpg' | 'png';

// "<collection>/<file>.<extension>": the file name has no slash and does not start with a dot.
function isGalleryKey(collection: string, key: string, extensions: readonly GalleryExtension[]): boolean {
    const prefix = `${collection}/`;
    if (!key.startsWith(prefix)) return false;
    const file = key.slice(prefix.length);
    return /^[^/.][^/]*$/.test(file) && extensions.some((extension) => file.endsWith(`.${extension}`));
}

/**
 * The schema of one entry in `src/data/gallery/<collection>.json`. A factory because the caption differs by
 * collection: photography keeps camera settings, art will keep a title and medium.
 */
export function galleryEntrySchema<Caption extends z.ZodType>(
    collection: string,
    captionSchema: Caption,
    categories: readonly GalleryCategory[],
    extensions: readonly GalleryExtension[],
) {
    const categoryIds = categories.map(({ id }) => id);
    return z.object({
        // The R2 object key. It ends in the extension of the source format, which the collection must accept.
        key: z
            .string()
            .refine(
                (key) => isGalleryKey(collection, key, extensions),
                `Expected a key like "${collection}/<file>.${extensions.join('|')}"`,
            ),
        width: z.int().positive(),
        height: z.int().positive(),
        thumbhash: z.string().refine(isThumbHash, 'Expected a base64 ThumbHash'),
        // Hash of the local source file, so a re-run skips files that have not changed.
        sourceSha256: z.string().regex(SHA256_HEX, 'Expected 64 lowercase hex characters'),
        processingVersion: z.int().positive(),
        alt: z.string().min(1),
        // Copied from the sidecar by the sync; one of the collection's categories.
        category: z
            .string()
            .refine((category) => categoryIds.includes(category), `Expected one of ${categoryIds.join(', ')}`),
        // Written only as `true` (from the sidecar's `pin`), so an unpinned entry carries no key and the file stays small.
        pin: z.literal(true).optional(),
        caption: captionSchema,
    });
}

export interface GalleryEntry<Caption> {
    key: string;
    width: number;
    height: number;
    thumbhash: string;
    sourceSha256: string;
    processingVersion: number;
    alt: string;
    /** The section of the collection's page the entry is shown in: the `id` of one of its `categories`. */
    category: string;
    /** The home page's collage shows pinned entries. */
    pin?: true;
    caption: Caption;
}

/** An entry plus the sidecar's `order`, which decides its position but is not stored in the data file. */
export interface CuratedEntry<Caption> {
    entry: GalleryEntry<Caption>;
    order: number | undefined;
}

/** One section of a collection's page. */
export interface GalleryCategory {
    /** The value a sidecar's `category` holds, also the section's anchor id on the page. */
    id: string;
    /** The section's heading. */
    label: string;
}

interface GalleryCollection<Caption extends z.ZodType, Sidecar extends z.ZodType> {
    captionSchema: Caption;
    /** The hand-written `src/content/<collection>/<image basename>.yml` next to each image. */
    sidecarSchema: Sidecar;
    /** The text of a new sidecar for an image with this basename; its `alt` must be a placeholder the schema rejects. */
    sidecarTemplate(basename: string): string;
    /** Reads the source's camera EXIF and keeps it in the processed JPEG (never GPS). */
    readsCamera: boolean;
    /** Derives a place (sidecar `location` override, else GPS -> GeoNames). False: no lookup, no dataset load. */
    usesPlaces: boolean;
    /**
     * Source formats accepted, in priority order. 'jpg' accepts .jpg/.jpeg (any case) and keys end .jpg; 'png' accepts
     * .png and keys end .png.
     */
    extensions: readonly GalleryExtension[];
    /** The page's sections, in the order they render; every entry is in exactly one. */
    categories: readonly GalleryCategory[];
    // A method, not a property, so each collection can take its own caption type (parameters are checked bivariantly).
    formatCaption(caption: z.output<Caption>): string;
    /** The short line under a tile in the grid; the full `formatCaption` line is shown in the lightbox. */
    formatTileCaption(caption: z.output<Caption>): string;
    /**
     * The entry caption. `camera`: the caption processImage read (new or changed) or the previous entry's caption
     * (unchanged); undefined when `readsCamera` is false. `location`: the resolved place; undefined when `usesPlaces`
     * is false or there is none. A hook, so the sync never has to know which collection it is running.
     */
    captionFor(input: {
        sidecar: z.output<Sidecar>;
        camera: z.output<Caption> | undefined;
        location: PhotoLocation | undefined;
    }): z.output<Caption>;
    /** The total order of the curated entries in the data file. */
    compareEntries(a: CuratedEntry<z.output<Caption>>, b: CuratedEntry<z.output<Caption>>): number;
}

/** Everything that differs between collections. `art` is added here, with its own caption and sidecar, later. */
export const GALLERY_COLLECTIONS = {
    photography: {
        captionSchema: photographyCaptionSchema,
        sidecarSchema: photographySidecarSchema,
        sidecarTemplate: photographySidecarTemplate,
        readsCamera: true,
        usesPlaces: true,
        extensions: ['jpg'],
        categories: PHOTOGRAPHY_CATEGORIES,
        formatCaption: formatPhotographyCaption,
        formatTileCaption: formatPhotographyTileCaption,
        captionFor: ({ camera, location }) => captionWithLocation(camera ?? {}, location),
        compareEntries: comparePhotographyEntries,
    },
} satisfies Record<string, GalleryCollection<z.ZodType, z.ZodType>>;

export type GalleryCollectionName = keyof typeof GALLERY_COLLECTIONS;
export type CollectionCaption = z.output<(typeof GALLERY_COLLECTIONS)[GalleryCollectionName]['captionSchema']>;
export type CollectionSidecar = z.output<(typeof GALLERY_COLLECTIONS)[GalleryCollectionName]['sidecarSchema']>;

export function isGalleryCollection(name: string): name is GalleryCollectionName {
    return Object.hasOwn(GALLERY_COLLECTIONS, name);
}

/** Throws a message that lists the valid names when `name` is not a registered collection. */
export function assertGalleryCollection(name: string): asserts name is GalleryCollectionName {
    if (!isGalleryCollection(name)) {
        throw new Error(
            `Unknown gallery collection "${name}". Known collections: ${Object.keys(GALLERY_COLLECTIONS).join(', ')}.`,
        );
    }
}

export function galleryCollection(name: string): (typeof GALLERY_COLLECTIONS)[GalleryCollectionName] {
    assertGalleryCollection(name);
    return GALLERY_COLLECTIONS[name];
}

/** Validates the parsed contents of `src/data/gallery/<collection>.json` (an array of entries). */
export function parseGallery(collection: string, data: unknown): GalleryEntry<CollectionCaption>[] {
    const { captionSchema, categories, extensions } = galleryCollection(collection);
    return z.array(galleryEntrySchema(collection, captionSchema, categories, extensions)).parse(data);
}
