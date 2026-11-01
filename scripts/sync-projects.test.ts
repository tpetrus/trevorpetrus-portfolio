import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { EXIT_ERROR, EXIT_OK, EXIT_WOULD_CHANGE } from '../src/lib/projectSync';
import { main, type Project, type SyncDeps } from './sync-projects';

const SHA = 'b'.repeat(40);
const META = 'src/data/project-meta.json';

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

let png: Buffer;
beforeAll(async () => {
    png = await sharp({ create: { width: 2560, height: 1600, channels: 3, background: '#223344' } })
        .png()
        .toBuffer();
});

interface Options {
    projects?: Project[];
    files?: Record<string, Buffer>;
    repos?: Record<string, unknown>;
    failUrl?: string;
    capture?: SyncDeps['capture'];
}

function setup(options: Options = {}) {
    const files = new Map(Object.entries(options.files ?? {}));
    const writes: string[] = [];
    const captures: string[] = [];
    const logs: string[] = [];
    const errors: string[] = [];
    const repoResponse = (description: string | null, topics: string[]) => ({
        created_at: '2025-01-02T03:04:05Z',
        description,
        topics,
    });
    const deps: SyncDeps = {
        listProjects: () => options.projects ?? [archived],
        fetchJson(url) {
            if (url === options.failUrl) return Promise.reject(new Error(`GitHub API answered 403 for ${url}`));
            if (url.includes('/commits')) {
                return Promise.resolve([{ sha: SHA, commit: { committer: { date: '2026-10-05T12:00:00Z' } } }]);
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
                return Promise.resolve(png);
            }),
        log: (line) => logs.push(line),
        error: (line) => errors.push(line),
    };
    return { deps, files, writes, captures, logs, errors };
}

const metaOf = (files: Map<string, Buffer>) => JSON.parse(files.get(META)!.toString('utf8')) as Record<string, unknown>;

describe('main', () => {
    it('writes the canonical meta with description and tech', async () => {
        const run = setup();
        expect(await main([], run.deps)).toBe(EXIT_OK);
        expect(run.writes).toEqual([META]);
        expect(run.files.get(META)!.toString('utf8')).toBe(
            `${JSON.stringify(
                {
                    old: {
                        created: '2025-01-02T03:04:05Z',
                        description: 'About it.',
                        tech: ['TypeScript', 'React'],
                        updated: '2026-10-05T12:00:00Z',
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
                capturedSha: 'c'.repeat(40),
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
        const meta = metaOf(run.files) as Record<string, Record<string, unknown>>;
        expect(meta.old).toMatchObject({
            description: 'About it.',
            tech: ['TypeScript', 'React'],
            capturedSha: 'c'.repeat(40),
        });
        expect(meta.gone).toBeDefined();
    });

    it('writes nothing on a second run with identical inputs', async () => {
        const run = setup({ projects: [live, archived] });
        expect(await main([], run.deps)).toBe(EXIT_OK);
        expect(run.writes).toHaveLength(2);
        expect(run.captures).toEqual(['https://app.trevorpetr.us']);
        const again = setup({ projects: [live, archived], files: Object.fromEntries(run.files) });
        expect(await main([], again.deps)).toBe(EXIT_OK);
        expect(again.writes).toEqual([]);
        expect(again.logs.some((line) => line.includes('unchanged'))).toBe(true);
    });

    it('writes the screenshot as AVIF and reminds about a missing thumbnail', async () => {
        const run = setup({ projects: [live] });
        await main([], run.deps);
        expect(run.writes).toEqual([META, 'src/assets/projects/app.avif']);
        expect((await sharp(run.files.get('src/assets/projects/app.avif')).metadata()).format).toBe('heif');
        expect(
            run.logs.some((line) => line.startsWith('Reminder: add "thumbnail: ../../assets/projects/app.avif"')),
        ).toBe(true);
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
            failUrl: 'https://api.github.com/repos/tpetrus/old/commits?per_page=1',
        });
        expect(await main([], run.deps)).toBe(EXIT_ERROR);
        expect(run.errors).toHaveLength(1);
        expect(run.errors[0]).toMatch(/^https:\/\/github\.com\/tpetrus\/old: GitHub API answered 403/);
        expect(run.writes).toEqual([]);
        expect(run.captures).toEqual([]);
    });

    it('returns 1 with nothing written when a screenshot has the wrong size', async () => {
        const small = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } })
            .png()
            .toBuffer();
        const run = setup({ projects: [live], capture: () => Promise.resolve(small) });
        expect(await main([], run.deps)).toBe(EXIT_ERROR);
        expect(run.errors[0]).toMatch(
            /^https:\/\/github\.com\/tpetrus\/app: https:\/\/app\.trevorpetr\.us: expected a 2560x1600/,
        );
        expect(run.writes).toEqual([]);
    });

    it('returns 1 when the screenshot is over the size limit', async () => {
        const noise = await sharp(
            Buffer.from(Array.from({ length: 2560 * 1600 * 3 }, (_, i) => (i * 2654435761) >>> 24)),
            {
                raw: { width: 2560, height: 1600, channels: 3 },
            },
        )
            .png()
            .toBuffer();
        const run = setup({ projects: [live], capture: () => Promise.resolve(noise) });
        expect(await main([], run.deps)).toBe(EXIT_ERROR);
        expect(run.errors[0]).toMatch(/over 500\.0 kB/);
        expect(run.writes).toEqual([]);
    }, 60_000);

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
        });

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
