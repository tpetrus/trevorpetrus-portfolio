// The pure core of `npm run sync:projects` (scripts/sync-projects.ts does only I/O). Contract C3 is frozen here: the
// CLI flags, the exit codes and the copy-validation errors. S2 adds the SHA-keyed capture plan to this module.
import type { ProjectCopy } from './projectMeta';

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
    void argv;
    throw new Error('not implemented');
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
 * trimmed, and the topics' display names in GitHub's order.
 */
export function validateCopy(inputs: readonly RepoCopyInput[]): CopyValidation {
    void inputs;
    throw new Error('not implemented');
}

/**
 * One line per error, naming the repo and the field or slug, for example
 * `https://github.com/tpetrus/x: the GitHub About description is empty` or
 * `https://github.com/tpetrus/x: topic "foo" is not in src/lib/topicMap.ts`.
 */
export function formatCopyError(error: CopyError): string {
    void error;
    throw new Error('not implemented');
}
