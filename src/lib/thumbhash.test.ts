import sharp from 'sharp';
import { thumbHashToDataURL } from 'thumbhash';
import { describe, expect, it } from 'vitest';

import { decodeThumbHash, encodeThumbHash, isThumbHash, placeholderDataUrl } from './thumbhash';

// A horizontal gradient from red to blue, so the hash has real structure; `alpha` makes its right half transparent.
function gradient(width: number, height: number, alpha = false): Uint8Array {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            rgba[i] = 255 - Math.round((255 * x) / (width - 1));
            rgba[i + 2] = Math.round((255 * x) / (width - 1));
            rgba[i + 3] = alpha && x >= width / 2 ? 0 : 255;
        }
    }
    return rgba;
}

describe('encodeThumbHash', () => {
    it.each([
        ['landscape', 100, 60, false],
        ['portrait', 60, 100, false],
        ['square', 50, 50, false],
        ['with alpha', 100, 60, true],
    ])('encodes a %s image to a hash that validates', (_name, width, height, alpha) => {
        const hash = encodeThumbHash(width, height, gradient(width, height, alpha));
        expect(isThumbHash(hash)).toBe(true);
        expect(decodeThumbHash(hash).length).toBeLessThan(40);
    });

    it('refuses an image over 100x100', () => {
        expect(() => encodeThumbHash(101, 100, new Uint8Array(101 * 100 * 4))).toThrow(/100x100/);
    });
});

describe('decodeThumbHash', () => {
    const valid = encodeThumbHash(100, 60, gradient(100, 60));

    it('round-trips the bytes', () => {
        expect(btoa(String.fromCharCode(...decodeThumbHash(valid)))).toBe(valid);
    });

    it('rejects text that is not base64', () => {
        expect(() => decodeThumbHash('not base64!')).toThrow(/not base64/);
    });

    it('rejects non-canonical base64', () => {
        expect(() => decodeThumbHash(valid.replace(/=+$/, ''))).toThrow(/canonical/);
    });

    it('rejects a hash too short to hold a header', () => {
        expect(() => decodeThumbHash(btoa('abcd'))).toThrow(/does not match its header/);
    });

    it('rejects a truncated hash', () => {
        const bytes = decodeThumbHash(valid);
        expect(() => decodeThumbHash(btoa(String.fromCharCode(...bytes.slice(0, -1))))).toThrow(
            /does not match its header/,
        );
    });

    it('rejects a hash with trailing bytes', () => {
        const bytes = decodeThumbHash(valid);
        expect(() => decodeThumbHash(btoa(String.fromCharCode(...bytes, 0)))).toThrow(/does not match its header/);
    });
});

describe('isThumbHash', () => {
    it('is false for junk', () => {
        expect(isThumbHash('')).toBe(false);
        expect(isThumbHash('AAAA')).toBe(false);
    });
});

describe('placeholderDataUrl', () => {
    const hash = encodeThumbHash(100, 60, gradient(100, 60));

    it('is a WebP data URL of the decoded preview size', async () => {
        const url = await placeholderDataUrl(hash);
        expect(url.startsWith('data:image/webp;base64,')).toBe(true);
        const webp = Buffer.from(url.slice('data:image/webp;base64,'.length), 'base64');
        const { format, width, height } = await sharp(webp).metadata();
        expect(format).toBe('webp');
        expect(Math.max(width, height)).toBe(32);
    });

    it('is far smaller than the library uncompressed PNG data URL', async () => {
        const webp = await placeholderDataUrl(hash);
        const bytes = Uint8Array.from(atob(hash), (character) => character.charCodeAt(0));
        expect(webp.length).toBeLessThan(thumbHashToDataURL(bytes).length / 4);
    });

    it('rejects an invalid hash', async () => {
        await expect(placeholderDataUrl('AAAA')).rejects.toThrow(/Invalid ThumbHash/);
    });
});
