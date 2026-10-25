// Publishes a gallery collection by hand: `npm run sync:gallery -- <collection> [options]`. Nothing here runs at build
// time (the site makes no network calls then).
//
// For every JPEG in the source directory (default gallery-originals/<collection>, never committed) it
//   1. re-encodes the image for upload (sRGB, auto-oriented, camera EXIF only, no GPS; see scripts/galleryImage.ts),
//   2. uploads it to the R2 bucket as <collection>/<name>.jpg, and
//   3. records its size, ThumbHash and caption, with the alt text from src/content/<collection>/<name>.yml, in
//      src/data/gallery/<collection>.json, which is committed.
// A file whose bytes and processing version are unchanged is neither processed nor uploaded again.
//
// THE DEFAULT IS A DRY RUN: it processes in memory and prints what it would do, and touches neither R2 nor the JSON.
// Only --upload does. The R2 API token is read from the environment variable named in R2_TOKEN_ENV and handed to
// wrangler through the child process's environment only; it is never printed. Parsing, matching and ordering live in
// src/lib, so this file only does I/O.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { galleryCollection, parseGallery, type CollectionCaption, type GalleryEntry } from '../src/lib/gallery.ts';
import {
    decideAction,
    droppedNotices,
    galleryDataFile,
    galleryKey,
    mergeGallery,
    parseSidecar,
    parseSyncArgs,
    planInputs,
    PROCESSING_VERSION,
    r2UploadArgs,
    R2_TOKEN_ENV,
    serializeGallery,
    sidecarDirectory,
    type CuratedEntry,
    type SyncAction,
} from '../src/lib/gallerySync.ts';
import { processImage } from './galleryImage.ts';

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

const previous = parseGallery(collectionName, JSON.parse(readFileSync(dataFile, 'utf8')));
const previousByKey = new Map(previous.map((entry) => [entry.key, entry]));
const credentials = options.upload
    ? { bucket: options.bucket!, account: options.account!, token: process.env[R2_TOKEN_ENV]! }
    : undefined;

console.log(`${options.upload ? 'UPLOADING' : 'Dry run (nothing uploaded, nothing written)'}: ${collectionName}`);
const current: CuratedEntry<CollectionCaption>[] = [];
const counts: Record<SyncAction, number> = { new: 0, changed: 0, unchanged: 0 };

for (const { file, basename } of images) {
    const key = galleryKey(collectionName, basename);
    const sidecarPath = join(sidecarDir, `${basename}.yml`);
    const sidecar = parseSidecar(collectionName, readFileSync(sidecarPath, 'utf8'), sidecarPath);
    const original = readFileSync(join(sourceDir, file));
    const sourceSha256 = createHash('sha256').update(original).digest('hex');
    const existing = previousByKey.get(key);
    const action = decideAction(existing, sourceSha256);
    counts[action]++;

    if (existing !== undefined && action === 'unchanged') {
        // Only the sidecar can differ, and the alt text is not part of the uploaded file.
        current.push({ entry: { ...existing, alt: sidecar.alt }, order: sidecar.order });
        console.log(`unchanged  ${key}  ${existing.width}x${existing.height}`);
        continue;
    }

    const processed = await processImage(original, { keepCameraExif: collection.keepsCameraExif, label: file });
    console.log(
        `${action.padEnd(9)}  ${key}  ${processed.width}x${processed.height}  ${kilobytes(processed.jpeg.length)}`,
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
        caption: processed.caption ?? {},
    };
    current.push({ entry, order: sidecar.order });
}

const { entries, dropped } = mergeGallery(current, previous);
for (const notice of droppedNotices(dropped)) console.log(notice);
console.log(
    `${counts.new} new, ${counts.changed} changed, ${counts.unchanged} unchanged, ${dropped.length} dropped; ` +
        `${entries.length} entries in ${dataFile}`,
);

if (credentials) {
    // Only after every upload succeeded, so the committed data never lists an object that is not in the bucket.
    const changed = writeIfChanged(dataFile, serializeGallery(entries));
    console.log(`${dataFile}: ${changed ? 'updated' : 'unchanged'}`);
}
