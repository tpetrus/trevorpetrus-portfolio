// The blank-capture guard of `npm run sync:projects` (contract frozen in S2; the bodies are the builder's). A screenshot
// that fails it is never written, and its project keeps the previous file and `capturedSha` (decision D12). The script
// measures the facts (scripts/sync-projects.ts does only I/O); this module only judges them.

/**
 * The smallest plausible screenshot, in bytes of the encoded AVIF (2560x1600, quality 80). Calibrated on the committed
 * AudioVisualizer captures: real ones measured 31 kB (1x) to 217 kB (2x); the blank capture of PR #20 was 5.8 kB at 1x.
 */
export const MIN_CAPTURE_BYTES = 20 * 1024;

/** The largest screenshot written, in bytes of the encoded AVIF: the image budget of a project card. */
export const MAX_CAPTURE_BYTES = 500 * 1024;

/**
 * The smallest standard deviation the most varied RGB channel of the PNG must reach. Real captures measured at least 24
 * on every channel; a blank or single-color page is near 0.
 */
export const MIN_CHANNEL_STDEV = 8;

/** What the script measured about one capture. */
export interface CaptureFacts {
    /** The HTTP status of the navigation response, or `null` when the navigation produced none. */
    readonly status: number | null;
    /** The PNG's size as decoded (`undefined` when sharp could not read it). */
    readonly width: number | undefined;
    readonly height: number | undefined;
    /** The size the screenshot must have: the viewport times the device scale factor. */
    readonly expectedWidth: number;
    readonly expectedHeight: number;
    /** The encoded AVIF's length in bytes. */
    readonly bytes: number;
    /** The standard deviation of each RGB channel of the PNG, as sharp's `stats()` reports it. */
    readonly channelStdev: readonly number[];
}

export type CaptureVerdict = { readonly ok: true } | { readonly ok: false; readonly reasons: readonly string[] };

/**
 * Judges one capture. It is rejected when the navigation status is not 2xx (or there was no response), the size is not
 * the expected one, the AVIF is under `MIN_CAPTURE_BYTES` or over `MAX_CAPTURE_BYTES`, or no RGB channel reaches
 * `MIN_CHANNEL_STDEV`. Every failing check adds one plain-English reason, in that order, so one run reports them all
 * (for example `the site answered 502`, `the AVIF is 5.8 kB, under the 20.0 kB minimum (a nearly blank page?)`).
 */
export function assessCapture(facts: CaptureFacts): CaptureVerdict {
    const reasons: string[] = [];
    const { status, width, height, expectedWidth, expectedHeight, bytes, channelStdev } = facts;
    if (status === null) reasons.push('the navigation produced no response');
    else if (status < 200 || status > 299) reasons.push(`the site answered ${status}`);
    if (width !== expectedWidth || height !== expectedHeight) {
        const got = width === undefined || height === undefined ? 'an unreadable image' : `${width}x${height}`;
        reasons.push(`the screenshot is ${got}, expected ${expectedWidth}x${expectedHeight}`);
    }
    if (bytes < MIN_CAPTURE_BYTES) {
        reasons.push(
            `the AVIF is ${kilobytes(bytes)}, under the ${kilobytes(MIN_CAPTURE_BYTES)} minimum (a nearly blank page?)`,
        );
    }
    if (bytes > MAX_CAPTURE_BYTES) {
        reasons.push(`the AVIF is ${kilobytes(bytes)}, over the ${kilobytes(MAX_CAPTURE_BYTES)} maximum`);
    }
    // An empty list (sharp reported no channels) has no variation to show, so it is rejected like a flat page.
    const mostVaried = channelStdev.length > 0 ? Math.max(...channelStdev) : 0;
    if (mostVaried < MIN_CHANNEL_STDEV) {
        reasons.push(
            `the pixels are nearly uniform (the most varied color channel deviates by ${mostVaried.toFixed(1)}, under ${MIN_CHANNEL_STDEV})`,
        );
    }
    return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

function kilobytes(bytes: number): string {
    return `${(bytes / 1024).toFixed(1)} kB`;
}
