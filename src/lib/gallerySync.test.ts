import { describe, expect, it, vi } from 'vitest';

import type { GalleryEntry } from './gallery';
import type { PhotoLocation } from './location';
import { comparePhotographyEntries, type PhotographyCaption } from './photography';
import {
    acceptImages,
    decideAction,
    inTwoPasses,
    syncSummary,
    DEFAULT_BUCKET,
    defaultSourceDir,
    droppedNotices,
    galleryDataFile,
    galleryKey,
    mergeGallery,
    parseSidecar,
    parseSidecars,
    parseSyncArgs,
    pinLimitWarning,
    planInputs,
    PROCESSING_VERSION,
    r2UploadArgs,
    composeProcessedEntry,
    composeUnchangedEntry,
    extensionOfFile,
    keyExtension,
    R2_TOKEN_ENV,
    serializeGallery,
    sidecarDirectory,
    sidecarFileName,
    checkSourceFormat,
    withSidecarFlags,
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
        expect(galleryKey('photography', 'IMG_0001', 'jpg')).toBe('photography/IMG_0001.jpg');
        expect(galleryKey('art', 'piece', 'png')).toBe('art/piece.png');
    });
});

describe('planInputs', () => {
    it('pairs images with sidecars, sorted, and accepts jpg and jpeg in any case', () => {
        expect(planInputs(['b.JPEG', 'a.jpg', 'c.Jpg'], ['c.yml', 'a.yml', 'b.yml'], ['jpg'])).toEqual({
            images: [
                { file: 'a.jpg', basename: 'a', extension: 'jpg' },
                { file: 'b.JPEG', basename: 'b', extension: 'jpg' },
                { file: 'c.Jpg', basename: 'c', extension: 'jpg' },
            ],
            problems: [],
        });
    });

    it('reports every problem at once', () => {
        const { images, problems } = planInputs(
            ['a.jpg', 'a.jpeg', 'b.png', 'c.jpg', 'noextension', '.hidden.jpg'],
            ['a.yml', 'ghost.yml', 'c.yaml'],
            ['jpg'],
        );
        expect(images).toEqual([
            { file: 'a.jpeg', basename: 'a', extension: 'jpg' },
            { file: 'c.jpg', basename: 'c', extension: 'jpg' },
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
        expect(parseSidecar('photography', 'alt: A harbor at dawn\ncategory: landscape\norder: 2\n', 'a.yml')).toEqual({
            alt: 'A harbor at dawn',
            category: 'landscape',
            order: 2,
        });
    });

    it('parses a location override: a place, or false to hide it', () => {
        const place = 'location:\n  city: Lisbon\n  country: Portugal\n';
        expect(parseSidecar('photography', `alt: A harbor\ncategory: landscape\n${place}`, 'a.yml')).toEqual({
            alt: 'A harbor',
            category: 'landscape',
            location: { city: 'Lisbon', country: 'Portugal' },
        });
        expect(parseSidecar('photography', 'alt: A harbor\ncategory: landscape\nlocation: false\n', 'a.yml')).toEqual({
            alt: 'A harbor',
            category: 'landscape',
            location: false,
        });
    });

    it('leaves the location absent when the sidecar has none, so the sync derives it', () => {
        expect(parseSidecar('photography', 'alt: A harbor\ncategory: landscape\n', 'a.yml')).not.toHaveProperty(
            'location',
        );
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
            { basename: 'b', source: 'dir/b.yml', text: 'alt: A harbor\ncategory: landscape\norder: 3\n' },
            { basename: 'c', source: 'dir/c.yml', text: 'order: 1\n' },
            { basename: 'd', source: 'dir/d.yml', text: 'alt: "TODO"\n' },
        ]);
        expect(result.problems).toHaveLength(3);
        expect(result.problems[0]).toMatch(/dir\/a\.yml: invalid sidecar/);
        expect(result.problems[1]).toMatch(/dir\/c\.yml: invalid sidecar/);
        expect(result.problems[2]).toMatch(/dir\/d\.yml: invalid sidecar/);
        expect([...result.sidecars.keys()]).toEqual(['b']);
        expect(result.sidecars.get('b')).toEqual({ alt: 'A harbor', category: 'landscape', order: 3 });
    });
});

