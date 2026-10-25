import { PHOTOS_ORIGIN } from '../config/site';

// Cloudflare bills Images transformations per unique transformation (5,000 a month on the free plan), and every
// distinct width of every image is one. `format` and `quality` do not count. Fixed width sets keep the total bounded:
// images x (grid + lightbox widths). format=auto serves AVIF only up to 1,200 px and WebP or JPEG above that
// (https://developers.cloudflare.com/images/get-started/limits/), so the lightbox widths are mostly WebP.
export const GRID_WIDTHS: readonly number[] = [320, 640, 960];
export const LIGHTBOX_WIDTHS: readonly number[] = [1280, 1920, 2560];

export interface TransformOptions {
    /** Maximum width in pixels; a positive integer. */
    width: number;
    /** 1-100. Omitted means Cloudflare's default. */
    quality?: number;
    /** `scale-down` never upscales; `cover` crops to fill. */
    fit?: 'scale-down' | 'cover';
}

// `<collection>/<file>`. `.` and `..` segments would let a key climb out of its collection.
function assertValidKey(key: string): string[] {
    const segments = key.split('/');
    if (segments.length < 2 || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
        throw new Error(
            `Invalid image key "${key}": expected "<collection>/<file>" with no leading slash, empty segments, "." or "..".`,
        );
    }
    return segments;
}

function encodedPath(key: string): string {
    return assertValidKey(key).map(encodeURIComponent).join('/');
}

function transformationOptions({ width, quality, fit }: TransformOptions): string {
    if (!Number.isInteger(width) || width <= 0) {
        throw new Error(`Invalid image width ${width}: expected a positive integer.`);
    }
    if (quality !== undefined && (!Number.isInteger(quality) || quality < 1 || quality > 100)) {
        throw new Error(`Invalid image quality ${quality}: expected an integer from 1 to 100.`);
    }
    const parts = [`width=${width}`];
    if (quality !== undefined) parts.push(`quality=${quality}`);
    if (fit !== undefined) parts.push(`fit=${fit}`);
    parts.push('format=auto');
    return parts.join(',');
}

/** The URL of a resized variant: `<origin>/cdn-cgi/image/<options>/<key>`, always with `format=auto`. */
export function transformedImageUrl(key: string, options: TransformOptions, origin: string = PHOTOS_ORIGIN): string {
    return `${origin}/cdn-cgi/image/${transformationOptions(options)}/${encodedPath(key)}`;
}

/** The URL of the untouched original in the bucket: `<origin>/<key>`. */
export function originalImageUrl(key: string, origin: string = PHOTOS_ORIGIN): string {
    return `${origin}/${encodedPath(key)}`;
}

/** A `srcset` value with one `<url> <width>w` candidate per width. */
export function imageSrcset(
    key: string,
    widths: readonly number[],
    options: Omit<TransformOptions, 'width'> = {},
): string {
    if (widths.length === 0) {
        throw new Error('imageSrcset needs at least one width.');
    }
    return widths.map((width) => `${transformedImageUrl(key, { ...options, width })} ${width}w`).join(', ');
}
