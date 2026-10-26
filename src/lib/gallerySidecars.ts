import { assertGalleryCollection, type GalleryCollectionName } from './gallery';
import { acceptImages, defaultSourceDir, sidecarFileName, type SourceImage } from './gallerySync';

export interface ScaffoldOptions {
    collection: GalleryCollectionName;
    sourceDir: string;
    /** True writes nothing and only reports what would be created. */
    dryRun: boolean;
}

export const SCAFFOLD_USAGE = 'Usage: scaffold-gallery <collection> [--source <dir>] [--dry-run]';

/** Parses `scaffold-gallery <collection> [--source <dir>] [--dry-run]`. The source defaults like the sync's. */
export function parseScaffoldArgs(argv: readonly string[]): ScaffoldOptions {
    const positionals: string[] = [];
    let source: string | undefined;
    let dryRun = false;

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--dry-run') {
            dryRun = true;
        } else if (arg === '--source') {
            const value = argv[index + 1];
            if (value === undefined || value.startsWith('--')) {
                throw new Error(`--source needs a value.\n${SCAFFOLD_USAGE}`);
            }
            source = value;
            index++;
        } else if (arg.startsWith('--')) {
            throw new Error(`Unknown option ${arg}.\n${SCAFFOLD_USAGE}`);
        } else {
            positionals.push(arg);
        }
    }

    const [collection, ...extra] = positionals;
    if (collection === undefined) throw new Error(`Name a collection.\n${SCAFFOLD_USAGE}`);
    if (extra.length > 0) throw new Error(`Unexpected argument "${extra[0]}".\n${SCAFFOLD_USAGE}`);
    assertGalleryCollection(collection);
    return { collection, sourceDir: source ?? defaultSourceDir(collection), dryRun };
}

export interface ScaffoldPlan {
    /** Accepted images that have no sidecar yet. */
    create: SourceImage[];
    /** Accepted images whose sidecar already exists; it is never touched. */
    skip: SourceImage[];
    /** Files in the source directory the sync would reject (not JPEGs, hidden, duplicate names). */
    rejected: string[];
}

/** Decides which sidecars to create: one per accepted image that lacks one. Existing sidecars are only ever skipped. */
export function planScaffold(imageFiles: readonly string[], sidecarFiles: readonly string[]): ScaffoldPlan {
    const { images, problems } = acceptImages(imageFiles);
    const existing = new Set(sidecarFiles);
    return {
        create: images.filter(({ basename }) => !existing.has(sidecarFileName(basename))),
        skip: images.filter(({ basename }) => existing.has(sidecarFileName(basename))),
        rejected: problems,
    };
}
