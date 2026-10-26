import { z } from 'astro/zod';
import { parse } from 'yaml';

import {
    galleryCollection,
    assertGalleryCollection,
    type CollectionSidecar,
    type GalleryCollectionName,
    type GalleryEntry,
} from './gallery';

// Bump when the sync script's image processing changes (quality, color handling, EXIF policy), so every committed
// entry is re-processed and re-uploaded on the next run instead of being skipped as unchanged.
export const PROCESSING_VERSION = 1;

/** The user-scope environment variable that holds the R2 API token. The sync reads it; nothing ever prints it. */
export const R2_TOKEN_ENV = 'CLOUDFLARE_R2_BUCKET_READ_WRITE_API_KEY';

/** The R2 bucket the photos live in. `--bucket` or `R2_BUCKET` override it. */
export const DEFAULT_BUCKET = 'portfolio-photos';

// R2 bucket names: 3-63 lowercase letters, digits and inner hyphens. Checked because the name is joined to the object
// key with a slash on the wrangler command line.
const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const ACCOUNT_ID = /^[0-9a-f]{32}$/i;

const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg'];

export interface SyncOptions {
    collection: GalleryCollectionName;
    sourceDir: string;
    /** False (the default) is a dry run: nothing is uploaded and no file is written. */
    upload: boolean;
    bucket: string;
    account?: string;
}

export const SYNC_USAGE =
    `Usage: sync-gallery <collection> [--source <dir>] [--upload] [--bucket <name>] [--account <id>]
` +
    `The bucket defaults to ${DEFAULT_BUCKET} (override with --bucket or R2_BUCKET).
` +
    `The account ID defaults to the CLOUDFLARE_ACCOUNT_ID environment variable (override with --account).`;

const VALUE_FLAGS = ['--source', '--bucket', '--account'];

/**
 * Parses `sync-gallery <collection> [--source <dir>] [--upload] [--bucket <name>] [--account <id>]`. The bucket and
 * account fall back to `R2_BUCKET` (then `DEFAULT_BUCKET`) and `CLOUDFLARE_ACCOUNT_ID`; a flag, when given, wins over
 * the environment. Without `--upload` this is a
 * dry run, and the account and token are not needed. Errors name what is missing, never a secret's value.
 */
export function parseSyncArgs(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): SyncOptions {
    const positionals: string[] = [];
    const values: Record<string, string> = {};
    let upload = false;

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--upload') {
            upload = true;
        } else if (VALUE_FLAGS.includes(arg)) {
            const value = argv[index + 1];
            if (value === undefined || value.startsWith('--')) {
                throw new Error(`${arg} needs a value.\n${SYNC_USAGE}`);
            }
            values[arg] = value;
            index++;
        } else if (arg.startsWith('--')) {
            throw new Error(`Unknown option ${arg}.\n${SYNC_USAGE}`);
        } else {
            positionals.push(arg);
        }
    }

    const [collection, ...extra] = positionals;
    if (collection === undefined) throw new Error(`Name a collection.\n${SYNC_USAGE}`);
    if (extra.length > 0) throw new Error(`Unexpected argument "${extra[0]}".\n${SYNC_USAGE}`);
    assertGalleryCollection(collection);

    const bucket = values['--bucket'] ?? (env.R2_BUCKET || DEFAULT_BUCKET);
    const account = values['--account'] ?? (env.CLOUDFLARE_ACCOUNT_ID || undefined);
    const options: SyncOptions = {
        collection,
        sourceDir: values['--source'] ?? defaultSourceDir(collection),
        upload,
        bucket,
        ...(account === undefined ? {} : { account }),
    };

    if (upload) {
        const missing = [
            account === undefined ? 'the account ID (--account or CLOUDFLARE_ACCOUNT_ID)' : undefined,
            env[R2_TOKEN_ENV] ? undefined : `the API token (environment variable ${R2_TOKEN_ENV})`,
        ].filter((name) => name !== undefined);
        if (missing.length > 0) throw new Error(`--upload needs ${missing.join(', ')}.`);
        if (!BUCKET_NAME.test(bucket)) throw new Error('The bucket name is not a valid R2 bucket name.');
        if (!ACCOUNT_ID.test(account)) throw new Error('The account ID must be 32 hexadecimal characters.');
    }
    return options;
}

