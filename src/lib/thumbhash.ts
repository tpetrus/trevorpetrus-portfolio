import { rgbaToThumbHash, thumbHashToRGBA } from 'thumbhash';

// The only sizes a ThumbHash header can describe: luminance is 7 (or 5 with alpha) coefficients on the long side, the
// two chroma channels 3x3 and alpha 5x5. The decoder reads past the end of a short hash without complaint, so the
// length is checked here.
function acCoefficientCount(nx: number, ny: number): number {
    let count = 0;
    for (let cy = 0; cy < ny; cy++) {
        for (let cx = cy === 0 ? 1 : 0; cx * ny < nx * (ny - cy); cx++) count++;
    }
    return count;
}

function expectedByteLength(hash: Uint8Array): number {
    const header24 = hash[0] | (hash[1] << 8) | (hash[2] << 16);
    const header16 = hash[3] | (hash[4] << 8);
    const hasAlpha = header24 >> 23 !== 0;
    const isLandscape = header16 >> 15 !== 0;
    const longSide = hasAlpha ? 5 : 7;
    const lx = Math.max(3, isLandscape ? longSide : header16 & 7);
    const ly = Math.max(3, isLandscape ? header16 & 7 : longSide);
    const coefficients =
        acCoefficientCount(lx, ly) + 2 * acCoefficientCount(3, 3) + (hasAlpha ? acCoefficientCount(5, 5) : 0);
    return (hasAlpha ? 6 : 5) + Math.ceil(coefficients / 2);
}

/** Encodes RGBA pixels (at most 100x100, not premultiplied) as a base64 ThumbHash. */
export function encodeThumbHash(width: number, height: number, rgba: ArrayLike<number>): string {
    return btoa(String.fromCharCode(...rgbaToThumbHash(width, height, rgba)));
}

/** Decodes a base64 ThumbHash to its bytes, throwing when it is not canonical base64 or has the wrong length. */
export function decodeThumbHash(base64: string): Uint8Array {
    let binary: string;
    try {
        binary = atob(base64);
    } catch {
        throw new Error('Invalid ThumbHash: not base64.');
    }
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (btoa(binary) !== base64) {
        throw new Error('Invalid ThumbHash: base64 is not in canonical form.');
    }
    if (bytes.length < 5 || bytes.length !== expectedByteLength(bytes)) {
        throw new Error(`Invalid ThumbHash: ${bytes.length} bytes does not match its header.`);
    }
    return bytes;
}

/** True when `base64` decodes to a well-formed ThumbHash. */
export function isThumbHash(base64: string): boolean {
    try {
        decodeThumbHash(base64);
        return true;
    } catch {
        return false;
    }
}

const PLACEHOLDER_WEBP_QUALITY = 40;

/**
 * A `data:image/webp;base64,...` URL of the hash's roughly 32 px preview, for an `<img>`/CSS background so the page
 * needs no client JavaScript. Decoded at build time. It is a lossy WebP because the preview is blurred to the browser
 * anyway and every photo's URL sits in the HTML: a real-looking scene is a couple of hundred characters as WebP, against
 * about 3 kB as a compressed PNG (and more as the library's uncompressed one).
 */
export async function placeholderDataUrl(base64: string): Promise<string> {
    const { w, h, rgba } = thumbHashToRGBA(decodeThumbHash(base64));
    // Imported on demand so the schema (which only needs `isThumbHash`) never pulls the native module into a bundle.
    const { default: sharp } = await import('sharp');
    const webp = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
        .webp({ quality: PLACEHOLDER_WEBP_QUALITY })
        .toBuffer();
    return `data:image/webp;base64,${webp.toString('base64')}`;
}
