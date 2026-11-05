import { describe, expect, it } from 'vitest';

import {
    checkRunsApiUrl,
    DEPLOY_CHECK_PREFIX,
    deployStateFromCheckRuns,
    formatCaptureFailure,
    formatCopyError,
    formatDeploySkipWarning,
    formatSyncSummary,
    MAX_CHECK_RUN_PAGES,
    nextCheckRunsPage,
    parseCheckRunsPage,
    parseSyncArgs,
    planCapture,
    planCaptureWithoutDeploy,
    SETTLE_HOURS,
    STALE_RUN_HOURS,
    validateCopy,
    type CapturePlanInput,
    type CheckRun,
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
    it('builds the check-runs URL of a commit page', () => {
        expect(checkRunsApiUrl('https://github.com/tpetrus/AudioVisualizer', 'a'.repeat(40), 2)).toBe(
            `https://api.github.com/repos/tpetrus/AudioVisualizer/commits/${'a'.repeat(40)}/check-runs?filter=latest&per_page=100&page=2`,
        );
    });

    it('rejects a URL that is not a GitHub repo', () => {
        expect(() => checkRunsApiUrl('https://example.com/x', 'a', 1)).toThrow(/Not a GitHub repo URL/);
    });
});

describe('parseCheckRunsPage', () => {
    const raw = { id: 1, name: 'ci', status: 'completed', conclusion: 'success', started_at: '2026-10-05T12:00:00Z' };

    it('reads the total and maps started_at to startedAt', () => {
        expect(parseCheckRunsPage({ total_count: 3, check_runs: [{ ...raw, extra: true }], other: 1 })).toEqual({
            totalCount: 3,
            runs: [
                { id: 1, name: 'ci', status: 'completed', conclusion: 'success', startedAt: '2026-10-05T12:00:00Z' },
            ],
        });
    });

    it('accepts a null or missing started_at as null', () => {
        const { started_at: _omitted, ...without } = raw;
        const page = parseCheckRunsPage({ total_count: 2, check_runs: [{ ...raw, started_at: null }, without] });
        expect(page.runs.map((run) => run.startedAt)).toEqual([null, null]);
    });

    it.each([
        null,
        'x',
        {},
        { check_runs: [] },
        { total_count: 0 },
        { total_count: 'a', check_runs: [] },
        { total_count: 1, check_runs: 'x' },
        { total_count: 1, check_runs: [{ ...raw, id: 'a' }] },
        { total_count: 1, check_runs: [{ ...raw, name: 1 }] },
        { total_count: 1, check_runs: [{ ...raw, conclusion: 1 }] },
        { total_count: 1, check_runs: [{ status: 'completed' }] },
    ])('throws on the wrong shape %j', (response) => {
        expect(() => parseCheckRunsPage(response)).toThrow();
    });
});

describe('nextCheckRunsPage', () => {
    it('stops when every run has been read', () => {
        expect(nextCheckRunsPage(1, 100, 100, 100)).toBeUndefined();
        expect(nextCheckRunsPage(2, 100, 200, 150)).toBeUndefined();
    });

    it('stops after a short page', () => {
        expect(nextCheckRunsPage(1, 99, 99, 500)).toBeUndefined();
        expect(nextCheckRunsPage(1, 0, 0, 0)).toBeUndefined();
    });

    it('asks for the next page after a full one while runs are missing', () => {
        expect(nextCheckRunsPage(1, 100, 100, 150)).toBe(2);
        expect(nextCheckRunsPage(MAX_CHECK_RUN_PAGES - 1, 100, 900, 1000)).toBe(MAX_CHECK_RUN_PAGES);
    });

    it('throws, naming the total, when more than the page limit is needed', () => {
        expect(() => nextCheckRunsPage(MAX_CHECK_RUN_PAGES, 100, 1000, 1234)).toThrow(/1234/);
    });
});

