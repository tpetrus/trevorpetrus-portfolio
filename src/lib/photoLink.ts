// The one place the gallery pages' deep-link format is defined. The home collage links to a piece with collectionHref;
// the gallery gives that piece's tile the id collectionAnchorId, and the lightbox glue opens the piece whose id is in the
// URL fragment (anchorIdFromHash checks it). Photography keeps its original names (photoAnchorId and friends).
import type { GalleryCollectionName } from './gallery';

/** The path of the Photography page. */
export const PHOTOGRAPHY_PATH = '/photography/';

// Each collection's tile ids start with its own prefix, so a fragment names the collection it belongs to. Photography's
// is the one the site shipped with ("photo-", not "photography-"), so existing links keep working.
const ANCHOR_PREFIXES: Record<GalleryCollectionName, string> = {
    photography: 'photo-',
    art: 'art-',
};

// "photography/DSC_0098-Edit.jpg" -> "DSC_0098-Edit". Keys are validated by the entry schema: one slash, a `.jpg` or
// `.png` end.
function basename(key: string): string {
    return key.slice(key.indexOf('/') + 1).replace(/\.(jpg|png)$/, '');
}

/**
 * The `id` of a tile on its collection's page, such as `photo-DSC_0098-Edit` or `art-Oil-study`. File names may hold
 * spaces and parentheses ("DSC_1158-Edit (2)"), which are not valid in a fragment, so every character outside
 * `[A-Za-z0-9_-]` becomes a hyphen. Two names that differ only there would collide; the gallery's specs check the
 * committed data has none.
 */
export function collectionAnchorId(collection: GalleryCollectionName, key: string): string {
    return `${ANCHOR_PREFIXES[collection]}${basename(key).replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

/** The link to a piece on its collection's page, which opens it in the lightbox. */
export function collectionHref(collection: GalleryCollectionName, key: string): string {
    return `/${collection}/#${collectionAnchorId(collection, key)}`;
}

/** The tile id a URL fragment names, or `undefined` when it is not a link to a piece of any registered collection. */
export function anchorIdFromHash(hash: string): string | undefined {
    const id = hash.startsWith('#') ? hash.slice(1) : hash;
    const named = Object.values(ANCHOR_PREFIXES).some((prefix) => id.startsWith(prefix) && id.length > prefix.length);
    return named && !/[^A-Za-z0-9_-]/.test(id) ? id : undefined;
}

/** The `id` of a photo's tile on the Photography page. */
export function photoAnchorId(key: string): string {
    return collectionAnchorId('photography', key);
}

/** The link to a photo on the Photography page, which opens it in the lightbox. */
export function photoPageHref(key: string): string {
    return collectionHref('photography', key);
}

/** The tile id a URL fragment ("#photo-...") names, or `undefined` when the fragment is not a photo link. */
export function photoIdFromHash(hash: string): string | undefined {
    const id = anchorIdFromHash(hash);
    return id?.startsWith(ANCHOR_PREFIXES.photography) ? id : undefined;
}
