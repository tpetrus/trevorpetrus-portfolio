// The I/O half of the offline reverse geocoding: fetches GeoNames' `cities1000` extract once and keeps the unzipped
// text in node_modules/.cache, so every later sync reads the disk only. Used at sync time; the build never needs it and
// makes no network calls. Parsing and lookup live in src/lib/geonames.ts.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseGeonamesCities, type Place } from '../src/lib/geonames.ts';
import { readZipEntry } from '../src/lib/zip.ts';

// CC BY 4.0, https://download.geonames.org/export/dump/ (about 11 MB zipped, 32 MB as text).
export const GEONAMES_URL = 'https://download.geonames.org/export/dump/cities1000.zip';
const ENTRY_NAME = 'cities1000.txt';
const DEFAULT_CACHE_DIR = join('node_modules', '.cache', 'geonames');

// Without a limit a stalled connection hangs the whole sync. The zip is about 11 MB, so two minutes is generous.
export const DOWNLOAD_TIMEOUT_MS = 120_000;
// Far above the real size; a larger answer is not the dataset, and it is refused before it is buffered.
const MAX_ZIP_BYTES = 64 * 1024 * 1024;

export interface GeonamesOptions {
    /** Replaceable so a test never touches the network or the real cache. */
    fetchFn?: typeof fetch;
    timeoutMs?: number;
    cacheDir?: string;
}

async function download(
    fetchFn: typeof fetch,
    timeoutMs: number,
    cacheDir: string,
): Promise<{ text: string; zipBytes: number }> {
    console.log(`Downloading ${GEONAMES_URL} (once; cached in ${cacheDir})`);
    let zip: Buffer;
    try {
        const response = await fetchFn(GEONAMES_URL, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) {
            throw new Error(
                `Downloading GeoNames failed (HTTP ${response.status}). Place names need it for photos with GPS, ` +
                    'or give each such photo a "location" in its sidecar.',
            );
        }
        const declared = Number(response.headers.get('content-length'));
        if (declared > MAX_ZIP_BYTES) {
            throw new Error(
                `Downloading GeoNames failed: ${GEONAMES_URL} announced ${declared} bytes, above the ${MAX_ZIP_BYTES} byte limit.`,
            );
        }
        zip = Buffer.from(await response.arrayBuffer());
    } catch (error) {
        if ((error as Error).name !== 'TimeoutError') throw error;
        throw new Error(
            `Downloading ${GEONAMES_URL} timed out after ${timeoutMs / 1000} s. Nothing was cached, so there is ` +
                'nothing to delete: run the sync again, or give each photo with GPS a "location" in its sidecar.',
            { cause: error },
        );
    }
    return { text: readZipEntry(zip, ENTRY_NAME).toString('utf8'), zipBytes: zip.length };
}

// Written to a temporary name first, so an interrupted run never leaves a truncated cache behind.
function writeCache(cacheDir: string, text: string): void {
    mkdirSync(cacheDir, { recursive: true });
    const file = join(cacheDir, ENTRY_NAME);
    const temporary = `${file}.download`;
    writeFileSync(temporary, text);
    renameSync(temporary, file);
}

function parseNonEmpty(text: string, source: string): Place[] {
    const places = parseGeonamesCities(text);
    if (places.length === 0) throw new Error(`${source} holds no places.`);
    return places;
}

/** The places that can name a photo, from the cache or, on the first use, from the download. Delete the cache to refresh. */
export async function loadGeonamesPlaces({
    fetchFn = fetch,
    timeoutMs = DOWNLOAD_TIMEOUT_MS,
    cacheDir = DEFAULT_CACHE_DIR,
}: GeonamesOptions = {}): Promise<Place[]> {
    const cacheFile = join(cacheDir, ENTRY_NAME);
    if (existsSync(cacheFile))
        return parseNonEmpty(readFileSync(cacheFile, 'utf8'), `${cacheFile} (delete it to download again)`);
    const { text, zipBytes } = await download(fetchFn, timeoutMs, cacheDir);
    // Only a download that parses is cached, so a bad one is never reused.
    const places = parseNonEmpty(text, 'The GeoNames download');
    writeCache(cacheDir, text);
    console.log(
        `Cached ${(zipBytes / 1024 / 1024).toFixed(1)} MB zip as ${(Buffer.byteLength(text) / 1024 / 1024).toFixed(1)} MB text.`,
    );
    return places;
}
