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
    category: 'landscape',
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

    it('keeps pin: true and leaves an unpinned entry without the key', () => {
        const [pinned, bare] = parseGallery('photography', [{ ...validEntry, pin: true }, validEntry]);
        expect(pinned?.pin).toBe(true);
        expect(bare && Object.hasOwn(bare, 'pin')).toBe(false);
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
        ['a missing category', { category: undefined }],
        ['an unknown category', { category: 'street' }],
        ['a bad caption', { caption: { iso: -1 } }],
        ['pin: false (only true is written)', { pin: false }],
    ])('rejects %s', (_name, patch) => {
        expect(() => parseGallery('photography', [{ ...validEntry, ...patch }])).toThrow();
    });
});

describe('galleryEntrySchema', () => {
    it('takes the caption schema as a parameter', () => {
        const schema = galleryEntrySchema('art', z.object({ title: z.string() }), [{ id: 'oil', label: 'Oil' }]);
        const entry = { ...validEntry, key: 'art/piece.jpg', category: 'oil', caption: { title: 'Piece' } };
        expect(() => schema.parse({ ...entry, category: 'landscape' })).toThrow(/one of oil/);
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

    it('lists the photography sections in page order', () => {
        expect(GALLERY_COLLECTIONS.photography.categories.map(({ id }) => id)).toEqual([
            'landscape',
            'portrait',
            'car',
        ]);
    });

    it('requires a known category in the sidecar', () => {
        const { sidecarSchema } = GALLERY_COLLECTIONS.photography;
        expect(() => sidecarSchema.parse({ alt: 'A harbor' })).toThrow();
        expect(() => sidecarSchema.parse({ alt: 'A harbor', category: 'street' })).toThrow();
        expect(sidecarSchema.parse({ alt: 'A harbor', category: 'car' })).toEqual({ alt: 'A harbor', category: 'car' });
    });

    it('requires alt text in the sidecar and allows an order', () => {
        const { sidecarSchema } = GALLERY_COLLECTIONS.photography;
        expect(sidecarSchema.parse({ alt: 'A harbor', category: 'landscape', order: 2 })).toEqual({
            alt: 'A harbor',
            category: 'landscape',
            order: 2,
        });
        expect(sidecarSchema.parse({ alt: 'A harbor', category: 'landscape' })).toEqual({
            alt: 'A harbor',
            category: 'landscape',
        });
        expect(() => sidecarSchema.parse({ alt: '' })).toThrow();
        expect(() => sidecarSchema.parse({ alt: 'TODO: describe this photo', category: 'landscape' })).toThrow(
            /real alt text/,
        );
        expect(() => sidecarSchema.parse({ order: 1 })).toThrow();
        expect(() => sidecarSchema.parse({ alt: 'x', order: 1.5 })).toThrow();
    });

    it('allows a boolean pin in the sidecar', () => {
        const { sidecarSchema } = GALLERY_COLLECTIONS.photography;
        expect(sidecarSchema.parse({ alt: 'A harbor', category: 'landscape', pin: true })).toEqual({
            alt: 'A harbor',
            category: 'landscape',
            pin: true,
        });
        expect(sidecarSchema.parse({ alt: 'A harbor', category: 'landscape', pin: false })).toEqual({
            alt: 'A harbor',
            category: 'landscape',
            pin: false,
        });
        expect(() => sidecarSchema.parse({ alt: 'A harbor', category: 'landscape', pin: 'yes' })).toThrow();
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
