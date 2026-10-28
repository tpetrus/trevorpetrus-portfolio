import { z } from 'astro/zod';

import { formatLocation, locationSchema, sidecarLocationSchema } from './location';
import { ALT_PLACEHOLDER_MARKER, isPlaceholderAlt, PLACEHOLDER_ALT_MESSAGE } from './sidecarPlaceholder';

// Every field is optional: a file may carry no EXIF at all, and cameras leave out whatever they cannot measure
// (a manual lens reports no aperture). Strict, so nothing outside this list (a coordinate, say) can reach the page.
export const photographyCaptionSchema = z.strictObject({
    /** Where the photo was taken, as a city and a country. Set by the sync from the GPS or the sidecar, not from EXIF. */
    location: locationSchema.optional(),
    camera: z.string().min(1).optional(),
    lens: z.string().min(1).optional(),
    /** Millimeters. */
    focalLength: z.number().positive().optional(),
    /** The f-number, e.g. 1.8 for f/1.8. */
    aperture: z.number().positive().optional(),
    /** Seconds, e.g. 0.004 for 1/250 s. */
    exposure: z.number().positive().optional(),
    iso: z.int().positive().optional(),
    /** The capture date as `YYYY-MM-DD`, exactly as the camera wrote it (no time-zone conversion). */
    taken: z.iso.date().optional(),
});
export type PhotographyCaption = z.output<typeof photographyCaptionSchema>;

/**
 * The photography page's sections, in the order they render. `id` is what a sidecar's `category` holds and the anchor
 * of the section; `label` is its heading. Every photo is in exactly one.
 */
export const PHOTOGRAPHY_CATEGORIES = [
    { id: 'landscape', label: 'Landscape' },
    { id: 'portrait', label: 'Portrait' },
    { id: 'car', label: 'Car' },
] as const;
export type PhotographyCategory = (typeof PHOTOGRAPHY_CATEGORIES)[number]['id'];

const PHOTOGRAPHY_CATEGORY_IDS = PHOTOGRAPHY_CATEGORIES.map(({ id }) => id) as [
    PhotographyCategory,
    ...PhotographyCategory[],
];

// The hand-written `src/content/photography/<image basename>.yml`: EXIF has no alt text, so every photo needs one.
export const photographySidecarSchema = z.object({
    // The scaffold's placeholder is rejected so that a photo without real alt text cannot be synced.
    alt: z
        .string()
        .min(1)
        .refine((alt) => !isPlaceholderAlt(alt), PLACEHOLDER_ALT_MESSAGE),
    /** Which section of the page the photo is in. Required, so a new photo cannot land in a section by accident. */
    category: z.enum(PHOTOGRAPHY_CATEGORY_IDS),
    /** Fixes the photo's position: lowest first, ahead of every photo without an order. */
    order: z.int().optional(),
    /** Shows the photo in the home page's collage (the first eight pinned photos, in the gallery's order). */
    pin: z.boolean().optional(),
    /** The place shown in the caption instead of the one derived from the GPS, or `false` for none. */
    location: sidecarLocationSchema.optional(),
});
export type PhotographySidecar = z.output<typeof photographySidecarSchema>;

/** The file `scaffold-gallery` writes for a photo that has no sidecar yet. Its `alt` is rejected until it is replaced. */
export function photographySidecarTemplate(basename: string): string {
    return `# Sidecar for ${basename}.jpg: the text the site cannot read from the photo.
# alt (required): one plain sentence saying what is in the photo, for people who cannot see it.
#   Replace the whole line below. The sync refuses any alt that starts with ${ALT_PLACEHOLDER_MARKER}.
# category (required): the section of the Photography page, one of ${PHOTOGRAPHY_CATEGORY_IDS.join(', ')}.
#   The sync refuses the placeholder below until it is replaced.
# order (optional): a whole number that fixes this photo's position, lowest first, ahead of photos without one.
# pin (optional): true shows this photo in the home page's collage (at most eight, in the gallery's order).
alt: "${ALT_PLACEHOLDER_MARKER}: describe this photo"
category: "${ALT_PLACEHOLDER_MARKER}: ${PHOTOGRAPHY_CATEGORY_IDS.join(', ')}"
# order: 1
# pin: true
# location (optional): the place the caption starts with. By default the sync derives a city and a country from the
#   photo's GPS (offline, with GeoNames). Uncomment to name another place (also for a photo with no GPS), or write
#   "location: false" to show none.
# location:
#   city: Lisbon
#   country: Portugal
`;
}

