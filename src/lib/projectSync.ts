// The pure core of `npm run sync:projects` (scripts/sync-projects.ts does only I/O). Contract C3 is frozen here: the
// CLI flags, the exit codes and the copy-validation errors. S2 adds the SHA-keyed capture plan and the run report;
// S2R freezes the deploy-state reading (paginated, latest run per name, deploy runs only, stale runs ignored) and the
// capture rule order. S4 adds the stale-deploy warning and the exit 1 when no target's deploy could be read.
import { z } from 'astro/zod';

import type { HeadCommit, ProjectCopy } from './projectMeta';
import { repoPath } from './projects';
import { mapTopics } from './topicMap';

/** Exit codes of `npm run sync:projects` (contract C3). */
export const EXIT_OK = 0;
/**
 * A copy error (nothing written), a capture error (that project skipped, the rest written) or no readable deploy for
 * any target that needed one (`deployReadFailedEverywhere`; the rest written).
 */
export const EXIT_ERROR = 1;
/** `--check` only: the outputs would change. Nothing is written. */
export const EXIT_WOULD_CHANGE = 2;
export type SyncExitCode = typeof EXIT_OK | typeof EXIT_ERROR | typeof EXIT_WOULD_CHANGE;

export interface SyncArgs {
    /** Recapture every screenshot target, whatever its recorded `capturedSha`. */
    readonly force: boolean;
    /** Compute everything, write nothing, and exit 2 when an output would change (0 when none would). */
    readonly check: boolean;
}

/**
 * Parses the arguments after `npm run sync:projects --`: only `--force` and `--check`, each at most once. Anything else
 * throws with the offending argument named.
 */
export function parseSyncArgs(argv: readonly string[]): SyncArgs {
    let force = false;
    let check = false;
    for (const arg of argv) {
        if (arg === '--force' && !force) force = true;
        else if (arg === '--check' && !check) check = true;
        else if (arg === '--force' || arg === '--check') throw new Error(`Duplicate argument: ${arg}`);
        else throw new Error(`Unknown argument: ${arg} (expected --force and/or --check)`);
    }
    return { force, check };
}

/** What GitHub says about one project's repo: the inputs of the card copy. */
export interface RepoCopyInput {
    /** The project slug (markdown file name). */
    readonly slug: string;
    /** `https://github.com/<owner>/<repo>`, used to name the repo in errors. */
    readonly repo: string;
    /** The About text, `null` when GitHub has none. */
    readonly description: string | null;
    readonly topics: readonly string[];
}

/** One reason a repo's copy cannot be used. `field` names an empty About or no topics; `topic` an unmapped slug. */
export type CopyError =
    | { readonly repo: string; readonly field: 'description' | 'topics' }
    | { readonly repo: string; readonly topic: string };

export type CopyValidation =
    | { readonly ok: true; readonly copy: Readonly<Record<string, ProjectCopy>> }
    | { readonly ok: false; readonly errors: readonly CopyError[] };

/**
 * Validates every repo's copy all at once (decision D1: all or nothing). A blank or whitespace-only About is an error,
 * as are no topics and every topic missing from the topic map (src/lib/topicMap.ts); all errors of all repos are
 * returned, in input order, so one run reports everything to fix. On success `copy` is keyed by slug: the About text
 * trimmed, and the topics' display names ordered by topic slug (by code unit, since GitHub does not promise an order and
 * a reorder must not open a bot PR), with a display name that two slugs map to kept once, at its first place.
 */
export function validateCopy(inputs: readonly RepoCopyInput[]): CopyValidation {
    const errors: CopyError[] = [];
    const copy: Record<string, ProjectCopy> = {};
    for (const { slug, repo, description, topics } of inputs) {
        const about = description?.trim() ?? '';
        // Sorted by code unit, never by locale, so the order is the same on every machine.
        const sorted = [...topics].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        const { tech: mapped, unknown } = mapTopics(sorted);
        const tech = [...new Set(mapped)];
        const before = errors.length;
        if (about === '') errors.push({ repo, field: 'description' });
        if (topics.length === 0) errors.push({ repo, field: 'topics' });
        for (const topic of unknown) errors.push({ repo, topic });
        if (errors.length === before) copy[slug] = { description: about, tech };
    }
    return errors.length > 0 ? { ok: false, errors } : { ok: true, copy };
}

/**
 * One line per error, naming the repo and the field or slug, for example
 * `https://github.com/tpetrus/x: the GitHub About description is empty` or
 * `https://github.com/tpetrus/x: topic "foo" is not in src/lib/topicMap.ts`.
 */
