// Matches the GPS IFD's tags (`GPSLatitude`, `GPSLatitudeRef`, ...) and the `latitude`/`longitude` values exifr derives
// from them. Case-insensitive because XMP and IPTC readers do not agree on capitalization.
const LOCATION_KEY = /^GPS|^latitude$|^longitude$/i;

/**
 * The keys of a parsed metadata object (exifr's merged output) that describe where a photo was taken. Empty means the
 * metadata carries no location. It takes a plain object so the sync's guard can be tested without an image.
 */
export function locationKeys(parsed: Readonly<Record<string, unknown>> | undefined): string[] {
    return Object.keys(parsed ?? {}).filter((key) => LOCATION_KEY.test(key));
}
