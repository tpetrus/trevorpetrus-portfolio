// Refreshes the committed, generated project assets by hand: `npm run sync:projects`. Nothing here runs at build time
// (the site makes no network calls then); run it when a project changes, review the diff, and commit the outputs.
//
// For every project in src/content/projects/*.md it
//   1. writes the newest default-branch commit date and the repo's creation date to src/data/project-meta.json (GitHub
//      API, `GITHUB_TOKEN` from the environment when set, which lifts the unauthenticated rate limit), and
//   2. for live projects with a subdomain, screenshots the running site to src/assets/projects/<slug>.avif.
// Tech tags and copy are curated in the frontmatter and never rewritten. Parsing and validation live in src/lib, so
// this file only does I/O.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { chromium, type Browser } from '@playwright/test';
import sharp from 'sharp';

import { projectUrl } from '../src/config/site.ts';
import {
    commitsApiUrl,
    createdFromRepo,
    mergeProjectMeta,
    parseProjectMeta,
    repoApiUrl,
    serializeProjectMeta,
    updatedFromCommits,
} from '../src/lib/projectMeta.ts';
import { readProjectFrontmatter, type ProjectFrontmatter } from '../src/lib/projectSource.ts';
import { isScreenshotTarget, thumbnailFile, thumbnailFrontmatter } from '../src/lib/projects.ts';

const PROJECTS_DIRECTORY = 'src/content/projects';
const META_FILE = 'src/data/project-meta.json';
const VIEWPORT = { width: 1280, height: 800 };
const MAX_IMAGE_BYTES = 500 * 1024;
const AVIF_QUALITY = 80;
const PAGE_TIMEOUT_MS = 30_000;

interface Project extends ProjectFrontmatter {
    slug: string;
}

function readProjects(): Project[] {
    return readdirSync(PROJECTS_DIRECTORY)
        .filter((name) => name.endsWith('.md'))
        .map((name) => {
            const path = join(PROJECTS_DIRECTORY, name);
            return { slug: basename(name, '.md'), ...readProjectFrontmatter(readFileSync(path, 'utf8'), path) };
        });
}

function kilobytes(bytes: number): string {
    return `${(bytes / 1024).toFixed(1)} kB`;
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

// Writes only when the content differs, so unchanged output keeps its timestamp and git sees no change.
function writeIfChanged(path: string, data: Buffer | string): boolean {
    const bytes = typeof data === 'string' ? Buffer.from(data) : data;
    if (readIfPresent(path)?.equals(bytes)) return false;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    return true;
}

async function fetchGitHub(repo: string, url: string): Promise<unknown> {
    const token = process.env.GITHUB_TOKEN;
    const response = await fetch(url, {
        headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'trevorpetrus-portfolio-sync-projects',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });
    if (!response.ok) {
        throw new Error(`${repo}: GitHub API answered ${response.status} ${response.statusText}`);
    }
    return response.json();
}

async function syncMeta(projects: Project[]): Promise<void> {
    let meta = parseProjectMeta(JSON.parse(readFileSync(META_FILE, 'utf8')));
    for (const project of projects) {
        const updated = updatedFromCommits(await fetchGitHub(project.repo, commitsApiUrl(project.repo)));
        const created = createdFromRepo(await fetchGitHub(project.repo, repoApiUrl(project.repo)));
        meta = mergeProjectMeta(meta, project.slug, { updated, created });
        console.log(`${project.slug}: created ${created}, last commit ${updated}`);
    }
    const changed = writeIfChanged(META_FILE, serializeProjectMeta(meta));
    console.log(`${META_FILE}: ${changed ? 'updated' : 'unchanged'}`);
}

async function screenshot(browser: Browser, url: string): Promise<Buffer> {
    const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 1,
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

async function syncScreenshots(projects: Project[]): Promise<void> {
    const targets = projects.filter(isScreenshotTarget);
    if (targets.length === 0) return;

    const browser = await chromium.launch();
    try {
        for (const project of targets) {
            const url = projectUrl(project.subdomain!);
            const output = thumbnailFile(project.slug);
            const png = await screenshot(browser, url);
            const { width, height } = await sharp(png).metadata();
            if (width !== VIEWPORT.width || height !== VIEWPORT.height) {
                throw new Error(
                    `${url}: expected a ${VIEWPORT.width}x${VIEWPORT.height} screenshot, got ${width}x${height}`,
                );
            }
            const avif = await sharp(png).avif({ quality: AVIF_QUALITY, effort: 6 }).toBuffer();
            if (avif.length > MAX_IMAGE_BYTES) {
                throw new Error(`${output} is ${kilobytes(avif.length)}, over ${kilobytes(MAX_IMAGE_BYTES)}`);
            }
            const changed = writeIfChanged(output, avif);
            console.log(`${output}: ${changed ? 'written' : 'unchanged'}, ${kilobytes(avif.length)}`);
            if (project.thumbnail === undefined) {
                console.log(
                    `Reminder: add "thumbnail: ${thumbnailFrontmatter(project.slug)}" to ${PROJECTS_DIRECTORY}/${project.slug}.md`,
                );
            }
        }
    } finally {
        await browser.close();
    }
}

const projects = readProjects();
await syncMeta(projects);
await syncScreenshots(projects);
