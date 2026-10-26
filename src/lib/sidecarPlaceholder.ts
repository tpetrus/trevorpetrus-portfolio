/**
 * The word the scaffold writes at the start of a sidecar's `alt`. A sidecar schema rejects any `alt` that begins with
 * it, so a photo whose alt text was never written cannot be synced. Shared by every collection's template and schema.
 */
export const ALT_PLACEHOLDER_MARKER = 'TODO';

/** True when `alt` still starts with the placeholder marker (case-insensitive, after trimming). */
export function isPlaceholderAlt(alt: string): boolean {
    return alt.trim().toLowerCase().startsWith(ALT_PLACEHOLDER_MARKER.toLowerCase());
}

export const PLACEHOLDER_ALT_MESSAGE = `alt still starts with "${ALT_PLACEHOLDER_MARKER}": replace it with real alt text.`;
