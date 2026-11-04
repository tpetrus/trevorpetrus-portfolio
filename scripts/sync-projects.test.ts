import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { EXIT_ERROR, EXIT_OK, EXIT_WOULD_CHANGE } from '../src/lib/projectSync';
import { main, type Capture, type Project, type SyncDeps } from './sync-projects';

const SHA = 'b'.repeat(40);
const OLD_SHA = 'c'.repeat(40);
const META = 'src/data/project-meta.json';
const AVIF = 'src/assets/projects/app.avif';
const HEAD_DATE = '2026-10-05T12:00:00Z';
const WIDTH = 2560;
const HEIGHT = 1600;

const archived: Project = {
    slug: 'old',
    title: 'Old',
    status: 'archived',
    repo: 'https://github.com/tpetrus/old',
    order: 2,
};
const live: Project = {
    slug: 'app',
    title: 'App',
    status: 'live',
    repo: 'https://github.com/tpetrus/app',
    subdomain: 'app',
    appSelector: '#app',
    order: 1,
};
const live2: Project = {
    slug: 'app2',
    title: 'App 2',
    status: 'live',
    repo: 'https://github.com/tpetrus/app2',
    subdomain: 'app2',
    appSelector: '#app',
    order: 3,
};

// A deterministic pseudo-random byte stream, so the images do not depend on Math.random.
function noise(seed: number): () => number {
    let state = seed;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state >>> 24;
    };
}

function rawPng(fill: (x: number, y: number, channel: number) => number): Promise<Buffer> {
    const data = Buffer.alloc(WIDTH * HEIGHT * 3);
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const at = (y * WIDTH + x) * 3;
            for (let channel = 0; channel < 3; channel++) data[at + channel] = fill(x, y, channel);
        }
    }
    return sharp(data, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
        .png()
        .toBuffer();
}

let png: Buffer;
let blank: Buffer;
let noisy: Buffer;
beforeAll(async () => {
    // A gradient with soft stripes and light grain: like a real page it has structure, and its AVIF lands between the
    // guard's limits.
    const grain = noise(7);
    png = await rawPng(
        (x, y, channel) =>
            (x * 0.06 + y * 0.04 + 50 * Math.sin(y / (40 + channel * 9)) + (grain() % 7) + channel * 20 + 60) & 255,
    );
    blank = await rawPng(() => 0x22);
    const full = noise(11);
    noisy = await rawPng(() => full());
}, 120_000);

interface Options {
    projects?: Project[];
    files?: Record<string, Buffer>;
    repos?: Record<string, unknown>;
    failUrl?: string;
    capture?: SyncDeps['capture'];
    checkRuns?: unknown;
    now?: string;
    headSha?: string;
}

const green = { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] };

function setup(options: Options = {}) {
    const files = new Map(Object.entries(options.files ?? {}));
    const writes: string[] = [];
    const captures: string[] = [];
    const logs: string[] = [];
    const errors: string[] = [];
    const summaries: string[] = [];
    const repoResponse = (description: string | null, topics: string[]) => ({
        created_at: '2025-01-02T03:04:05Z',
        description,
        topics,
    });
    const deps: SyncDeps = {
        listProjects: () => options.projects ?? [archived],
        fetchJson(url) {
            if (url === options.failUrl) return Promise.reject(new Error(`GitHub API answered 403 for ${url}`));
            if (url.includes('/check-runs')) return Promise.resolve(options.checkRuns ?? green);
            if (url.includes('/commits')) {
                return Promise.resolve([
                    {
                        sha: options.headSha ?? SHA,
                        author: { type: 'User' },
                        commit: { message: 'feat: x', committer: { date: HEAD_DATE } },
                    },
                ]);
            }
            const repo = url.replace('https://api.github.com/repos/', 'https://github.com/');
            return Promise.resolve(options.repos?.[repo] ?? repoResponse('About it.', ['typescript', 'react']));
        },
        readFile: (path) => files.get(path),
        writeFile(path, data) {
            writes.push(path);
            files.set(path, data);
        },
        capture:
            options.capture ??
            ((project) => {
                captures.push(project.url);
                return Promise.resolve({ png, status: 200 });
            }),
        now: () => new Date(options.now ?? '2026-10-05T13:00:00Z'),
        summary: (markdown) => summaries.push(markdown),
        log: (line) => logs.push(line),
        error: (line) => errors.push(line),
    };
    return { deps, files, writes, captures, logs, errors, summaries };
}

