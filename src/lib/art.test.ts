import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
    ART_CATEGORIES,
    artCaptionFor,
    artCaptionSchema,
    artSidecarSchema,
    artSidecarTemplate,
    compareArtEntries,
    formatArtCaption,
    formatArtTileCaption,
    type ArtCaption,
} from './art';
import { galleryEntrySchema, GALLERY_COLLECTIONS, parseGallery } from './gallery';
import { parseSidecars, planInputs } from './gallerySync';

const valid = { alt: 'A red barn', title: 'Barn', category: 'painting' };

describe('ART_CATEGORIES', () => {
    it('lists painting, drawing and digital, in page order, with labels', () => {
        expect(ART_CATEGORIES).toEqual([
            { id: 'painting', label: 'Painting' },
            { id: 'drawing', label: 'Drawing' },
            { id: 'digital', label: 'Digital' },
        ]);
    });
});

describe('artSidecarSchema', () => {
    it('accepts the required fields and omits what is absent', () => {
        expect(artSidecarSchema.parse(valid)).toEqual(valid);
    });

    it('accepts every optional field', () => {
        const full = {
            ...valid,
            medium: 'Oil on canvas',
            dimensions: '24 x 36 in',
            year: 2024,
            order: 2,
            pin: true,
            homeOrder: 1,
        };
        expect(artSidecarSchema.parse(full)).toEqual(full);
    });

    it.each([
        ['a TODO alt', { alt: 'TODO: describe this piece' }, /real alt text/],
        ['an empty alt', { alt: '' }, /alt/],
        ['a missing title', { title: undefined }, /title/],
        ['a blank title', { title: '   ' }, /title/],
        ['a bad category', { category: 'sculpture' }, /category/],
        ['a placeholder category', { category: 'TODO: painting, drawing, digital' }, /category/],
        ['an empty medium', { medium: '' }, /medium/],
        ['a year before 1900', { year: 1899 }, /year/],
        ['a year after 2100', { year: 2101 }, /year/],
        ['a fractional order', { order: 1.5 }, /order/],
        ['a fractional homeOrder', { homeOrder: 0.5 }, /homeOrder/],
        ['an unknown key', { location: false }, /location/],
    ])('rejects %s', (_name, patch, message) => {
        expect(() => artSidecarSchema.parse({ ...valid, ...patch })).toThrow(message);
    });
});

describe('artCaptionSchema', () => {
    it('is strict and needs a title', () => {
        expect(artCaptionSchema.parse({ title: 'Barn' })).toEqual({ title: 'Barn' });
        expect(() => artCaptionSchema.parse({})).toThrow();
        expect(() => artCaptionSchema.parse({ title: 'Barn', camera: 'X' })).toThrow();
    });
});

describe('formatArtCaption', () => {
    it('joins the present fields with a comma and omits the absent ones', () => {
        expect(formatArtCaption({ title: 'Barn', medium: 'Oil', dimensions: '24 x 36 in', year: 2024 })).toBe(
            'Barn, Oil, 24 x 36 in, 2024',
        );
        expect(formatArtCaption({ title: 'Barn', year: 2024 })).toBe('Barn, 2024');
        expect(formatArtCaption({ title: 'Barn', dimensions: '8 x 10 in' })).toBe('Barn, 8 x 10 in');
        expect(formatArtCaption({ title: 'Barn' })).toBe('Barn');
    });

    it('shows only the title under a tile', () => {
        expect(formatArtTileCaption({ title: 'Barn', medium: 'Oil' })).toBe('Barn');
    });
});

describe('artCaptionFor', () => {
    it('copies the title and the present fields, never writing an absent one', () => {
        const none = artCaptionFor({ sidecar: artSidecarSchema.parse(valid), camera: undefined, location: undefined });
        expect(none).toEqual({ title: 'Barn' });
        expect(Object.keys(none)).toEqual(['title']);
        expect(
            artCaptionFor({
                sidecar: artSidecarSchema.parse({ ...valid, medium: 'Oil', dimensions: '1 x 1', year: 2020 }),
                camera: undefined,
                location: undefined,
            }),
        ).toEqual({ title: 'Barn', medium: 'Oil', dimensions: '1 x 1', year: 2020 });
    });

    it('is the art collection captionFor', () => {
        expect(GALLERY_COLLECTIONS.art.captionFor).toBe(artCaptionFor);
    });
});

