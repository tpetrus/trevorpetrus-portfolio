import { z } from 'astro/zod';

import { repoPath } from './projects';

// Keyed by project slug (the markdown file name). `updated` is the committer date of the newest commit on the repo's
// default branch, as an ISO 8601 UTC timestamp.
const projectMetaSchema = z.record(z.string(), z.object({ updated: z.iso.datetime() }));
export type ProjectMeta = z.output<typeof projectMetaSchema>;

const commitsResponseSchema = z
    .array(z.object({ commit: z.object({ committer: z.object({ date: z.iso.datetime() }) }) }))
    .min(1, 'The repository has no commits');

/** Validates the parsed contents of `src/data/project-meta.json`. */
export function parseProjectMeta(data: unknown): ProjectMeta {
    return projectMetaSchema.parse(data);
}

/** The project's last-updated date, or `undefined` when the sync has not recorded one (the card then omits it). */
export function lastUpdatedFor(meta: ProjectMeta, slug: string): Date | undefined {
    const entry = meta[slug];
    return entry ? new Date(entry.updated) : undefined;
}

/**
 * The URL of the repo's newest commit on its default branch. The commits endpoint, unlike the repo's `pushed_at`,
 * ignores pushes to other branches, and the version bot and Dependabot push PR branches all the time.
 */
export function commitsApiUrl(repo: string): string {
    return `https://api.github.com/repos/${repoPath(repo)}/commits?per_page=1`;
}

/** Extracts the newest commit's committer date from a `commits?per_page=1` response. */
export function metaFromCommits(response: unknown): { updated: string } {
    const [newest] = commitsResponseSchema.parse(response);
    return { updated: newest.commit.committer.date };
}

/** Returns a copy of `meta` with `slug` set to `entry`, keys sorted so the committed file diffs cleanly. */
export function mergeProjectMeta(meta: ProjectMeta, slug: string, entry: { updated: string }): ProjectMeta {
    const merged = { ...meta, [slug]: entry };
    return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
}

export function serializeProjectMeta(meta: ProjectMeta): string {
    return `${JSON.stringify(meta, null, 2)}\n`;
}
