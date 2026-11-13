import { describe, expect, it } from 'vitest';

import artJson from '../data/gallery/art.json';
import photographyJson from '../data/gallery/photography.json';
import { parseGallery } from './gallery';
import {
    PHOTOGRAPHY_PATH,
    anchorIdFromHash,
    collectionAnchorId,
    collectionHref,
    photoAnchorId,
    photoIdFromHash,
    photoPageHref,
} from './photoLink';

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

describe('collectionAnchorId', () => {
    it('keeps photography on the photo- prefix', () => {
        expect(collectionAnchorId('photography', 'photography/MiamiV1.jpg')).toBe('photo-MiamiV1');
    });

    it('uses the art- prefix for art and drops a .png or .jpg extension', () => {
        expect(collectionAnchorId('art', 'art/Oil Study (2).png')).toBe('art-Oil-Study--2-');
        expect(collectionAnchorId('art', 'art/harbor.jpg')).toBe('art-harbor');
    });

    it('is unique for every committed art piece', () => {
        const ids = parseGallery('art', artJson).map(({ key }) => collectionAnchorId('art', key));
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('collectionHref', () => {
    it('points at the tile on the collection page', () => {
        expect(collectionHref('art', 'art/harbor.png')).toBe('/art/#art-harbor');
        expect(collectionHref('photography', 'photography/MiamiV1.jpg')).toBe(photoPageHref('photography/MiamiV1.jpg'));
    });
});

describe('anchorIdFromHash', () => {
    it.each(['#photo-MiamiV1', 'art-harbor', '#art-Oil-Study--2-'])('accepts %j', (hash) => {
        expect(anchorIdFromHash(hash)).toBe(hash.replace(/^#/, ''));
    });

    it.each(['', '#', '#painting', '#art-', '#photo-', '#art-a b', '#other-x'])('ignores %j', (hash) => {
        expect(anchorIdFromHash(hash)).toBeUndefined();
    });

    it('is not a photo link when it names an art piece', () => {
        expect(photoIdFromHash('#art-harbor')).toBeUndefined();
    });
});
