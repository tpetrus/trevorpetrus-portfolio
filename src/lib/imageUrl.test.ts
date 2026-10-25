import { describe, expect, it } from 'vitest';

import { PHOTOS_ORIGIN } from '../config/site';
import { GRID_WIDTHS, imageSrcset, LIGHTBOX_WIDTHS, originalImageUrl, transformedImageUrl } from './imageUrl';

const ORIGIN = 'https://img.example.com';

describe('transformedImageUrl', () => {
    it('puts format=auto after the options and the key at the end', () => {
        expect(transformedImageUrl('photography/a.jpg', { width: 640 }, ORIGIN)).toBe(
            'https://img.example.com/cdn-cgi/image/width=640,format=auto/photography/a.jpg',
        );
    });

    it('adds quality and fit when given', () => {
        expect(transformedImageUrl('photography/a.jpg', { width: 320, quality: 80, fit: 'cover' }, ORIGIN)).toBe(
            'https://img.example.com/cdn-cgi/image/width=320,quality=80,fit=cover,format=auto/photography/a.jpg',
        );
    });

    it('defaults to the configured photo host', () => {
        expect(transformedImageUrl('photography/a.jpg', { width: 320 })).toBe(
            `${PHOTOS_ORIGIN}/cdn-cgi/image/width=320,format=auto/photography/a.jpg`,
        );
    });

    it.each([0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects the width %j', (width) => {
        expect(() => transformedImageUrl('photography/a.jpg', { width }, ORIGIN)).toThrow(/Invalid image width/);
    });

    it.each([0, 101, 80.5, -1])('rejects the quality %j', (quality) => {
        expect(() => transformedImageUrl('photography/a.jpg', { width: 320, quality }, ORIGIN)).toThrow(
            /Invalid image quality/,
        );
    });

    it.each([1, 100])('accepts the quality %j', (quality) => {
        expect(transformedImageUrl('photography/a.jpg', { width: 320, quality }, ORIGIN)).toContain(
            `quality=${quality},`,
        );
    });
});

describe('originalImageUrl', () => {
    it('joins the origin and the key', () => {
        expect(originalImageUrl('photography/a.jpg', ORIGIN)).toBe('https://img.example.com/photography/a.jpg');
    });

    it('defaults to the configured photo host', () => {
        expect(originalImageUrl('photography/a.jpg')).toBe(`${PHOTOS_ORIGIN}/photography/a.jpg`);
    });

    it('percent-encodes each segment but keeps the separators', () => {
        expect(originalImageUrl('photography/my photo #1?.jpg', ORIGIN)).toBe(
            'https://img.example.com/photography/my%20photo%20%231%3F.jpg',
        );
    });

    it.each([
        '/photography/a.jpg',
        'a.jpg',
        'photography//a.jpg',
        'photography/',
        '../a.jpg',
        'photography/../a.jpg',
        './a.jpg',
        '',
    ])('rejects the key %j', (key) => {
        expect(() => originalImageUrl(key, ORIGIN)).toThrow(/Invalid image key/);
    });
});

describe('imageSrcset', () => {
    it('lists one width descriptor per candidate', () => {
        expect(imageSrcset('photography/a.jpg', [320, 640], { quality: 70 })).toBe(
            `${transformedImageUrl('photography/a.jpg', { width: 320, quality: 70 })} 320w, ` +
                `${transformedImageUrl('photography/a.jpg', { width: 640, quality: 70 })} 640w`,
        );
    });

    it('works without options', () => {
        expect(imageSrcset('photography/a.jpg', [320])).toBe(
            `${transformedImageUrl('photography/a.jpg', { width: 320 })} 320w`,
        );
    });

    it('rejects an empty width list', () => {
        expect(() => imageSrcset('photography/a.jpg', [])).toThrow(/at least one width/);
    });
});

describe('width sets', () => {
    it('are fixed, ascending and disjoint, so the transformation count stays bounded', () => {
        expect(GRID_WIDTHS).toEqual([320, 640, 960]);
        expect(LIGHTBOX_WIDTHS).toEqual([1280, 1920, 2560]);
        const all = [...GRID_WIDTHS, ...LIGHTBOX_WIDTHS];
        expect(all).toEqual([...all].sort((a, b) => a - b));
        expect(new Set(all).size).toBe(all.length);
    });
});
