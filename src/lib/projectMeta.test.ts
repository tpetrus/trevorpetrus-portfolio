import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
    commitsApiUrl,
    copyFor,
    createdFor,
    factsFromRepo,
    headFromCommits,
    lastUpdatedFor,
    mergeProjectMeta,
    parseProjectMeta,
    repoApiUrl,
    serializeProjectMeta,
} from './projectMeta';

const SHA = 'a'.repeat(40);
const entry = {
    created: '2025-01-02T03:04:05Z',
    updated: '2026-10-05T12:00:00Z',
    description: 'A demo.',
    tech: ['TypeScript'],
};
const commit = (date: string) => ({ sha: SHA, commit: { committer: { name: 'x', date } } });

describe('parseProjectMeta', () => {
    it('accepts an entry with and without capturedSha', () => {
        const meta = { plain: entry, captured: { ...entry, capturedSha: SHA } };
        expect(parseProjectMeta(meta)).toEqual(meta);
    });

    it.each([
        ['an extra key', { ...entry, pushed: 'x' }],
        ['a missing description', { ...entry, description: undefined }],
        ['a blank description', { ...entry, description: '  ' }],
        ['missing tech', { ...entry, tech: undefined }],
        ['empty tech', { ...entry, tech: [] }],
        ['an empty tech name', { ...entry, tech: [''] }],
        ['a missing creation date', { ...entry, created: undefined }],
        ['a bad creation date', { ...entry, created: 'long ago' }],
        ['a bad timestamp', { ...entry, updated: 'yesterday' }],
        ['a short capturedSha', { ...entry, capturedSha: 'abc' }],
        ['an uppercase capturedSha', { ...entry, capturedSha: 'A'.repeat(40) }],
    ])('rejects %s', (_name, bad) => {
        expect(() => parseProjectMeta({ demo: bad })).toThrow();
    });
});

describe('lastUpdatedFor and createdFor', () => {
    const meta = { demo: entry };

    it('return the recorded dates', () => {
        expect(lastUpdatedFor(meta, 'demo')?.toISOString()).toBe('2026-10-05T12:00:00.000Z');
        expect(createdFor(meta, 'demo')?.toISOString()).toBe('2025-01-02T03:04:05.000Z');
    });

    it('return undefined for an unknown slug', () => {
        expect(lastUpdatedFor(meta, 'other')).toBeUndefined();
        expect(createdFor(meta, 'other')).toBeUndefined();
    });
});

describe('copyFor', () => {
    it('returns the description and tech', () => {
        expect(copyFor({ demo: entry }, 'demo')).toEqual({ description: 'A demo.', tech: ['TypeScript'] });
    });

    it('throws naming the slug and the command when there is no entry', () => {
        expect(() => copyFor({}, 'demo')).toThrow(/"demo".*npm run sync:projects/);
    });
});

describe('repoApiUrl and factsFromRepo', () => {
    it('builds the repo endpoint', () => {
        expect(repoApiUrl('https://github.com/tpetrus/AudioVisualizer')).toBe(
            'https://api.github.com/repos/tpetrus/AudioVisualizer',
        );
    });

    it('takes created_at, the description and the topics', () => {
        expect(
            factsFromRepo({ id: 1, created_at: '2025-01-02T03:04:05Z', description: 'Hi', topics: ['react'] }),
        ).toEqual({ created: '2025-01-02T03:04:05Z', description: 'Hi', topics: ['react'] });
    });

    it('keeps a null description', () => {
        const facts = factsFromRepo({ created_at: '2025-01-02T03:04:05Z', description: null, topics: [] });
        expect(facts.description).toBeNull();
    });

    it('rejects an unexpected response', () => {
        expect(() => factsFromRepo({ message: 'Not Found' })).toThrow();
        expect(() => factsFromRepo({ created_at: '2025-01-02T03:04:05Z', description: null })).toThrow();
    });
});