describe('the art collection', () => {
    it('declares its capabilities', () => {
        const { readsCamera, usesPlaces, extensions } = GALLERY_COLLECTIONS.art;
        expect({ readsCamera, usesPlaces, extensions }).toEqual({
            readsCamera: false,
            usesPlaces: false,
            extensions: ['jpg', 'png'],
        });
    });

    it('takes .jpg and .png keys under art/ and homeOrder in an entry', () => {
        const schema = galleryEntrySchema(
            'art',
            artCaptionSchema,
            GALLERY_COLLECTIONS.art.categories,
            GALLERY_COLLECTIONS.art.extensions,
        );
        const entry = {
            key: 'art/barn.png',
            width: 1,
            height: 1,
            thumbhash: 'HCgOHgh/udU4h3dXiHiHeGd38YYHWBg=',
            sourceSha256: 'a'.repeat(64),
            processingVersion: 1,
            alt: 'A barn',
            category: 'painting',
            homeOrder: 3,
            caption: { title: 'Barn' },
        };
        expect(schema.parse(entry)).toEqual(entry);
        expect(schema.parse({ ...entry, key: 'art/barn.jpg' }).key).toBe('art/barn.jpg');
        expect(() => schema.parse({ ...entry, key: 'art/barn.gif' })).toThrow();
        expect(() => schema.parse({ ...entry, homeOrder: 1.5 })).toThrow();
    });

    it('parses the empty data file', () => {
        expect(parseGallery('art', [])).toEqual([]);
    });
});

describe('artSidecarTemplate', () => {
    const template = artSidecarTemplate('piece-1');

    it('names the piece without claiming an extension, and comments the optional fields', () => {
        expect(template).toContain('piece-1');
        expect(template).not.toContain('.jpg');
        expect(template).toContain('\nalt: "TODO: describe this piece"\n');
        for (const key of ['medium', 'dimensions', 'year', 'order', 'pin', 'homeOrder']) {
            expect(template).toContain(`\n# ${key}: `);
        }
        expect(template.endsWith('\n')).toBe(true);
    });

    it('is rejected until alt, title and category are filled in, then parses', () => {
        expect(() => artSidecarSchema.parse(parse(template))).toThrow();
        const filled = template
            .replace(/^alt: .*$/m, 'alt: A barn')
            .replace(/^title: .*$/m, 'title: Barn')
            .replace(/^category: .*$/m, 'category: drawing')
            .replace(/^# (medium|year|homeOrder):/gm, '$1:');
        expect(artSidecarSchema.parse(parse(filled))).toEqual({
            alt: 'A barn',
            title: 'Barn',
            category: 'drawing',
            medium: 'Oil on canvas',
            year: 2026,
            homeOrder: 1,
        });
    });
});

describe('compareArtEntries', () => {
    const curated = (key: string, category: string, order?: number) => ({
        entry: {
            key,
            width: 1,
            height: 1,
            thumbhash: 'x',
            sourceSha256: 'a'.repeat(64),
            processingVersion: 1,
            alt: 'a',
            category,
            caption: { title: key } as ArtCaption,
        },
        order,
    });

    it('sorts by category, then order (unset last), then key', () => {
        const sorted = [
            curated('art/z.png', 'digital'),
            curated('art/b.png', 'painting'),
            curated('art/a.png', 'painting'),
            curated('art/c.png', 'painting', 2),
            curated('art/d.png', 'painting', 1),
            curated('art/e.png', 'drawing', 5),
        ].sort(compareArtEntries);
        expect(sorted.map(({ entry }) => entry.key)).toEqual([
            'art/d.png',
            'art/c.png',
            'art/a.png',
            'art/b.png',
            'art/e.png',
            'art/z.png',
        ]);
    });
});

describe('the preflight', () => {
    it('lists every offending sidecar in one run, before anything is processed', () => {
        const result = parseSidecars('art', [
            { basename: 'ok', source: 'src/content/art/ok.yml', text: 'alt: Fine\ntitle: Fine\ncategory: drawing\n' },
            {
                basename: 'todo',
                source: 'src/content/art/todo.yml',
                text: 'alt: "TODO: describe this piece"\ntitle: T\ncategory: drawing\n',
            },
            { basename: 'notitle', source: 'src/content/art/notitle.yml', text: 'alt: Fine\ncategory: digital\n' },
            {
                basename: 'badcat',
                source: 'src/content/art/badcat.yml',
                text: 'alt: Fine\ntitle: T\ncategory: sculpture\n',
            },
        ]);
        expect(result.problems).toHaveLength(3);
        expect(result.problems[0]).toMatch(/todo\.yml: invalid sidecar[\s\S]*real alt text/);
        expect(result.problems[1]).toMatch(/notitle\.yml: invalid sidecar[\s\S]*title/);
        expect(result.problems[2]).toMatch(/badcat\.yml: invalid sidecar[\s\S]*category/);
        expect([...result.sidecars.keys()]).toEqual(['ok']);
    });

    it('plans png and jpg inputs for art and rejects other formats', () => {
        const { images, problems } = planInputs(['a.png', 'b.JPG', 'c.webp'], ['a.yml', 'b.yml'], ['jpg', 'png']);
        expect(images.map(({ extension }) => extension)).toEqual(['png', 'jpg']);
        expect(problems).toEqual(['"c.webp" is not accepted: only .jpg, .jpeg and .png files are.']);
    });
});
