// Publishes a gallery collection by hand: `npm run sync:gallery -- <collection> [options]`. Nothing here runs at build
// time (the site makes no network calls then).
//
// For every JPEG in the source directory (default gallery-originals/<collection>, never committed) it
//   1. re-encodes the image for upload (sRGB, auto-oriented, camera EXIF only, no GPS; see scripts/galleryImage.ts),
//   2. uploads it to the R2 bucket as <collection>/<name>.jpg, and
//   3. records its size, ThumbHash and caption, with the alt text from src/content/<collection>/<name>.yml, in
//      src/data/gallery/<collection>.json, which is committed.
// A file whose bytes and processing version are unchanged is neither processed nor uploaded again. Its place name is
// still worked out again every run (from the source's GPS, offline, or from the sidecar), because the place is not in
// the uploaded bytes: only the city and country are stored, never the coordinates.
//
// Two passes: first every photo is read, hashed and located (a sidecar override, or its GPS looked up in GeoNames,
// which may download the dataset), then each is processed and uploaded. A lookup failure, such as a download timeout,
// therefore aborts before anything is uploaded. Pass two reads each changed file again rather than keeping every
// original in memory (they run to about 21 MB each).
//
// THE DEFAULT IS A DRY RUN: it processes in memory and prints what it would do, and touches neither R2 nor the JSON.
// Only --upload does, and the last line of a dry run says so. The R2 API token is read from the environment variable named in R2_TOKEN_ENV and handed to
// wrangler through the child process's environment only; it is never printed. Parsing, matching and ordering live in
// src/lib, so this file only does I/O.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { galleryCollection, parseGallery, type CollectionCaption, type GalleryEntry } from '../src/lib/gallery.ts';
import type { Place } from '../src/lib/geonames.ts';
import { captionWithLocation, formatLocation, resolveLocation, type SidecarLocation } from '../src/lib/location.ts';
import {
    decideAction,
    inTwoPasses,
    droppedNotices,
    galleryDataFile,
    galleryKey,
    mergeGallery,
    parseSidecars,
    parseSyncArgs,
    planInputs,
    PROCESSING_VERSION,
    r2UploadArgs,
    R2_TOKEN_ENV,
    serializeGallery,
    sidecarDirectory,
    sidecarFileName,
    syncSummary,
    type CuratedEntry,
    type SyncAction,
} from '../src/lib/gallerySync.ts';
import { deriveSourceLocation, processImage } from './galleryImage.ts';
import { loadGeonamesPlaces } from './geonames.ts';

const WRANGLER = join('node_modules', 'wrangler', 'bin', 'wrangler.js');

function kilobytes(bytes: number): string {
    return `${(bytes / 1024).toFixed(1)} kB`;
}