describe('commitsApiUrl and headFromCommits', () => {
    it('asks for the newest 30 commits', () => {
        expect(commitsApiUrl('https://github.com/tpetrus/AudioVisualizer')).toBe(
            'https://api.github.com/repos/tpetrus/AudioVisualizer/commits?per_page=30',
        );
    });

    it('takes the sha and committer date of the first commit', () => {
        expect(headFromCommits([commit('2026-10-05T12:00:00Z')])).toEqual({ sha: SHA, date: '2026-10-05T12:00:00Z' });
    });

    describe('skipping bot commits', () => {
        const sha = (char: string) => char.repeat(40);
        const made = (
            char: string,
            message: string,
            author: { type: string } | null,
            date = '2026-10-01T00:00:00Z',
        ) => ({ sha: sha(char), author, commit: { message, committer: { date } } });
        const person = made('1', 'feat: a change\n\nbody', { type: 'User' }, '2026-09-01T00:00:00Z');

        it('chooses the newest human commit past bot commits', () => {
            const response = [
                made('2', 'chore: set version to 1.2.3', { type: 'Bot' }, '2026-10-03T00:00:00Z'),
                made('3', 'build(deps): bump x', { type: 'Bot' }, '2026-10-02T00:00:00Z'),
                person,
            ];
            expect(headFromCommits(response)).toEqual({ sha: sha('1'), date: '2026-09-01T00:00:00Z' });
        });

        it('skips the squashed sync commit', () => {
            const response = [made('2', 'chore(projects): refresh project data (#40)', { type: 'User' }), person];
            expect(headFromCommits(response).sha).toBe(sha('1'));
        });

        it('skips a merge of the sync branch but not of another branch', () => {
            const sync = made('2', 'Merge pull request #41 from tpetrus/bot/sync-projects\n\nchore', { type: 'User' });
            expect(headFromCommits([sync, person]).sha).toBe(sha('1'));
            const other = made('3', 'Merge pull request #42 from tpetrus/feat/x', { type: 'User' });
            expect(headFromCommits([sync, other, person]).sha).toBe(sha('3'));
        });

        it('counts a null author as a person', () => {
            expect(headFromCommits([made('2', 'fix: y', null), person]).sha).toBe(sha('2'));
        });

        it('counts a commit without the author key or a message as a person', () => {
            expect(headFromCommits([commit('2026-10-05T12:00:00Z')]).sha).toBe(SHA);
        });

        it('throws a clear error when every commit is a bot or sync commit', () => {
            const response = [
                made('2', 'chore: x', { type: 'Bot' }),
                made('3', 'chore(projects): refresh project data', { type: 'User' }),
            ];
            expect(() => headFromCommits(response)).toThrow(/None of the newest 2 commits was made by a person/);
        });
    });

    it('rejects an empty response and a bad shape', () => {
        expect(() => headFromCommits([])).toThrow(/no commits/);
        expect(() => headFromCommits({ message: 'Not Found' })).toThrow();
        const shortSha = [{ sha: 'abc', commit: { committer: { date: '2026-10-05T12:00:00Z' } } }];
        expect(() => headFromCommits(shortSha)).toThrow();
    });
});

describe('mergeProjectMeta', () => {
    it('adds or replaces an entry without mutating the input', () => {
        const meta = { a: entry, b: entry };
        const merged = mergeProjectMeta(meta, 'b', { ...entry, description: 'New.' });
        expect(merged.b?.description).toBe('New.');
        expect(meta.b.description).toBe('A demo.');
    });
});

describe('serializeProjectMeta', () => {
    it('sorts keys at every level, keeps array order and ends with a newline', () => {
        const out = serializeProjectMeta({ b: { ...entry, tech: ['Z', 'A'] }, a: entry });
        const parsed = JSON.parse(out) as Record<string, Record<string, unknown>>;
        expect(Object.keys(parsed)).toEqual(['a', 'b']);
        expect(Object.keys(parsed.a ?? {})).toEqual(['created', 'description', 'tech', 'updated']);
        expect(parsed.b?.tech).toEqual(['Z', 'A']);
        expect(out.endsWith('}\n')).toBe(true);
        expect(out).toContain('\n  "a": {\n    "created"');
    });

    it('round-trips the committed file byte for byte', () => {
        const text = readFileSync('src/data/project-meta.json', 'utf8');
        expect(serializeProjectMeta(parseProjectMeta(JSON.parse(text)))).toBe(text);
    });
});