describe('deployStateFromCheckRuns', () => {
    const NOW = new Date('2026-10-05T12:00:00Z');
    const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
    let nextId = 1;
    const run = (over: Partial<CheckRun> = {}): CheckRun => ({
        id: nextId++,
        name: 'ci',
        status: 'completed',
        conclusion: 'success',
        startedAt: ago(1),
        ...over,
    });
    const state = (...runs: CheckRun[]) => deployStateFromCheckRuns(runs, NOW);

    it('is none without check runs', () => {
        expect(state()).toBe('none');
    });

    it('is green when every run passed, neutral or skipped', () => {
        expect(
            state(
                run({ name: 'a' }),
                run({ name: 'b', conclusion: 'neutral' }),
                run({ name: 'c', conclusion: 'skipped' }),
            ),
        ).toBe('green');
    });

    it.each(['failure', 'cancelled', 'timed_out', 'action_required', 'stale'])('is failed for a %s run', (verdict) => {
        expect(state(run({ name: 'a' }), run({ name: 'b', conclusion: verdict }))).toBe('failed');
    });

    it('is failed for a completed run with no conclusion', () => {
        expect(state(run({ conclusion: null }))).toBe('failed');
    });

    it('is pending for a fresh incomplete run when none failed', () => {
        expect(state(run({ name: 'a' }), run({ name: 'b', status: 'in_progress', conclusion: null }))).toBe('pending');
        expect(state(run({ status: 'queued', conclusion: null }))).toBe('pending');
    });

    it('is failed when one failed even while another is pending', () => {
        expect(
            state(
                run({ name: 'a', status: 'in_progress', conclusion: null }),
                run({ name: 'b', conclusion: 'failure' }),
            ),
        ).toBe('failed');
    });

    it('lets a rerun supersede the failed run of the same name', () => {
        expect(
            state(run({ conclusion: 'failure', startedAt: ago(3) }), run({ conclusion: 'success', startedAt: ago(2) })),
        ).toBe('green');
        expect(
            state(run({ conclusion: 'success', startedAt: ago(3) }), run({ conclusion: 'failure', startedAt: ago(2) })),
        ).toBe('failed');
    });

    it('treats a null startedAt as older than any date', () => {
        expect(state(run({ conclusion: 'failure', startedAt: null }), run({ startedAt: ago(30) }))).toBe('green');
        expect(state(run({ startedAt: ago(30) }), run({ conclusion: 'failure', startedAt: null }))).toBe('green');
    });

    it('breaks a tie on startedAt by the greater id', () => {
        const at = ago(2);
        expect(
            state(
                run({ id: 20, conclusion: 'success', startedAt: at }),
                run({ id: 10, conclusion: 'failure', startedAt: at }),
            ),
        ).toBe('green');
        expect(
            state(
                run({ id: 10, conclusion: 'failure', startedAt: at }),
                run({ id: 20, conclusion: 'success', startedAt: at }),
            ),
        ).toBe('green');
        expect(
            state(
                run({ id: 5, conclusion: 'success', startedAt: null }),
                run({ id: 6, conclusion: 'failure', startedAt: null }),
            ),
        ).toBe('failed');
    });

    it('lets only Workers Builds runs decide when there is one', () => {
        expect(DEPLOY_CHECK_PREFIX).toBe('Workers Builds');
        expect(state(run({ name: 'Workers Builds: site' }), run({ name: 'lint', conclusion: 'failure' }))).toBe(
            'green',
        );
        expect(state(run({ name: 'Workers Builds: site', conclusion: 'failure' }), run({ name: 'lint' }))).toBe(
            'failed',
        );
    });

    it('lets every run decide when there is no Workers Builds run', () => {
        expect(state(run({ name: 'build' }), run({ name: 'lint', conclusion: 'failure' }))).toBe('failed');
    });

    it('drops an incomplete run older than the stale limit, or without a start', () => {
        expect(STALE_RUN_HOURS).toBe(24);
        expect(state(run({ status: 'queued', conclusion: null, startedAt: ago(25) }))).toBe('none');
        expect(state(run({ status: 'queued', conclusion: null, startedAt: null }))).toBe('none');
        expect(
            state(run({ name: 'a' }), run({ name: 'b', status: 'in_progress', conclusion: null, startedAt: ago(48) })),
        ).toBe('green');
        expect(state(run({ status: 'in_progress', conclusion: null, startedAt: ago(24) }))).toBe('pending');
    });

    it('keeps an old completed run', () => {
        expect(state(run({ conclusion: 'failure', startedAt: ago(500) }))).toBe('failed');
        expect(state(run({ conclusion: 'failure', startedAt: null }))).toBe('failed');
    });
});

