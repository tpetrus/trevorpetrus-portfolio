// The image half of the gallery sync: turns one original JPEG into the file that is uploaded, plus the data the site
// needs about it. I/O-free apart from sharp and exifr working on buffers; the decisions live in src/lib. It is its own
// module (not inline in sync-gallery.ts) so the same code that uploads can be exercised on test images without
// touching R2.
import { isDeepStrictEqual } from 'node:util';

import exifr from 'exifr';
import sharp from 'sharp';

import type { GalleryExtension } from '../src/lib/gallery.ts';
import { locationKeys } from '../src/lib/exifLocation.ts';
import { derivePlace, gpsPoint, type DerivedPlace, type Place } from '../src/lib/geonames.ts';
import {
    PHOTOGRAPHY_EXIF_TAGS,
    photographyCaptionFromExif,
    photographyExifBlocks,
    type PhotographyCaption,
} from '../src/lib/photography.ts';
import { encodeThumbHash } from '../src/lib/thumbhash.ts';

const JPEG_QUALITY = 92;
// ThumbHash encoding is slow past 100x100 and gains nothing from more pixels.
const THUMBHASH_MAX_SIDE = 100;

// The only PNG chunks an uploaded file may carry: the pixels, the palette and transparency, and color description.
// Anything else (eXIf, tEXt, iTXt, zTXt, tIME, ...) can hold a location, a name or a note.
const PNG_ALLOWED_CHUNKS = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'sRGB', 'iCCP', 'gAMA', 'cHRM', 'pHYs']);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The chunk types of a PNG, in file order. Throws when the bytes are not a well-formed chunk sequence. */
export function pngChunkTypes(png: Buffer): string[] {
    if (png.length < PNG_SIGNATURE.length || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
        throw new Error('Not a PNG: the signature is missing.');
    }
    const types: string[] = [];
    let offset = PNG_SIGNATURE.length;
    while (offset < png.length) {
        if (offset + 12 > png.length) throw new Error('The PNG is truncated inside a chunk header.');
        const length = png.readUInt32BE(offset);
        const type = png.toString('latin1', offset + 4, offset + 8);
        offset += 12 + length;
        if (offset > png.length) throw new Error(`The PNG is truncated inside its ${type} chunk.`);
        types.push(type);
    }
    return types;
}

/** Hard failure unless every chunk of the output PNG is on the allow list and the file ends with IEND. */
export function assertPngChunks(png: Buffer, label: string): void {
    const types = pngChunkTypes(png);
    const extra = [...new Set(types.filter((type) => !PNG_ALLOWED_CHUNKS.has(type)))];
    if (extra.length > 0) {
        throw new Error(`${label}: the processed PNG still has chunks that are not allowed (${extra.join(', ')}).`);
    }
    if (types.at(-1) !== 'IEND') throw new Error(`${label}: the processed PNG does not end with IEND.`);
}

/**
 * The format a source file really is, from its bytes (not its name), as the extension its R2 key gets. Throws for any
 * other format, so nothing but a JPEG or a PNG is ever uploaded.
 */
export async function sourceExtension(original: Buffer): Promise<GalleryExtension> {
    const { format } = await sharp(original).metadata();
    if (format === 'jpeg') return 'jpg';
    if (format === 'png') return 'png';
    throw new Error(`The source is a ${format ?? 'unknown'} file; only JPEG and PNG are supported.`);
}

export interface ProcessedImage {
    bytes: Buffer;
    width: number;
    height: number;
    thumbhash: string;
    /** What was read from the source's EXIF; `undefined` when the collection keeps none. */
    caption: PhotographyCaption | undefined;
}

async function readCameraExif(jpeg: Buffer): Promise<Record<string, unknown> | undefined> {
    // reviveValues: false keeps DateTimeOriginal the string the camera wrote; revived, exifr builds a Date in the
    // machine's local time zone, which can move the day.
    return (await exifr.parse(jpeg, { pick: [...PHOTOGRAPHY_EXIF_TAGS], reviveValues: false })) as
        Record<string, unknown> | undefined;
}

