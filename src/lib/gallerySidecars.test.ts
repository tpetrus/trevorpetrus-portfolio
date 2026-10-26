import { describe, expect, it } from 'vitest';

import { GALLERY_COLLECTIONS, type GalleryCollectionName } from './gallery';
import { parseScaffoldArgs, planScaffold } from './gallerySidecars';
import { parseSidecar } from './gallerySync';

describe('parseScaffoldArgs', () => {
    it('defaults to the collection folder and a real run', () => {
        expect(parseScaffoldArgs(['photography'])).toEqual({
            collection: 'photography',
            sourceDir: 'gallery-originals/photography',
            dryRun: false,
        });
    });

    it('reads --source and --dry-run in any order', () => {
        expect(parseScaffoldArgs(['--dry-run', 'photography', '--source', 'elsewhere'])).toEqual({
            collection: 'photography',
            sourceDir: 'elsewhere',
            dryRun: true,
        });
    });

    it('requires a known collection and rejects stray input', () => {
        expect(() => parseScaffoldArgs([])).toThrow(/Name a collection/);
        expect(() => parseScaffoldArgs(['sculpture'])).toThrow(/Unknown gallery collection "sculpture"/);
        expect(() => parseScaffoldArgs(['photography', 'art'])).toThrow(/Unexpected argument "art"/);
        expect(() => parseScaffoldArgs(['photography', '--upload'])).toThrow(/Unknown option --upload/);
        expect(() => parseScaffoldArgs(['photography', '--source'])).toThrow(/--source needs a value/);
        expect(() => parseScaffoldArgs(['photography', '--source', '--dry-run'])).toThrow(/--source needs a value/);
    });
});

describe('planScaffold', () => {
    it('creates a sidecar for each accepted image that lacks one and skips the rest, sorted', () => {
        const plan = planScaffold(['b.JPG', 'a.jpg', 'c.jpeg'], ['b.yml']);
        expect(plan.create.map(({ basename }) => basename)).toEqual(['a', 'c']);
        expect(plan.skip.map(({ basename }) => basename)).toEqual(['b']);
        expect(plan.rejected).toEqual([]);
    });

    it('creates nothing when every image has a sidecar, and ignores sidecars without an image', () => {
        const plan = planScaffold(['a.jpg'], ['a.yml', 'ghost.yml']);
        expect(plan.create).toEqual([]);
        expect(plan.skip).toHaveLength(1);
    });

    it('reports files the sync would reject instead of scaffolding them', () => {
        const plan = planScaffold(['notes.txt', '.hidden.jpg', 'a.jpg', 'a.jpeg'], []);
        expect(plan.create.map(({ file }) => file)).toEqual(['a.jpeg']);
        expect(plan.rejected).toHaveLength(3);
    });

    it('plans nothing for an empty or missing source directory', () => {
        expect(planScaffold([], [])).toEqual({ create: [], skip: [], rejected: [] });
    });
});

describe('every collection template', () => {
    it.each(Object.keys(GALLERY_COLLECTIONS) as GalleryCollectionName[])(
        '%s: is rejected by its own schema until the alt is replaced',
        (name) => {
            const template = GALLERY_COLLECTIONS[name].sidecarTemplate('IMG_0001');
            expect(() => parseSidecar(name, template, 'src/content/x/IMG_0001.yml')).toThrow(
                /src\/content\/x\/IMG_0001\.yml: invalid sidecar[\s\S]*real alt text/,
            );
            const edited = template.replace(/^alt: .*$/m, 'alt: A harbor at dawn');
            expect(parseSidecar(name, edited, 'a.yml')).toMatchObject({ alt: 'A harbor at dawn' });
        },
    );
});