/**
 * The EXIF tags the sync script asks exifr for. It must call exifr with `reviveValues: false`: with it on, exifr turns
 * `DateTimeOriginal` into a Date in the machine's local time zone, which would shift the day for a photo taken near
 * midnight in another zone. Raw, it is the string the camera wrote.
 */
export const PHOTOGRAPHY_EXIF_TAGS = [
    'Make',
    'Model',
    'LensModel',
    'FocalLength',
    'FNumber',
    'ExposureTime',
    'ISO',
    'DateTimeOriginal',
];

const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})(?: |$)/;

// EXIF strings are often padded with spaces or NULs.
function cleanString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const cleaned = value.replaceAll(String.fromCharCode(0), '').trim();
    return cleaned === '' ? undefined : cleaned;
}

function positiveNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

// Rounds away float noise from rational values (1.7999999 -> 1.8) without losing real precision.
function round1(value: number | undefined): number | undefined {
    return value === undefined ? undefined : Math.round(value * 10) / 10;
}

// Exposures are stored at the precision the output file can hold them: whole milliseconds from one second up, and 1e-8 s
// below it (a 1/32000 s shutter is 3.125e-5 s). photographyExifBlocks writes them as rationals over the same
// denominators, so a value survives the write and a re-read unchanged.
const LONG_EXPOSURE_DENOMINATOR = 1000;
const SHORT_EXPOSURE_DENOMINATOR = 100_000_000;

function exposureDenominator(seconds: number): number {
    return seconds >= 1 ? LONG_EXPOSURE_DENOMINATOR : SHORT_EXPOSURE_DENOMINATOR;
}

function normalizeExposure(seconds: number | undefined): number | undefined {
    if (seconds === undefined) return undefined;
    const denominator = exposureDenominator(seconds);
    return Math.round(seconds * denominator) / denominator;
}

/**
 * "Canon" + "Canon EOS R5" is "Canon EOS R5", not "Canon Canon EOS R5"; many bodies repeat the make in the model. The
 * comparison uses only the make's first word, because makes often carry a legal suffix the model leaves out ("NIKON
 * CORPORATION" + "NIKON D850" is "NIKON D850").
 */
function cameraName(make: string | undefined, model: string | undefined): string | undefined {
    if (make === undefined || model === undefined) return model ?? make;
    const [makeFirstWord] = make.split(/\s+/);
    return model.toLowerCase().startsWith(makeFirstWord.toLowerCase()) ? model : `${make} ${model}`;
}

