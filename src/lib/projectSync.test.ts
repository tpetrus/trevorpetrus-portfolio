import { describe, expect, it } from 'vitest';

import {
    checkRunsApiUrl,
    deployStateFromCheckRuns,
    formatCaptureFailure,
    formatCopyError,
    formatSyncSummary,
    parseSyncArgs,
    planCapture,
    SETTLE_HOURS,
    validateCopy,
    type CapturePlanInput,
    type ProjectReport,
    type RepoCopyInput,
} from './projectSync';
import { TOPIC_NAMES } from './topicMap';

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
    it('trims the About text and orders the topics by slug', () => {
        const result = validateCopy([input({ description: '  Hello.  ', topics: ['typescript', 'react'] })]);
        expect(result).toEqual({ ok: true, copy: { x: { description: 'Hello.', tech: ['React', 'TypeScript'] } } });
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
                // Unknown topics are reported in slug order too, like the mapped ones.
                { repo: 'r/c', topic: 'constructor' },
                { repo: 'r/c', topic: 'foo' },
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

describe('validateCopy tech order', () => {
    it('orders by slug by code unit, whatever order GitHub sent', () => {
        const a = validateCopy([input({ topics: ['typescript', 'react', 'astro', 'github-actions'] })]);
        const b = validateCopy([input({ topics: ['astro', 'github-actions', 'react', 'typescript'] })]);
        expect(a).toEqual(b);
        expect(b).toEqual({
            ok: true,
            copy: { x: { description: 'About x.', tech: ['Astro', 'GitHub Actions', 'React', 'TypeScript'] } },
        });
    });

    it('keeps a display name once, at its first place', () => {
        const names = TOPIC_NAMES as Record<string, string>;
        names['react-alias'] = 'React';
        try {
            const result = validateCopy([input({ topics: ['typescript', 'react-alias', 'react', 'astro'] })]);
            // Sorted: astro, react, react-alias, typescript.
            expect(result).toEqual({
                ok: true,
                copy: { x: { description: 'About x.', tech: ['Astro', 'React', 'TypeScript'] } },
            });
        } finally {
            delete names['react-alias'];
        }
    });

    it('keeps a topic that GitHub repeated once', () => {
        expect(validateCopy([input({ topics: ['react', 'react'] })])).toEqual({
            ok: true,
            copy: { x: { description: 'About x.', tech: ['React'] } },
        });
    });
});

describe('checkRunsApiUrl', () => {
    it('builds the check-runs URL of a commit', () => {
        expect(checkRunsApiUrl('https://github.com/tpetrus/AudioVisualizer', 'a'.repeat(40))).toBe(
            `https://api.github.com/repos/tpetrus/AudioVisualizer/commits/${'a'.repeat(40)}/check-runs?per_page=100`,
        );
    });

    it('rejects a URL that is not a GitHub repo', () => {
        expect(() => checkRunsApiUrl('https://example.com/x', 'a')).toThrow(/Not a GitHub repo URL/);
    });
});

describe('deployStateFromCheckRuns', () => {
    const runs = (...list: [string, string | null][]) => ({
        total_count: list.length,
        check_runs: list.map(([status, conclusion]) => ({ status, conclusion })),
    });

    it('is none without check runs', () => {
        expect(deployStateFromCheckRuns(runs())).toBe('none');
        expect(deployStateFromCheckRuns({ check_runs: [] })).toBe('none');
    });

    it('is green when every run passed, neutral or skipped', () => {
        expect(
            deployStateFromCheckRuns(
                runs(['completed', 'success'], ['completed', 'neutral'], ['completed', 'skipped']),
            ),
        ).toBe('green');
    });

    it.each(['failure', 'cancelled', 'timed_out', 'action_required', 'stale'])('is failed for a %s run', (verdict) => {
        expect(deployStateFromCheckRuns(runs(['completed', 'success'], ['completed', verdict]))).toBe('failed');
    });

    it('is failed for a completed run with no conclusion', () => {
        expect(deployStateFromCheckRuns(runs(['completed', null]))).toBe('failed');
    });

    it('is pending when a run has not completed and none failed', () => {
        expect(deployStateFromCheckRuns(runs(['completed', 'success'], ['in_progress', null]))).toBe('pending');
        expect(deployStateFromCheckRuns(runs(['queued', null]))).toBe('pending');
    });

    it('is failed when one failed even while another is pending', () => {
        expect(deployStateFromCheckRuns(runs(['in_progress', null], ['completed', 'failure']))).toBe('failed');
    });

    it.each([
        null,
        'x',
        {},
        { check_runs: 'x' },
        { check_runs: [{ status: 1, conclusion: null }] },
        { check_runs: [{}] },
    ])('throws on the wrong shape %j', (response) => {
        expect(() => deployStateFromCheckRuns(response)).toThrow();
    });
});

describe('planCapture', () => {
    const SHA_A = 'a'.repeat(40);
    const SHA_B = 'b'.repeat(40);
    const HEAD_DATE = '2026-10-05T12:00:00Z';
    const plan = (over: Partial<CapturePlanInput> = {}) =>
        planCapture({
            capturedSha: SHA_A,
            head: { sha: SHA_B, date: HEAD_DATE },
            thumbnailExists: true,
            deploy: 'green',
            force: false,
            now: new Date('2026-10-05T13:00:00Z'),
            ...over,
        });

    it('captures on --force, before every other rule', () => {
        expect(plan({ force: true, capturedSha: SHA_B, deploy: 'failed' })).toEqual({ capture: true, reason: 'force' });
    });

    it('captures a missing file even when the SHA matches or the deploy failed', () => {
        expect(plan({ thumbnailExists: false, capturedSha: SHA_B })).toEqual({
            capture: true,
            reason: 'missing-thumbnail',
        });
        expect(plan({ thumbnailExists: false, deploy: 'failed' })).toEqual({
            capture: true,
            reason: 'missing-thumbnail',
        });
    });

    it('skips an unchanged head whatever the deploy says', () => {
        for (const deploy of ['green', 'pending', 'failed', 'none'] as const) {
            expect(plan({ capturedSha: SHA_B, deploy })).toEqual({ capture: false, reason: 'up-to-date' });
        }
    });

    it('captures a new commit with a green deploy, and a first capture', () => {
        expect(plan()).toEqual({ capture: true, reason: 'new-commit' });
        expect(plan({ capturedSha: undefined })).toEqual({ capture: true, reason: 'new-commit' });
    });

    it('skips a new commit whose deploy failed or is pending', () => {
        expect(plan({ deploy: 'failed' })).toEqual({ capture: false, reason: 'deploy-failed' });
        expect(plan({ deploy: 'pending' })).toEqual({ capture: false, reason: 'deploy-pending' });
    });

    describe('without check runs', () => {
        const at = (hours: number) => new Date(Date.parse(HEAD_DATE) + hours * 3_600_000);

        it('waits until the head is SETTLE_HOURS old, inclusive', () => {
            expect(SETTLE_HOURS).toBe(6);
            expect(plan({ deploy: 'none', now: at(0) })).toEqual({ capture: false, reason: 'settling' });
            expect(plan({ deploy: 'none', now: new Date(at(6).getTime() - 1) })).toEqual({
                capture: false,
                reason: 'settling',
            });
            expect(plan({ deploy: 'none', now: at(6) })).toEqual({ capture: true, reason: 'new-commit' });
            expect(plan({ deploy: 'none', now: at(48) })).toEqual({ capture: true, reason: 'new-commit' });
        });
    });
});

describe('formatCaptureFailure', () => {
    it('names the project and joins the reasons', () => {
        expect(formatCaptureFailure('app', ['the site answered 502'])).toBe(
            'app: screenshot not updated: the site answered 502',
        );
        expect(formatCaptureFailure('app', ['the site answered 502', 'the pixels are nearly uniform'])).toBe(
            'app: screenshot not updated: the site answered 502; the pixels are nearly uniform',
        );
    });
});

describe('formatSyncSummary', () => {
    const reports: ProjectReport[] = [
        { slug: 'old', copyChanged: false, datesChanged: true, screenshot: { kind: 'not-a-target' } },
        {
            slug: 'a',
            copyChanged: true,
            datesChanged: false,
            screenshot: { kind: 'skipped', reason: 'deploy-pending' },
        },
        {
            slug: 'b',
            copyChanged: false,
            datesChanged: false,
            screenshot: { kind: 'captured', reason: 'new-commit', changed: true },
        },
        {
            slug: 'c',
            copyChanged: false,
            datesChanged: false,
            screenshot: { kind: 'captured', reason: 'force', changed: false },
        },
        {
            slug: 'd|e',
            copyChanged: true,
            datesChanged: true,
            screenshot: { kind: 'failed', reasons: ['the site answered 502', 'a | b'] },
        },
    ];

    it('renders a markdown table, one row per project in order', () => {
        expect(formatSyncSummary(reports, { check: false })).toBe(
            [
                '### Project sync',
                '',
                '| Project | Copy | Dates | Screenshot |',
                '| --- | --- | --- | --- |',
                '| old | unchanged | changed | - |',
                '| a | changed | unchanged | skipped (deploy-pending) |',
                '| b | unchanged | unchanged | captured (new-commit) |',
                '| c | unchanged | unchanged | captured (force), unchanged bytes |',
                '| d\\|e | changed | changed | **failed**: the site answered 502; a \\| b |',
                '',
            ].join('\n'),
        );
    });

    it('marks check mode in the heading', () => {
        expect(formatSyncSummary([], { check: true }).split('\n')[0]).toBe('### Project sync (--check)');
    });
});