// Missing is not an error: a collection with no images yet has no sidecar directory either.
function listFiles(directory: string): string[] {
    try {
        return readdirSync(directory, { withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }
}

// Reads without a separate existence check, which would race with the write that follows it.
function readIfPresent(path: string): Buffer | undefined {
    try {
        return readFileSync(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
    }
}

// Writes only when the content differs, so unchanged output keeps its timestamp and git sees no change.
function writeIfChanged(path: string, data: string): boolean {
    const bytes = Buffer.from(data);
    if (readIfPresent(path)?.equals(bytes)) return false;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    return true;
}

// Uploads one object. wrangler gets an argument array (no shell) and the credentials only through its environment.
function upload(
    { bucket, account, token }: { bucket: string; account: string; token: string },
    key: string,
    jpeg: Buffer,
): void {
    const directory = mkdtempSync(join(tmpdir(), 'sync-gallery-'));
    try {
        const file = join(directory, 'upload.jpg');
        writeFileSync(file, jpeg);
        const { [R2_TOKEN_ENV]: _unused, ...inherited } = process.env;
        const result = spawnSync(process.execPath, [WRANGLER, ...r2UploadArgs(bucket, key, file)], {
            env: { ...inherited, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account },
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (result.error || result.status !== 0) {
            // Defense in depth: wrangler should never echo the token, but this output must not either.
            const output = `${result.stderr}${result.stdout}`.replaceAll(token, '[redacted]').trim();
            throw new Error(
                `Uploading ${key} failed (${result.error?.message ?? `exit ${result.status}`}).\n${output}`,
            );
        }
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

// The GeoNames dataset is loaded (and downloaded the first time) only when a photo without a sidecar override has GPS.
let places: Promise<Place[]> | undefined;
const loadPlaces = () => (places ??= loadGeonamesPlaces());

// The place for one photo: the sidecar decides when it says anything, otherwise it is derived from the source's GPS.
async function locationOf(original: Buffer, file: string, override: SidecarLocation | undefined) {
    if (override !== undefined) return resolveLocation(undefined, override);
    const { place, warning } = await deriveSourceLocation(original, loadPlaces);
    if (warning !== undefined) console.warn(`warning: ${file}: ${warning}`);
    return resolveLocation(place, undefined);
}

const options = parseSyncArgs(process.argv.slice(2), process.env);
const { collection: collectionName, sourceDir } = options;
const collection = galleryCollection(collectionName);
if (!collection.keepsCameraExif) {
    // Collections without camera EXIF (art) take their caption from the sidecar, which is not built yet.
    throw new Error(`${collectionName}: captions from sidecars are not supported yet.`);
}

const dataFile = galleryDataFile(collectionName);
const sidecarDir = sidecarDirectory(collectionName);
const { images, problems } = planInputs(listFiles(sourceDir), listFiles(sidecarDir));
if (problems.length > 0) {
    throw new Error(`Cannot sync ${collectionName} from ${sourceDir}:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
}

// Every sidecar is read and validated up front, so one run lists all the bad ones (a TODO placeholder included).
const sidecarResult = parseSidecars(
    collectionName,
    images.map(({ basename }) => {
        const source = join(sidecarDir, sidecarFileName(basename));
        return { basename, source, text: readFileSync(source, 'utf8') };
    }),
);
if (sidecarResult.problems.length > 0) {
    const lines = sidecarResult.problems.map((problem) => `  - ${problem.replaceAll('\n', '\n    ')}`);
    throw new Error(`Cannot sync ${collectionName}: ${lines.length} sidecar(s) are invalid:\n${lines.join('\n')}`);
}

const previous = parseGallery(collectionName, JSON.parse(readFileSync(dataFile, 'utf8')));
const previousByKey = new Map(previous.map((entry) => [entry.key, entry]));
const credentials = options.upload
    ? { bucket: options.bucket, account: options.account!, token: process.env[R2_TOKEN_ENV]! }
    : undefined;

console.log(`${options.upload ? 'UPLOADING' : 'Dry run (nothing uploaded, nothing written)'}: ${collectionName}`);
const current: CuratedEntry<CollectionCaption>[] = [];
const counts: Record<SyncAction, number> = { new: 0, changed: 0, unchanged: 0 };

// Pass one: everything that can fail without side effects. A plan holds no image bytes.
async function planPhoto({ file, basename }: (typeof images)[number]) {
    const key = galleryKey(collectionName, basename);
    const sidecar = sidecarResult.sidecars.get(basename)!;
    const original = readFileSync(join(sourceDir, file));
    const sourceSha256 = createHash('sha256').update(original).digest('hex');
    const existing = previousByKey.get(key);
    const action = decideAction(existing, sourceSha256);
    counts[action]++;
    const location = await locationOf(original, file, sidecar.location);
    return { file, key, sidecar, sourceSha256, existing, action, location };
}

// Pass two: process and upload (or, in a dry run, only process).
async function syncPhoto({
    file,
    key,
    sidecar,
    sourceSha256,
    existing,
    action,
    location,
}: Awaited<ReturnType<typeof planPhoto>>): Promise<void> {
    const place = location === undefined ? 'no place' : `${formatLocation(location)} (${location.source})`;

    if (existing !== undefined && action === 'unchanged') {
        // The alt text and the place are not part of the uploaded file, so a change to either needs no re-upload.
        current.push({
            entry: { ...existing, alt: sidecar.alt, caption: captionWithLocation(existing.caption, location) },
            order: sidecar.order,
        });
        console.log(`unchanged  ${key}  ${existing.width}x${existing.height}  ${place}`);
        return;
    }

    const original = readFileSync(join(sourceDir, file));
    const processed = await processImage(original, { keepCameraExif: collection.keepsCameraExif, label: file });
    console.log(
        `${action.padEnd(9)}  ${key}  ${processed.width}x${processed.height}  ${kilobytes(processed.jpeg.length)}  ${place}`,
    );
    if (credentials) upload(credentials, key, processed.jpeg);
    const entry: GalleryEntry<CollectionCaption> = {
        key,
        width: processed.width,
        height: processed.height,
        thumbhash: processed.thumbhash,
        sourceSha256,
        processingVersion: PROCESSING_VERSION,
        alt: sidecar.alt,
        caption: captionWithLocation(processed.caption ?? {}, location),
    };
    current.push({ entry, order: sidecar.order });
}

await inTwoPasses(images, planPhoto, syncPhoto);

const { entries, dropped } = mergeGallery(current, previous);
for (const notice of droppedNotices(dropped)) console.log(notice);
console.log(syncSummary(counts, dropped.length, entries.length, dataFile, options.upload));

if (credentials) {
    // Only after every upload succeeded, so the committed data never lists an object that is not in the bucket.
    const changed = writeIfChanged(dataFile, serializeGallery(entries));
    console.log(`${dataFile}: ${changed ? 'updated' : 'unchanged'}`);
}