export function defaultSourceDir(collection: string): string {
    return `gallery-originals/${collection}`;
}

/** Where the hand-written alt-text sidecars for a collection live. */
export function sidecarDirectory(collection: string): string {
    return `src/content/${collection}`;
}

/** The committed JSON the sync writes and the site reads. */
export function galleryDataFile(collection: string): string {
    return `src/data/gallery/${collection}.json`;
}

export interface SourceImage {
    /** The file name in the source directory, e.g. `IMG_0001.JPG`. */
    file: string;
    /** The name without its extension; the sidecar is `<basename>.yml`. */
    basename: string;
}

function splitExtension(file: string): { basename: string; extension: string } {
    const dot = file.lastIndexOf('.');
    return dot <= 0 ? { basename: file, extension: '' } : { basename: file.slice(0, dot), extension: file.slice(dot) };
}

/**
 * Sorts the files in a source directory into the images the sync accepts and a problem line for each file it does not:
 * non-JPEGs, hidden files and names that collide once the extension is removed.
 */
export function acceptImages(imageFiles: readonly string[]): { images: SourceImage[]; problems: string[] } {
    const problems: string[] = [];
    const images: SourceImage[] = [];
    const seen = new Set<string>();

    for (const file of [...imageFiles].sort()) {
        const { basename, extension } = splitExtension(file);
        if (!ACCEPTED_EXTENSIONS.includes(extension.toLowerCase())) {
            problems.push(`"${file}" is not accepted: only .jpg and .jpeg files are.`);
        } else if (basename.startsWith('.')) {
            problems.push(`"${file}" is a hidden file: rename it.`);
        } else if (seen.has(basename)) {
            problems.push(`"${file}" has the same name as another image once the extension is removed.`);
        } else {
            seen.add(basename);
            images.push({ file, basename });
        }
    }
    return { images, problems };
}

/** The sidecar file name for an image basename. */
export function sidecarFileName(basename: string): string {
    return `${basename}.yml`;
}

/**
 * Checks the source directory against the sidecar directory (both as plain file-name lists) and collects EVERY
 * problem, so one run reports all of them: files that are not JPEGs, duplicate names, images without a sidecar and
 * sidecars without an image.
 */
export function planInputs(
    imageFiles: readonly string[],
    sidecarFiles: readonly string[],
): { images: SourceImage[]; problems: string[] } {
    const { images, problems } = acceptImages(imageFiles);
    const seen = new Set(images.map(({ basename }) => basename));

    const sidecarBasenames = new Set<string>();
    for (const file of [...sidecarFiles].sort()) {
        const { basename, extension } = splitExtension(file);
        if (extension === '.yml') {
            sidecarBasenames.add(basename);
        } else {
            problems.push(`Sidecar "${file}" must be named "<image name>.yml".`);
        }
    }

    for (const { file, basename } of images) {
        if (!sidecarBasenames.has(basename)) {
            problems.push(`Image "${file}" has no sidecar "${sidecarFileName(basename)}".`);
        }
    }
    for (const basename of sidecarBasenames) {
        if (!seen.has(basename)) problems.push(`Sidecar "${sidecarFileName(basename)}" has no image.`);
    }
    return { images, problems };
}

/** The R2 object key for an image: always `<collection>/<basename>.jpg`, because the output is always a JPEG. */
export function galleryKey(collection: string, basename: string): string {
    return `${collection}/${basename}.jpg`;
}

/** Parses and validates a hand-written sidecar, naming the file in the error. */
export function parseSidecar(collection: GalleryCollectionName, yamlText: string, source: string): CollectionSidecar {
    const result = galleryCollection(collection).sidecarSchema.safeParse(parse(yamlText));
    if (!result.success) {
        throw new Error(`${source}: invalid sidecar\n${z.prettifyError(result.error)}`);
    }
    return result.data;
}

