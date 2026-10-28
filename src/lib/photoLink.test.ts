import { describe, expect, it } from 'vitest';

import photographyJson from '../data/gallery/photography.json';
import { parseGallery } from './gallery';
import { PHOTOGRAPHY_PATH, photoAnchorId, photoIdFromHash, photoPageHref } from './photoLink';

describe('photoAnchorId', () => {
    it('is the file name without the collection or the extension', () => {
        expect(photoAnchorId('photography/DSC_0098-Edit.jpg')).toBe('photo-DSC_0098-Edit');
    });

    it('replaces characters a fragment cannot hold', () => {
        expect(photoAnchorId('photography/DSC_1158-Edit (2).jpg')).toBe('photo-DSC_1158-Edit--2-');
    });

    it('is unique for every committed photo', () => {
        const ids = parseGallery('photography', photographyJson).map(({ key }) => photoAnchorId(key));
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('photoPageHref', () => {
    it('points at the tile on the Photography page', () => {
        expect(photoPageHref('photography/MiamiV1.jpg')).toBe(`${PHOTOGRAPHY_PATH}#photo-MiamiV1`);
    });
});

describe('photoIdFromHash', () => {
    it('round-trips an anchor id, with or without the hash sign', () => {
        const id = photoAnchorId('photography/DSC_1158-Edit (2).jpg');
        expect(photoIdFromHash(`#${id}`)).toBe(id);
        expect(photoIdFromHash(id)).toBe(id);
    });

    it.each(['', '#', '#landscape', '#photo-', '#photo-a b', '#photo-"x"'])('ignores %j', (hash) => {
        expect(photoIdFromHash(hash)).toBeUndefined();
    });
});