export function formatCopyError(error: CopyError): string {
    if ('topic' in error) return `${error.repo}: topic "${error.topic}" is not in src/lib/topicMap.ts`;
    return error.field === 'description'
        ? `${error.repo}: the GitHub About description is empty`
        : `${error.repo}: the GitHub repo has no topics`;
}

// ---------------------------------------------------------------------------------------------------------------------
// S2: the SHA-keyed capture plan. A screenshot is retaken only when the repo's head moved past the recorded
// `capturedSha` and the live site is known to serve the new commit, so an unchanged repo never yields a new image
// (and AVIF bytes that differ between machines never open a bot PR).

/**
 * Hours a new head commit must have aged before its screenshot is retaken, when the commit has no check runs that
 * could confirm its deploy.
 */
export const SETTLE_HOURS = 6;

/**
 * What the head commit's deploy looks like from its check runs, after `deployStateFromCheckRuns` has narrowed them:
 * `green` when at least one run is left and every one completed as `success`, `neutral` or `skipped`; `failed` when
 * any completed run has another conclusion (a null conclusion on a completed run counts as failed); `pending` when none
 * failed but one has not completed; `none` when no run is left; `unknown` when the check runs could not be read (set by
 * the caller when a fetch or a parse throws, never returned by `deployStateFromCheckRuns`).
 */
export type DeployState = 'green' | 'pending' | 'failed' | 'none' | 'unknown';

/** Page size of the check-runs requests. */
export const CHECK_RUNS_PER_PAGE = 100;
/** The most check-runs pages one commit may need; `nextCheckRunsPage` throws beyond it. */
export const MAX_CHECK_RUN_PAGES = 10;
/**
 * Check runs whose name starts with this are the deploy (Cloudflare names them `Workers Builds: <worker>`). When a
 * commit has at least one, only those runs decide its deploy state, so an unrelated failing check never blocks a
 * screenshot.
 */
export const DEPLOY_CHECK_PREFIX = 'Workers Builds';
/**
 * An incomplete run that started more than this many hours before `now`, or that has no `startedAt`, is ignored, so a
 * run stuck in `queued` or `in_progress` cannot keep a screenshot pending forever.
 */
export const STALE_RUN_HOURS = 24;

/**
 * `https://api.github.com/repos/<owner>/<repo>/commits/<sha>/check-runs?filter=latest&per_page=100&page=<page>`
 * (`page` is 1-based). Throws on a repo URL that is not GitHub's.
 */
export function checkRunsApiUrl(repo: string, sha: string, page: number): string {
    return `https://api.github.com/repos/${repoPath(repo)}/commits/${sha}/check-runs?filter=latest&per_page=${CHECK_RUNS_PER_PAGE}&page=${page}`;
}

/** One check run as the sync reads it. */
export interface CheckRun {
    readonly id: number;
    readonly name: string;
    readonly status: string;
    /** `null` while the run has not completed. */
    readonly conclusion: string | null;
    /** ISO 8601; `null` when GitHub has not started it. */
    readonly startedAt: string | null;
}

/** One parsed check-runs response. */
export interface CheckRunsPage {
    /** `total_count` of the response: the runs across every page. */
    readonly totalCount: number;
    readonly runs: readonly CheckRun[];
}

/**
 * Reads one check-runs response (`{ total_count, check_runs: [{ id, name, status, conclusion, started_at }] }`; extra
 * keys are ignored and `started_at` may be null or absent); throws on any other shape.
 */
export function parseCheckRunsPage(response: unknown): CheckRunsPage {
    const parsed = checkRunsPageSchema.parse(response);
    return {
        totalCount: parsed.total_count,
        runs: parsed.check_runs.map((run) => ({
            id: run.id,
            name: run.name,
            status: run.status,
            conclusion: run.conclusion,
            startedAt: run.started_at ?? null,
        })),
    };
}

// `conclusion` is null while a run has not completed; `started_at` is null or absent for a run GitHub has not started.
const checkRunsPageSchema = z.object({
    total_count: z.number(),
    check_runs: z.array(
        z.object({
            id: z.number(),
            name: z.string(),
            status: z.string(),
            conclusion: z.string().nullable(),
            started_at: z.string().nullable().optional(),
        }),
    ),
});

