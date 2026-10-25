import { describe, expect, it } from 'vitest';

import {
    formatPhotographyCaption,
    PHOTOGRAPHY_EXIF_TAGS,
    photographyCaptionFromExif,
    photographyCaptionSchema,
    photographyExifBlocks,
} from './photography';

const FULL_RAW = {
    Make: 'Canon',
    Model: 'Canon EOS R5',
    LensModel: 'RF 35mm F1.8',
    FocalLength: 35,
    FNumber: 1.8,
    ExposureTime: 0.004,
    ISO: 400,
    DateTimeOriginal: '2026:10:01 13:45:10',
};

describe('photographyCaptionFromExif', () => {
    it('maps every field and keeps the capture date as written', () => {
        expect(photographyCaptionFromExif(FULL_RAW)).toEqual({
            camera: 'Canon EOS R5',
            lens: 'RF 35mm F1.8',
            focalLength: 35,
            aperture: 1.8,
            exposure: 0.004,
            iso: 400,
            taken: '2026-10-01',
        });
    });

    it('reads exactly the tags it asks exifr for', () => {
        expect([...PHOTOGRAPHY_EXIF_TAGS].sort()).toEqual(Object.keys(FULL_RAW).sort());
    });

    it('gives an empty caption for a file without EXIF', () => {
        expect(photographyCaptionFromExif(undefined)).toEqual({});
    });

    it('omits missing tags instead of writing undefined keys', () => {
        const caption = photographyCaptionFromExif({ ISO: 100 });
        expect(caption).toEqual({ iso: 100 });
        expect(Object.keys(caption)).toEqual(['iso']);
    });

    it('prefixes the make when the model does not repeat it', () => {
        expect(photographyCaptionFromExif({ Make: 'FUJIFILM', Model: 'X-T5' }).camera).toBe('FUJIFILM X-T5');
    });

    it('does not repeat the make, whatever its case', () => {
        expect(photographyCaptionFromExif({ Make: 'NIKON', Model: 'Nikon Z 6' }).camera).toBe('Nikon Z 6');
    });

    it('uses the model alone or the make alone when only one exists', () => {
        expect(photographyCaptionFromExif({ Model: 'X100V' }).camera).toBe('X100V');
        expect(photographyCaptionFromExif({ Make: 'Leica' }).camera).toBe('Leica');
    });

    it('trims padding and NULs and drops empty or non-string values', () => {
        const caption = photographyCaptionFromExif({ Make: 'Sony\u0000 ', Model: '  ', LensModel: 5 });
        expect(caption).toEqual({ camera: 'Sony' });
    });

    it('rounds away float noise and rounds ISO to an integer', () => {
        expect(photographyCaptionFromExif({ FNumber: 1.7999999, FocalLength: 23.0000001, ISO: 399.6 })).toEqual({
            aperture: 1.8,
            focalLength: 23,
            iso: 400,
        });
    });

    it.each([0, -1, Number.NaN, '35', null])('ignores the unusable number %j', (value) => {
        expect(
            photographyCaptionFromExif({ FocalLength: value, FNumber: value, ExposureTime: value, ISO: value }),
        ).toEqual({});
    });

    it.each(['0000:00:00 00:00:00', '2026:13:01 00:00:00', '2026:02:30 00:00:00', 'yesterday', '', 20261001])(
        'ignores the unusable date %j',
        (value) => {
            expect(photographyCaptionFromExif({ DateTimeOriginal: value })).toEqual({});
        },
    );

    it('accepts a date without a time part', () => {
        expect(photographyCaptionFromExif({ DateTimeOriginal: '2026:10:01' }).taken).toBe('2026-10-01');
    });

    it('produces captions its own schema accepts', () => {
        const caption = photographyCaptionFromExif(FULL_RAW);
        expect(photographyCaptionSchema.parse(caption)).toEqual(caption);
    });
});

describe('photographyCaptionSchema', () => {
    it('accepts an empty caption', () => {
        expect(photographyCaptionSchema.parse({})).toEqual({});
    });

    it.each([{ iso: 100.5 }, { taken: '2026-13-01' }, { camera: '' }, { aperture: 0 }])('rejects %j', (caption) => {
        expect(() => photographyCaptionSchema.parse(caption)).toThrow();
    });
});

describe('formatPhotographyCaption', () => {
    it('joins every part with a middle dot', () => {
        expect(formatPhotographyCaption(photographyCaptionFromExif(FULL_RAW))).toBe(
            'Canon EOS R5 · RF 35mm F1.8 · 35 mm · f/1.8 · 1/250 s · ISO 400 · 2026-10-01',
        );
    });

    it('omits missing parts', () => {
        expect(formatPhotographyCaption({ camera: 'X100V', iso: 200 })).toBe('X100V · ISO 200');
    });

    it('is an empty string for an empty caption', () => {
        expect(formatPhotographyCaption({})).toBe('');
    });

    it.each([
        [2, '2 s'],
        [1, '1 s'],
        [2.5, '2.5 s'],
        [0.8, '0.8 s'],
        [0.5, '1/2 s'],
        [0.0166667, '1/60 s'],
        [0.004, '1/250 s'],
    ])('prints an exposure of %j seconds as %j', (exposure, expected) => {
        expect(formatPhotographyCaption({ exposure })).toBe(expected);
    });
});

describe('exposure precision', () => {
    it.each([
        [1 / 3, 0.33333333],
        [1 / 32000, 0.00003125],
        [2.0004, 2],
        [30, 30],
    ])('stores an exposure of %j seconds as %j', (seconds, stored) => {
        expect(photographyCaptionFromExif({ ExposureTime: seconds }).exposure).toBe(stored);
    });
});

describe('photographyExifBlocks', () => {
    it('writes only the camera fields, as strings and rationals', () => {
        expect(photographyExifBlocks(photographyCaptionFromExif(FULL_RAW))).toEqual({
            IFD0: { Model: 'Canon EOS R5' },
            IFD2: {
                LensModel: 'RF 35mm F1.8',
                FocalLength: '350/10',
                FNumber: '18/10',
                ExposureTime: '400000/100000000',
                ISOSpeedRatings: '400',
                DateTimeOriginal: '2026:10:01 00:00:00',
            },
        });
    });

    it('writes a long exposure over a denominator of 1000', () => {
        expect(photographyExifBlocks({ exposure: 2.5 })).toEqual({ IFD2: { ExposureTime: '2500/1000' } });
    });

    it('writes nothing for an empty caption, and omits an empty block', () => {
        expect(photographyExifBlocks({})).toEqual({});
        expect(photographyExifBlocks({ camera: 'X100V' })).toEqual({ IFD0: { Model: 'X100V' } });
        expect(photographyExifBlocks({ iso: 100 })).toEqual({ IFD2: { ISOSpeedRatings: '100' } });
    });
});
