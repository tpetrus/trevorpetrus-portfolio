// Creates a starter alt-text sidecar for every photo that lacks one: `npm run scaffold:gallery -- <collection>
// [--source <dir>] [--dry-run]`. Nothing here runs at build time.
//
// For each accepted image in the source directory (default gallery-originals/<collection>) with no
// src/content/<collection>/<name>.yml, it writes the collection's template there. The template's alt text is a
// placeholder the sidecar schema rejects, so the sync refuses the photo until a person writes the real text. An existing
// sidecar is NEVER overwritten: files are opened with the exclusive-create flag, so even a sidecar that appears between
// the listing and the write is left alone. --dry-run writes nothing. Deciding what to create lives in src/lib, so this
// file only does I/O.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { galleryCollection } from '../src/lib/gallery.ts';
import { parseScaffoldArgs, planScaffold } from '../src/lib/gallerySidecars.ts';
import { sidecarDirectory, sidecarFileName } from '../src/lib/gallerySync.ts';

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

// The `wx` flag fails with EEXIST instead of truncating a file that is already there.
function createExclusively(path: string, text: string): boolean {
    try {
        writeFileSync(path, text, { flag: 'wx' });
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw error;
    }
}

const { collection: collectionName, sourceDir, dryRun } = parseScaffoldArgs(process.argv.slice(2));
const { sidecarTemplate } = galleryCollection(collectionName);
const sidecarDir = sidecarDirectory(collectionName);
const plan = planScaffold(listFiles(sourceDir), listFiles(sidecarDir));

console.log(`${dryRun ? 'Dry run (nothing written)' : 'Scaffolding'}: ${collectionName} from ${sourceDir}`);
for (const problem of plan.rejected) console.log(`ignored  ${problem}`);

let created = 0;
let skipped = plan.skip.length;
for (const { basename } of plan.skip) console.log(`skipped  ${sidecarFileName(basename)} (already exists)`);

if (!dryRun && plan.create.length > 0) mkdirSync(sidecarDir, { recursive: true });
for (const { basename } of plan.create) {
    const name = sidecarFileName(basename);
    if (dryRun) {
        created++;
        console.log(`would create  ${name}`);
    } else if (createExclusively(join(sidecarDir, name), sidecarTemplate(basename))) {
        created++;
        console.log(`created  ${name}`);
    } else {
        skipped++;
        console.log(`skipped  ${name} (already exists)`);
    }
}

console.log(
    `${created} ${dryRun ? 'would be created' : 'created'}, ${skipped} skipped, ${plan.rejected.length} ignored`,
);
if (created > 0 && !dryRun) {
    console.log(`Now replace every alt that starts with TODO in ${sidecarDir}/; the sync refuses them until you do.`);
}
