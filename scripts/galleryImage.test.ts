import exifr from 'exifr';
import type { Exif } from 'sharp';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { assertNoLocation, processImage } from './galleryImage.ts';

const GPS_BLOCK = {
    GPSLatitudeRef: 'N',
    GPSLatitude: '51/1 30/1 0/1',
    GPSLongitudeRef: 'W',
    GPSLongitude: '0/1 7/1 0/1',
};

// A 16x12 landscape frame, as a camera stores it. Orientation 6 means "rotate 90 degrees clockwise to display", so
// the displayed image is 12x16. The left half is red and the right half is blue so the rotation can be checked.
async function tinyJpeg(
    exif?: Exif,
    { profile, orientation }: { profile?: string; orientation?: number } = {},
): Promise<Buffer> {
    const half = (red: number, blue: number) =>
        sharp({ create: { width: 8, height: 12, channels: 3, background: { r: red, g: 0, b: blue } } })
            .raw()
            .toBuffer();
    const [left, right] = await Promise.all([half(255, 0), half(0, 255)]);
    const rows = Array.from({ length: 12 }, (_, y) =>
        Buffer.concat([left.subarray(y * 24, (y + 1) * 24), right.subarray(y * 24, (y + 1) * 24)]),
    );
    let pipeline = sharp(Buffer.concat(rows), { raw: { width: 16, height: 12, channels: 3 } });
    if (profile !== undefined) pipeline = pipeline.withIccProfile(profile);
    if (exif !== undefined) pipeline = pipeline.withExif(exif);
    // After withExif, which does not honor an Orientation key; withMetadata resets the profile, so it is repeated.
    if (orientation !== undefined)
        pipeline = pipeline.withMetadata({ orientation, ...(profile === undefined ? {} : { icc: profile }) });
    return pipeline.jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
}

// The ICC profile's description, e.g. "sRGB" or "sP3C" (libvips's built-in Display P3).
async function profileName(jpeg: Buffer): Promise<string | undefined> {
    return ((await exifr.parse(jpeg, { icc: true })) as { ProfileDescription?: string } | undefined)
        ?.ProfileDescription;
}

// Everything exifr reads except the ICC profile, which every output keeps on purpose.
async function metadataOtherThanProfile(jpeg: Buffer): Promise<unknown> {
    return exifr.parse(jpeg, { icc: false, tiff: true, xmp: true, iptc: true });
}

const CAMERA_EXIF = {
    IFD0: { Make: 'NIKON CORPORATION', Model: 'NIKON D850' },
    IFD2: {
        LensModel: 'AF-S 50mm f/1.8G',
        FocalLength: '500/10',
        FNumber: '18/10',
        ExposureTime: '4000000/100000000',
        ISOSpeedRatings: '400',
        DateTimeOriginal: '2026:10:01 13:45:10',
    },
    IFD3: GPS_BLOCK,
};

