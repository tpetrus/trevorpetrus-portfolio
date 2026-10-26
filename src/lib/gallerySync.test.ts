import { describe, expect, it } from 'vitest';

import type { GalleryEntry } from './gallery';
import {
    acceptImages,
    decideAction,
    DEFAULT_BUCKET,
    defaultSourceDir,
    droppedNotices,
    galleryDataFile,
    galleryKey,
    mergeGallery,
    parseSidecar,
    parseSidecars,
    parseSyncArgs,
    planInputs,
    PROCESSING_VERSION,
    r2UploadArgs,
    R2_TOKEN_ENV,
    serializeGallery,
    sidecarDirectory,
    sidecarFileName,
    type CuratedEntry,
} from './gallerySync';

const BUCKET = 'my-photos';
const ACCOUNT = '0123456789abcdef0123456789abcdef';
const FULL_ENV = { R2_BUCKET: BUCKET, CLOUDFLARE_ACCOUNT_ID: ACCOUNT, [R2_TOKEN_ENV]: 'secret-token-value' };

describe('parseSyncArgs', () => {
    it('defaults to a dry run of the default source directory and the default bucket', () => {
        expect(parseSyncArgs(['photography'], {})).toEqual({
            collection: 'photography',
            sourceDir: 'gallery-originals/photography',
            upload: false,
            bucket: DEFAULT_BUCKET,
        });
        expect(DEFAULT_BUCKET).toBe('portfolio-photos');
    });

    it('uploads to the default bucket when neither a flag nor R2_BUCKET names one', () => {
        expect(parseSyncArgs(['photography', '--upload'], { ...FULL_ENV, R2_BUCKET: undefined })).toMatchObject({
            bucket: DEFAULT_BUCKET,
        });
    });

    it('does not need credentials for a dry run, even when some are given', () => {
        expect(parseSyncArgs(['photography', '--bucket', BUCKET], {})).toEqual({
            collection: 'photography',
            sourceDir: 'gallery-originals/photography',
            upload: false,
            bucket: BUCKET,
        });
    });

    it('reads every flag in any order', () => {
        expect(
            parseSyncArgs(
                ['--source', 'D:/shots', 'photography', '--upload', '--account', ACCOUNT, '--bucket', BUCKET],
                { [R2_TOKEN_ENV]: 'x' },
            ),
        ).toEqual({ collection: 'photography', sourceDir: 'D:/shots', upload: true, bucket: BUCKET, account: ACCOUNT });
    });

    it('falls back to R2_BUCKET and CLOUDFLARE_ACCOUNT_ID, and lets flags win', () => {
        expect(parseSyncArgs(['photography', '--upload'], FULL_ENV)).toMatchObject({
            bucket: BUCKET,
            account: ACCOUNT,
        });
        expect(parseSyncArgs(['photography', '--upload', '--bucket', 'other-bucket'], FULL_ENV)).toMatchObject({
            bucket: 'other-bucket',
        });
    });

    describe('the account ID', () => {
        const OTHER_ACCOUNT = 'fedcba9876543210fedcba9876543210';

        it('comes from CLOUDFLARE_ACCOUNT_ID when --account is not given', () => {
            expect(parseSyncArgs(['photography', '--upload'], FULL_ENV).account).toBe(ACCOUNT);
        });

        it('is overridden by --account when given', () => {
            expect(parseSyncArgs(['photography', '--upload', '--account', OTHER_ACCOUNT], FULL_ENV).account).toBe(
                OTHER_ACCOUNT,
            );
        });

        it('fails naming both options when neither is set, without printing a value', () => {
            const env = { ...FULL_ENV, CLOUDFLARE_ACCOUNT_ID: undefined };
            expect(() => parseSyncArgs(['photography', '--upload'], env)).toThrow(
                '--upload needs the account ID (--account or CLOUDFLARE_ACCOUNT_ID).',
            );
        });

        it('is not required for a dry run', () => {
            expect(
                parseSyncArgs(['photography'], { ...FULL_ENV, CLOUDFLARE_ACCOUNT_ID: undefined }),
            ).not.toHaveProperty('account');
        });
    });

    it('treats empty environment variables as missing', () => {
        expect(() => parseSyncArgs(['photography', '--upload'], { R2_BUCKET: '', [R2_TOKEN_ENV]: '' })).toThrow(
            /account ID.*API token/,
        );
        expect(parseSyncArgs(['photography'], { R2_BUCKET: '' }).bucket).toBe(DEFAULT_BUCKET);
    });

    it('names everything --upload is missing, and never a value', () => {
        expect(() => parseSyncArgs(['photography', '--upload'], {})).toThrow(
            `--upload needs the account ID (--account or CLOUDFLARE_ACCOUNT_ID), ` +
                `the API token (environment variable ${R2_TOKEN_ENV}).`,
        );
        let message = '';
        try {
            parseSyncArgs(['photography', '--upload'], { ...FULL_ENV, CLOUDFLARE_ACCOUNT_ID: undefined });
        } catch (error) {
            message = (error as Error).message;
        }
        expect(message).toMatch(/the account ID/);
        expect(message).not.toContain('secret-token-value');
    });

    it('names a single missing token', () => {
        expect(() => parseSyncArgs(['photography', '--upload'], { ...FULL_ENV, [R2_TOKEN_ENV]: undefined })).toThrow(
            `--upload needs the API token (environment variable ${R2_TOKEN_ENV}).`,
        );
    });

    it.each(['UPPER', 'a', 'has/slash', '-leading', 'trailing-', 'has space'])('rejects the bucket %j', (bucket) => {
        expect(() => parseSyncArgs(['photography', '--upload', '--bucket', bucket], FULL_ENV)).toThrow(/bucket name/);
    });

    it.each(['abc', ACCOUNT + '0', 'g'.repeat(32)])('rejects the account %j', (account) => {
        expect(() => parseSyncArgs(['photography', '--upload', '--account', account], FULL_ENV)).toThrow(
            /32 hexadecimal/,
        );
    });

    it('requires a collection and rejects unknown ones', () => {
        expect(() => parseSyncArgs([], {})).toThrow(/Name a collection/);
        expect(() => parseSyncArgs(['sculpture'], {})).toThrow(/Unknown gallery collection "sculpture"/);
    });

    it('rejects unknown options, extra arguments and flags without a value', () => {
        expect(() => parseSyncArgs(['photography', '--force'], {})).toThrow(/Unknown option --force/);
        expect(() => parseSyncArgs(['photography', 'art'], {})).toThrow(/Unexpected argument "art"/);
        expect(() => parseSyncArgs(['photography', '--source'], {})).toThrow(/--source needs a value/);
        expect(() => parseSyncArgs(['photography', '--source', '--upload'], {})).toThrow(/--source needs a value/);
    });
});