/**
 * Parses every sidecar and collects the failure of each bad one, so a single run lists all of them (a placeholder
 * `alt` from the scaffold included) instead of stopping at the first. `source` is the path the message names.
 */
export function parseSidecars(
    collection: GalleryCollectionName,
    files: readonly { basename: string; source: string; text: string }[],
): { sidecars: Map<string, CollectionSidecar>; problems: string[] } {
    const sidecars = new Map<string, CollectionSidecar>();
    const problems: string[] = [];
    for (const { basename, source, text } of files) {
        try {
            sidecars.set(basename, parseSidecar(collection, text, source));
        } catch (error) {
            problems.push((error as Error).message);
        }
    }
    return { sidecars, problems };
}

export type SyncAction = 'new' | 'changed' | 'unchanged';

/**
 * An existing entry is reused, with no re-upload, only when both the source bytes and the processing recipe are what
 * produced it. Anything else is processed again.
 */
export function decideAction(
    existing: Pick<GalleryEntry<unknown>, 'sourceSha256' | 'processingVersion'> | undefined,
    sourceSha256: string,
): SyncAction {
    if (existing === undefined) return 'new';
    return existing.sourceSha256 === sourceSha256 && existing.processingVersion === PROCESSING_VERSION
        ? 'unchanged'
        : 'changed';
}

/** An entry plus the sidecar's `order`, which decides its position but is not stored in the data file. */
export interface CuratedEntry<Caption> {
    entry: GalleryEntry<Caption>;
    order: number | undefined;
}

// Pinned entries (an `order`) first, lowest first; then newest capture date; then the key, so the result never depends
// on file-system order.
function compareCurated(
    a: CuratedEntry<{ taken?: string | undefined }>,
    b: CuratedEntry<{ taken?: string | undefined }>,
) {
    if (a.order !== b.order) {
        if (a.order === undefined) return 1;
        if (b.order === undefined) return -1;
        return a.order - b.order;
    }
    const takenA = a.entry.caption.taken ?? '';
    const takenB = b.entry.caption.taken ?? '';
    return takenB.localeCompare(takenA) || a.entry.key.localeCompare(b.entry.key);
}

/**
 * Builds the new data file from the entries of the images that exist now, sorted, and reports the keys that were in the
 * old file but whose source is gone. Those entries are dropped from the data; their R2 objects are not deleted.
 */
export function mergeGallery<Caption extends { taken?: string | undefined }>(
    current: readonly CuratedEntry<Caption>[],
    previous: readonly Pick<GalleryEntry<unknown>, 'key'>[],
): { entries: GalleryEntry<Caption>[]; dropped: string[] } {
    const currentKeys = new Set(current.map(({ entry }) => entry.key));
    return {
        entries: [...current].sort(compareCurated).map(({ entry }) => entry),
        dropped: previous.map(({ key }) => key).filter((key) => !currentKeys.has(key)),
    };
}

/** One line per dropped key, saying plainly that the bucket still holds the object. */
export function droppedNotices(dropped: readonly string[]): string[] {
    return dropped.map((key) => `Dropped ${key}: its source is gone. Its R2 object is NOT deleted; remove it by hand.`);
}

/** The committed file: 2-space JSON with a trailing newline. */
export function serializeGallery(entries: readonly GalleryEntry<unknown>[]): string {
    return `${JSON.stringify(entries, null, 2)}\n`;
}

/**
 * Arguments for `wrangler r2 object put`, one object per call
 * (https://developers.cloudflare.com/workers/wrangler/commands/r2/). `--remote` makes it hit the real bucket, not the
 * local simulator. The token is not here: it goes only through the child process environment.
 */
export function r2UploadArgs(bucket: string, key: string, file: string): string[] {
    return [
        'r2',
        'object',
        'put',
        `${bucket}/${key}`,
        '--file',
        file,
        '--content-type',
        'image/jpeg',
        '--cache-control',
        'public, max-age=86400',
        '--remote',
    ];
}