describe('processImage', () => {
    it('drops the GPS block, converts a P3 original to sRGB and applies the orientation', async () => {
        const original = await tinyJpeg(CAMERA_EXIF, { profile: 'p3', orientation: 6 });
        // The fixture really does contain what the guards are meant to remove.
        expect((await exifr.gps(original))?.latitude).toBeCloseTo(51.5);
        expect(await profileName(original)).toBe('sP3C');

        const { jpeg, width, height } = await processImage(original, { keepCameraExif: true, label: 'fixture.jpg' });

        expect(await exifr.gps(jpeg)).toBeUndefined();
        const metadata = await sharp(jpeg).metadata();
        expect(await profileName(jpeg)).toBe('sRGB');
        // Auto-oriented: 16x12 stored with Orientation 6 displays as 12x16, and no rotation is left to apply.
        expect({ width, height }).toEqual({ width: 12, height: 16 });
        expect({ width: metadata.width, height: metadata.height }).toEqual({ width: 12, height: 16 });
        // 1 (or no tag) means "as displayed".
        expect(metadata.orientation ?? 1).toBe(1);
        // Rotated 90 degrees clockwise, the left (red) half is now the top.
        const { data } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
        expect(data[0]).toBeGreaterThan(200);
        expect(data[2]).toBeLessThan(60);
        const lastPixel = data.length - 3;
        expect(data[lastPixel]).toBeLessThan(60);
        expect(data[lastPixel + 2]).toBeGreaterThan(200);
    });

    it('keeps the camera strings, the capture time and the numbers, and reports the caption', async () => {
        const original = await tinyJpeg(CAMERA_EXIF, { profile: 'p3', orientation: 6 });

        const { jpeg, caption } = await processImage(original, { keepCameraExif: true, label: 'fixture.jpg' });

        expect(caption).toEqual({
            camera: 'NIKON D850',
            lens: 'AF-S 50mm f/1.8G',
            focalLength: 50,
            aperture: 1.8,
            exposure: 0.04,
            iso: 400,
            taken: '2026-10-01',
        });
        const written = (await exifr.parse(jpeg, { reviveValues: false })) as unknown;
        expect(written).toMatchObject({
            Make: 'NIKON CORPORATION',
            Model: 'NIKON D850',
            LensModel: 'AF-S 50mm f/1.8G',
            FocalLength: 50,
            FNumber: 1.8,
            ExposureTime: 0.04,
            ISO: 400,
            DateTimeOriginal: '2026:10:01 13:45:10',
        });
    });

    it('processes an image with no EXIF at all', async () => {
        const original = await tinyJpeg();

        const { jpeg, caption, width, height } = await processImage(original, {
            keepCameraExif: true,
            label: 'bare.jpg',
        });

        expect(caption).toEqual({});
        expect({ width, height }).toEqual({ width: 16, height: 12 });
        expect(await metadataOtherThanProfile(jpeg)).toBeUndefined();
        expect(await profileName(jpeg)).toBe('sRGB');
    });

    it('writes no camera EXIF for a collection that keeps none', async () => {
        const original = await tinyJpeg(CAMERA_EXIF);

        const { jpeg, caption } = await processImage(original, { keepCameraExif: false, label: 'art.jpg' });

        expect(caption).toBeUndefined();
        expect(await metadataOtherThanProfile(jpeg)).toBeUndefined();
    });

    it('returns a ThumbHash for the processed image', async () => {
        const { thumbhash } = await processImage(await tinyJpeg(), { keepCameraExif: true, label: 'bare.jpg' });

        expect(thumbhash).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });
});

describe('assertNoLocation', () => {
    it('throws for a JPEG that still has GPS', async () => {
        const withGps = await tinyJpeg(CAMERA_EXIF);

        await expect(assertNoLocation(withGps, 'leaky.jpg')).rejects.toThrow(/leaky\.jpg: .*GPS/);
    });

    it('throws for GPS tags that carry no usable coordinates', async () => {
        const refsOnly = await tinyJpeg({ IFD3: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'W' } });

        await expect(assertNoLocation(refsOnly, 'refs.jpg')).rejects.toThrow(/refs\.jpg: .*GPS tags/);
    });

    it('throws for an XMP block, which can hold location too', async () => {
        const xmp =
            '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>';
        const withXmp = await sharp(await tinyJpeg())
            .withXmp(xmp)
            .toBuffer();

        await expect(assertNoLocation(withXmp, 'xmp.jpg')).rejects.toThrow(/xmp\.jpg: .*XMP or IPTC/);
    });

    it('passes a JPEG with camera EXIF but no location', async () => {
        const { IFD3: _location, ...cameraOnly } = CAMERA_EXIF;
        const clean = await tinyJpeg(cameraOnly);

        await expect(assertNoLocation(clean, 'clean.jpg')).resolves.toBeUndefined();
    });

    it('passes a JPEG with no metadata', async () => {
        await expect(assertNoLocation(await tinyJpeg(), 'bare.jpg')).resolves.toBeUndefined();
    });
});
