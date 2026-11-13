import { z } from 'astro/zod';

import type { CuratedEntry } from './gallery';
import type { PhotoLocation } from './location';
import { ALT_PLACEHOLDER_MARKER, isPlaceholderAlt, PLACEHOLDER_ALT_MESSAGE } from './sidecarPlaceholder';

// What the viewer sees under an artwork. Strict, so nothing outside this list reaches the page. Everything but the
// title is optional: a piece may have no known medium, size or year.
export const artCaptionSchema = z.strictObject({
    title: z.string().trim().min(1),
    medium: z.string().trim().min(1).optional(),
    /** Free text, as the artist writes it ("24 x 36 in"). */
    dimensions: z.string().trim().min(1).optional(),
    year: z.int().min(1900).max(2100).optional(),
});
export type ArtCaption = z.output<typeof artCaptionSchema>;

/** The art page's sections, in the order they render. `id` is what a sidecar's `category` holds. */
export const ART_CATEGORIES = [
    { id: 'drawing', label: 'Drawing' },
    { id: 'digital', label: 'Digital' },
] as const;
export type ArtCategory = (typeof ART_CATEGORIES)[number]['id'];

const ART_CATEGORY_IDS = ART_CATEGORIES.map(({ id }) => id) as [ArtCategory, ...ArtCategory[]];

// The hand-written `src/content/art/<image basename>.yml`. Strict: a mistyped key (`medum`) fails instead of being
// ignored, because the sidecar is the only source of the caption.
export const artSidecarSchema = z.strictObject({
    // The scaffold's placeholder is rejected so that a piece without real alt text cannot be synced.
    alt: z
        .string()
        .min(1)
        .refine((alt) => !isPlaceholderAlt(alt), PLACEHOLDER_ALT_MESSAGE),
    title: z.string().trim().min(1),
    category: z.enum(ART_CATEGORY_IDS),
    medium: z.string().trim().min(1).optional(),
    dimensions: z.string().trim().min(1).optional(),
    year: z.int().min(1900).max(2100).optional(),
    /** Fixes the piece's position within its category: lowest first, ahead of pieces without an order. */
    order: z.int().optional(),
    /** Shows the piece in the home page's collage. */
    pin: z.boolean().optional(),
    /** Fixes the piece's position in the home page's collage, lowest first. */
    homeOrder: z.int().optional(),
});
export type ArtSidecar = z.output<typeof artSidecarSchema>;

/** The file `scaffold-gallery` writes for a piece that has no sidecar yet. The sync refuses it until it is filled in. */
export function artSidecarTemplate(basename: string): string {
    return `# Sidecar for ${basename}: the text the site cannot read from the image.
# alt (required): one plain sentence saying what is in the image, for people who cannot see it.
#   Replace the whole line below. The sync refuses any alt that starts with ${ALT_PLACEHOLDER_MARKER}.
# title (required): the name of the piece, shown under it and in the lightbox. The sync refuses an empty title.
# category (required): the section of the Art page, one of ${ART_CATEGORY_IDS.join(', ')}.
#   The sync refuses the placeholder below until it is replaced.
# medium (optional): for example graphite on paper.
# dimensions (optional): for example 24 x 36 in.
# year (optional): a year from 1900 to 2100.
# order (optional): a whole number that fixes this piece's position in its section, lowest first.
# pin (optional): true shows this piece in the home page's collage.
# homeOrder (optional): a whole number that fixes this piece's position in the home page's collage, lowest first.
alt: "${ALT_PLACEHOLDER_MARKER}: describe this piece"
title: ""
category: "${ALT_PLACEHOLDER_MARKER}: ${ART_CATEGORY_IDS.join(', ')}"
# medium: Graphite on paper
# dimensions: 24 x 36 in
# year: 2026
# order: 1
# pin: true
# homeOrder: 1
`;
}

/** `Title, medium, dimensions, year`, with absent fields left out. */
export function formatArtCaption(caption: ArtCaption): string {
    return [caption.title, caption.medium, caption.dimensions, caption.year]
        .filter((part) => part !== undefined)
        .join(', ');
}

/** The short caption under a tile on the Art page: the title. The full line is in the lightbox. */
export function formatArtTileCaption(caption: ArtCaption): string {
    return caption.title;
}

/** The entry caption, taken from the sidecar alone (a piece has no camera and no place), absent fields omitted. */
export function artCaptionFor({
    sidecar,
}: {
    sidecar: ArtSidecar;
    camera: ArtCaption | undefined;
    location: PhotoLocation | undefined;
}): ArtCaption {
    const { title, medium, dimensions, year } = sidecar;
    return {
        title,
        ...(medium === undefined ? {} : { medium }),
        ...(dimensions === undefined ? {} : { dimensions }),
        ...(year === undefined ? {} : { year }),
    };
}

/** The order of the art data file: category (in page order), then `order` (lowest first, unset last), then the key. */
export function compareArtEntries(a: CuratedEntry<ArtCaption>, b: CuratedEntry<ArtCaption>): number {
    const ids: readonly string[] = ART_CATEGORY_IDS;
    const byCategory = ids.indexOf(a.entry.category) - ids.indexOf(b.entry.category);
    if (byCategory !== 0) return byCategory;
    if (a.order !== b.order) {
        if (a.order === undefined) return 1;
        if (b.order === undefined) return -1;
        return a.order - b.order;
    }
    // By code point, so the order never depends on the machine's locale.
    return a.entry.key < b.entry.key ? -1 : a.entry.key > b.entry.key ? 1 : 0;
}
