import { z } from 'astro/zod';

import { isDnsLabel, projectUrl } from '../config/site';

export const PROJECT_STATUSES = ['live', 'in-progress', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

const STATUS_LABELS: Record<ProjectStatus, string> = {
    live: 'Live',
    'in-progress': 'In progress',
    archived: 'Archived',
};

// https://github.com/<owner>/<repo>, nothing else: the card builds the GitHub link and the sync script builds the API
// URL from it, so a trailing path or query would produce wrong addresses.
const GITHUB_REPO_URL = /^https:\/\/github\.com\/([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)$/;

/**
 * The frontmatter schema of a project. A factory because the thumbnail type differs by caller: the content collection
 * passes Astro's `image()` helper (which resolves the file for `astro:assets`), while tests and the sync script, which
 * cannot import `astro:content`, pass a plain `z.string()`.
 */
export function projectSchema<Thumbnail extends z.ZodType>(thumbnail: Thumbnail) {
    return z.object({
        title: z.string().min(1),
        description: z.string().min(1),
        tech: z.array(z.string().min(1)).min(1),
        status: z.enum(PROJECT_STATUSES),
        repo: z.string().regex(GITHUB_REPO_URL, 'Expected a URL like https://github.com/<owner>/<repo>'),
        subdomain: z
            .string()
            .refine(isDnsLabel, 'Expected a lowercase DNS label such as "audio-visualizer"')
            .optional(),
        order: z.int(),
        thumbnail: thumbnail.optional(),
    });
}

export interface ProjectLinks {
    readonly repo: string;
    readonly subdomain?: string | undefined;
}

/** `owner/repo` of a validated GitHub repo URL. */
export function repoPath(repo: string): string {
    const match = GITHUB_REPO_URL.exec(repo);
    if (!match?.[1]) {
        throw new Error(`Not a GitHub repo URL: ${repo}`);
    }
    return match[1];
}

/** Where the card's main link goes: the project's own subdomain when it has one, otherwise its repo. */
export function projectHref({ repo, subdomain }: ProjectLinks): string {
    return subdomain ? projectUrl(subdomain) : repo;
}

export function statusLabel(status: ProjectStatus): string {
    return STATUS_LABELS[status];
}

/** A copy sorted by `order`, ties broken by title so the page never depends on file-system order. */
export function sortProjects<T extends { order: number; title: string }>(projects: readonly T[]): T[] {
    return [...projects].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

/** Only live projects with their own address can be screenshotted. */
export function isScreenshotTarget({
    status,
    subdomain,
}: {
    status: ProjectStatus;
    subdomain?: string | undefined;
}): boolean {
    return status === 'live' && subdomain !== undefined;
}

/** Repo-relative path the sync script writes the screenshot to. */
export function thumbnailFile(slug: string): string {
    return `src/assets/projects/${slug}.avif`;
}

/** The `thumbnail` frontmatter value that points at that file (relative to `src/content/projects/<slug>.md`). */
export function thumbnailFrontmatter(slug: string): string {
    return `../../assets/projects/${slug}.avif`;
}