describe('parseSidecars for art', () => {
    const file = (basename: string, ...lines: string[]) => ({
        basename,
        source: `dir/${basename}.yml`,
        text: `${lines.join('\n')}\n`,
    });

    it('names every offender (placeholder alt, missing title, bad category) in one pass', () => {
        const result = parseSidecars('art', [
            file('a', 'alt: "TODO: describe"', 'title: A', 'category: drawing'),
            file('b', 'alt: Fine', 'category: drawing'),
            file('c', 'alt: Fine', 'title: C', 'category: sculpture'),
            file('d', 'alt: Fine', 'title: "  "', 'category: drawing'),
            file('e', 'alt: Fine', 'title: E', 'category: digital'),
        ]);
        expect(result.problems).toHaveLength(4);
        expect(result.problems.map((problem) => /dir\/(\w)\.yml/.exec(problem)?.[1])).toEqual(['a', 'b', 'c', 'd']);
        expect([...result.sidecars.keys()]).toEqual(['e']);
    });
});

describe('acceptImages', () => {
    it('splits accepted images from rejected files, sorted', () => {
        expect(acceptImages(['b.jpg', 'a.JPEG', 'c.png', '.d.jpg', 'a.jpg'], ['jpg'])).toEqual({
            images: [
                { file: 'a.JPEG', basename: 'a', extension: 'jpg' },
                { file: 'b.jpg', basename: 'b', extension: 'jpg' },
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
    category: 'landscape',
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
            comparePhotographyEntries,
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
        mergeGallery(input, [], comparePhotographyEntries);
        expect(input.map(({ entry: { key } }) => key)).toEqual(['photography/b.jpg', 'photography/a.jpg']);
    });

    it('reports entries whose source is gone', () => {
        const { entries, dropped } = mergeGallery(
            [curated('photography/kept.jpg', undefined)],
            [{ key: 'photography/kept.jpg' }, { key: 'photography/gone.jpg' }],
            comparePhotographyEntries,
        );
        expect(entries).toHaveLength(1);
        expect(dropped).toEqual(['photography/gone.jpg']);
    });
});

describe('withSidecarFlags', () => {
    const base = entry('photography/a.jpg', undefined);

    it('adds pin: true and the homeOrder when the sidecar sets them', () => {
        expect(withSidecarFlags(base, { pin: true, homeOrder: 2 })).toEqual({ ...base, pin: true, homeOrder: 2 });
        expect(withSidecarFlags(base, { pin: undefined, homeOrder: 0 })).toEqual({ ...base, homeOrder: 0 });
    });

    it('writes nothing when neither is set', () => {
        const result = withSidecarFlags(base, { pin: undefined, homeOrder: undefined });
        expect(result).toEqual(base);
        expect(Object.hasOwn(result, 'pin')).toBe(false);
        expect(Object.hasOwn(result, 'homeOrder')).toBe(false);
    });

    it('drops a pin and a homeOrder the previous entry carried when the sidecar no longer sets them', () => {
        const flagged = { ...base, pin: true as const, homeOrder: 4 };
        for (const pin of [undefined, false]) {
            const result = withSidecarFlags(flagged, { pin, homeOrder: undefined });
            expect(result).toEqual(base);
            expect(Object.hasOwn(result, 'pin')).toBe(false);
            expect(Object.hasOwn(result, 'homeOrder')).toBe(false);
        }
    });

    it('changes a homeOrder', () => {
        expect(withSidecarFlags({ ...base, homeOrder: 1 }, { pin: undefined, homeOrder: 7 })).toEqual({
            ...base,
            homeOrder: 7,
        });
    });
});

describe('checkSourceFormat', () => {
    it('passes when the bytes are the format the name claims', () => {
        expect(() => checkSourceFormat('a.png', 'png', 'png')).not.toThrow();
    });

    it('names the file when a PNG is called a JPEG or the reverse', () => {
        expect(() => checkSourceFormat('a.jpg', 'jpg', 'png')).toThrow(/"a.jpg" is really a PNG file, not a JPEG/);
        expect(() => checkSourceFormat('a.png', 'png', 'jpg')).toThrow(/"a.png" is really a JPEG file, not a PNG/);
    });
});

describe('pinLimitWarning', () => {
    const pinned = (key: string) => ({ ...entry(key, undefined), pin: true as const });

    it('says nothing at or under the limit', () => {
        expect(pinLimitWarning([], 2)).toBeUndefined();
        expect(
            pinLimitWarning(
                [pinned('photography/a.jpg'), entry('photography/b.jpg', undefined), pinned('photography/c.jpg')],
                2,
            ),
        ).toBeUndefined();
    });

    it('names the pinned photos past the limit, in order', () => {
        const warning = pinLimitWarning(
            [
                pinned('photography/a.jpg'),
                entry('photography/b.jpg', undefined),
                pinned('photography/c.jpg'),
                pinned('photography/d.jpg'),
            ],
            2,
        );
        expect(warning).toBe(
            'Warning: 3 photos are pinned, but the home page shows only the first 2. Not shown: photography/d.jpg.',
        );
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

describe('inTwoPasses', () => {
    it('plans every image before it executes any, then executes in order', async () => {
        const calls: string[] = [];
        const results = await inTwoPasses(
            ['a', 'b'],
            (image) => {
                calls.push(`plan ${image}`);
                return Promise.resolve(image.toUpperCase());
            },
            (planned) => {
                calls.push(`execute ${planned}`);
                return Promise.resolve(planned.toLowerCase());
            },
        );
        expect(calls).toEqual(['plan a', 'plan b', 'execute A', 'execute B']);
        expect(results).toEqual(['a', 'b']);
    });

    it('never executes when a later plan fails', async () => {
        const execute = vi.fn((planned: string) => Promise.resolve(planned));
        await expect(
            inTwoPasses(
                ['a', 'b'],
                (image) => (image === 'b' ? Promise.reject(new Error('lookup failed')) : Promise.resolve(image)),
                execute,
            ),
        ).rejects.toThrow('lookup failed');
        expect(execute).not.toHaveBeenCalled();
    });
});

describe('syncSummary', () => {
    const file = 'src/data/gallery/photography.json';

    it('says a dry run wrote nothing and how to publish', () => {
        expect(syncSummary({ new: 49, changed: 0, unchanged: 0 }, 0, 49, file, false)).toBe(
            `49 new, 0 changed, 0 unchanged, 0 dropped; 49 entries (dry run: ${file} not written; re-run with --upload to publish)`,
        );
    });

    it('names the data file after an upload run', () => {
        expect(syncSummary({ new: 1, changed: 2, unchanged: 3 }, 4, 6, file, true)).toBe(
            `1 new, 2 changed, 3 unchanged, 4 dropped; 6 entries in ${file}`,
        );
    });
});

describe('capability planning', () => {
    it('accepts png files only for a collection that takes png', () => {
        expect(acceptImages(['a.PNG', 'b.jpg'], ['jpg', 'png']).images).toEqual([
            { file: 'a.PNG', basename: 'a', extension: 'png' },
            { file: 'b.jpg', basename: 'b', extension: 'jpg' },
        ]);
        expect(acceptImages(['b.gif'], ['jpg', 'png']).problems).toEqual([
            '"b.gif" is not accepted: only .jpg, .jpeg and .png files are.',
        ]);
        expect(acceptImages(['a.png'], ['jpg']).problems).toEqual([
            '"a.png" is not accepted: only .jpg and .jpeg files are.',
        ]);
        expect(acceptImages(['a.gif'], ['png']).problems).toEqual(['"a.gif" is not accepted: only .png files are.']);
    });

    it('plans inputs with the collection extensions', () => {
        expect(planInputs(['a.png'], ['a.yml'], ['png'])).toEqual({
            images: [{ file: 'a.png', basename: 'a', extension: 'png' }],
            problems: [],
        });
        expect(planInputs(['a.png', 'a.jpg'], ['a.yml'], ['jpg', 'png']).problems).toEqual([
            '"a.png" has the same name as another image once the extension is removed.',
        ]);
    });

    it('names the format a file claims', () => {
        expect(extensionOfFile('a.JPEG')).toBe('jpg');
        expect(extensionOfFile('a.Png')).toBe('png');
        expect(extensionOfFile('a.gif')).toBeUndefined();
    });

    it('reads the extension of a key and refuses others', () => {
        expect(keyExtension('art/a.png')).toBe('png');
        expect(keyExtension('photography/a.jpg')).toBe('jpg');
        expect(() => keyExtension('art/a.gif')).toThrow(/only .jpg and .png/);
    });

    it('derives the content type from the key', () => {
        expect(r2UploadArgs(BUCKET, 'art/a.png', 'f.png')).toContain('image/png');
        expect(r2UploadArgs(BUCKET, 'photography/a.jpg', 'f.jpg')).toContain('image/jpeg');
        expect(() => r2UploadArgs(BUCKET, 'art/a.gif', 'f.gif')).toThrow();
    });
});

describe('entry composition', () => {
    const location = { city: 'Lisbon', country: 'Portugal', source: 'geonames' } as const;
    const sidecar = { alt: 'New alt', category: 'portrait', pin: true } as const;
    const camera = {
        readsCamera: true,
        captionFor: vi.fn(
            ({ camera: read, location: place }: { camera?: PhotographyCaption; location?: PhotoLocation }) => ({
                ...read,
                ...(place ? { location: place } : {}),
            }),
        ),
    };

    it('recomposes an unchanged entry from the sidecar, passing the previous caption as the camera', () => {
        const existing = { ...entry('photography/a.jpg', '2020-01-01'), alt: 'Old', category: 'landscape' };
        const result = composeUnchangedEntry(camera, { existing, sidecar, location });
        expect(result).toEqual({
            ...existing,
            alt: 'New alt',
            category: 'portrait',
            pin: true,
            caption: { taken: '2020-01-01', location },
        });
        expect(camera.captionFor).toHaveBeenLastCalledWith({ sidecar, camera: existing.caption, location });
    });

    it('passes no camera when the collection does not read it', () => {
        const none = { readsCamera: false, captionFor: vi.fn(() => ({})) };
        composeUnchangedEntry(none, { existing: entry('art/a.png', undefined), sidecar, location: undefined });
        expect(none.captionFor).toHaveBeenLastCalledWith({ sidecar, camera: undefined, location: undefined });
    });

    it('composes a new entry with the current processing version and drops a stale pin', () => {
        const processed = { width: 3, height: 4, thumbhash: 'th', caption: { taken: '2021-01-01' } };
        const result = composeProcessedEntry(camera, {
            key: 'photography/b.jpg',
            sourceSha256: 'b'.repeat(64),
            processed,
            sidecar: { alt: 'Alt', category: 'car' },
            location: undefined,
        });
        expect(result).toEqual({
            key: 'photography/b.jpg',
            width: 3,
            height: 4,
            thumbhash: 'th',
            sourceSha256: 'b'.repeat(64),
            processingVersion: PROCESSING_VERSION,
            alt: 'Alt',
            category: 'car',
            caption: { taken: '2021-01-01' },
        });
        expect(Object.hasOwn(result, 'pin')).toBe(false);
    });
});

describe('homeOrder in both branches', () => {
    const collection = { readsCamera: false, captionFor: () => ({}) };
    const base = entry('art/a.png', undefined);
    const processed = { width: 1, height: 1, thumbhash: 'th', caption: undefined };
    const processedEntry = (homeOrder: number | undefined) =>
        composeProcessedEntry(collection, {
            key: 'art/a.png',
            sourceSha256: 'a'.repeat(64),
            processed,
            sidecar: { alt: 'a', category: 'drawing', homeOrder },
            location: undefined,
        });

    it('sets, changes and removes homeOrder when an entry is composed from a changed or new source', () => {
        expect(processedEntry(3).homeOrder).toBe(3);
        expect(Object.hasOwn(processedEntry(undefined), 'homeOrder')).toBe(false);
    });

    it('sets, changes and removes homeOrder on the unchanged path', () => {
        const sidecar = { alt: 'a', category: 'drawing' } as const;
        const compose = (existing: typeof base, homeOrder: number | undefined) =>
            composeUnchangedEntry(collection, { existing, sidecar: { ...sidecar, homeOrder }, location: undefined });
        const set = compose(base, 1);
        expect(set.homeOrder).toBe(1);
        expect(compose(set, 5).homeOrder).toBe(5);
        const removed = compose(set, undefined);
        expect(Object.hasOwn(removed, 'homeOrder')).toBe(false);
    });
});
