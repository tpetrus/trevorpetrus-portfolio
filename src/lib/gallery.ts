import { z } from 'astro/zod';

import {
    formatPhotographyCaption,
    photographyCaptionSchema,
    photographySidecarSchema,
    photographySidecarTemplate,
} from './photography';
import { isThumbHash } from './thumbhash';

const SHA256_HEX = /^[0-9a-f]{64}$/;

// "<collection>/<file>.jpg": the file name has no slash and does not start with a dot.
function isGalleryKey(collection: string, key: string): boolean {
    const prefix = `${collection}/`;
    return key.startsWith(prefix) && /^[^/.][^/]*\.jpg$/.test(key.slice(prefix.length));
}

/**
 * The schema of one entry in `src/data/gallery/<collection>.json`. A factory because the caption differs by
 * collection: photography keeps camera settings, art will keep a title and medium.
 */
export function galleryEntrySchema<Caption extends z.ZodType>(collection: string, captionSchema: Caption) {
    return z.object({
        // The R2 object key. Output files are always JPEGs, so the key always ends in `.jpg`.
        key: z
            .string()
            .refine((key) => isGalleryKey(collection, key), `Expected a key like "${collection}/<file>.jpg"`),
        width: z.int().positive(),
        height: z.int().positive(),
        thumbhash: z.string().refine(isThumbHash, 'Expected a base64 ThumbHash'),
        // Hash of the local source file, so a re-run skips files that have not changed.
        sourceSha256: z.string().regex(SHA256_HEX, 'Expected 64 lowercase hex characters'),
        processingVersion: z.int().positive(),
        alt: z.string().min(1),
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
    caption: Caption;
}

interface GalleryCollection<Caption extends z.ZodType, Sidecar extends z.ZodType> {
    captionSchema: Caption;
    /** The hand-written `src/content/<collection>/<image basename>.yml` next to each image. */
    sidecarSchema: Sidecar;
    /** The text of a new sidecar for an image with this basename; its `alt` must be a placeholder the schema rejects. */
    sidecarTemplate(basename: string): string;
    /** Whether the processed JPEG keeps the camera's EXIF (never GPS). Art has none worth keeping. */
    keepsCameraExif: boolean;
    // A method, not a property, so each collection can take its own caption type (parameters are checked bivariantly).
    formatCaption(caption: z.output<Caption>): string;
}

/** Everything that differs between collections. `art` is added here, with its own caption and sidecar, later. */
export const GALLERY_COLLECTIONS = {
    photography: {
        captionSchema: photographyCaptionSchema,
        sidecarSchema: photographySidecarSchema,
        sidecarTemplate: photographySidecarTemplate,
        keepsCameraExif: true,
        formatCaption: formatPhotographyCaption,
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
    const { captionSchema } = galleryCollection(collection);
    return z.array(galleryEntrySchema(collection, captionSchema)).parse(data);
}