describe('paths', () => {
    it('derive from the collection name', () => {
        expect(defaultSourceDir('photography')).toBe('gallery-originals/photography');
        expect(sidecarDirectory('photography')).toBe('src/content/photography');
        expect(galleryDataFile('photography')).toBe('src/data/gallery/photography.json');
        expect(galleryKey('photography', 'IMG_0001')).toBe('photography/IMG_0001.jpg');
    });
});

describe('planInputs', () => {
    it('pairs images with sidecars, sorted, and accepts jpg and jpeg in any case', () => {
        expect(planInputs(['b.JPEG', 'a.jpg', 'c.Jpg'], ['c.yml', 'a.yml', 'b.yml'])).toEqual({
            images: [
                { file: 'a.jpg', basename: 'a' },
                { file: 'b.JPEG', basename: 'b' },
                { file: 'c.Jpg', basename: 'c' },
            ],
            problems: [],
        });
    });

    it('reports every problem at once', () => {
        const { images, problems } = planInputs(
            ['a.jpg', 'a.jpeg', 'b.png', 'c.jpg', 'noextension', '.hidden.jpg'],
            ['a.yml', 'ghost.yml', 'c.yaml'],
        );
        expect(images).toEqual([
            { file: 'a.jpeg', basename: 'a' },
            { file: 'c.jpg', basename: 'c' },
        ]);
        expect(problems).toEqual([
            '".hidden.jpg" is a hidden file: rename it.',
            '"a.jpg" has the same name as another image once the extension is removed.',
            '"b.png" is not accepted: only .jpg and .jpeg files are.',
            '"noextension" is not accepted: only .jpg and .jpeg files are.',
            'Sidecar "c.yaml" must be named "<image name>.yml".',
            'Image "c.jpg" has no sidecar "c.yml".',
            'Sidecar "ghost.yml" has no image.',
        ]);
    });
});