const metaOf = (files: Map<string, Buffer>) =>
    JSON.parse(files.get(META)!.toString('utf8')) as Record<string, Record<string, unknown>>;

const entry = (over: Record<string, unknown> = {}) => ({
    created: '2025-01-02T03:04:05Z',
    updated: HEAD_DATE,
    description: 'About it.',
    tech: ['React', 'TypeScript'],
    ...over,
});
const metaFile = (slug: string, over: Record<string, unknown> = {}) =>
    Buffer.from(JSON.stringify({ [slug]: entry(over) }));

describe('main', () => {
    it('writes the canonical meta with description and tech, ordered by topic slug', async () => {
        const run = setup();
        expect(await main([], run.deps)).toBe(EXIT_OK);
        expect(run.writes).toEqual([META]);
        expect(run.files.get(META)!.toString('utf8')).toBe(
            `${JSON.stringify(
                {
                    old: {
                        created: '2025-01-02T03:04:05Z',
                        description: 'About it.',
                        tech: ['React', 'TypeScript'],
                        updated: HEAD_DATE,
                    },
                },
                null,
                2,
            )}\n`,
        );
    });

    it('keeps a recorded capturedSha and other slugs', async () => {
        const existing = {
            old: {
                created: '2020-01-01T00:00:00Z',
                updated: '2020-01-01T00:00:00Z',
                description: 'Stale.',
                tech: ['Python'],
                capturedSha: OLD_SHA,
            },
            gone: {
                created: '2020-01-01T00:00:00Z',
                updated: '2020-01-01T00:00:00Z',
                description: 'Gone.',
                tech: ['Python'],
            },
        };
        const run = setup({ files: { [META]: Buffer.from(JSON.stringify(existing)) } });
        expect(await main([], run.deps)).toBe(EXIT_OK);
        const meta = metaOf(run.files);
        expect(meta.old).toMatchObject({
            description: 'About it.',
            tech: ['React', 'TypeScript'],
            capturedSha: OLD_SHA,
        });
        expect(meta.gone).toBeDefined();
    });

    it('reports a changed copy and dates against the old entry in the summary', async () => {
        const run = setup({ files: { [META]: metaFile('old', { description: 'Stale.' }) } });
        await main([], run.deps);
        expect(run.summaries).toHaveLength(1);
        expect(run.summaries[0]).toContain('| old | changed | unchanged | - |');
    });

    it('reports a changed tech list and changed dates', async () => {
        const run = setup({
            files: { [META]: metaFile('old', { tech: ['React'], created: '2020-01-01T00:00:00Z' }) },
        });
        await main([], run.deps);
        expect(run.summaries[0]).toContain('| old | changed | changed | - |');
    });

    describe('screenshots', () => {
        it('captures a first-time target, writes the AVIF and records capturedSha', async () => {
            const run = setup({ projects: [live] });
            expect(await main([], run.deps)).toBe(EXIT_OK);
            expect(run.captures).toEqual(['https://app.trevorpetr.us']);
            expect(run.writes).toEqual([META, AVIF]);
            expect(metaOf(run.files).app.capturedSha).toBe(SHA);
            expect((await sharp(run.files.get(AVIF)).metadata()).format).toBe('heif');
            expect(
                run.logs.some((line) => line.startsWith('Reminder: add "thumbnail: ../../assets/projects/app.avif"')),
            ).toBe(true);
            expect(run.summaries[0]).toContain('captured (missing-thumbnail)');
        }, 60_000);

        it('does not capture or write on a second run with identical inputs', async () => {
            const run = setup({ projects: [live, archived] });
            expect(await main([], run.deps)).toBe(EXIT_OK);
            expect(run.writes).toHaveLength(2);
            expect(run.captures).toEqual(['https://app.trevorpetr.us']);
            const again = setup({ projects: [live, archived], files: Object.fromEntries(run.files) });
            expect(await main([], again.deps)).toBe(EXIT_OK);
            expect(again.captures).toEqual([]);
            expect(again.writes).toEqual([]);
            expect(again.logs.some((line) => line.includes('unchanged'))).toBe(true);
            expect(again.summaries[0]).toContain('skipped (up-to-date)');
        }, 60_000);

        const existingFiles = (over: Record<string, unknown> = {}) => ({
            [META]: metaFile('app', { capturedSha: OLD_SHA, ...over }),
            [AVIF]: Buffer.from('old image'),
        });

        it('captures a new commit when the deploy is green', async () => {
            const run = setup({ projects: [live], files: existingFiles() });
            expect(await main([], run.deps)).toBe(EXIT_OK);
            expect(run.captures).toHaveLength(1);
            expect(metaOf(run.files).app.capturedSha).toBe(SHA);
            expect(run.writes).toEqual([META, AVIF]);
        }, 60_000);

        it.each([
            ['pending', { total_count: 1, check_runs: [{ status: 'in_progress', conclusion: null }] }],
            ['failed', { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'failure' }] }],
        ])('does not capture a new commit whose deploy is %s, and keeps capturedSha', async (word, checkRuns) => {
            const run = setup({ projects: [live], files: existingFiles(), checkRuns });
            expect(await main([], run.deps)).toBe(EXIT_OK);
            expect(run.captures).toEqual([]);
            expect(run.files.get(AVIF)!.toString()).toBe('old image');
            expect(metaOf(run.files).app.capturedSha).toBe(OLD_SHA);
            expect(run.summaries[0]).toContain(`skipped (deploy-${word})`);
        });

        it('waits for a commit without check runs and captures it after six hours', async () => {
            const none = { total_count: 0, check_runs: [] };
            const early = setup({
                projects: [live],
                files: existingFiles(),
                checkRuns: none,
                now: '2026-10-05T17:59:59Z',
            });
            expect(await main([], early.deps)).toBe(EXIT_OK);
            expect(early.captures).toEqual([]);
            expect(metaOf(early.files).app.capturedSha).toBe(OLD_SHA);
            expect(early.summaries[0]).toContain('skipped (settling)');

            const late = setup({
                projects: [live],
                files: existingFiles(),
                checkRuns: none,
                now: '2026-10-05T18:00:00Z',
            });
            expect(await main([], late.deps)).toBe(EXIT_OK);
            expect(late.captures).toHaveLength(1);
            expect(metaOf(late.files).app.capturedSha).toBe(SHA);
        }, 60_000);

        it('captures a missing file even when the SHA matches', async () => {
            const run = setup({ projects: [live], files: { [META]: metaFile('app', { capturedSha: SHA }) } });
            expect(await main([], run.deps)).toBe(EXIT_OK);
            expect(run.captures).toHaveLength(1);
            expect(run.writes).toEqual([META, AVIF]);
        }, 60_000);

        it('captures with --force even when everything is up to date', async () => {
            const files = { [META]: metaFile('app', { capturedSha: SHA }), [AVIF]: Buffer.from('old image') };
            const run = setup({ projects: [live], files });
            expect(await main(['--force'], run.deps)).toBe(EXIT_OK);
            expect(run.captures).toHaveLength(1);
            expect(run.summaries[0]).toContain('captured (force)');
        }, 60_000);

        it('names an unchanged-bytes capture', async () => {
            const first = setup({ projects: [live] });
            await main([], first.deps);
            const run = setup({ projects: [live], files: Object.fromEntries(first.files) });
            expect(await main(['--force'], run.deps)).toBe(EXIT_OK);
            expect(run.writes).toEqual([]);
            expect(run.summaries[0]).toContain('captured (force), unchanged bytes');
        }, 120_000);

        describe('a rejected or failed capture', () => {
            const expectKept = (run: ReturnType<typeof setup>, reasonPattern: RegExp) => {
                expect(run.writes).toEqual([META]);
                expect(run.files.get(AVIF)!.toString()).toBe('old image');
                expect(metaOf(run.files).app.capturedSha).toBe(OLD_SHA);
                expect(metaOf(run.files).app.updated).toBe(HEAD_DATE);
                expect(run.errors).toHaveLength(1);
                expect(run.errors[0]).toMatch(/^app: screenshot not updated: /);
                expect(run.errors[0]).toMatch(reasonPattern);
                expect(run.summaries).toHaveLength(1);
                expect(run.summaries[0]).toContain('| app |');
                expect(run.summaries[0]).toContain('**failed**');
            };
            const files = () => ({
                [META]: metaFile('app', { capturedSha: OLD_SHA, updated: '2020-01-01T00:00:00Z' }),
                [AVIF]: Buffer.from('old image'),
            });
            const withCapture = (capture: Capture | Error) =>
                setup({
                    projects: [live],
                    files: files(),
                    capture: () => (capture instanceof Error ? Promise.reject(capture) : Promise.resolve(capture)),
                });

            it('rejects a blank page', async () => {
                const run = withCapture({ png: blank, status: 200 });
                expect(await main([], run.deps)).toBe(EXIT_ERROR);
                expectKept(run, /nearly uniform/);
            }, 60_000);

            it('rejects an error status', async () => {
                const run = withCapture({ png, status: 502 });
                expect(await main([], run.deps)).toBe(EXIT_ERROR);
                expectKept(run, /the site answered 502/);
            }, 60_000);

            it('rejects a missing response', async () => {
                const run = withCapture({ png, status: null });
                expect(await main([], run.deps)).toBe(EXIT_ERROR);
                expectKept(run, /no response/);
            }, 60_000);

            it('rejects a wrong size', async () => {
                const small = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } })
                    .png()
                    .toBuffer();
                const run = withCapture({ png: small, status: 200 });
                expect(await main([], run.deps)).toBe(EXIT_ERROR);
                expectKept(run, /expected 2560x1600/);
            });

            it('rejects an AVIF over the size limit', async () => {
                const run = withCapture({ png: noisy, status: 200 });
                expect(await main([], run.deps)).toBe(EXIT_ERROR);
                expectKept(run, /over the 500\.0 kB maximum/);
            }, 120_000);

            it('rejects an unreadable image and reports the error message', async () => {
                const run = withCapture({ png: Buffer.from('not an image'), status: 200 });
                expect(await main([], run.deps)).toBe(EXIT_ERROR);
                expectKept(run, /unsupported image format/);
            });

            it('reports a capture that throws', async () => {
                const run = withCapture(new Error('Timeout 30000ms exceeded waiting for #app'));
                expect(await main([], run.deps)).toBe(EXIT_ERROR);
                expectKept(run, /Timeout 30000ms exceeded waiting for #app/);
            });

            it('writes the other project and still exits 1', async () => {
                const run = setup({
                    projects: [live, live2],
                    capture(project) {
                        if (project.slug === 'app') return Promise.reject(new Error('boom'));
                        run.captures.push(project.url);
                        return Promise.resolve({ png, status: 200 });
                    },
                });
                expect(await main([], run.deps)).toBe(EXIT_ERROR);
                expect(run.captures).toEqual(['https://app2.trevorpetr.us']);
                expect(run.writes).toEqual([META, 'src/assets/projects/app2.avif']);
                expect(metaOf(run.files).app.capturedSha).toBeUndefined();
                expect(metaOf(run.files).app2.capturedSha).toBe(SHA);
                expect(run.errors).toEqual(['app: screenshot not updated: boom']);
                expect(run.summaries[0]).toContain('| app | changed | changed | **failed**: boom |');
                expect(run.summaries[0]).toContain('| app2 | changed | changed | captured (missing-thumbnail) |');
            }, 60_000);

            it('exits 1 and writes nothing with --check', async () => {
                const run = setup({
                    projects: [live],
                    files: files(),
                    capture: () => Promise.resolve({ png: blank, status: 200 }),
                });
                expect(await main(['--check'], run.deps)).toBe(EXIT_ERROR);
                expect(run.writes).toEqual([]);
                expect(run.errors).toHaveLength(1);
                expect(run.summaries[0]).toContain('### Project sync (--check)');
            }, 60_000);
        });
    });

    it('accepts --force', async () => {
        const run = setup();
        expect(await main(['--force'], run.deps)).toBe(EXIT_OK);
    });

    it('writes and captures nothing when any copy is bad, naming every repo and field', async () => {
        const run = setup({
            projects: [live, archived],
            repos: {
                'https://github.com/tpetrus/app': { created_at: '2025-01-02T03:04:05Z', description: null, topics: [] },
                'https://github.com/tpetrus/old': {
                    created_at: '2025-01-02T03:04:05Z',
                    description: 'Ok',
                    topics: ['nope'],
                },
            },
        });
        expect(await main([], run.deps)).toBe(EXIT_ERROR);
        expect(run.writes).toEqual([]);
        expect(run.captures).toEqual([]);
        expect(run.summaries).toEqual([]);
        expect(run.errors).toEqual([
            'https://github.com/tpetrus/app: the GitHub About description is empty',
            'https://github.com/tpetrus/app: the GitHub repo has no topics',
            'https://github.com/tpetrus/old: topic "nope" is not in src/lib/topicMap.ts',
        ]);
    });

    it('returns 1 for an unknown argument and writes nothing', async () => {
        const run = setup();
        expect(await main(['--bogus'], run.deps)).toBe(EXIT_ERROR);
        expect(run.errors[0]).toContain('--bogus');
        expect(run.writes).toEqual([]);
    });

    it('returns 1 naming the repo when GitHub fails, and writes nothing', async () => {
        const run = setup({
            projects: [live, archived],
            failUrl: 'https://api.github.com/repos/tpetrus/old/commits?per_page=30',
        });
        expect(await main([], run.deps)).toBe(EXIT_ERROR);
        expect(run.errors).toHaveLength(1);
        expect(run.errors[0]).toMatch(/^https:\/\/github\.com\/tpetrus\/old: GitHub API answered 403/);
        expect(run.writes).toEqual([]);
        expect(run.captures).toEqual([]);
    });

    it('returns 1 naming the repo when the check-runs request fails, and writes nothing', async () => {
        const run = setup({
            projects: [live],
            failUrl: `https://api.github.com/repos/tpetrus/app/commits/${SHA}/check-runs?per_page=100`,
        });
        expect(await main([], run.deps)).toBe(EXIT_ERROR);
        expect(run.errors).toHaveLength(1);
        expect(run.errors[0]).toMatch(/^https:\/\/github\.com\/tpetrus\/app: GitHub API answered 403/);
        expect(run.writes).toEqual([]);
        expect(run.captures).toEqual([]);
    });

    it('returns 1 when the check-runs response has the wrong shape', async () => {
        const run = setup({ projects: [live], checkRuns: { nope: true } });
        expect(await main([], run.deps)).toBe(EXIT_ERROR);
        expect(run.writes).toEqual([]);
    });

    it('returns 1 when every recent commit is a bot commit', async () => {
        const run = setup({ projects: [archived] });
        const fetchJson = run.deps.fetchJson.bind(run.deps);
        run.deps.fetchJson = (url) =>
            url.includes('/commits')
                ? Promise.resolve([
                      { sha: SHA, author: { type: 'Bot' }, commit: { message: 'x', committer: { date: HEAD_DATE } } },
                  ])
                : fetchJson(url);
        expect(await main([], run.deps)).toBe(EXIT_ERROR);
        expect(run.errors[0]).toMatch(/^https:\/\/github\.com\/tpetrus\/old: None of the newest 1 commits/);
        expect(run.writes).toEqual([]);
    });

    it('returns 1 for a malformed existing meta file', async () => {
        const run = setup({ files: { [META]: Buffer.from('{"old": {}}') } });
        expect(await main([], run.deps)).toBe(EXIT_ERROR);
        expect(run.writes).toEqual([]);
    });

    describe('--check', () => {
        it('returns 2 when an output would change and never writes', async () => {
            const run = setup({ projects: [live] });
            expect(await main(['--check'], run.deps)).toBe(EXIT_WOULD_CHANGE);
            expect(run.writes).toEqual([]);
            expect(run.logs).toContain(`${META}: would change`);
            expect(run.logs.some((line) => line.startsWith(`${AVIF}: would change`))).toBe(true);
            expect(run.summaries[0]).toContain('### Project sync (--check)');
        }, 60_000);

        it('returns 0 when nothing would change', async () => {
            const first = setup();
            await main([], first.deps);
            const run = setup({ files: Object.fromEntries(first.files) });
            expect(await main(['--check'], run.deps)).toBe(EXIT_OK);
            expect(run.writes).toEqual([]);
            expect(run.logs).toContain(`${META}: unchanged`);
        });
    });
});
