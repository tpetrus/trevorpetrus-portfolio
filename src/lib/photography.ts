import { z } from 'astro/zod';

// Every field is optional: a file may carry no EXIF at all, and cameras leave out whatever they cannot measure
// (a manual lens reports no aperture).
export const photographyCaptionSchema = z.object({
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

// The hand-written `src/content/photography/<image basename>.yml`: EXIF has no alt text, so every photo needs one.
export const photographySidecarSchema = z.object({
    alt: z.string().min(1),
    /** Pins the photo's position: lowest first, ahead of every photo without an order. */
    order: z.int().optional(),
});
export type PhotographySidecar = z.output<typeof photographySidecarSchema>;

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

/** "Canon" + "Canon EOS R5" is "Canon EOS R5", not "Canon Canon EOS R5"; many bodies repeat the make in the model. */
function cameraName(make: string | undefined, model: string | undefined): string | undefined {
    if (make === undefined || model === undefined) return model ?? make;
    return model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`;
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
        exposure: positiveNumber(raw.ExposureTime),
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

/** A human line such as `Canon EOS R5 · RF 35mm F1.8 · 35 mm · f/1.8 · 1/250 s · ISO 400 · 2026-10-01`. */
export function formatPhotographyCaption(caption: PhotographyCaption): string {
    const parts = [
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