describe('parseSidecar', () => {
    it('parses alt and order', () => {
        expect(parseSidecar('photography', 'alt: A harbor at dawn\norder: 2\n', 'a.yml')).toEqual({
            alt: 'A harbor at dawn',
            order: 2,
        });
    });

    it('parses a location override: a place, or false to hide it', () => {
        const place = 'location:\n  city: Lisbon\n  country: Portugal\n';
        expect(parseSidecar('photography', `alt: A harbor\n${place}`, 'a.yml')).toEqual({
            alt: 'A harbor',
            location: { city: 'Lisbon', country: 'Portugal' },
        });
        expect(parseSidecar('photography', 'alt: A harbor\nlocation: false\n', 'a.yml')).toEqual({
            alt: 'A harbor',
            location: false,
        });
    });

    it('leaves the location absent when the sidecar has none, so the sync derives it', () => {
        expect(parseSidecar('photography', 'alt: A harbor\n', 'a.yml')).not.toHaveProperty('location');
    });

    it.each([
        ['true', 'location: true'],
        ['a bare string', 'location: Lisbon'],
        ['a place without a country', 'location:\n  city: Lisbon'],
        ['a coordinate', 'location:\n  city: Lisbon\n  country: Portugal\n  latitude: 38.7'],
    ])('rejects a location that is %s', (_label, location) => {
        expect(() => parseSidecar('photography', `alt: A harbor\n${location}\n`, 'a.yml')).toThrow(
            /a\.yml: invalid sidecar/,
        );
    });

    it('names the file when the sidecar is invalid', () => {
        expect(() => parseSidecar('photography', 'order: 1\n', 'src/content/photography/a.yml')).toThrow(
            /src\/content\/photography\/a\.yml: invalid sidecar/,
        );
        expect(() => parseSidecar('photography', '', 'a.yml')).toThrow(/a\.yml: invalid sidecar/);
    });

    it('rejects the scaffold placeholder, in any case, naming the file', () => {
        for (const alt of ['"TODO: describe this photo"', '"  todo"', 'Todo later']) {
            expect(() => parseSidecar('photography', `alt: ${alt}\n`, 'src/content/photography/a.yml')).toThrow(
                /src\/content\/photography\/a\.yml: invalid sidecar[\s\S]*real alt text/,
            );
        }
    });
});

describe('parseSidecars', () => {
    it('collects every invalid sidecar in one pass and keeps the valid ones', () => {
        const result = parseSidecars('photography', [
            { basename: 'a', source: 'dir/a.yml', text: 'alt: "TODO: describe this photo"\n' },
            { basename: 'b', source: 'dir/b.yml', text: 'alt: A harbor\norder: 3\n' },
            { basename: 'c', source: 'dir/c.yml', text: 'order: 1\n' },
            { basename: 'd', source: 'dir/d.yml', text: 'alt: "TODO"\n' },
        ]);
        expect(result.problems).toHaveLength(3);
        expect(result.problems[0]).toMatch(/dir\/a\.yml: invalid sidecar/);
        expect(result.problems[1]).toMatch(/dir\/c\.yml: invalid sidecar/);
        expect(result.problems[2]).toMatch(/dir\/d\.yml: invalid sidecar/);
        expect([...result.sidecars.keys()]).toEqual(['b']);
        expect(result.sidecars.get('b')).toEqual({ alt: 'A harbor', order: 3 });
    });
});

describe('acceptImages', () => {
    it('splits accepted images from rejected files, sorted', () => {
        expect(acceptImages(['b.jpg', 'a.JPEG', 'c.png', '.d.jpg', 'a.jpg'])).toEqual({
            images: [
                { file: 'a.JPEG', basename: 'a' },
                { file: 'b.jpg', basename: 'b' },
            ],
            problems: [
                '".d.jpg" is a hidden file: rename it.',
                '"a.jpg" has the same name as another image once the extension is removed.',
                '"c.png" is not accepted: only .jpg and .jpeg files are.',
            ],
        });
    });
});

describe('sidecarFileName', () => {
    it('adds .yml to the image basename', () => {
        expect(sidecarFileName('IMG_0001')).toBe('IMG_0001.yml');
    });
});

