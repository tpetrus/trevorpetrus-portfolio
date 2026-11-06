// The blank-capture guard of `npm run sync:projects` (contract frozen in S2; the bodies are the builder's). A screenshot
// that fails it is never written, and its project keeps the previous file and `capturedSha` (decision D12). The script
// measures the facts (scripts/sync-projects.ts does only I/O); this module only judges them.

/**
 * The smallest plausible screenshot, in bytes of the encoded AVIF (2560x1600, quality 80). Calibrated on the committed
 * AudioVisualizer captures: real ones measured 31 kB (1x) to 247 kB (2x, the ubuntu trial); the blank capture of PR #20 was 5.8 kB at 1x.
 */
export const MIN_CAPTURE_BYTES = 20 * 1024;

/** The largest screenshot written, in bytes of the encoded AVIF: the image budget of a project card. */
export const MAX_CAPTURE_BYTES = 500 * 1024;

/**
 * The smallest standard deviation the most varied RGB channel of the PNG must reach. Real captures measured at least 24
 * on every channel (44 to 72 in the ubuntu trial); a blank or single-color page is near 0.
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

/** What the script reads from one `<img>` of the page. */
export interface PageImage {
    /** `currentSrc`: empty while the image has no source to load. */
    readonly src: string;
    /** Whether the image is at least partly inside the viewport the screenshot shows. */
    readonly inViewport: boolean;
    /** `HTMLImageElement.complete`: also true for an image that failed to load, and for one with no source. */
    readonly complete: boolean;
    /** `HTMLImageElement.naturalWidth`: 0 for an image that failed to load. */
    readonly naturalWidth: number;
}

export type ImagesState =
    | { readonly state: 'ready' }
    /** An on-screen image is still loading: keep waiting. */
    | { readonly state: 'loading'; readonly sources: readonly string[] }
    /** An on-screen image finished without pixels: it would be photographed as a broken-image icon. */
    | { readonly state: 'broken'; readonly sources: readonly string[] };

// A vector image can report a natural width of 0 in a working browser when it declares no size, so it cannot be judged
// by its width.
const VECTOR_SOURCE = /\.svg(?:[?#]|$)|^data:image\/svg\+xml/i;

/**
 * Whether every image the screenshot will show has loaded. Images outside the viewport and images with no source are
 * ignored. An on-screen image that is not `complete` is `loading`. One that is `complete` with a natural width of 0 is
 * `broken` (a failed request, or bytes the browser could not decode), unless it is a vector image. `broken` wins over
 * `loading`, because waiting longer cannot fix it.
 */
export function assessImages(images: readonly PageImage[]): ImagesState {
    const onScreen = images.filter((image) => image.inViewport && image.src !== '');
    const broken = onScreen.filter(
        (image) => image.complete && image.naturalWidth === 0 && !VECTOR_SOURCE.test(image.src),
    );
    if (broken.length > 0) return { state: 'broken', sources: broken.map((image) => image.src) };
    const loading = onScreen.filter((image) => !image.complete);
    if (loading.length > 0) return { state: 'loading', sources: loading.map((image) => image.src) };
    return { state: 'ready' };
}

/**
 * The failure reason for an `ImagesState` that is not ready: `an image on the page failed to load: <src>` or, when the
 * wait ran out, `an image on the page was still loading after the wait: <src>`. At most three sources are named, each
 * cut to 80 characters (a `data:` URL can be enormous), and `, and N more` follows when there are others.
 */
export function formatImageProblem(state: Exclude<ImagesState, { state: 'ready' }>): string {
    const shown = state.sources.slice(0, 3).map((src) => (src.length > 80 ? `${src.slice(0, 80)}...` : src));
    const more = state.sources.length > 3 ? `, and ${state.sources.length - 3} more` : '';
    const what = state.state === 'broken' ? 'failed to load' : 'was still loading after the wait';
    return `an image on the page ${what}: ${shown.join(', ')}${more}`;
}
