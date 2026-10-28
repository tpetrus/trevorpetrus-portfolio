import { readFileSync } from 'node:fs';

import { PHOTOGRAPHY_CATEGORIES } from '../../src/lib/photography';

// Re-exported so the specs read the one category list the site renders from.
export { PHOTOGRAPHY_CATEGORIES };

export interface GalleryDataEntry {
    key: string;
    alt: string;
    width: number;
    height: number;
    category: string;
    caption: { location?: { city: string; country: string } };
}

/** The committed `src/data/gallery/<collection>.json`, read at the time the spec file loads (cwd is the repo root). */
export function readGalleryEntries(collection: string): GalleryDataEntry[] {
    return JSON.parse(readFileSync(`src/data/gallery/${collection}.json`, 'utf8')) as GalleryDataEntry[];
}

/** The entries in the order the page lists their tiles: by category section, then the data's order within it. */
export function entriesInPageOrder(entries: readonly GalleryDataEntry[]): GalleryDataEntry[] {
    return PHOTOGRAPHY_CATEGORIES.flatMap(({ id }) => entries.filter((entry) => entry.category === id));
}
