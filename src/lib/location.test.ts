import { describe, expect, it } from 'vitest';

import { parseGallery } from './gallery';
import {
    captionWithLocation,
    formatLocation,
    locationSchema,
    resolveLocation,
    showsGeonamesPlace,
    sidecarLocationSchema,
    type PhotoLocation,
} from './location';
import { encodeThumbHash } from './thumbhash';

const LISBON = { city: 'Lisbon', country: 'Portugal' };
const DERIVED: PhotoLocation = { ...LISBON, source: 'geonames' };

describe('resolveLocation', () => {
    it('uses the derived place, marked as GeoNames', () => {
        expect(resolveLocation(LISBON, undefined)).toEqual(DERIVED);
    });

    it('lets the sidecar replace the derived place', () => {
        expect(resolveLocation(LISBON, { city: 'Porto', country: 'Portugal' })).toEqual({
            city: 'Porto',
            country: 'Portugal',
            source: 'sidecar',
        });
    });

    it('uses the sidecar place for a photo without GPS', () => {
        expect(resolveLocation(undefined, LISBON)).toEqual({ ...LISBON, source: 'sidecar' });
    });

    it('shows nothing when the sidecar says false, even with a derived place', () => {
        expect(resolveLocation(LISBON, false)).toBeUndefined();
    });

    it('shows nothing without a derived place or an override', () => {
        expect(resolveLocation(undefined, undefined)).toBeUndefined();
    });
});

describe('locationSchema', () => {
    it('accepts a city, a country and a source', () => {
        expect(locationSchema.parse(DERIVED)).toEqual(DERIVED);
    });

    it.each([
        ['an empty city', { ...DERIVED, city: '' }],
        ['a blank country', { ...DERIVED, country: '  ' }],
        ['an unknown source', { ...DERIVED, source: 'exif' }],
        ['a missing source', LISBON],
        ['a latitude', { ...DERIVED, latitude: 38.7223 }],
        ['a longitude', { ...DERIVED, longitude: -9.1393 }],
        ['a coordinate pair', { ...DERIVED, coordinates: [38.7223, -9.1393] }],
        ['a lat/lon pair', { ...DERIVED, lat: 38.7223, lon: -9.1393 }],
    ])('rejects %s', (_label, value) => {
        expect(locationSchema.safeParse(value).success).toBe(false);
    });
});

describe('sidecarLocationSchema', () => {
    it('accepts a place and false', () => {
        expect(sidecarLocationSchema.parse(LISBON)).toEqual(LISBON);
        expect(sidecarLocationSchema.parse(false)).toBe(false);
    });

    it.each([
        ['true', true],
        ['a string', 'Lisbon'],
        ['a place without a country', { city: 'Lisbon' }],
        ['an empty city', { city: '', country: 'Portugal' }],
        ['a coordinate', { ...LISBON, latitude: 38.7 }],
    ])('rejects %s', (_label, value) => {
        expect(sidecarLocationSchema.safeParse(value).success).toBe(false);
    });
});

describe('formatLocation', () => {
    it('joins the city and the country', () => {
        expect(formatLocation(LISBON)).toBe('Lisbon, Portugal');
    });
});

describe('captionWithLocation', () => {
    it('adds the location and keeps the rest', () => {
        const caption: { camera: string; location?: PhotoLocation } = { camera: 'X100V' };
        expect(captionWithLocation(caption, DERIVED)).toEqual({ camera: 'X100V', location: DERIVED });
    });

    it('replaces a stale location', () => {
        const other: PhotoLocation = { city: 'Porto', country: 'Portugal', source: 'sidecar' };
        expect(captionWithLocation({ location: DERIVED }, other)).toEqual({ location: other });
    });

    it('removes the location when there is none now, without touching the input', () => {
        const caption = { camera: 'X100V', location: DERIVED };
        expect(captionWithLocation(caption, undefined)).toEqual({ camera: 'X100V' });
        expect('location' in captionWithLocation(caption, undefined)).toBe(false);
        expect(caption.location).toBe(DERIVED);
    });
});

describe('showsGeonamesPlace', () => {
    it('is true when any entry has a derived place', () => {
        expect(
            showsGeonamesPlace([
                { caption: {} },
                { caption: { location: { ...LISBON, source: 'sidecar' } } },
                { caption: { location: DERIVED } },
            ]),
        ).toBe(true);
    });

    it('is false for sidecar places only, for no places and for no entries', () => {
        expect(showsGeonamesPlace([{ caption: { location: { ...LISBON, source: 'sidecar' } } }])).toBe(false);
        expect(showsGeonamesPlace([{ caption: {} }])).toBe(false);
        expect(showsGeonamesPlace([])).toBe(false);
    });
});

describe('the data file schema', () => {
    const entry = {
        key: 'photography/a.jpg',
        width: 100,
        height: 50,
        thumbhash: encodeThumbHash(4, 4, new Uint8Array(4 * 4 * 4).fill(200)),
        sourceSha256: 'f'.repeat(64),
        processingVersion: 1,
        alt: 'A test image',
    };

    it('keeps a location in the caption', () => {
        const [parsed] = parseGallery('photography', [{ ...entry, caption: { location: DERIVED } }]);
        expect(parsed.caption.location).toEqual(DERIVED);
    });

    // Privacy: exact coordinates must never reach the committed data, in the location or beside it.
    it('accepts the same entry without any of the rejected fields', () => {
        expect(() => parseGallery('photography', [{ ...entry, caption: {} }])).not.toThrow();
    });

    it.each([
        ['latitude in the location', { location: { ...DERIVED, latitude: 38.7223 } }],
        ['longitude in the location', { location: { ...DERIVED, longitude: -9.1393 } }],
        ['a coordinate pair in the location', { location: { ...DERIVED, coordinates: [38.7223, -9.1393] } }],
        ['a lat/lon pair in the caption', { lat: 38.7223, lon: -9.1393 }],
        ['gps in the caption', { gps: { latitude: 38.7223, longitude: -9.1393 } }],
    ])('rejects %s', (_label, caption) => {
        expect(() => parseGallery('photography', [{ ...entry, caption }])).toThrow();
    });
});
