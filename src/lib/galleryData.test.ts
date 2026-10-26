import { describe, expect, it } from 'vitest';

import { parseGallery } from './gallery';
import { decodeThumbHash, encodeThumbHash } from './thumbhash';

const files = import.meta.glob<unknown>('../data/gallery/*.json', { eager: true, import: 'default' });

// `../data/gallery/photography.json` -> `photography`
function collectionOf(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1, -'.json'.length);
}

/** Everything the committed data must satisfy: the collection's schema, its own key prefix, unique keys, real hashes. */
function checkGalleryFile(path: string, data: unknown): void {
    const collection = collectionOf(path);
    const entries = parseGallery(collection, data);
    for (const entry of entries) {
        expect(entry.key.startsWith(`${collection}/`), `${entry.key} is not under ${collection}/`).toBe(true);
        expect(() => decodeThumbHash(entry.thumbhash)).not.toThrow();
    }
    const keys = entries.map(({ key }) => key);
    expect(new Set(keys).size, `duplicate keys in ${path}`).toBe(keys.length);
}

describe('committed gallery data', () => {
    it('finds the photography data file', () => {
        expect(Object.keys(files).map(collectionOf)).toContain('photography');
    });

    it.each(Object.entries(files))('%s is valid', (path, data) => {
        checkGalleryFile(path, data);
    });
});

// Privacy: the committed data holds a city and a country per photo, never where on the map it was. The schema rejects
// extra fields (location.test.ts); this reads the raw file, so a coordinate cannot hide under any key or as text.
const COORDINATE_KEY = /^(lat|lon|lng|latitude|longitude|coords?|coordinates?|gps\w*|position|geo\w*)$/i;
const COORDINATE_PAIR = /-?\d{1,3}\.\d{3,}\s*[,;/ ]\s*-?\d{1,3}\.\d{3,}/;

function coordinateKeysIn(value: unknown): string[] {
    if (Array.isArray(value)) return value.flatMap(coordinateKeysIn);
    if (typeof value !== 'object' || value === null) return [];
    return Object.entries(value).flatMap(([key, child]) => [
        ...(COORDINATE_KEY.test(key) ? [key] : []),
        ...coordinateKeysIn(child),
    ]);
}

describe('no coordinates in the committed data', () => {
    it.each(Object.entries(files))('%s has no coordinate-like key and no number pair', (_path, data) => {
        expect(coordinateKeysIn(data)).toEqual([]);
        expect(JSON.stringify(data)).not.toMatch(COORDINATE_PAIR);
    });

    it('the check itself catches a coordinate however it is spelled', () => {
        expect(coordinateKeysIn([{ caption: { location: { latitude: 1, lon: 2 } } }])).toEqual(['latitude', 'lon']);
        expect(coordinateKeysIn([{ caption: { gps: [1, 2] } }])).toEqual(['gps']);
        expect(coordinateKeysIn([{ caption: { location: { city: 'Lisbon', country: 'Portugal' } } }])).toEqual([]);
        expect(JSON.stringify({ at: '38.7223, -9.1393' })).toMatch(COORDINATE_PAIR);
        expect(JSON.stringify({ at: [38.7223, -9.1393] })).toMatch(COORDINATE_PAIR);
    });
});

describe('checkGalleryFile', () => {
    const entry = {
        key: 'photography/a.jpg',
        width: 100,
        height: 50,
        thumbhash: encodeThumbHash(4, 4, new Uint8Array(4 * 4 * 4).fill(200)),
        sourceSha256: 'f'.repeat(64),
        processingVersion: 1,
        alt: 'A test image',
        caption: {},
    };
    const path = '../data/gallery/photography.json';

    it('accepts good data', () => {
        expect(() => checkGalleryFile(path, [entry, { ...entry, key: 'photography/b.jpg' }])).not.toThrow();
    });

    it('rejects an entry that breaks the schema', () => {
        expect(() => checkGalleryFile(path, [{ ...entry, alt: '' }])).toThrow();
    });

    it('rejects a key under another collection', () => {
        expect(() => checkGalleryFile(path, [{ ...entry, key: 'art/a.jpg' }])).toThrow();
    });

    it('rejects duplicate keys', () => {
        expect(() => checkGalleryFile(path, [entry, entry])).toThrow(/duplicate keys/);
    });

    it('rejects a file named after a collection that does not exist', () => {
        expect(() => checkGalleryFile('../data/gallery/sculpture.json', [])).toThrow(/Unknown gallery collection/);
    });
});