const entry = (key: string, taken: string | undefined, sha = 'a'.repeat(64)): GalleryEntry<{ taken?: string }> => ({
    key,
    width: 10,
    height: 10,
    thumbhash: 'x',
    sourceSha256: sha,
    processingVersion: PROCESSING_VERSION,
    alt: 'alt',
    caption: taken === undefined ? {} : { taken },
});
const curated = (key: string, taken: string | undefined, order?: number): CuratedEntry<{ taken?: string }> => ({
    entry: entry(key, taken),
    order,
});

describe('decideAction', () => {
    it('is new without an existing entry', () => {
        expect(decideAction(undefined, 'a'.repeat(64))).toBe('new');
    });

    it('is unchanged only when the hash and the processing version both match', () => {
        const existing = entry('photography/a.jpg', undefined);
        expect(decideAction(existing, 'a'.repeat(64))).toBe('unchanged');
        expect(decideAction(existing, 'b'.repeat(64))).toBe('changed');
        expect(decideAction({ ...existing, processingVersion: PROCESSING_VERSION - 1 }, 'a'.repeat(64))).toBe(
            'changed',
        );
    });

    // The place is derived from the source, not from the uploaded bytes, so an entry that has none yet is not
    // re-uploaded to gain one: the sync fills it in on the unchanged path.
    it('stays unchanged for an entry that has no location yet', () => {
        const existing = { ...entry('photography/a.jpg', undefined), caption: {} };
        expect(decideAction(existing, 'a'.repeat(64))).toBe('unchanged');
    });
});

describe('mergeGallery', () => {
    it('puts ordered entries first by order, then newest first, then by key', () => {
        const { entries } = mergeGallery(
            [
                curated('photography/old.jpg', '2020-01-01'),
                curated('photography/second.jpg', '2019-01-01', 2),
                curated('photography/new.jpg', '2026-01-01'),
                curated('photography/undated-b.jpg', undefined),
                curated('photography/first.jpg', '2018-01-01', 1),
                curated('photography/undated-a.jpg', undefined),
                curated('photography/tie-b.jpg', '2026-01-01', 2),
                curated('photography/same-day-b.jpg', '2025-05-05'),
                curated('photography/same-day-a.jpg', '2025-05-05'),
            ],
            [],
        );
        expect(entries.map(({ key }) => key.replace('photography/', ''))).toEqual([
            'first.jpg',
            'tie-b.jpg',
            'second.jpg',
            'new.jpg',
            'same-day-a.jpg',
            'same-day-b.jpg',
            'old.jpg',
            'undated-a.jpg',
            'undated-b.jpg',
        ]);
    });

    it('does not mutate its input', () => {
        const input = [curated('photography/b.jpg', '2020-01-01'), curated('photography/a.jpg', '2021-01-01')];
        mergeGallery(input, []);
        expect(input.map(({ entry: { key } }) => key)).toEqual(['photography/b.jpg', 'photography/a.jpg']);
    });

    it('reports entries whose source is gone', () => {
        const { entries, dropped } = mergeGallery(
            [curated('photography/kept.jpg', undefined)],
            [{ key: 'photography/kept.jpg' }, { key: 'photography/gone.jpg' }],
        );
        expect(entries).toHaveLength(1);
        expect(dropped).toEqual(['photography/gone.jpg']);
    });
});

describe('droppedNotices', () => {
    it('says the R2 object is not deleted', () => {
        expect(droppedNotices(['photography/gone.jpg'])).toEqual([
            'Dropped photography/gone.jpg: its source is gone. Its R2 object is NOT deleted; remove it by hand.',
        ]);
        expect(droppedNotices([])).toEqual([]);
    });
});

describe('serializeGallery', () => {
    it('writes 2-space JSON with a trailing newline', () => {
        expect(serializeGallery([])).toBe('[]\n');
        expect(serializeGallery([entry('photography/a.jpg', undefined)])).toMatch(/^\[\n {2}\{\n {4}"key"[\s\S]*\]\n$/);
    });
});

describe('r2UploadArgs', () => {
    it('builds one remote object put with explicit headers and no token', () => {
        const args = r2UploadArgs(BUCKET, 'photography/a.jpg', 'C:/tmp/a.jpg');
        expect(args).toEqual([
            'r2',
            'object',
            'put',
            'my-photos/photography/a.jpg',
            '--file',
            'C:/tmp/a.jpg',
            '--content-type',
            'image/jpeg',
            '--cache-control',
            'public, max-age=86400',
            '--remote',
        ]);
    });
});
