import { z } from 'astro/zod';

import {
    ART_CATEGORIES,
    artCaptionFor,
    artCaptionSchema,
    artSidecarSchema,
    artSidecarTemplate,
    compareArtEntries,
    formatArtCaption,
    formatArtTileCaption,
} from './art';
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
 * collection: photography keeps camera settings, art keeps a title and medium.
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
        // Written only when the sidecar sets it: the entry's position in the home collage.
        homeOrder: z.int().optional(),
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
    /** Fixes the entry's position in the home page's collage, lowest first. */
    homeOrder?: number;
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

/** Everything that differs between collections. */
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
    art: {
        captionSchema: artCaptionSchema,
        sidecarSchema: artSidecarSchema,
        sidecarTemplate: artSidecarTemplate,
        readsCamera: false,
        usesPlaces: false,
        extensions: ['jpg', 'png'],
        categories: ART_CATEGORIES,
        formatCaption: formatArtCaption,
        formatTileCaption: formatArtTileCaption,
        captionFor: artCaptionFor,
        compareEntries: compareArtEntries,
    },
} satisfies Record<string, GalleryCollection<z.ZodType, z.ZodType>>;

export type GalleryCollectionName = keyof typeof GALLERY_COLLECTIONS;
/** The caption of any registered collection, for code that serves whichever collection it was told to (the sync). */
export type AnyCollectionCaption = z.output<(typeof GALLERY_COLLECTIONS)[GalleryCollectionName]['captionSchema']>;
/** The sidecar of any registered collection. */
export type AnyCollectionSidecar = z.output<(typeof GALLERY_COLLECTIONS)[GalleryCollectionName]['sidecarSchema']>;
/**
 * The caption of a named collection; photography unless said otherwise. The default is transitional: the photography
 * page and the home collage were written against one collection's caption and keep compiling until they are made
 * generic over the collection.
 */
export type CollectionCaption<Name extends GalleryCollectionName = 'photography'> = z.output<
    (typeof GALLERY_COLLECTIONS)[Name]['captionSchema']
>;
export type CollectionSidecar<Name extends GalleryCollectionName = 'photography'> = z.output<
    (typeof GALLERY_COLLECTIONS)[Name]['sidecarSchema']
>;

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

// Overloads: a literal name keeps its own collection's types (a page of photography sees photography captions), and a
// plain string (the sync, which takes the name from the command line) sees the union.
export function galleryCollection<Name extends GalleryCollectionName>(name: Name): (typeof GALLERY_COLLECTIONS)[Name];
export function galleryCollection(name: string): (typeof GALLERY_COLLECTIONS)[GalleryCollectionName];
export function galleryCollection(name: string): (typeof GALLERY_COLLECTIONS)[GalleryCollectionName] {
    assertGalleryCollection(name);
    return GALLERY_COLLECTIONS[name];
}

/** Validates the parsed contents of `src/data/gallery/<collection>.json` (an array of entries). */
export function parseGallery<Name extends GalleryCollectionName>(
    collection: Name,
    data: unknown,
): GalleryEntry<z.output<(typeof GALLERY_COLLECTIONS)[Name]['captionSchema']>>[];
export function parseGallery(collection: string, data: unknown): GalleryEntry<AnyCollectionCaption>[];
export function parseGallery(collection: string, data: unknown): GalleryEntry<AnyCollectionCaption>[] {
    const { captionSchema, categories, extensions } = galleryCollection(collection);
    return z.array(galleryEntrySchema(collection, captionSchema, categories, extensions)).parse(data);
}
