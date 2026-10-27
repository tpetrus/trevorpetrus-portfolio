# Trevor Petrus portfolio site

Personal portfolio with three pages: home, photography and projects. It is a static Astro site styled with Tailwind CSS 4
and written in TypeScript, and it is served from Cloudflare Workers static assets.

This README is the owner's guide to the commands you run by hand. For the architecture, the project layout, CI internals
and the rules that apply to every change, see [AGENTS.md](AGENTS.md).

## Contents

- [Setup](#setup)
- [Everyday commands](#everyday-commands)
- [Checks before a PR](#checks-before-a-pr)
- [Add or update photos](#add-or-update-photos)
- [Add or update a project](#add-or-update-a-project)
- [Visual baselines](#visual-baselines)
- [Releases and versions](#releases-and-versions)
- [Deploys and rollback](#deploys-and-rollback)

## Setup

Node 24 is required (`.nvmrc`; `package.json` says `>=24`).

```sh
npm ci
```

Use `npm ci` for a clean, exact install from the lockfile. Use `npm install` only when you are changing dependencies.

**Windows gotcha.** `npm install` on Windows can drop the bundled `@tailwindcss/oxide-wasm32-wasi/node_modules/*` entries
from `package-lock.json`, and then `npm ci` fails on Linux (CI) with "Missing: ... from lock file". CI checks this before
every `npm ci`. To check or repair after an install on Windows (the tag below is the one `.github/workflows/` pins
today; use whatever tag they pin when you read this):

```sh
npx --yes --package=github:tpetrus/ci-workflows#vX.Y.Z ci-tools check-lockfile
npx --yes --package=github:tpetrus/ci-workflows#vX.Y.Z ci-tools repair-lockfile
```

`repair-lockfile` adds back the missing entries after checking their integrity hashes and never changes existing ones.
Exit code 1 means it could not repair. The version bot runs the same repair on PR branches, so a Windows install often
fixes itself there. See "Known gaps" in AGENTS.md for more.

## Everyday commands

| Command                | What it does                                                               |
| ---------------------- | -------------------------------------------------------------------------- |
| `npm run dev`          | Dev server with hot reload (`astro dev`).                                  |
| `npm run build`        | Static build to `dist/` (`astro build`). Makes no network calls.           |
| `npm run preview`      | Runs `npm run build`, then `wrangler dev`: serves `dist/` like production. |
| `npm run format`       | Rewrites every file with Prettier (`prettier --write .`).                  |
| `npm run format:check` | Checks formatting without changing anything (`prettier --check .`).        |

Run `npm run dev` while you work and look at the page. Run `npm run preview` when a change could behave differently on
Cloudflare than in the dev server (routing, headers, static asset rules). Run `npm run format` before committing if
`format:check` complains.

```sh
npm run dev
npm run preview   # wrangler dev prints the local URL
```

## Checks before a PR

CI runs all of these on every pull request. Before sending a change, run:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

For anything that renders, also run `npm run test:e2e` (after the build) and look at the result in `npm run dev`.

| Command                    | What it does and when to run it                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run lint`             | `astro sync`, then ESLint (type-aware, also lints `.astro`). The sync step generates the content types, so it works on a clean checkout.                           |
| `npm run typecheck`        | `astro check` for the app, then `tsc -p tests/e2e` for the end-to-end specs.                                                                                       |
| `npm run test`             | Vitest unit tests (`vitest run`), no coverage. Quick feedback while you work.                                                                                      |
| `npm run test:coverage`    | The same tests with coverage. Fails under 95% for lines, statements, functions and branches over `src/lib/**` and `src/config/**`.                                 |
| `npm run test:e2e`         | Playwright in three projects (`chromium-desktop`, `chromium-mobile`, `webkit-mobile`). Needs a build first; it starts `wrangler dev` on port 8787 (see `E2E_PORT`). |
| `npm run test:e2e:install` | Installs Chromium and WebKit with their system dependencies (`playwright install --with-deps chromium webkit`). Run once per machine.                              |
| `npm run test:smoke`       | Runs only the `@smoke` tests, in the Chromium projects, against a live site.                                                                                       |
| `npm run size`             | Bundle-size budget (`size-limit`). Reads the existing build, so run `npm run build` first.                                                                         |
| `npm run lighthouse`       | Lighthouse budget on the three pages, mobile and then desktop (`lhci autorun` twice). Reads the existing build, starts `wrangler dev` on port 8787, needs Chrome.  |

Environment variables:

- `E2E_PORT` (read in `playwright.config.ts`): the port `wrangler dev` uses for `test:e2e`, default `8787`. Set it to run
  the suite while another dev server holds the default port.
- `BASE_URL`: when set, `test:e2e` skips the local server and runs against that site instead. `test:smoke` uses it as the
  target too, and defaults to `SITE_URL` from `src/config/site.ts` when it is unset.
- `CI`: when set, Playwright retries failures twice, forbids `test.only` and never reuses a running server.
- `VISUAL_LOCAL=1`: forces `tests/e2e/visual.spec.ts` to run on Windows or macOS. Without it the spec skips there, because
  the committed baselines are Linux-only (see [Visual baselines](#visual-baselines)).

```sh
npm run build
npm run test:e2e
E2E_PORT=8800 npm run test:e2e              # in PowerShell: $env:E2E_PORT = '8800'; npm run test:e2e
BASE_URL=https://example.com npm run test:smoke
```

Extra arguments after `--` go to Playwright for `test:e2e` and `test:smoke` (`scripts/smoke.ts` appends them), for
example `npm run test:e2e -- --project chromium-desktop`.

Change `.size-limit.json` or `lighthouserc.json` only for growth you intend, in the same PR, with the reason in the PR
description.

## Add or update photos

Photos never go in git. The originals live in the R2 bucket `portfolio-photos`, and the repo holds only a data file
(`src/data/gallery/photography.json`) and one small sidecar per photo (`src/content/photography/<name>.yml`).

### One-time: set the upload credentials

The upload needs two user-scope environment variables. The account ID is the 32-character hex number in any Cloudflare
dashboard URL (`dash.cloudflare.com/<id>/...`). The token is an R2 API token with read and write access to the bucket.
Set them once in PowerShell, then open a new terminal (a running one does not see them):

```powershell
[Environment]::SetEnvironmentVariable('CLOUDFLARE_ACCOUNT_ID', '<account id>', 'User')
[Environment]::SetEnvironmentVariable('CLOUDFLARE_R2_BUCKET_READ_WRITE_API_KEY', '<token>', 'User')
```

The script hands the token to `wrangler r2 object put` through the child process's environment only and never prints it.

### Steps

1. **Put the JPEGs in `gallery-originals/photography/`.** The folder is gitignored; create it if it does not exist. Only
   `.jpg` and `.jpeg` files are accepted.

2. **Scaffold the sidecars.** For every accepted JPEG without a sidecar, this writes
   `src/content/photography/<name>.yml` from a template. It never overwrites an existing sidecar.

   ```sh
   npm run scaffold:gallery -- photography --dry-run   # only lists what it would do
   npm run scaffold:gallery -- photography
   ```

   Usage: `scaffold-gallery <collection> [--source <dir>] [--dry-run]`.
   - `--dry-run`: print the plan and write nothing.
   - `--source <dir>`: read the JPEGs from `<dir>` instead of `gallery-originals/photography`.

   It writes only inside `src/content/photography/`, and it lists the files it ignores (non-JPEGs, hidden files,
   duplicate names).

3. **Edit each sidecar.** Filled in, a sidecar looks like this:

   ```yaml
   alt: "A woman holds a protest sign in a crowd of other protesters"
   order: 1
   location:
     city: Lisbon
     country: Portugal
   ```

   - `alt` (required): one plain sentence saying what is in the photo, for people who cannot see it. The template's
     `TODO: describe this photo` placeholder is rejected: the sync fails and lists every sidecar that still has one.
   - `order` (optional): a whole number. The lowest comes first, ahead of photos without one.
   - `location` (optional): by default the sync derives a city and country from the photo's GPS, offline, using GeoNames.
     Write `city` and `country` to override the derived place or to name a photo without GPS, or write `location: false`
     to show no place. Expect an occasional odd name for a photo that borders a big city; fix it with an override.

4. **Dry run the sync.**

   ```sh
   npm run sync:gallery -- photography
   ```

   **A run without `--upload` writes nothing.** It does not touch R2 and does not write the JSON; it processes the images
   in memory and prints what it would do, and its last line says the data file was not written. Check the sizes, the
   places and the new, changed and unchanged counts. It also reports every missing sidecar, orphan sidecar, non-JPEG and
   duplicate name in one run. The first run that needs a GPS lookup downloads the GeoNames `cities1000` dataset (about
   11 MB zipped) into `node_modules/.cache/geonames/`; that is the one network call a dry run can make, and no
   coordinate is sent anywhere.

5. **Upload.**

   ```sh
   npm run sync:gallery -- photography --upload
   ```

   This re-encodes each new or changed original (strips GPS, keeps the camera EXIF fields), uploads it to R2, and only
   after every upload succeeded rewrites `src/data/gallery/photography.json`. A file whose bytes are unchanged is
   skipped, but its alt text and place are recomputed on every run, so an alt-text edit needs no re-upload.

6. **Commit** `src/data/gallery/photography.json` and the sidecars (`src/content/photography/*.yml`). Never commit the
   JPEGs.

7. **Regenerate the Photography visual baselines.** Adding or changing photos changes the Photography page screenshot, so
   `tests/e2e/visual.spec.ts` fails until you do. See [Visual baselines](#visual-baselines).

### Sync options

Usage: `sync-gallery <collection> [--source <dir>] [--upload] [--bucket <name>] [--account <id>]`. The collection is
required; running `npm run sync:gallery` with no arguments fails with `Name a collection.` and that usage text.

| Option or variable                          | Meaning                                                                                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `--source <dir>`                            | Where the originals are. Default `gallery-originals/<collection>`.                                                                  |
| `--upload`                                  | Upload to R2 and rewrite the JSON. Without it, nothing is uploaded or written.                                                      |
| `--bucket <name>` or `R2_BUCKET`            | The R2 bucket. The flag wins over the variable; the default is `portfolio-photos`.                                                  |
| `--account <id>` or `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account ID (32 hexadecimal characters). The flag wins over the variable. Required for `--upload`, not for a dry run. |
| `CLOUDFLARE_R2_BUCKET_READ_WRITE_API_KEY`   | The R2 API token. Environment only, there is no flag. Required for `--upload`, not for a dry run.                                   |

A missing option value (for example `--source` with nothing after it) or an unknown `--option` fails with the usage text.

**R2 objects are never deleted by the script.** If a photo's source is gone, it is dropped from the JSON with a notice,
but its object stays in the bucket. Remove it by hand in the Cloudflare dashboard.

Photos are displayed through fixed width sets because Cloudflare bills image transformations per unique width. See
"Gallery" in AGENTS.md before changing them.

## Add or update a project

The Projects page is built from the markdown files in `src/content/projects/`; the frontmatter is the data and the body is
unused.

1. Create `src/content/projects/<slug>.md`:

   ```yaml
   ---
   title: AudioVisualizer
   description: One or two sentences about the project.
   tech:
     - TypeScript
     - React
   status: live # live, in-progress or archived
   repo: https://github.com/<owner>/<repo>
   order: 1 # the lowest renders as the large featured card
   subdomain: audio-visualizer # optional: the DNS label only
   ---
   ```

   With a `subdomain`, the card links to the project's own site; without one, to the repo. A bad frontmatter file fails
   the build. Tech tags and the description are yours: the sync never rewrites them.

2. Run the sync:

   ```sh
   npm run sync:projects
   ```

   It takes no arguments. For every project it asks the GitHub API for the newest default-branch commit date and the
   repo's creation date and writes them to `src/data/project-meta.json`. For `live` projects that have a `subdomain` it
   also screenshots the running site with Chromium to `src/assets/projects/<slug>.avif` (1280x800; it fails if the image
   is over 500 kB). A file is written only if its bytes changed, and the script prints `updated`, `written` or
   `unchanged`.

   Set `GITHUB_TOKEN` in the environment to avoid the unauthenticated GitHub rate limit:

   ```powershell
   $env:GITHUB_TOKEN = '<token>'; npm run sync:projects
   ```

3. When the script screenshots a project that has no `thumbnail`, it prints a reminder. Add this line to the frontmatter:

   ```yaml
   thumbnail: ../../assets/projects/<slug>.avif
   ```

   `thumbnail` is optional; a card without one renders without an image.

4. Look at the screenshot, then commit the markdown, `src/data/project-meta.json` and the `.avif`.

The sync is manual and its outputs are committed; the build makes no network calls. Re-run it when a project changes and
commit the diff. CI never follows external links, so check a new project's links yourself.

## Visual baselines

`tests/e2e/visual.spec.ts` compares a full-page screenshot of every page, in each Playwright project, with committed
baselines in `tests/e2e/visual.spec.ts-snapshots/`. The baselines are Linux-only, so a GitHub Actions workflow
regenerates them, not your machine. Regenerate them after any deliberate visual change, including a change to the photos.

1. Push your branch and open the PR. Wait for the version bot's commit (`chore: set version to X.Y.Z`) to land on the
   branch, and pull it. If the branch moves while the workflow runs, its commit job fails cleanly without force-pushing,
   so just run it again.
2. Run the "Update visual snapshots" workflow on the branch, either from the Actions tab (choose the branch) or:

   ```sh
   gh workflow run update-snapshots.yml --ref <branch>
   ```

   It builds the site, runs the spec with `--update-snapshots` in the Playwright container image, and commits the images
   to the branch.

3. Pull the branch, then open the PR's Files changed tab and review the images. A regenerated baseline is an accepted
   change, so look at each one.
4. The snapshot commit is pushed as the GitHub App, so the PR checks start on it by themselves. Nothing more to push.

## Releases and versions

The PR title decides the version. Titles are Conventional Commits, `type(scope)?!?: description`, for example
`fix(nav): mark the current page`. The `pr-checks / pr-title` check enforces the format, and the merge commit carries the
title into the release notes.

| Title                                                          | Bump                                   |
| -------------------------------------------------------------- | -------------------------------------- |
| any type with `!` before the colon (`feat!:`, `fix(api)!:`)    | major                                  |
| `feat`                                                         | minor                                  |
| `fix`, `perf`, `refactor`, `build`, `chore`, `revert`, `style` | patch                                  |
| `docs`, `ci`, `test`                                           | none (the version must equal `main`'s) |

A `docs`, `ci` or `test` PR must not change anything that ships (`src/**`, `public/**`, `astro.config.mjs`,
`wrangler.jsonc`, or the dependencies in `package.json`); otherwise `pr-checks / version` fails and asks for a releasing
type.

**Never edit the version by hand.** The version bot commits `chore: set version to X.Y.Z` to the PR branch on every PR
event, and `release.yml` tags and publishes a GitHub Release on `main` when the tag for the new version does not exist.
If the bot is down, the failing `version` check names the exact version; write it yourself with (the tag is the one
`.github/workflows/` pins today):

```sh
npx --yes --package=github:tpetrus/ci-workflows#vX.Y.Z ci-tools release write-version <version>
```

To replace the generated release notes, add `.github/release-notes/v<version>.md` in the PR.

## Deploys and rollback

**Never run `wrangler deploy` by hand.** Cloudflare Workers Builds deploys `main` to production and each PR branch to a
preview URL; GitHub Actions only checks. After a merge, "Smoke (production)" runs the `@smoke` tests against the live
site, and it also runs daily.

To check a deploy-affecting change before merging, run `npm run preview` locally, then load each page; the PR's
Cloudflare preview URL is the same check on the real host.

If a production deploy is bad, roll back from the Cloudflare dashboard (Workers, `trevorpetrus-portfolio`, Deployments)
or from the terminal, then fix forward:

```sh
npx wrangler rollback
```

## More

[AGENTS.md](AGENTS.md) covers the stack, where things live, the design tokens, the gallery's internals, CI and the rules
that apply to every change.
