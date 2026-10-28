// The one place the Photography page's deep-link format is defined. The home collage links to a photo with
// photoPageHref; the gallery gives that photo's tile the id photoAnchorId, and the lightbox glue opens the photo whose
// id is in the URL fragment (photoIdFromHash checks it).

/** The path of the Photography page. */
export const PHOTOGRAPHY_PATH = '/photography/';

const ANCHOR_PREFIX = 'photo-';

// "photography/DSC_0098-Edit.jpg" -> "DSC_0098-Edit". Keys are validated by the entry schema: one slash, a `.jpg` end.
function basename(key: string): string {
    return key.slice(key.indexOf('/') + 1).replace(/\.jpg$/, '');
}

/**
 * The `id` of a photo's tile on the Photography page, such as `photo-DSC_0098-Edit`. File names may hold spaces and
 * parentheses ("DSC_1158-Edit (2)"), which are not valid in a fragment, so every character outside `[A-Za-z0-9_-]` becomes
 * a hyphen. Two names that differ only there would collide; the gallery's spec checks the committed data has none.
 */
export function photoAnchorId(key: string): string {
    return `${ANCHOR_PREFIX}${basename(key).replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

/** The link to a photo on the Photography page, which opens it in the lightbox. */
export function photoPageHref(key: string): string {
    return `${PHOTOGRAPHY_PATH}#${photoAnchorId(key)}`;
}

/** The tile id a URL fragment ("#photo-...") names, or `undefined` when the fragment is not a photo link. */
export function photoIdFromHash(hash: string): string | undefined {
    const id = hash.startsWith('#') ? hash.slice(1) : hash;
    return id.startsWith(ANCHOR_PREFIX) && id.length > ANCHOR_PREFIX.length && !/[^A-Za-z0-9_-]/.test(id)
        ? id
        : undefined;
}