/**
 * The next page to request after `pagesFetched` pages holding `runsSoFar` runs in total, the last of them
 * `lastPageSize` runs, or `undefined` when `runsSoFar >= totalCount` or `lastPageSize < CHECK_RUNS_PER_PAGE`. Throws,
 * naming `totalCount`, when another page is needed but `pagesFetched` is already `MAX_CHECK_RUN_PAGES`.
 */
export function nextCheckRunsPage(
    pagesFetched: number,
    lastPageSize: number,
    runsSoFar: number,
    totalCount: number,
): number | undefined {
    if (runsSoFar >= totalCount || lastPageSize < CHECK_RUNS_PER_PAGE) return undefined;
    if (pagesFetched >= MAX_CHECK_RUN_PAGES) {
        throw new Error(
            `The commit has ${totalCount} check runs, more than ${MAX_CHECK_RUN_PAGES} pages of ${CHECK_RUNS_PER_PAGE}`,
        );
    }
    return pagesFetched + 1;
}

/**
 * Narrows a commit's check runs (every page together) and reads the deploy state, in this order:
 * 0. duplicates: of the runs sharing an `id` (a run that moved between pages while they were read), only the first
 *    counts;
 * 1. latest run per name: of the runs sharing a `name`, only the one with the greatest `startedAt` counts (a null
 *    `startedAt`, or one `Date.parse` cannot read, is older than any date; ties go to the greater `id`), so a rerun
 *    supersedes the run it repeats whatever order the runs arrive in;
 * 2. deploy runs only: when any remaining run's name starts with `DEPLOY_CHECK_PREFIX`, every other run is dropped;
 * 3. stale runs: an incomplete run (`status` other than `completed`) whose `startedAt` is null or more than
 *    `STALE_RUN_HOURS` before `now` is dropped;
 * then `none`, `failed`, `pending` or `green` as `DeployState` describes. Never returns `unknown`.
 */
export function deployStateFromCheckRuns(runs: readonly CheckRun[], now: Date): DeployState {
    // A null start is older than any date; the greater id wins a tie.
    const startOf = (run: CheckRun): number => (run.startedAt === null ? -Infinity : Date.parse(run.startedAt));
    const newer = (a: CheckRun, b: CheckRun): boolean =>
        startOf(a) > startOf(b) || (startOf(a) === startOf(b) && a.id > b.id);
    const latest = new Map<string, CheckRun>();
    for (const run of runs) {
        const seen = latest.get(run.name);
        if (seen === undefined || newer(run, seen)) latest.set(run.name, run);
    }
    let narrowed = [...latest.values()];
    const deployRuns = narrowed.filter((run) => run.name.startsWith(DEPLOY_CHECK_PREFIX));
    if (deployRuns.length > 0) narrowed = deployRuns;
    const staleBefore = now.getTime() - STALE_RUN_HOURS * 3_600_000;
    narrowed = narrowed.filter(
        (run) => run.status === 'completed' || (run.startedAt !== null && startOf(run) >= staleBefore),
    );

    if (narrowed.length === 0) return 'none';
    const completed = narrowed.filter((run) => run.status === 'completed');
    if (completed.some((run) => !PASSING_CONCLUSIONS.has(run.conclusion ?? ''))) return 'failed';
    return completed.length < narrowed.length ? 'pending' : 'green';
}

const PASSING_CONCLUSIONS: ReadonlySet<string> = new Set(['success', 'neutral', 'skipped']);

/**
 * Whether the commit had deploy runs and step 3 of `deployStateFromCheckRuns` dropped every one of them as stale: after
 * steps 0 and 1 at least one run's name starts with `DEPLOY_CHECK_PREFIX`, and none of those is either completed or
 * started at most `STALE_RUN_HOURS` before `now`. `deployStateFromCheckRuns` then reads `none` (the other runs are not
 * consulted), so `planCapture` decides by rule 5; the sync warns with `formatStaleDeployWarning`, so a stuck deploy
 * neither blocks a screenshot nor passes silently. `false` when the commit has no deploy run at all.
 */
export function deployRunsAllStale(runs: readonly CheckRun[], now: Date): boolean {
    throw new Error(`S4: not implemented ${runs.length} ${now.toISOString()}`);
}

export interface CapturePlanInput {
    /** The commit the committed screenshot was taken at, `undefined` before the first capture. */
    readonly capturedSha: string | undefined;
    /** The repo's head as `headFromCommits` chose it. */
    readonly head: HeadCommit;
    /** Whether src/assets/projects/<slug>.avif exists. */
    readonly thumbnailExists: boolean;
    readonly deploy: DeployState;
    readonly force: boolean;
    readonly now: Date;
}

