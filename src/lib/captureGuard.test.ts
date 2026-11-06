import { describe, expect, it } from 'vitest';

import {
    assessCapture,
    assessImages,
    formatImageProblem,
    MAX_CAPTURE_BYTES,
    MIN_CAPTURE_BYTES,
    MIN_CHANNEL_STDEV,
    type CaptureFacts,
    type PageImage,
} from './captureGuard';

const good: CaptureFacts = {
    status: 200,
    width: 2560,
    height: 1600,
    expectedWidth: 2560,
    expectedHeight: 1600,
    bytes: 217 * 1024,
    channelStdev: [31.2, 28.9, 40.5],
};
const facts = (over: Partial<CaptureFacts> = {}): CaptureFacts => ({ ...good, ...over });
const reasonsOf = (over: Partial<CaptureFacts>) => {
    const verdict = assessCapture(facts(over));
    return verdict.ok ? [] : verdict.reasons;
};

describe('assessCapture', () => {
    it('accepts a realistic capture', () => {
        expect(assessCapture(good)).toEqual({ ok: true });
    });

    it.each([200, 204, 299])('accepts status %i', (status) => {
        expect(assessCapture(facts({ status }))).toEqual({ ok: true });
    });

    it.each([300, 404, 502])('rejects status %i and names it', (status) => {
        expect(reasonsOf({ status })).toEqual([`the site answered ${status}`]);
    });

    it('rejects a missing response', () => {
        expect(reasonsOf({ status: null })).toEqual(['the navigation produced no response']);
    });

    it('rejects a wrong size', () => {
        expect(reasonsOf({ width: 10, height: 10 })).toEqual(['the screenshot is 10x10, expected 2560x1600']);
        expect(reasonsOf({ height: 1599 })).toEqual(['the screenshot is 2560x1599, expected 2560x1600']);
    });

    it('rejects an unreadable image', () => {
        expect(reasonsOf({ width: undefined, height: undefined })).toEqual([
            'the screenshot is an unreadable image, expected 2560x1600',
        ]);
    });

    it('accepts exactly the minimum and maximum bytes', () => {
        expect(assessCapture(facts({ bytes: MIN_CAPTURE_BYTES }))).toEqual({ ok: true });
        expect(assessCapture(facts({ bytes: MAX_CAPTURE_BYTES }))).toEqual({ ok: true });
    });

    it('rejects a capture under the minimum', () => {
        expect(reasonsOf({ bytes: MIN_CAPTURE_BYTES - 1 })).toHaveLength(1);
        expect(reasonsOf({ bytes: Math.round(5.8 * 1024) })).toEqual([
            'the AVIF is 5.8 kB, under the 20.0 kB minimum (a nearly blank page?)',
        ]);
    });

    it('rejects a capture over the maximum', () => {
        expect(reasonsOf({ bytes: MAX_CAPTURE_BYTES + 1 })).toHaveLength(1);
        expect(reasonsOf({ bytes: 600 * 1024 })).toEqual(['the AVIF is 600.0 kB, over the 500.0 kB maximum']);
    });

    it('accepts a deviation of exactly the minimum on its best channel', () => {
        expect(assessCapture(facts({ channelStdev: [0, MIN_CHANNEL_STDEV, 1] }))).toEqual({ ok: true });
    });

    it('rejects when no channel reaches the minimum', () => {
        expect(reasonsOf({ channelStdev: [0.5, 7.5, 1] })).toEqual([
            'the pixels are nearly uniform (the most varied color channel deviates by 7.5, under 8)',
        ]);
        expect(reasonsOf({ channelStdev: [0, 0, 0] })[0]).toContain('deviates by 0.0');
    });

    it('rejects an empty channel list like a flat page', () => {
        expect(reasonsOf({ channelStdev: [] })).toHaveLength(1);
    });

    it('reports every failing check, in order', () => {
        const reasons = reasonsOf({ status: 502, width: 10, height: 10, bytes: 6000, channelStdev: [0, 0, 0] });
        expect(reasons.map((reason) => reason.split(' ').slice(0, 3).join(' '))).toEqual([
            'the site answered',
            'the screenshot is',
            'the AVIF is',
            'the pixels are',
        ]);
    });
});

describe('assessImages', () => {
    const image = (over: Partial<PageImage> = {}): PageImage => ({
        src: 'https://app.example/card.avif',
        inViewport: true,
        complete: true,
        naturalWidth: 640,
        ...over,
    });

    it('is ready without images and with loaded ones', () => {
        expect(assessImages([])).toEqual({ state: 'ready' });
        expect(assessImages([image(), image({ src: 'https://app.example/b.avif' })])).toEqual({ state: 'ready' });
    });

    it('waits for an on-screen image that has not completed', () => {
        expect(assessImages([image(), image({ src: 'https://app.example/slow.avif', complete: false })])).toEqual({
            state: 'loading',
            sources: ['https://app.example/slow.avif'],
        });
    });

    it('calls an on-screen image that completed with no pixels broken, which complete alone would pass', () => {
        expect(assessImages([image({ src: 'https://app.example/gone.avif', naturalWidth: 0 })])).toEqual({
            state: 'broken',
            sources: ['https://app.example/gone.avif'],
        });
    });

    it('reports broken before loading, because waiting cannot fix it', () => {
        const state = assessImages([
            image({ src: 'https://app.example/slow.avif', complete: false, naturalWidth: 0 }),
            image({ src: 'https://app.example/gone.avif', naturalWidth: 0 }),
        ]);
        expect(state).toEqual({ state: 'broken', sources: ['https://app.example/gone.avif'] });
    });

    it('ignores images outside the viewport and images with no source', () => {
        expect(
            assessImages([
                image({ inViewport: false, complete: false, naturalWidth: 0 }),
                image({ src: '', complete: true, naturalWidth: 0 }),
                image({ src: '', complete: false, naturalWidth: 0 }),
            ]),
        ).toEqual({ state: 'ready' });
    });

    it.each([
        'https://app.example/logo.svg',
        'https://app.example/logo.SVG?v=2',
        'https://app.example/logo.svg#icon',
        'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>',
    ])('does not judge a vector image by its natural width: %s', (src) => {
        expect(assessImages([image({ src, naturalWidth: 0 })])).toEqual({ state: 'ready' });
    });

    it('still judges a raster image whose name only mentions svg', () => {
        expect(assessImages([image({ src: 'https://app.example/svg-card.avif', naturalWidth: 0 })]).state).toBe(
            'broken',
        );
    });
});

describe('formatImageProblem', () => {
    it('names a broken image', () => {
        expect(formatImageProblem({ state: 'broken', sources: ['https://app.example/a.avif'] })).toBe(
            'an image on the page failed to load: https://app.example/a.avif',
        );
    });

    it('names a slow image after the wait ran out', () => {
        expect(formatImageProblem({ state: 'loading', sources: ['https://app.example/a.avif'] })).toBe(
            'an image on the page was still loading after the wait: https://app.example/a.avif',
        );
    });

    it('names at most three, cuts long sources and counts the rest', () => {
        const long = `data:image/png;base64,${'A'.repeat(200)}`;
        const text = formatImageProblem({ state: 'broken', sources: ['a', 'b', long, 'd', 'e'] });
        expect(text).toBe(`an image on the page failed to load: a, b, ${long.slice(0, 80)}..., and 2 more`);
    });
});
