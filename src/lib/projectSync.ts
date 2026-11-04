// The pure core of `npm run sync:projects` (scripts/sync-projects.ts does only I/O). Contract C3 is frozen here: the
// CLI flags, the exit codes and the copy-validation errors. S2 adds the SHA-keyed capture plan and the run report.
import type { HeadCommit, ProjectCopy } from './projectMeta';
import { mapTopics } from './topicMap';

/** Exit codes of `npm run sync:projects` (contract C3). */
export const EXIT_OK = 0;
/** A copy error (nothing written) or a capture error (that project skipped, the rest written). */
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
        const { tech, unknown } = mapTopics(topics);
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
 * What the head commit's check runs say about its deploy: `green` when there is at least one run and every run
 * completed as `success`, `neutral` or `skipped`; `failed` when any completed run has another conclusion; `pending`
 * when none failed but one has not completed; `none` when the commit has no check runs.
 */
export type DeployState = 'green' | 'pending' | 'failed' | 'none';

/** `https://api.github.com/repos/<owner>/<repo>/commits/<sha>/check-runs?per_page=100`. */
export function checkRunsApiUrl(repo: string, sha: string): string {
    void [repo, sha];
    throw new Error('S2: not implemented');
}

/** Reads a check-runs response (`{ total_count, check_runs: [{ status, conclusion }] }`); throws on any other shape. */
export function deployStateFromCheckRuns(response: unknown): DeployState {
    void response;
    throw new Error('S2: not implemented');
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
export type SkipReason = 'up-to-date' | 'deploy-pending' | 'deploy-failed' | 'settling';

export type CaptureDecision =
    | { readonly capture: true; readonly reason: CaptureReason }
    | { readonly capture: false; readonly reason: SkipReason };

/**
 * Decides whether to retake one screenshot target, first rule that applies: `--force` captures; a missing screenshot
 * file captures; `capturedSha` equal to the head SHA skips (`up-to-date`); otherwise the deploy decides: `green`
 * captures (`new-commit`), `failed` and `pending` skip, and `none` captures once the head commit is at least
 * `SETTLE_HOURS` old (`settling` until then).
 */
export function planCapture(input: CapturePlanInput): CaptureDecision {
    void input;
    throw new Error('S2: not implemented');
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
    void [slug, reasons];
    throw new Error('S2: not implemented');
}

/**
 * The GitHub Actions job summary of a run, as GitHub-flavored markdown: a `### Project sync` heading (with `(--check)`
 * appended in check mode), then a table with one row per project, in input order, and the columns Project, Copy,
 * Dates and Screenshot. Copy and Dates read `changed` or `unchanged`; Screenshot reads `-` for a project that is not a
 * target, `skipped (<reason>)`, `captured (<reason>)` or `captured (<reason>), unchanged bytes`, and
 * `**failed**: <reasons joined with "; ">`. Table cells escape `|`. Ends with a newline.
 */
export function formatSyncSummary(reports: readonly ProjectReport[], options: { readonly check: boolean }): string {
    void [reports, options];
    throw new Error('S2: not implemented');
}