/** `YYYY:MM:DD HH:MM:SS` to `YYYY-MM-DD`, or `undefined` for anything that is not a real calendar date ("0000:00:00"). */
function takenDate(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const match = EXIF_DATE.exec(value.trim());
    if (!match) return undefined;
    const iso = `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? undefined : iso;
}

/**
 * Maps an exifr result, read with `reviveValues: false`, to a caption. `undefined` (a file without EXIF) gives an
 * empty caption. Missing or malformed tags are left out rather than failing the sync.
 */
export function photographyCaptionFromExif(raw: Readonly<Record<string, unknown>> | undefined): PhotographyCaption {
    if (raw === undefined) return {};
    const iso = positiveNumber(raw.ISO);
    const caption = {
        camera: cameraName(cleanString(raw.Make), cleanString(raw.Model)),
        lens: cleanString(raw.LensModel),
        focalLength: round1(positiveNumber(raw.FocalLength)),
        aperture: round1(positiveNumber(raw.FNumber)),
        exposure: normalizeExposure(positiveNumber(raw.ExposureTime)),
        iso: iso === undefined ? undefined : Math.round(iso),
        taken: takenDate(raw.DateTimeOriginal),
    };
    // Drop the undefined keys so the committed JSON holds only what exists.
    return Object.fromEntries(Object.entries(caption).filter(([, value]) => value !== undefined));
}

// Long exposures and the slow fractions a camera shows as decimals (0.6 s, 0.8 s) read better than "1/2 s" or "1/1 s".
function formatExposure(seconds: number): string {
    return seconds > 0.5 ? `${Math.round(seconds * 10) / 10} s` : `1/${Math.round(1 / seconds)} s`;
}

/** A human line such as `Lisbon, Portugal · Canon EOS R5 · RF 35mm F1.8 · 35 mm · f/1.8 · 1/250 s · ISO 400 · 2026-10-01`. */
export function formatPhotographyCaption(caption: PhotographyCaption): string {
    const parts = [
        caption.location === undefined ? undefined : formatLocation(caption.location),
        caption.camera,
        caption.lens,
        caption.focalLength === undefined ? undefined : `${caption.focalLength} mm`,
        caption.aperture === undefined ? undefined : `f/${caption.aperture}`,
        caption.exposure === undefined ? undefined : formatExposure(caption.exposure),
        caption.iso === undefined ? undefined : `ISO ${caption.iso}`,
        caption.taken,
    ];
    return parts.filter((part) => part !== undefined).join(' · ');
}

// EXIF rationals are written as "numerator/denominator" strings, which is what sharp's withExif accepts.
function rational(value: number, denominator: number): string {
    return `${Math.round(value * denominator)}/${denominator}`;
}

/**
 * The only EXIF the processed JPEG keeps, as the blocks sharp's `withExif` takes (IFD0 is the main image directory,
 * IFD2 the Exif sub-directory, by libvips's naming). Everything else, GPS above all, is dropped because `withExif`
 * replaces the whole EXIF block.
 *
 * Built from the raw exifr result (read with `reviveValues: false`), not from the display caption, so the file keeps
 * what the camera wrote: `Make` and `Model` as the separate strings they were, and `DateTimeOriginal` with its time of
 * day (the time is not sensitive, the location is). The numbers go through the caption's rounding so that they survive
 * the write and a re-read unchanged, which is what the sync's round-trip check compares.
 */
export function photographyExifBlocks(raw: Readonly<Record<string, unknown>> | undefined): {
    IFD0?: Record<string, string>;
    IFD2?: Record<string, string>;
} {
    if (raw === undefined) return {};
    const caption = photographyCaptionFromExif(raw);
    const ifd0: Record<string, string> = {};
    const ifd2: Record<string, string> = {};
    const make = cleanString(raw.Make);
    const model = cleanString(raw.Model);
    if (make !== undefined) ifd0.Make = make;
    if (model !== undefined) ifd0.Model = model;
    if (caption.lens !== undefined) ifd2.LensModel = caption.lens;
    if (caption.focalLength !== undefined) ifd2.FocalLength = rational(caption.focalLength, 10);
    if (caption.aperture !== undefined) ifd2.FNumber = rational(caption.aperture, 10);
    if (caption.exposure !== undefined) {
        ifd2.ExposureTime = rational(caption.exposure, exposureDenominator(caption.exposure));
    }
    if (caption.iso !== undefined) ifd2.ISOSpeedRatings = String(caption.iso);
    // Only a date that parsed as a real one is written, so a camera's "0000:00:00 00:00:00" is not carried over.
    if (caption.taken !== undefined) ifd2.DateTimeOriginal = cleanString(raw.DateTimeOriginal)!;
    return {
        ...(Object.keys(ifd0).length > 0 ? { IFD0: ifd0 } : {}),
        ...(Object.keys(ifd2).length > 0 ? { IFD2: ifd2 } : {}),
    };
}
