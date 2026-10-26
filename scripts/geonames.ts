// The I/O half of the offline reverse geocoding: fetches GeoNames' `cities1000` extract once and keeps the unzipped
// text in node_modules/.cache, so every later sync reads the disk only. Used at sync time; the build never needs it and
// makes no network calls. Parsing and lookup live in src/lib/geonames.ts.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseGeonamesCities, type Place } from '../src/lib/geonames.ts';
import { readZipEntry } from '../src/lib/zip.ts';

// CC BY 4.0, https://download.geonames.org/export/dump/ (about 11 MB zipped, 32 MB as text).
const GEONAMES_URL = 'https://download.geonames.org/export/dump/cities1000.zip';
const ENTRY_NAME = 'cities1000.txt';
const CACHE_DIR = join('node_modules', '.cache', 'geonames');
const CACHE_FILE = join(CACHE_DIR, ENTRY_NAME);

async function download(): Promise<string> {
    console.log(`Downloading ${GEONAMES_URL} (once; cached in ${CACHE_DIR})`);
    const response = await fetch(GEONAMES_URL);
    if (!response.ok) {
        throw new Error(
            `Downloading GeoNames failed (HTTP ${response.status}). Place names need it for photos with GPS, ` +
                'or give each such photo a "location" in its sidecar.',
        );
    }
    const zip = Buffer.from(await response.arrayBuffer());
    const data = readZipEntry(zip, ENTRY_NAME);
    const text = data.toString('utf8');
    // Written to a temporary name first, so an interrupted run never leaves a truncated cache behind.
    mkdirSync(CACHE_DIR, { recursive: true });
    const temporary = `${CACHE_FILE}.download`;
    writeFileSync(temporary, text);
    renameSync(temporary, CACHE_FILE);
    console.log(
        `Cached ${(zip.length / 1024 / 1024).toFixed(1)} MB zip as ${(data.length / 1024 / 1024).toFixed(1)} MB text.`,
    );
    return text;
}

/** The places that can name a photo, from the cache or, on the first use, from the download. Delete the cache to refresh. */
export async function loadGeonamesPlaces(): Promise<Place[]> {
    const text = existsSync(CACHE_FILE) ? readFileSync(CACHE_FILE, 'utf8') : await download();
    const places = parseGeonamesCities(text);
    if (places.length === 0) throw new Error(`${CACHE_FILE} holds no places; delete it to download again.`);
    return places;
}
