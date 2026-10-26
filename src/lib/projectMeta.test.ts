import { describe, expect, it } from 'vitest';

import {
    commitsApiUrl,
    createdFor,
    createdFromRepo,
    lastUpdatedFor,
    mergeProjectMeta,
    parseProjectMeta,
    repoApiUrl,
    serializeProjectMeta,
    updatedFromCommits,
} from './projectMeta';

const commit = (date: string) => ({ sha: 'abc', commit: { committer: { name: 'x', date } } });

describe('parseProjectMeta', () => {
    it('accepts a map of slugs to ISO timestamps', () => {
        const meta = { demo: { updated: '2026-10-05T12:00:00Z' } };
        expect(parseProjectMeta(meta)).toEqual(meta);
    });

    it('accepts an entry with a creation date and one without', () => {
        const meta = {
            old: { updated: '2026-10-05T12:00:00Z' },
            current: { updated: '2026-10-05T12:00:00Z', created: '2025-01-02T03:04:05Z' },
        };
        expect(parseProjectMeta(meta)).toEqual(meta);
    });

    it('rejects a bad creation date', () => {
        expect(() => parseProjectMeta({ demo: { updated: '2026-10-05T12:00:00Z', created: 'long ago' } })).toThrow();
    });

    it('rejects a bad timestamp', () => {
        expect(() => parseProjectMeta({ demo: { updated: 'yesterday' } })).toThrow();
    });
});

describe('lastUpdatedFor', () => {
    const meta = { demo: { updated: '2026-10-05T12:00:00Z' } };

    it('returns the recorded date', () => {
        expect(lastUpdatedFor(meta, 'demo')?.toISOString()).toBe('2026-10-05T12:00:00.000Z');
    });

    it('returns undefined when nothing is recorded', () => {
        expect(lastUpdatedFor(meta, 'other')).toBeUndefined();
    });
});

describe('createdFor', () => {
    const meta = {
        dated: { updated: '2026-10-05T12:00:00Z', created: '2025-01-02T03:04:05Z' },
        undated: { updated: '2026-10-05T12:00:00Z' },
    };

    it('returns the recorded creation date', () => {
        expect(createdFor(meta, 'dated')?.toISOString()).toBe('2025-01-02T03:04:05.000Z');
    });

    it('returns undefined for an entry without one and for an unknown slug', () => {
        expect(createdFor(meta, 'undated')).toBeUndefined();
        expect(createdFor(meta, 'other')).toBeUndefined();
    });
});

describe('repoApiUrl and createdFromRepo', () => {
    it('builds the repo endpoint', () => {
        expect(repoApiUrl('https://github.com/tpetrus/AudioVisualizer')).toBe(
            'https://api.github.com/repos/tpetrus/AudioVisualizer',
        );
    });

    it('takes created_at from the response', () => {
        expect(createdFromRepo({ id: 1, created_at: '2025-01-02T03:04:05Z' })).toBe('2025-01-02T03:04:05Z');
    });

    it('rejects a response without created_at', () => {
        expect(() => createdFromRepo({ message: 'Not Found' })).toThrow();
    });
});

describe('commitsApiUrl', () => {
    it('asks for the single newest commit', () => {
        expect(commitsApiUrl('https://github.com/tpetrus/AudioVisualizer')).toBe(
            'https://api.github.com/repos/tpetrus/AudioVisualizer/commits?per_page=1',
        );
    });
});

describe('updatedFromCommits', () => {
    it('takes the committer date of the first commit', () => {
        expect(updatedFromCommits([commit('2026-10-05T12:00:00Z')])).toBe('2026-10-05T12:00:00Z');
    });

    it('rejects an empty response', () => {
        expect(() => updatedFromCommits([])).toThrow(/no commits/);
    });

    it('rejects an unexpected shape', () => {
        expect(() => updatedFromCommits({ message: 'Not Found' })).toThrow();
    });
});

describe('mergeProjectMeta', () => {
    it('adds or replaces an entry and sorts the keys', () => {
        const merged = mergeProjectMeta(
            { b: { updated: '2026-01-01T00:00:00Z' }, a: { updated: '2026-01-01T00:00:00Z' } },
            'b',
            { updated: '2026-02-02T00:00:00Z', created: '2025-01-01T00:00:00Z' },
        );
        expect(Object.keys(merged)).toEqual(['a', 'b']);
        expect(merged.b).toEqual({ updated: '2026-02-02T00:00:00Z', created: '2025-01-01T00:00:00Z' });
    });
});

describe('serializeProjectMeta', () => {
    it('writes two-space JSON with a trailing newline', () => {
        expect(serializeProjectMeta({ a: { updated: '2026-01-01T00:00:00Z' } })).toBe(
            '{\n  "a": {\n    "updated": "2026-01-01T00:00:00Z"\n  }\n}\n',
        );
    });
});
