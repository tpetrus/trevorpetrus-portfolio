import { z } from 'astro/zod';
import { describe, expect, it } from 'vitest';

import {
    GALLERY_COLLECTIONS,
    galleryCollection,
    galleryEntrySchema,
    isGalleryCollection,
    parseGallery,
} from './gallery';
import { encodeThumbHash } from './thumbhash';

const THUMBHASH = encodeThumbHash(4, 4, new Uint8Array(4 * 4 * 4).fill(128));

const validEntry = {
    key: 'photography/harbor.jpg',
    width: 3000,
    height: 2000,
    thumbhash: THUMBHASH,
    sourceSha256: 'a'.repeat(64),
    processingVersion: 1,
    alt: 'Boats in a harbor at dawn',
    caption: { camera: 'Canon EOS R5', iso: 400, taken: '2026-10-01' },
};

describe('parseGallery', () => {
    it('accepts an empty gallery', () => {
        expect(parseGallery('photography', [])).toEqual([]);
    });

    it('accepts a valid entry, with or without caption fields', () => {
        const bare = { ...validEntry, key: 'photography/bare.jpg', caption: {} };
        expect(parseGallery('photography', [validEntry, bare])).toEqual([validEntry, bare]);
    });

    it('rejects a collection that does not exist', () => {
        expect(() => parseGallery('sculpture', [])).toThrow(/Unknown gallery collection "sculpture".*photography/);
    });

    it('rejects data that is not an array', () => {
        expect(() => parseGallery('photography', validEntry)).toThrow();
    });

    it.each([
        ['a key from another collection', { key: 'art/harbor.jpg' }],
        ['a key without a collection', { key: 'harbor.jpg' }],
        ['a nested key', { key: 'photography/a/harbor.jpg' }],
        ['a key that is not a jpg', { key: 'photography/harbor.png' }],
        ['a hidden file name', { key: 'photography/.jpg' }],
        ['a zero width', { width: 0 }],
        ['a fractional height', { height: 10.5 }],
        ['a thumbhash that is not base64', { thumbhash: 'nope!' }],
        ['a thumbhash that is too short', { thumbhash: 'AAAA' }],
        ['a short sha', { sourceSha256: 'abc' }],
        ['an uppercase sha', { sourceSha256: 'A'.repeat(64) }],
        ['a missing processing version', { processingVersion: undefined }],
        ['an empty alt', { alt: '' }],
        ['a bad caption', { caption: { iso: -1 } }],
    ])('rejects %s', (_name, patch) => {
        expect(() => parseGallery('photography', [{ ...validEntry, ...patch }])).toThrow();
    });
});

describe('galleryEntrySchema', () => {
    it('takes the caption schema as a parameter', () => {
        const schema = galleryEntrySchema('art', z.object({ title: z.string() }));
        const entry = { ...validEntry, key: 'art/piece.jpg', caption: { title: 'Piece' } };
        expect(schema.parse(entry)).toEqual(entry);
        expect(() => schema.parse({ ...entry, caption: {} })).toThrow();
    });
});

describe('GALLERY_COLLECTIONS', () => {
    it('keeps camera EXIF for photography', () => {
        expect(GALLERY_COLLECTIONS.photography.keepsCameraExif).toBe(true);
    });

    it('formats a photography caption', () => {
        expect(GALLERY_COLLECTIONS.photography.formatCaption({ camera: 'X100V', iso: 200 })).toBe('X100V · ISO 200');
    });

    it('requires alt text in the sidecar and allows an order', () => {
        const { sidecarSchema } = GALLERY_COLLECTIONS.photography;
        expect(sidecarSchema.parse({ alt: 'A harbor', order: 2 })).toEqual({ alt: 'A harbor', order: 2 });
        expect(sidecarSchema.parse({ alt: 'A harbor' })).toEqual({ alt: 'A harbor' });
        expect(() => sidecarSchema.parse({ alt: '' })).toThrow();
        expect(() => sidecarSchema.parse({ order: 1 })).toThrow();
        expect(() => sidecarSchema.parse({ alt: 'x', order: 1.5 })).toThrow();
    });
});

describe('isGalleryCollection and galleryCollection', () => {
    it('recognize known names only', () => {
        expect(isGalleryCollection('photography')).toBe(true);
        expect(isGalleryCollection('toString')).toBe(false);
        expect(galleryCollection('photography')).toBe(GALLERY_COLLECTIONS.photography);
        expect(() => galleryCollection('toString')).toThrow(/Unknown gallery collection/);
    });
});