export type CaptureReason = 'force' | 'missing-thumbnail' | 'new-commit';
export type SkipReason = 'up-to-date' | 'deploy-pending' | 'deploy-failed' | 'deploy-unknown' | 'settling';

export type CaptureDecision =
    | { readonly capture: true; readonly reason: CaptureReason }
    | { readonly capture: false; readonly reason: SkipReason };

/**
 * The rules of `planCapture` that need no deploy state (1 and 2): their decision, or `undefined` when the deploy
 * decides. The caller fetches the check runs only when this returns `undefined`.
 */
export function planCaptureWithoutDeploy(input: Omit<CapturePlanInput, 'deploy'>): CaptureDecision | undefined {
    if (input.force) return { capture: true, reason: 'force' };
    if (input.thumbnailExists && input.capturedSha === input.head.sha) return { capture: false, reason: 'up-to-date' };
    return undefined;
}

/**
 * Decides whether to retake one screenshot target, first rule that applies:
 * 1. `--force` captures (`force`);
 * 2. an existing screenshot file whose `capturedSha` equals the head SHA skips (`up-to-date`);
 * 3. deploy `failed`, `pending` or `unknown` skips (`deploy-failed`, `deploy-pending`, `deploy-unknown`), even when the
 *    file is missing;
 * 4. deploy `green` captures: `missing-thumbnail` when the file is missing, otherwise `new-commit`;
 * 5. deploy `none`: a missing file captures (`missing-thumbnail`); otherwise the head commit captures (`new-commit`)
 *    once it is at least `SETTLE_HOURS` old and skips (`settling`) until then.
 */
export function planCapture(input: CapturePlanInput): CaptureDecision {
    const early = planCaptureWithoutDeploy(input);
    if (early !== undefined) return early;
    const { thumbnailExists, deploy, head, now } = input;
    if (deploy === 'failed') return { capture: false, reason: 'deploy-failed' };
    if (deploy === 'pending') return { capture: false, reason: 'deploy-pending' };
    if (deploy === 'unknown') return { capture: false, reason: 'deploy-unknown' };
    if (deploy === 'green') return { capture: true, reason: thumbnailExists ? 'new-commit' : 'missing-thumbnail' };
    // No check runs to confirm the deploy: a missing file is captured now, a new commit once the settle delay passed.
    if (!thumbnailExists) return { capture: true, reason: 'missing-thumbnail' };
    const ageMs = now.getTime() - Date.parse(head.date);
    return ageMs >= SETTLE_HOURS * 3_600_000
        ? { capture: true, reason: 'new-commit' }
        : { capture: false, reason: 'settling' };
}

const DEPLOY_SKIP_MEANINGS: Partial<Record<SkipReason, string>> = {
    'deploy-failed': "the head commit's deploy failed",
    'deploy-pending': "the head commit's deploy has not finished",
    'deploy-unknown': 'its check runs could not be read',
};

/**
 * The GitHub Actions warning for a screenshot skipped because of its deploy (`deploy-failed`, `deploy-pending`,
 * `deploy-unknown`), or `undefined` for any other skip reason. One line:
 * `::warning::<slug>: screenshot not retaken: <what the reason means>`, then `: <detail>` when a detail is given (the
 * error that made the deploy `unknown`). In the message after `::warning::` every run of whitespace collapses to one
 * space and `%` is encoded as `%25`, so a multi-line error stays one annotation.
 */
export function formatDeploySkipWarning(slug: string, reason: SkipReason, detail?: string): string | undefined {
    const meaning = DEPLOY_SKIP_MEANINGS[reason];
    if (meaning === undefined) return undefined;
    const message = `${slug}: screenshot not retaken: ${meaning}${detail === undefined ? '' : `: ${detail}`}`;
    // One line, and `%` encoded as the workflow-command syntax expects.
    return `::warning::${message.replace(/%/g, '%25').replace(/\s+/g, ' ').trim()}`;
}

/**
 * The GitHub Actions warning for a project whose deploy runs were all stale (`deployRunsAllStale`), encoded like
 * `formatDeploySkipWarning`: `::warning::<slug>: every deploy check run of the head commit is stale (unfinished for
 * over <STALE_RUN_HOURS> hours or never started), so the screenshot is decided as if the commit had no check runs`.
 */
export function formatStaleDeployWarning(slug: string): string {
    throw new Error(`S4: not implemented ${slug} ${STALE_RUN_HOURS}`);
}

