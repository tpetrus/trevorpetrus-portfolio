// Refreshes the committed, generated project assets by hand: `npm run sync:projects`. Nothing here runs at build time
// (the site makes no network calls then); run it when a project changes, review the diff, and commit the outputs.
//
// For every project in src/content/projects/*.md it
//   1. writes the repo's creation date, the newest default-branch commit date, the GitHub About text (the card
//      description) and the topics mapped to display names (the card tech chips) to src/data/project-meta.json (GitHub
//      API, `GITHUB_TOKEN` from the environment when set, which lifts the unauthenticated rate limit), and
//   2. for live projects with a subdomain, screenshots the running site to src/assets/projects/<slug>.avif.
// The copy comes from GitHub, so a repo with an empty About or an unmapped topic fails the whole run before anything is
// written (see src/lib/projectSync.ts). `--check` computes everything and writes nothing; `--force` is accepted for the
// screenshot rules that follow. Parsing and validation live in src/lib, so this file only does I/O: `main` takes its
// I/O as `SyncDeps`, which is how scripts/sync-projects.test.ts drives it without a network or a browser.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium, type Browser } from '@playwright/test';
import sharp from 'sharp';

import { projectUrl } from '../src/config/site.ts';
import {
    commitsApiUrl,
    factsFromRepo,
    headFromCommits,
    mergeProjectMeta,
    parseProjectMeta,
    repoApiUrl,
    serializeProjectMeta,
    type HeadCommit,
    type ProjectMeta,
    type RepoFacts,
} from '../src/lib/projectMeta.ts';
import { readProjectFrontmatter, type ProjectFrontmatter } from '../src/lib/projectSource.ts';
import { isScreenshotTarget, thumbnailFile, thumbnailFrontmatter } from '../src/lib/projects.ts';
import {
    EXIT_ERROR,
    EXIT_OK,
    EXIT_WOULD_CHANGE,
    formatCopyError,
    parseSyncArgs,
    validateCopy,
    type RepoCopyInput,
    type SyncExitCode,
} from '../src/lib/projectSync.ts';

const PROJECTS_DIRECTORY = 'src/content/projects';
const META_FILE = 'src/data/project-meta.json';
const VIEWPORT = { width: 1280, height: 800 };
const SCALE = 2;
const MAX_IMAGE_BYTES = 500 * 1024;
const AVIF_QUALITY = 80;
const PAGE_TIMEOUT_MS = 30_000;

/** A project's frontmatter plus its slug (the markdown file name). */
export interface Project extends ProjectFrontmatter {
    slug: string;
}

/** A screenshot target as `capture` receives it: `appSelector` is required for targets by the schema (contract C2). */
export type CaptureTarget = Project & { url: string; appSelector: string };

/** What `capture` returns: the PNG and the HTTP status of the navigation response (`null` when there was none). */
export interface Capture {
    png: Buffer;
    status: number | null;
}

/** Everything `main` does to the outside world (frozen in S2). */
export interface SyncDeps {
    listProjects(): Project[];
    /** GET with the GitHub headers; rejects on a non-2xx answer or after the request timeout. */
    fetchJson(url: string): Promise<unknown>;
    /** The file's bytes, or `undefined` when it does not exist. */
    readFile(path: string): Buffer | undefined;
    writeFile(path: string, data: Buffer): void;
    /** Screenshots the live site once `appSelector` is visible. Rejects when the page or the selector times out. */
    capture(target: CaptureTarget): Promise<Capture>;
    /** The current time, for the settle delay of `planCapture`. */
    now(): Date;
    /** Appends GitHub-flavored markdown to the job summary (`GITHUB_STEP_SUMMARY`); does nothing when it is unset. */
    summary(markdown: string): void;
    log(line: string): void;
    error(line: string): void;
}