/** Hard failure unless the output carries no location and no metadata block that could hide one. */
export async function assertNoLocation(jpeg: Buffer, label: string): Promise<void> {
    const gps = (await exifr.gps(jpeg)) as { latitude?: number; longitude?: number } | undefined;
    if (gps?.latitude !== undefined || gps?.longitude !== undefined) {
        throw new Error(`${label}: the processed image still contains GPS coordinates.`);
    }
    // Every segment exifr can read (TIFF/EXIF/GPS, XMP, IPTC), looking for any GPS-looking key.
    const gpsKeys = locationKeys((await exifr.parse(jpeg, true)) as Record<string, unknown> | undefined);
    if (gpsKeys.length > 0) {
        throw new Error(`${label}: the processed image still has GPS tags (${gpsKeys.join(', ')}).`);
    }
    const { xmp, iptc } = await sharp(jpeg).metadata();
    if (xmp !== undefined || iptc !== undefined) {
        throw new Error(`${label}: the processed image still carries an XMP or IPTC block.`);
    }
}

/**
 * Names the place a source photo was taken, from the GPS in its EXIF: the city and country of the nearest GeoNames
 * place, or none (with a warning when that deserves attention). The coordinates stay inside this function: nothing
 * returned or thrown carries them, and the processed upload never has them (`assertNoLocation`).
 *
 * `loadPlaces` is called only for a photo that has a usable GPS fix, so a run without any never needs the dataset.
 */
export async function deriveSourceLocation(
    original: Buffer,
    loadPlaces: () => Promise<readonly Place[]>,
): Promise<DerivedPlace> {
    const point = gpsPoint(await exifr.gps(original));
    if (point === undefined) return { place: undefined, warning: undefined };
    return derivePlace(point, await loadPlaces());
}

async function thumbhashOf(jpeg: Buffer): Promise<string> {
    const { data, info } = await sharp(jpeg)
        .resize(THUMBHASH_MAX_SIDE, THUMBHASH_MAX_SIDE, { fit: 'inside' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    return encodeThumbHash(info.width, info.height, data);
}

/**
 * Re-encodes a PNG original losslessly: auto-oriented, converted to sRGB with the profile tagged, alpha kept, and no
 * EXIF, XMP or text chunks (sharp writes none unless asked). `palette: false` keeps full color instead of quantizing.
 * The output's chunk list is checked against the allow list before anything is uploaded.
 */
async function processPng(original: Buffer, label: string): Promise<ProcessedImage> {
    const bytes = await sharp(original)
        .rotate()
        .withIccProfile('srgb')
        .png({ compressionLevel: 9, palette: false })
        .toBuffer();
    assertPngChunks(bytes, label);
    await assertNoLocation(bytes, label);
    const { width, height } = await sharp(bytes).metadata();
    return { bytes, width, height, thumbhash: await thumbhashOf(bytes), caption: undefined };
}

/**
 * Re-encodes an original for upload: auto-oriented (the rewritten EXIF no longer carries Orientation), converted to sRGB
 * with the profile tagged, and carrying no metadata except, when `readsCamera`, the camera settings. sharp cannot
 * drop only the GPS tags, so the camera fields are read first and written into a fresh EXIF block. XMP (which can hold
 * GPS too) is stripped by default and `keepXmp` is deliberately never called.
 *
 * Throws, so the sync stops before anything is uploaded, if the output has any location data or if the camera fields do
 * not round-trip.
 *
 * @param label Names the image in error messages.
 */
export async function processImage(
    original: Buffer,
    { readsCamera, label }: { readsCamera: boolean; label: string },
): Promise<ProcessedImage> {
    if ((await sourceExtension(original)) === 'png') return processPng(original, label);

    const rawExif = readsCamera ? await readCameraExif(original) : undefined;
    const caption = readsCamera ? photographyCaptionFromExif(rawExif) : undefined;

    let pipeline = sharp(original).rotate().withIccProfile('srgb');
    const exifBlocks = photographyExifBlocks(rawExif);
    if (Object.keys(exifBlocks).length > 0) {
        pipeline = pipeline.withExif(exifBlocks);
    }
    const jpeg = await pipeline.jpeg({ quality: JPEG_QUALITY, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();

    await assertNoLocation(jpeg, label);
    if (caption !== undefined) {
        const written = photographyCaptionFromExif(await readCameraExif(jpeg));
        if (!isDeepStrictEqual(written, caption)) {
            throw new Error(
                `${label}: the camera fields did not survive processing.\n` +
                    `  source:  ${JSON.stringify(caption)}\n  written: ${JSON.stringify(written)}`,
            );
        }
    }

    const { width, height } = await sharp(jpeg).metadata();
    return { bytes: jpeg, width, height, thumbhash: await thumbhashOf(jpeg), caption };
}
