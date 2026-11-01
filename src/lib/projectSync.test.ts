import { describe, expect, it } from 'vitest';

import { formatCopyError, parseSyncArgs, validateCopy, type RepoCopyInput } from './projectSync';

const input = (over: Partial<RepoCopyInput> = {}): RepoCopyInput => ({
    slug: 'x',
    repo: 'https://github.com/tpetrus/x',
    description: 'About x.',
    topics: ['react'],
    ...over,
});

describe('parseSyncArgs', () => {
    it('defaults both flags to false', () => {
        expect(parseSyncArgs([])).toEqual({ force: false, check: false });
    });

    it('reads each flag and both together in any order', () => {
        expect(parseSyncArgs(['--force'])).toEqual({ force: true, check: false });
        expect(parseSyncArgs(['--check'])).toEqual({ force: false, check: true });
        expect(parseSyncArgs(['--check', '--force'])).toEqual({ force: true, check: true });
    });

    it.each(['--force', '--check'])('rejects a duplicate %s', (flag) => {
        expect(() => parseSyncArgs([flag, flag])).toThrow(flag);
    });

    it('rejects an unknown argument and names it', () => {
        expect(() => parseSyncArgs(['--nope'])).toThrow(/--nope/);
        expect(() => parseSyncArgs(['extra'])).toThrow(/extra/);
    });
});

describe('validateCopy', () => {
    it('trims the About text and maps the topics in order', () => {
        const result = validateCopy([input({ description: '  Hello.  ', topics: ['typescript', 'react'] })]);
        expect(result).toEqual({ ok: true, copy: { x: { description: 'Hello.', tech: ['TypeScript', 'React'] } } });
    });

    it('accepts an empty input', () => {
        expect(validateCopy([])).toEqual({ ok: true, copy: {} });
    });

    it.each([null, '', '   \n'])('reports an empty About (%j)', (description) => {
        expect(validateCopy([input({ description })])).toEqual({
            ok: false,
            errors: [{ repo: 'https://github.com/tpetrus/x', field: 'description' }],
        });
    });

    it('reports empty topics', () => {
        expect(validateCopy([input({ topics: [] })])).toEqual({
            ok: false,
            errors: [{ repo: 'https://github.com/tpetrus/x', field: 'topics' }],
        });
    });

    it('reports every error of every repo in input order and never guesses a topic', () => {
        const result = validateCopy([
            input({ slug: 'a', repo: 'r/a', description: null, topics: [] }),
            input({ slug: 'b', repo: 'r/b' }),
            input({ slug: 'c', repo: 'r/c', topics: ['react', 'foo', 'constructor'] }),
        ]);
        expect(result).toEqual({
            ok: false,
            errors: [
                { repo: 'r/a', field: 'description' },
                { repo: 'r/a', field: 'topics' },
                { repo: 'r/c', topic: 'foo' },
                { repo: 'r/c', topic: 'constructor' },
            ],
        });
    });
});

describe('formatCopyError', () => {
    it('names the repo and the empty field', () => {
        expect(formatCopyError({ repo: 'https://github.com/tpetrus/x', field: 'description' })).toBe(
            'https://github.com/tpetrus/x: the GitHub About description is empty',
        );
        expect(formatCopyError({ repo: 'https://github.com/tpetrus/x', field: 'topics' })).toBe(
            'https://github.com/tpetrus/x: the GitHub repo has no topics',
        );
    });

    it('names the unmapped topic', () => {
        expect(formatCopyError({ repo: 'https://github.com/tpetrus/x', topic: 'foo' })).toBe(
            'https://github.com/tpetrus/x: topic "foo" is not in src/lib/topicMap.ts',
        );
    });
});
