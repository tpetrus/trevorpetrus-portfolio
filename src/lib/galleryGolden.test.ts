import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { galleryCollection, parseGallery } from './gallery';
import { resolveLocation } from './location';
import type { PhotographyCaption, PhotographySidecar } from './photography';
import { composeUnchangedEntry, mergeGallery, parseSidecar, serializeGallery, type CuratedEntry } from './gallerySync';

// Pins the committed photography data: rebuilding every entry through the sync's unchanged-source path (the alt,
// category and pin from the sidecar; the place from the sidecar override, else the one already committed) and merging
// must reproduce the data file byte for byte. A refactor of the sync cannot change the published data unnoticed.
const dataFile = join(process.cwd(), 'src/data/gallery/photography.json');
const sidecarDir = join(process.cwd(), 'src/content/photography');

describe('the committed photography data', () => {
    it('is reproduced byte for byte from its sidecars by the unchanged path', () => {
        const committed = readFileSync(dataFile, 'utf8');
        const collection = galleryCollection('photography');
        const previous = parseGallery('photography', JSON.parse(committed));

        const current: CuratedEntry<(typeof previous)[number]['caption']>[] = previous.map((existing) => {
            const basename = existing.key.slice('photography/'.length).replace(/\.jpg$/, '');
            const source = join(sidecarDir, `${basename}.yml`);
            const sidecar = parseSidecar('photography', readFileSync(source, 'utf8'), source);
            const location =
                sidecar.location === undefined
                    ? existing.caption.location
                    : resolveLocation(undefined, sidecar.location);
            return {
                entry: composeUnchangedEntry<PhotographyCaption, PhotographySidecar>(collection, {
                    existing,
                    sidecar,
                    location,
                }),
                order: sidecar.order,
            };
        });

        const sidecarCount = readdirSync(sidecarDir).filter((file) => file.endsWith('.yml')).length;
        expect(current).toHaveLength(sidecarCount);

        const { entries, dropped } = mergeGallery(current, previous, collection.compareEntries);
        expect(dropped).toEqual([]);
        expect(serializeGallery(entries)).toBe(committed);
    });
});
