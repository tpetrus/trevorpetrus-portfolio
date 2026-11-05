// Refreshes the committed, generated project assets by hand: `npm run sync:projects`. Nothing here runs at build time
// (the site makes no network calls then); run it when a project changes, review the diff, and commit the outputs.
//
// For every project in src/content/projects/*.md it
//   1. writes the repo's creation date, the newest default-branch commit date (skipping bot and sync commits, so the
//      bot's own PR never moves it), the GitHub About text (the card description) and the topics mapped to display
//      names (the card tech chips) to src/data/project-meta.json (GitHub API, `GITHUB_TOKEN` from the environment when
//      set, which lifts the unauthenticated rate limit), and
//   2. for live projects with a subdomain, screenshots the running site to src/assets/projects/<slug>.avif, but only
//      when `planCapture` says so: the repo's head moved past the `capturedSha` in the meta file and the live site is
//      known to serve it (green check runs, or no check runs and the commit is old enough), the file is missing, or
//      `--force` is given. An unchanged repo therefore never yields a new image, whatever the machine encodes.
// Every capture goes through the blank-capture guard (src/lib/captureGuard.ts): a bad status, a wrong size, an AVIF
// outside its byte limits or a flat image is rejected. A rejected or failed capture affects only its project, which
// keeps its previous file and `capturedSha`; the other outputs are still written and the run exits 1 (decision D12).
// The copy comes from GitHub, so a repo with an empty About or an unmapped topic fails the whole run before anything is
// written (see src/lib/projectSync.ts). The run also exits 1 when every target that needed its check runs could not
// read them (a token or response-shape problem rather than one flaky project), after writing the other outputs.
// `--check` computes everything and writes nothing. Parsing, planning and judging live in src/lib, so this file only
// does I/O: `main` takes its I/O as `SyncDeps`, which is how scripts/sync-projects.test.ts drives it without a network
// or a browser.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium, type Browser } from '@playwright/test';
import sharp from 'sharp';

import { projectUrl } from '../src/config/site.ts';
import { assessCapture } from '../src/lib/captureGuard.ts';
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
    type CheckRun,
    checkRunsApiUrl,
    deployReadFailedEverywhere,
    deployRunsAllStale,
    type DeployState,
    deployStateFromCheckRuns,
    EXIT_ERROR,
    EXIT_OK,
    EXIT_WOULD_CHANGE,
    formatCaptureFailure,
    formatCopyError,
    formatDeployReadError,
    formatDeploySkipWarning,
    formatStaleDeployWarning,
    formatSyncSummary,
    GITHUB_RETRY_DELAY_MS,
    GitHubHttpError,
    isTransientGitHubError,
    nextCheckRunsPage,
    parseCheckRunsPage,
    parseSyncArgs,
    planCapture,
    planCaptureWithoutDeploy,
    type ProjectReport,
    type RepoCopyInput,
    type ScreenshotOutcome,
    type SyncExitCode,
    validateCopy,
} from '../src/lib/projectSync.ts';

const PROJECTS_DIRECTORY = 'src/content/projects';
const META_FILE = 'src/data/project-meta.json';
const VIEWPORT = { width: 1280, height: 800 };
const SCALE = 2;
const AVIF_QUALITY = 80;
const PAGE_TIMEOUT_MS = 30_000;
const LAUNCH_TIMEOUT_MS = 60_000;
const FETCH_TIMEOUT_MS = 30_000;
const NETWORK_IDLE_TIMEOUT_MS = 10_000;

