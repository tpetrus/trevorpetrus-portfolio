import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GEONAMES_URL, loadGeonamesPlaces } from './geonames.ts';

let cacheDir: string;

beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'geonames-test-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
    rmSync(cacheDir, { recursive: true, force: true });
});

// A fetch that never answers until its signal aborts, as a stalled connection does.
const stalledFetch: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
    });

describe('loadGeonamesPlaces', () => {
    it('turns a stalled download into a clear timeout error and caches nothing', async () => {
        const failure = loadGeonamesPlaces({ fetchFn: stalledFetch, timeoutMs: 20, cacheDir });
        await expect(failure).rejects.toThrow(GEONAMES_URL);
        await expect(failure).rejects.toThrow(/timed out after 0\.02 s.*nothing to delete/s);
        expect(existsSync(join(cacheDir, 'cities1000.txt'))).toBe(false);
        expect(existsSync(join(cacheDir, 'cities1000.txt.download'))).toBe(false);
    });

    it('refuses a response that announces more than the size limit, without reading the body', async () => {
        const arrayBuffer = vi.fn();
        const fetchFn = (() =>
            Promise.resolve({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-length': String(65 * 1024 * 1024) }),
                arrayBuffer,
            } as unknown as Response)) as typeof fetch;
        await expect(loadGeonamesPlaces({ fetchFn, cacheDir })).rejects.toThrow(/announced .* above the .* limit/);
        expect(arrayBuffer).not.toHaveBeenCalled();
    });

    it('reports an HTTP error and leaves other errors unchanged', async () => {
        const notFound = (() => Promise.resolve(new Response('', { status: 404 }))) as typeof fetch;
        await expect(loadGeonamesPlaces({ fetchFn: notFound, cacheDir })).rejects.toThrow('HTTP 404');
        const offline = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch;
        await expect(loadGeonamesPlaces({ fetchFn: offline, cacheDir })).rejects.toThrow('fetch failed');
    });
});
