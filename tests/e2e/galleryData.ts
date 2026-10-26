import { readFileSync } from 'node:fs';

export interface GalleryDataEntry {
    key: string;
    alt: string;
    width: number;
    height: number;
}

/** The committed `src/data/gallery/<collection>.json`, read at the time the spec file loads (cwd is the repo root). */
export function readGalleryEntries(collection: string): GalleryDataEntry[] {
    return JSON.parse(readFileSync(`src/data/gallery/${collection}.json`, 'utf8')) as GalleryDataEntry[];
}
