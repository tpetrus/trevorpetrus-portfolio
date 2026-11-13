// Publishes a gallery collection by hand: `npm run sync:gallery -- <collection> [options]`. Nothing here runs at build
// time (the site makes no network calls then).
//
// For every image (JPEG, or PNG for a collection that takes them) in the source directory (default gallery-originals/<collection>, never committed) it
//   1. re-encodes the image for upload (sRGB, auto-oriented, camera EXIF only, no GPS; see scripts/galleryImage.ts),
//   2. uploads it to the R2 bucket as <collection>/<name>.<jpg|png>, and
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

import {
    galleryCollection,
    parseGallery,
    type AnyCollectionCaption,
    type AnyCollectionSidecar,
} from '../src/lib/gallery.ts';
import type { Place } from '../src/lib/geonames.ts';
import { formatLocation, resolveLocation, type SidecarLocation } from '../src/lib/location.ts';
import {
    checkSourceFormats,
    anchorCollisionProblems,
    composeProcessedEntry,
    composeUnchangedEntry,
    decideAction,
    inTwoPasses,
    keyExtension,
    droppedNotices,
    galleryDataFile,
    galleryKey,
    mergeGallery,
    parseSidecars,
    parseSyncArgs,
    pinLimitWarning,
    planInputs,
    r2UploadArgs,
    R2_TOKEN_ENV,
    serializeGallery,
    sidecarDirectory,
    sidecarFileName,
    syncSummary,
    type EntryCollection,
    type CuratedEntry,
    type SyncAction,
} from '../src/lib/gallerySync.ts';
import { HOME_PIN_LIMIT } from '../src/lib/homeCluster.ts';
import { deriveSourceLocation, processImage, sourceExtension } from './galleryImage.ts';
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
    bytes: Buffer,
): void {
    const directory = mkdtempSync(join(tmpdir(), 'sync-gallery-'));
    try {
        const file = join(directory, `upload.${keyExtension(key)}`);
        writeFileSync(file, bytes);
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
// The same object seen through the hooks the composition needs (a union of collections, one method signature).
// Same trick for the order: the union's comparator takes no caption in particular.
const ordered: {
    compareEntries(a: CuratedEntry<AnyCollectionCaption>, b: CuratedEntry<AnyCollectionCaption>): number;
} = collection;
const hooks: EntryCollection<AnyCollectionCaption, AnyCollectionSidecar> = collection;

const dataFile = galleryDataFile(collectionName);
const sidecarDir = sidecarDirectory(collectionName);
const { images, problems } = planInputs(listFiles(sourceDir), listFiles(sidecarDir), collection.extensions);
problems.push(...anchorCollisionProblems(collectionName, images));
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
const current: CuratedEntry<AnyCollectionCaption>[] = [];
const counts: Record<SyncAction, number> = { new: 0, changed: 0, unchanged: 0 };

// Every file's real format is checked before anything else, so all renamed files are reported in one error.
checkSourceFormats(
    await Promise.all(
        images.map(async ({ file, extension }) => ({
            file,
            claimed: extension,
            actual: await sourceExtension(readFileSync(join(sourceDir, file))),
        })),
    ),
);

// Pass one: everything that can fail without side effects. A plan holds no image bytes.
async function planPhoto({ file, basename, extension }: (typeof images)[number]) {
    const key = galleryKey(collectionName, basename, extension);
    const sidecar = sidecarResult.sidecars.get(basename)!;
    const original = readFileSync(join(sourceDir, file));
    // The key and the content type come from the file name, so the bytes must really be that format.
    const sourceSha256 = createHash('sha256').update(original).digest('hex');
    const existing = previousByKey.get(key);
    const action = decideAction(existing, sourceSha256);
    counts[action]++;
    // Only a collection that shows places reads the GPS (and may load the GeoNames dataset).
    const location = collection.usesPlaces
        ? await locationOf(original, file, 'location' in sidecar ? sidecar.location : undefined)
        : undefined;
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
    // Only a collection that shows places has a place column.
    const place = !collection.usesPlaces
        ? ''
        : location === undefined
          ? '  no place'
          : `  ${formatLocation(location)} (${location.source})`;

    if (existing !== undefined && action === 'unchanged') {
        current.push({
            entry: composeUnchangedEntry(hooks, { existing, sidecar, location }),
            order: sidecar.order,
        });
        console.log(`unchanged  ${key}  ${existing.width}x${existing.height}${place}`);
        return;
    }

    const original = readFileSync(join(sourceDir, file));
    const processed = await processImage(original, { readsCamera: collection.readsCamera, label: file });
    console.log(
        `${action.padEnd(9)}  ${key}  ${processed.width}x${processed.height}  ${kilobytes(processed.bytes.length)}${place}`,
    );
    if (credentials) upload(credentials, key, processed.bytes);
    current.push({
        entry: composeProcessedEntry(hooks, { key, sourceSha256, processed, sidecar, location }),
        order: sidecar.order,
    });
}

await inTwoPasses(images, planPhoto, syncPhoto);

const { entries, dropped } = mergeGallery(current, previous, (a, b) => ordered.compareEntries(a, b));
for (const notice of droppedNotices(dropped)) console.log(notice);
const pinWarning = pinLimitWarning(entries, HOME_PIN_LIMIT);
if (pinWarning !== undefined) console.warn(pinWarning);
console.log(syncSummary(counts, dropped.length, entries.length, dataFile, options.upload));

const serialized = serializeGallery(entries);
if (credentials) {
    // Only after every upload succeeded, so the committed data never lists an object that is not in the bucket.
    const changed = writeIfChanged(dataFile, serialized);
    console.log(`${dataFile}: ${changed ? 'updated' : 'unchanged'}`);
} else {
    const changed = !readIfPresent(dataFile)?.equals(Buffer.from(serialized));
    console.log(`${dataFile}: ${changed ? 'would be updated' : 'would be unchanged'}`);
}
