import { describe, expect, it } from 'vitest';

import {
    commitsApiUrl,
    lastUpdatedFor,
    mergeProjectMeta,
    metaFromCommits,
    parseProjectMeta,
    serializeProjectMeta,
} from './projectMeta';

const commit = (date: string) => ({ sha: 'abc', commit: { committer: { name: 'x', date } } });

describe('parseProjectMeta', () => {
    it('accepts a map of slugs to ISO timestamps', () => {
        const meta = { demo: { updated: '2026-10-05T12:00:00Z' } };
        expect(parseProjectMeta(meta)).toEqual(meta);
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

describe('commitsApiUrl', () => {
    it('asks for the single newest commit', () => {
        expect(commitsApiUrl('https://github.com/tpetrus/AudioVisualizer')).toBe(
            'https://api.github.com/repos/tpetrus/AudioVisualizer/commits?per_page=1',
        );
    });
});

describe('metaFromCommits', () => {
    it('takes the committer date of the first commit', () => {
        expect(metaFromCommits([commit('2026-10-05T12:00:00Z')])).toEqual({ updated: '2026-10-05T12:00:00Z' });
    });

    it('rejects an empty response', () => {
        expect(() => metaFromCommits([])).toThrow(/no commits/);
    });

    it('rejects an unexpected shape', () => {
        expect(() => metaFromCommits({ message: 'Not Found' })).toThrow();
    });
});

describe('mergeProjectMeta', () => {
    it('adds or replaces an entry and sorts the keys', () => {
        const merged = mergeProjectMeta(
            { b: { updated: '2026-01-01T00:00:00Z' }, a: { updated: '2026-01-01T00:00:00Z' } },
            'b',
            { updated: '2026-02-02T00:00:00Z' },
        );
        expect(Object.keys(merged)).toEqual(['a', 'b']);
        expect(merged.b?.updated).toBe('2026-02-02T00:00:00Z');
    });
});

describe('serializeProjectMeta', () => {
    it('writes two-space JSON with a trailing newline', () => {
        expect(serializeProjectMeta({ a: { updated: '2026-01-01T00:00:00Z' } })).toBe(
            '{\n  "a": {\n    "updated": "2026-01-01T00:00:00Z"\n  }\n}\n',
        );
    });
});