// Extra Chromium flags. None are needed: the S2 trial on ubuntu-latest (GPU-less, run 41934146814) rendered the
// AudioVisualizer's WebGL previews with the default software path, so the blank capture of PR #20 was a timing race,
// which the appSelector wait and the guard now cover. Add GL flags here only if a runner change brings it back.
export const CHROMIUM_ARGS: readonly string[] = [];

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
    /**
     * GET with the GitHub headers; rejects with a `GitHubHttpError` on a non-2xx answer and with the `fetch` error on a
     * network failure or the request timeout. `main` retries a transient failure once (`isTransientGitHubError`).
     */
    fetchJson(url: string): Promise<unknown>;
    /** Resolves after `ms` milliseconds (the wait before a retry; instant in the tests). */
    sleep(ms: number): Promise<void>;
    /** The file's bytes, or `undefined` when it does not exist. */
    readFile(path: string): Buffer | undefined;
    writeFile(path: string, data: Buffer): void;
    /** Screenshots the live site once `appSelector` is visible. Rejects when the page or the selector times out. */
    capture(target: CaptureTarget): Promise<Capture>;
    /** Encodes a screenshot PNG as the committed AVIF (`encodeAvif` in production). */
    encodeAvif(png: Buffer): Promise<Buffer>;
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

/**
 * The committed screenshot encoding. It is a dependency of `main` because effort 6 takes tens of seconds per 2560x1600
 * image on a CI runner, which the specs cannot afford once per test; they inject a faster encoder.
 */
export function encodeAvif(png: Buffer): Promise<Buffer> {
    return sharp(png).avif({ quality: AVIF_QUALITY, effort: 6 }).toBuffer();
}

type CaptureResult = { ok: true; avif: Buffer } | { ok: false; reasons: string[] };

// Takes, measures and judges one screenshot. The guard sees the AVIF's length, so the encode happens here too.
async function captureAndAssess(target: CaptureTarget, deps: SyncDeps): Promise<CaptureResult> {
    try {
        const { png, status } = await deps.capture(target);
        const { width, height } = await sharp(png).metadata();
        const { channels } = await sharp(png).stats();
        const avif = await deps.encodeAvif(png);
        const verdict = assessCapture({
            status,
            width,
            height,
            expectedWidth: VIEWPORT.width * SCALE,
            expectedHeight: VIEWPORT.height * SCALE,
            bytes: avif.length,
            channelStdev: channels.slice(0, 3).map((channel) => channel.stdev),
        });
        return verdict.ok ? { ok: true, avif } : { ok: false, reasons: [...verdict.reasons] };
    } catch (error) {
        return { ok: false, reasons: [messageOf(error)] };
    }
}

// Makes one GitHub read, and one more after `GITHUB_RETRY_DELAY_MS` when the first failed transiently (a 5xx, a dropped
// connection, a timeout). Only the request is retried: callers parse the answer outside it, so a shape error is final.
async function fetchWithRetry(deps: SyncDeps, url: string): Promise<unknown> {
    try {
        return await deps.fetchJson(url);
    } catch (error) {
        if (!isTransientGitHubError(error)) throw error;
        await deps.sleep(GITHUB_RETRY_DELAY_MS);
        return deps.fetchJson(url);
    }
}