/**
 * Whether the run must exit `EXIT_ERROR` because no deploy could be read: `true` when at least one screenshot target
 * needed its check runs (`requested`, the slugs whose decision fell through `planCaptureWithoutDeploy`) and every one
 * of them read `unknown` (`unknown`, a subset of `requested`). One unknown among readable deploys stays a warning (per-
 * project isolation); all of them unknown is a misconfiguration (a token without the checks permission, a changed
 * response shape) that would otherwise skip every screenshot forever with exit 0. The other outputs are still written.
 */
export function deployReadFailedEverywhere(requested: readonly string[], unknown: readonly string[]): boolean {
    throw new Error(`S4: not implemented ${requested.length} ${unknown.length}`);
}

/**
 * The error line for `deployReadFailedEverywhere`, one line: `No deploy state could be read for any screenshot target
 * that needed one (<slugs joined by ", ">): check that the token can read check runs`.
 */
export function formatDeployReadError(unknown: readonly string[]): string {
    throw new Error(`S4: not implemented ${unknown.join(', ')}`);
}

/** What happened to one project's screenshot in a run. */
export type ScreenshotOutcome =
    | { readonly kind: 'not-a-target' }
    | { readonly kind: 'skipped'; readonly reason: SkipReason }
    /** `changed` is false when the new AVIF has the same bytes as the committed one. */
    | { readonly kind: 'captured'; readonly reason: CaptureReason; readonly changed: boolean }
    /** The capture threw or the guard (src/lib/captureGuard.ts) rejected it: the previous file and SHA are kept. */
    | { readonly kind: 'failed'; readonly reasons: readonly string[] };

/** One project's line in the run report. */
export interface ProjectReport {
    readonly slug: string;
    /** The description or tech differ from the committed meta entry (true for a project with no entry yet). */
    readonly copyChanged: boolean;
    /** `created` or `updated` differ from the committed meta entry (true for a project with no entry yet). */
    readonly datesChanged: boolean;
    readonly screenshot: ScreenshotOutcome;
}

/**
 * One error line per failed screenshot, naming the project and every reason, for example
 * `audio-visualizer: screenshot not updated: the site answered 502; the pixels are nearly uniform (...)`.
 */
export function formatCaptureFailure(slug: string, reasons: readonly string[]): string {
    // One line per project: Playwright's errors span several lines, and a later line starting with `::` would be read
    // by the Actions runner as a workflow command.
    return `${slug}: screenshot not updated: ${reasons.join('; ')}`.replace(/\s+/g, ' ').trim();
}

/**
 * The GitHub Actions job summary of a run, as GitHub-flavored markdown: a `### Project sync` heading (with `(--check)`
 * appended in check mode), then a table with one row per project, in input order, and the columns Project, Copy,
 * Dates and Screenshot. Copy and Dates read `changed` or `unchanged`; Screenshot reads `-` for a project that is not a
 * target, `skipped (<reason>)`, `captured (<reason>)` or `captured (<reason>), unchanged bytes`, and
 * `**failed**: <reasons joined with "; ">`. Table cells escape `|`. Ends with a newline.
 */
export function formatSyncSummary(reports: readonly ProjectReport[], options: { readonly check: boolean }): string {
    const rows = reports.map((report) => {
        const copy = report.copyChanged ? 'changed' : 'unchanged';
        const dates = report.datesChanged ? 'changed' : 'unchanged';
        return `| ${cell(report.slug)} | ${copy} | ${dates} | ${cell(describeScreenshot(report.screenshot))} |`;
    });
    return [
        `### Project sync${options.check ? ' (--check)' : ''}`,
        '',
        '| Project | Copy | Dates | Screenshot |',
        '| --- | --- | --- | --- |',
        ...rows,
        '',
    ].join('\n');
}

// A `|` inside a table cell would start a new column, and a line break would end the row: Playwright's timeout errors
// span several lines (the call log), so every run of whitespace collapses to one space.
function cell(text: string): string {
    return text.replace(/\s+/g, ' ').trim().replaceAll('|', '\\|');
}

function describeScreenshot(outcome: ScreenshotOutcome): string {
    switch (outcome.kind) {
        case 'not-a-target':
            return '-';
        case 'skipped':
            return `skipped (${outcome.reason})`;
        case 'captured':
            return `captured (${outcome.reason})${outcome.changed ? '' : ', unchanged bytes'}`;
        case 'failed':
            return `**failed**: ${outcome.reasons.join('; ')}`;
    }
}