describe('planCapture', () => {
    const SHA_A = 'a'.repeat(40);
    const SHA_B = 'b'.repeat(40);
    const HEAD_DATE = '2026-10-05T12:00:00Z';
    const base: Omit<CapturePlanInput, 'deploy'> = {
        capturedSha: SHA_A,
        head: { sha: SHA_B, date: HEAD_DATE },
        thumbnailExists: true,
        force: false,
        now: new Date('2026-10-05T13:00:00Z'),
    };
    const plan = (over: Partial<CapturePlanInput> = {}) => planCapture({ ...base, deploy: 'green', ...over });

    it('captures on --force, before every other rule', () => {
        expect(plan({ force: true, capturedSha: SHA_B, deploy: 'failed' })).toEqual({ capture: true, reason: 'force' });
    });

    it('skips an unchanged head with a file whatever the deploy says', () => {
        for (const deploy of ['green', 'pending', 'failed', 'none', 'unknown'] as const) {
            expect(plan({ capturedSha: SHA_B, deploy })).toEqual({ capture: false, reason: 'up-to-date' });
        }
    });

    it('does not call a missing file up to date', () => {
        expect(plan({ thumbnailExists: false, capturedSha: SHA_B })).toEqual({
            capture: true,
            reason: 'missing-thumbnail',
        });
    });

    it('captures a new commit with a green deploy, and a first capture', () => {
        expect(plan()).toEqual({ capture: true, reason: 'new-commit' });
        expect(plan({ capturedSha: undefined })).toEqual({ capture: true, reason: 'new-commit' });
    });

    it('skips a failed, pending or unknown deploy, even when the file is missing', () => {
        for (const thumbnailExists of [true, false]) {
            expect(plan({ deploy: 'failed', thumbnailExists })).toEqual({ capture: false, reason: 'deploy-failed' });
            expect(plan({ deploy: 'pending', thumbnailExists })).toEqual({ capture: false, reason: 'deploy-pending' });
            expect(plan({ deploy: 'unknown', thumbnailExists })).toEqual({ capture: false, reason: 'deploy-unknown' });
        }
    });

    it('captures a missing file when the deploy is green or there are no check runs', () => {
        expect(plan({ thumbnailExists: false })).toEqual({ capture: true, reason: 'missing-thumbnail' });
        expect(plan({ thumbnailExists: false, deploy: 'none', now: new Date(HEAD_DATE) })).toEqual({
            capture: true,
            reason: 'missing-thumbnail',
        });
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

describe('planCaptureWithoutDeploy', () => {
    const head = { sha: 'b'.repeat(40), date: '2026-10-05T12:00:00Z' };
    const base = { capturedSha: 'a'.repeat(40), head, thumbnailExists: true, force: false, now: new Date(head.date) };

    it('decides force and up-to-date', () => {
        expect(planCaptureWithoutDeploy({ ...base, force: true })).toEqual({ capture: true, reason: 'force' });
        expect(planCaptureWithoutDeploy({ ...base, capturedSha: head.sha })).toEqual({
            capture: false,
            reason: 'up-to-date',
        });
    });

    it('returns undefined when the deploy decides', () => {
        expect(planCaptureWithoutDeploy(base)).toBeUndefined();
        expect(planCaptureWithoutDeploy({ ...base, capturedSha: head.sha, thumbnailExists: false })).toBeUndefined();
        expect(planCaptureWithoutDeploy({ ...base, capturedSha: undefined })).toBeUndefined();
    });
});

describe('formatDeploySkipWarning', () => {
    it.each([
        ['deploy-failed', "the head commit's deploy failed"],
        ['deploy-pending', "the head commit's deploy has not finished"],
        ['deploy-unknown', 'its check runs could not be read'],
    ] as const)('words %s', (reason, meaning) => {
        expect(formatDeploySkipWarning('app', reason)).toBe(`::warning::app: screenshot not retaken: ${meaning}`);
    });

    it('appends the detail after a colon', () => {
        expect(formatDeploySkipWarning('app', 'deploy-unknown', 'GET x answered 500')).toBe(
            '::warning::app: screenshot not retaken: its check runs could not be read: GET x answered 500',
        );
    });

    it('collapses whitespace and encodes percent signs', () => {
        expect(formatDeploySkipWarning('app', 'deploy-unknown', 'line one\n\n  line  two 100%')).toBe(
            '::warning::app: screenshot not retaken: its check runs could not be read: line one line two 100%25',
        );
    });

    it('returns undefined for other reasons', () => {
        expect(formatDeploySkipWarning('app', 'up-to-date')).toBeUndefined();
        expect(formatDeploySkipWarning('app', 'settling', 'x')).toBeUndefined();
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

    it('puts a multi-line error on one line', () => {
        expect(formatCaptureFailure('app', ['Timeout 30000ms exceeded.\n::error::Call log:\n  - waiting'])).toBe(
            'app: screenshot not updated: Timeout 30000ms exceeded. ::error::Call log: - waiting',
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

    it('keeps a multi-line reason on one table row', () => {
        const summary = formatSyncSummary(
            [
                {
                    slug: 'x',
                    copyChanged: false,
                    datesChanged: false,
                    screenshot: {
                        kind: 'failed',
                        reasons: ['locator.waitFor: Timeout 30000ms exceeded.\nCall log:\n  - waiting'],
                    },
                },
            ],
            { check: false },
        );
        expect(summary.split('\n')[4]).toBe(
            '| x | unchanged | unchanged | **failed**: locator.waitFor: Timeout 30000ms exceeded. Call log: - waiting |',
        );
    });

    it('marks check mode in the heading', () => {
        expect(formatSyncSummary([], { check: true }).split('\n')[0]).toBe('### Project sync (--check)');
    });
});