function kilobytes(bytes: number): string {
    return `${(bytes / 1024).toFixed(1)} kB`;
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

interface Output {
    path: string;
    data: Buffer;
    note: string;
}

export async function main(argv: readonly string[], deps: SyncDeps): Promise<SyncExitCode> {
    let args;
    try {
        args = parseSyncArgs(argv);
    } catch (error) {
        deps.error(messageOf(error));
        return EXIT_ERROR;
    }

    let project: Project | undefined;
    try {
        const projects = deps.listProjects();
        const existing = deps.readFile(META_FILE);
        const oldMeta: ProjectMeta = existing ? parseProjectMeta(JSON.parse(existing.toString('utf8'))) : {};

        const facts: { repoFacts: RepoFacts; head: HeadCommit }[] = [];
        const inputs: RepoCopyInput[] = [];
        for (project of projects) {
            const repoFacts = factsFromRepo(await deps.fetchJson(repoApiUrl(project.repo)));
            const head = headFromCommits(await deps.fetchJson(commitsApiUrl(project.repo)));
            facts.push({ repoFacts, head });
            inputs.push({
                slug: project.slug,
                repo: project.repo,
                description: repoFacts.description,
                topics: repoFacts.topics,
            });
        }
        project = undefined;

        // All or nothing: one bad About or topic anywhere stops the run before any file or screenshot is touched.
        const validation = validateCopy(inputs);
        if (!validation.ok) {
            for (const copyError of validation.errors) deps.error(formatCopyError(copyError));
            return EXIT_ERROR;
        }

        let meta = oldMeta;
        projects.forEach((current, index) => {
            const { repoFacts, head } = facts[index];
            const copy = validation.copy[current.slug];
            // The screenshot's recorded commit is the capture step's to change, so it is carried over untouched.
            const capturedSha = oldMeta[current.slug]?.capturedSha;
            meta = mergeProjectMeta(meta, current.slug, {
                created: repoFacts.created,
                updated: head.date,
                description: copy.description,
                tech: [...copy.tech],
                ...(capturedSha ? { capturedSha } : {}),
            });
            deps.log(`${current.slug}: created ${repoFacts.created}, last commit ${head.date}`);
        });

        const outputs: Output[] = [{ path: META_FILE, data: Buffer.from(serializeProjectMeta(meta)), note: '' }];
        for (project of projects.filter(isScreenshotTarget)) {
            const url = projectUrl(project.subdomain!);
            const output = thumbnailFile(project.slug);
            const png = await deps.capture({ ...project, url });
            const { width, height } = await sharp(png).metadata();
            const expectedWidth = VIEWPORT.width * SCALE;
            const expectedHeight = VIEWPORT.height * SCALE;
            if (width !== expectedWidth || height !== expectedHeight) {
                throw new Error(
                    `${url}: expected a ${expectedWidth}x${expectedHeight} screenshot, got ${width}x${height}`,
                );
            }
            const avif = await sharp(png).avif({ quality: AVIF_QUALITY, effort: 6 }).toBuffer();
            if (avif.length > MAX_IMAGE_BYTES) {
                throw new Error(`${output} is ${kilobytes(avif.length)}, over ${kilobytes(MAX_IMAGE_BYTES)}`);
            }
            outputs.push({ path: output, data: avif, note: `, ${kilobytes(avif.length)}` });
            if (project.thumbnail === undefined) {
                deps.log(
                    `Reminder: add "thumbnail: ${thumbnailFrontmatter(project.slug)}" to ${PROJECTS_DIRECTORY}/${project.slug}.md`,
                );
            }
        }
        project = undefined;

        // Nothing is written until every fetch, validation and capture has succeeded, and only when the bytes differ,
        // so unchanged output keeps its timestamp and git sees no change.
        let anyChange = false;
        for (const { path, data, note } of outputs) {
            const changed = !deps.readFile(path)?.equals(data);
            anyChange ||= changed;
            if (changed && !args.check) deps.writeFile(path, data);
            const verb = args.check ? (changed ? 'would change' : 'unchanged') : changed ? 'written' : 'unchanged';
            deps.log(`${path}: ${verb}${note}`);
        }
        return args.check && anyChange ? EXIT_WOULD_CHANGE : EXIT_OK;
    } catch (error) {
        deps.error(project ? `${project.repo}: ${messageOf(error)}` : messageOf(error));
        return EXIT_ERROR;
    }
}

function readProjects(): Project[] {
    return readdirSync(PROJECTS_DIRECTORY)
        .filter((name) => name.endsWith('.md'))
        .map((name) => {
            const path = join(PROJECTS_DIRECTORY, name);
            return { slug: basename(name, '.md'), ...readProjectFrontmatter(readFileSync(path, 'utf8'), path) };
        });
}

// Reads without a separate existence check, which would race with the write that follows it.
function readIfPresent(path: string): Buffer | undefined {
    try {
        return readFileSync(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
    }
}

async function fetchGitHub(url: string): Promise<unknown> {
    const token = process.env.GITHUB_TOKEN;
    const response = await fetch(url, {
        headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'trevorpetrus-portfolio-sync-projects',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });
    if (!response.ok) {
        throw new Error(`GitHub API answered ${response.status} ${response.statusText} for ${url}`);
    }
    return response.json();
}

async function screenshot(browser: Browser, url: string): Promise<Buffer> {
    const context = await browser.newContext({
        viewport: VIEWPORT,
        // 2x so the image is 2560px wide: the cover is about 1440 CSS px (2880 device px) on a 1920 display. The CSS viewport is
        // unchanged, so the page lays out exactly as before.
        deviceScaleFactor: SCALE,
        colorScheme: 'dark',
        reducedMotion: 'reduce',
    });
    try {
        const page = await context.newPage();
        page.setDefaultTimeout(PAGE_TIMEOUT_MS);
        await page.goto(url, { waitUntil: 'load' });
        // The app is a client-side SPA: the load event fires on an empty shell. Its h1 is visually hidden, so wait for
        // it to be attached rather than visible.
        await page.locator('h1').first().waitFor({ state: 'attached' });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForFunction(() =>
            Array.from(document.images).every((image) => {
                const { top, bottom } = image.getBoundingClientRect();
                const inViewport = bottom > 0 && top < window.innerHeight;
                return !inViewport || image.complete;
            }),
        );
        return await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
    } finally {
        await context.close();
    }
}

/** The real I/O. The browser starts on the first capture, so a run without screenshots never launches one. */
export function realDeps(): SyncDeps & { close(): Promise<void> } {
    let browser: Promise<Browser> | undefined;
    return {
        listProjects: readProjects,
        fetchJson: fetchGitHub,
        readFile: readIfPresent,
        writeFile(path, data) {
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, data);
        },
        async capture(project) {
            browser ??= chromium.launch();
            return screenshot(await browser, project.url);
        },
        log: (line) => console.log(line),
        error: (line) => console.error(line),
        async close() {
            if (browser) await (await browser).close();
        },
    };
}

// Run only when executed directly (the bundle under node_modules/.cache), never when a spec imports this module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const deps = realDeps();
    try {
        process.exitCode = await main(process.argv.slice(2), deps);
    } finally {
        await deps.close();
    }
}