// Reads every page of a commit's latest check runs. Any failure (request, shape, too many pages) rejects, and the
// caller treats that as an unknown deploy for this project only.
async function fetchAllCheckRuns(repo: string, sha: string, deps: SyncDeps): Promise<CheckRun[]> {
    const runs: CheckRun[] = [];
    let page: number | undefined = 1;
    let pagesFetched = 0;
    while (page !== undefined) {
        const parsed = parseCheckRunsPage(await fetchWithRetry(deps, checkRunsApiUrl(repo, sha, page)));
        runs.push(...parsed.runs);
        pagesFetched += 1;
        page = nextCheckRunsPage(pagesFetched, parsed.runs.length, runs.length, parsed.totalCount);
    }
    return runs;
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
            const repoFacts = factsFromRepo(await fetchWithRetry(deps, repoApiUrl(project.repo)));
            const head = headFromCommits(await fetchWithRetry(deps, commitsApiUrl(project.repo)));
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

        const now = deps.now();
        const reports: ProjectReport[] = [];
        const screenshots: Output[] = [];
        const failures: string[] = [];
        // Slugs whose check runs were requested, and those among them whose read threw: when they are the same set,
        // no deploy could be read at all and the run exits 1 after writing everything else.
        const requested: string[] = [];
        const unknown: string[] = [];
        let meta = oldMeta;
        for (const [index, current] of projects.entries()) {
            const { repoFacts, head } = facts[index];
            const copy = validation.copy[current.slug];
            const old = oldMeta[current.slug];
            // A project keeps its recorded commit unless a capture below passes, so a skipped or failed screenshot
            // never claims a commit it was not taken at.
            let capturedSha = old?.capturedSha;
            let screenshot: ScreenshotOutcome = { kind: 'not-a-target' };

            if (isScreenshotTarget(current)) {
                const output = thumbnailFile(current.slug);
                const planInput = {
                    capturedSha,
                    head,
                    thumbnailExists: deps.readFile(output) !== undefined,
                    force: args.force,
                    now,
                };
                // The check runs are fetched only when the deploy can change the decision: an up-to-date or forced
                // screenshot never asks GitHub for them. A failed read is not fatal; it skips this one screenshot.
                let decision = planCaptureWithoutDeploy(planInput);
                let unknownDetail: string | undefined;
                if (decision === undefined) {
                    let deploy: DeployState;
                    let stale = false;
                    requested.push(current.slug);
                    try {
                        const runs = await fetchAllCheckRuns(current.repo, head.sha, deps);
                        deploy = deployStateFromCheckRuns(runs, now);
                        stale = deployRunsAllStale(runs, now);
                    } catch (error) {
                        deploy = 'unknown';
                        unknownDetail = messageOf(error);
                        unknown.push(current.slug);
                    }
                    // A stuck deploy reads as `none`; say so, or it would pass silently. The log is outside the try so a
                    // throwing logger can never turn a readable deploy into `unknown`.
                    if (stale) deps.log(formatStaleDeployWarning(current.slug));
                    decision = planCapture({ ...planInput, deploy });
                }
                if (!decision.capture) {
                    screenshot = { kind: 'skipped', reason: decision.reason };
                    // A deploy skip is a warning, not a failure: it leaves the exit code alone.
                    const warning = formatDeploySkipWarning(current.slug, decision.reason, unknownDetail);
                    if (warning !== undefined) deps.log(warning);
                } else {
                    const target: CaptureTarget = {
                        ...current,
                        url: projectUrl(current.subdomain!),
                        appSelector: current.appSelector!,
                    };
                    const result = await captureAndAssess(target, deps);
                    if (result.ok) {
                        const changed = !deps.readFile(output)?.equals(result.avif);
                        screenshots.push({
                            path: output,
                            data: result.avif,
                            note: `, ${kilobytes(result.avif.length)}`,
                        });
                        capturedSha = head.sha;
                        screenshot = { kind: 'captured', reason: decision.reason, changed };
                        if (current.thumbnail === undefined) {
                            deps.log(
                                `Reminder: add "thumbnail: ${thumbnailFrontmatter(current.slug)}" to ${PROJECTS_DIRECTORY}/${current.slug}.md`,
                            );
                        }
                    } else {
                        screenshot = { kind: 'failed', reasons: result.reasons };
                        failures.push(formatCaptureFailure(current.slug, result.reasons));
                    }
                }
            }

            const tech = [...copy.tech];
            meta = mergeProjectMeta(meta, current.slug, {
                created: repoFacts.created,
                updated: head.date,
                description: copy.description,
                tech,
                ...(capturedSha ? { capturedSha } : {}),
            });
            reports.push({
                slug: current.slug,
                copyChanged:
                    old === undefined ||
                    old.description !== copy.description ||
                    old.tech.length !== tech.length ||
                    old.tech.some((name, position) => name !== tech[position]),
                datesChanged: old === undefined || old.created !== repoFacts.created || old.updated !== head.date,
                screenshot,
            });
            deps.log(`${current.slug}: created ${repoFacts.created}, last commit ${head.date}`);
        }

        // Nothing is written until every fetch, validation and capture has finished, and only when the bytes differ,
        // so unchanged output keeps its timestamp and git sees no change.
        // The screenshots go first: the meta file records each `capturedSha`, so it must never land before its image.
        const outputs: Output[] = [
            ...screenshots,
            { path: META_FILE, data: Buffer.from(serializeProjectMeta(meta)), note: '' },
        ];
        let anyChange = false;
        for (const { path, data, note } of outputs) {
            const changed = !deps.readFile(path)?.equals(data);
            anyChange ||= changed;
            if (changed && !args.check) deps.writeFile(path, data);
            const verb = args.check ? (changed ? 'would change' : 'unchanged') : changed ? 'written' : 'unchanged';
            deps.log(`${path}: ${verb}${note}`);
        }
        for (const line of failures) deps.error(line);
        deps.summary(formatSyncSummary(reports, { check: args.check }));

        // Every deploy read failing is a misconfiguration (token, response shape), not one flaky project.
        const deployUnreadable = deployReadFailedEverywhere(requested, unknown);
        if (deployUnreadable) deps.error(formatDeployReadError(unknown));
        if (failures.length > 0 || deployUnreadable) return EXIT_ERROR;
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

export async function fetchGitHub(url: string): Promise<unknown> {
    const token = process.env.GITHUB_TOKEN;
    const response = await fetch(url, {
        headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'trevorpetrus-portfolio-sync-projects',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
        // The error body is never read, so cancel it to release the connection at once. A failed cancel must not hide the
        // HTTP error below, which callers classify by its status.
        await response.body?.cancel().catch(() => undefined);
        // A rate limit looks like a plain 403 or 429; these headers tell the two apart and say when it lifts.
        const remaining = response.headers.get('x-ratelimit-remaining');
        const reset = response.headers.get('x-ratelimit-reset');
        const limit = [
            remaining === null ? '' : `x-ratelimit-remaining ${remaining}`,
            reset === null ? '' : `x-ratelimit-reset ${reset}`,
        ].filter(Boolean);
        throw new GitHubHttpError(
            response.status,
            `GitHub API answered ${response.status} ${response.statusText} for ${url}${limit.length > 0 ? ` (${limit.join(', ')})` : ''}`,
        );
    }
    return response.json();
}

async function screenshot(browser: Browser, url: string, appSelector: string): Promise<Capture> {
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
        const response = await page.goto(url, { waitUntil: 'load' });
        // Best effort only: the app may stream or poll and never go idle, so a timeout here is not an error. The
        // selector wait below is what proves the app rendered.
        await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => undefined);
        // The app is a client-side SPA: the load event fires on an empty shell, so wait for the element it renders
        // once it is ready (the project's `appSelector`).
        await page.locator(appSelector).first().waitFor({ state: 'visible' });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForFunction(() =>
            Array.from(document.images).every((image) => {
                const { top, bottom } = image.getBoundingClientRect();
                const inViewport = bottom > 0 && top < window.innerHeight;
                return !inViewport || image.complete;
            }),
        );
        const png = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
        return { png, status: response?.status() ?? null };
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
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        readFile: readIfPresent,
        writeFile(path, data) {
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, data);
        },
        async capture(project) {
            browser ??= chromium.launch({ args: [...CHROMIUM_ARGS], timeout: LAUNCH_TIMEOUT_MS });
            return screenshot(await browser, project.url, project.appSelector);
        },
        encodeAvif,
        now: () => new Date(),
        summary(markdown) {
            const file = process.env.GITHUB_STEP_SUMMARY;
            if (file) appendFileSync(file, markdown);
        },
        log: (line) => console.log(line),
        error: (line) => console.error(line),
        async close() {
            if (browser) await (await browser).close();
        },
    };
}

// Run only when executed directly (the bundle under node_modules/.cache), never when a spec imports this module. The
// path is resolved through symlinks because Node reports `import.meta.url` as the real path.
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
// A path form the comparison does not expect (drive-letter case, 8.3 names) would otherwise make the bundle exit 0
// having done nothing, which an unattended run would read as "nothing changed".
if (!isMain && process.argv[1] !== undefined && basename(process.argv[1]) === 'sync-projects.mjs') {
    console.error(`sync-projects: not running: ${import.meta.url} is not ${process.argv[1]}`);
    process.exitCode = 1;
}
if (isMain) {
    const deps = realDeps();
    try {
        process.exitCode = await main(process.argv.slice(2), deps);
    } finally {
        await deps.close();
    }
}
