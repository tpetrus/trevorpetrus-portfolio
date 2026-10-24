# Trevor Petrus portfolio site

A personal portfolio: an intro page (a 3D hero is planned), a photography gallery and a projects list. Static Astro site
served from Cloudflare Workers static assets. This is Step 1 of a multi-step build: the skeleton, tooling and CI exist;
the projects collection, photo gallery and 3D hero do not. Pages are placeholders, labeled as such on the page.

## Commands
| Task | Command |
|---|---|
| Dev server (HMR) | `npm run dev` |
| Format all files / check formatting (Prettier + `prettier-plugin-astro`) | `npm run format` / `npm run format:check` |
| Lint (ESLint 9 flat config, type-aware, also lints `.astro`) | `npm run lint` |
| Type-check the app (`astro check`) and `tests/e2e/` (`tsc -p tests/e2e`) | `npm run typecheck` |
| Unit tests (vitest, node environment) | `npm run test` |
| Unit tests with coverage (fails under 95%) | `npm run test:coverage` |
| Production build (static output to `dist/`) | `npm run build` |
| Bundle-size budget (reads the existing build) | `npm run size` |
| End-to-end tests (Playwright, 3 projects; the build must exist, served via wrangler) | `npm run test:e2e` (first time: `npm run test:e2e:install`) |
| Smoke tests (Chromium projects only) against `BASE_URL`, default the site URL in `src/config/site.ts` | `npm run test:smoke` |
| Lighthouse budget on all three pages, mobile then desktop (reads the existing build) | `npm run lighthouse` |
| Check the lockfile for entries Windows npm drops (see "Known gaps"); runs the published `ci-tools` CLI from `tpetrus/ci-workflows` | `npm run check:lockfile` |
| Serve the build locally like production | `npm run preview` (builds, then `wrangler dev`) |

Before finishing any change: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test:coverage` and
`npm run build` must pass with no errors. For anything that renders, also run `npm run test:e2e` and look at it in
`npm run dev`. CI runs all of these on every pull request. Never run `wrangler deploy` by hand: deploys come from
Cloudflare Workers Builds (see "CI and deploys").

## Stack
- **Astro 7, static output** (`astro.config.mjs`). No server adapter: `astro build` writes plain files to `dist/`.
  Pages in `src/pages/`, the shared layout in `src/layouts/BaseLayout.astro`.
- **View Transitions** via `<ClientRouter />` from `astro:transitions` in the base layout. Scripts that must run on every
  page (not only the first load) belong in an `astro:page-load` listener.
- **React 19 via `@astrojs/react`**, only for future interactive islands (the 3D hero). No page uses it yet, so the
  island runtime (`dist/_astro/client.*.js`) is emitted but never loaded; the JS budget excludes it for that reason.
- **Tailwind CSS 4** via `@tailwindcss/vite`, entry `src/styles/global.css`.
- **TypeScript strict** (`astro/tsconfigs/strict`). `tests/e2e/` is its own TypeScript program
  (`tests/e2e/tsconfig.json`).
- **Font:** self-hosted Inter via `@fontsource-variable/inter`, imported in the base layout (trivial with Astro, no
  third-party request).
- **Deploy:** Cloudflare Workers static assets: `wrangler.jsonc` (Worker name `portfolio`) serves `dist/`. Cloudflare
  Workers Builds is expected to deploy `main` to production and PR branches to preview URLs once it is connected (see
  "One-time setup"). GitHub Actions only checks; it never deploys.
- **Tooling:** Node 24 (`.nvmrc`), Prettier (4-space code, 2-space JSON/YAML), ESLint 9, Vitest, Playwright (Chromium and
  WebKit), size-limit, Lighthouse CI. `.github/workflows/` holds thin caller workflows; the actual CI/CD logic lives in
  [`tpetrus/ci-workflows`](https://github.com/tpetrus/ci-workflows) (pinned by commit SHA, tagged v0.1.3).

## Where things live
```
src/
  config/site.ts        THE site-config module: SITE_URL and PROJECTS_DOMAIN (the one place the domain is set), projectUrl()
  lib/                  pure, unit-tested logic (nav.ts: nav items and the active-link helper)
  layouts/              BaseLayout.astro: head/meta, skip link, nav, View Transitions, footer
  pages/                index, photography, projects (default exports required by Astro)
  styles/global.css     Tailwind entry and theme
  components/           shared Astro/React components (empty for now)
public/                 static files served from / (favicon.svg)
tests/e2e/              Playwright specs (smoke.spec.ts is tagged @smoke); its own tsconfig
scripts/smoke.ts        runs the @smoke tests against BASE_URL (Chromium projects only)
.github/                thin caller workflows and Dependabot config
```

## The domain: change it in one place
`SITE_URL` and `PROJECTS_DOMAIN` in `src/config/site.ts` are the only places the domain is written. `astro.config.mjs`
reads `SITE_URL` for Astro's `site` (canonical URLs), and `projectUrl(name)` derives `https://<name>.<PROJECTS_DOMAIN>`
for project subdomain links. They are two separate settings: on workers.dev they differ (`SITE_URL` defaults to
`https://portfolio.mypoke.workers.dev`, the Worker named `portfolio` under the account's workers.dev subdomain, while
`PROJECTS_DOMAIN` is `mypoke.workers.dev`, so a sibling is `https://audio-visualizer.mypoke.workers.dev`); on a custom
domain both become that domain. Switching to a custom domain is an edit of the two adjacent constants in
`src/config/site.ts`. The workers.dev URL is not confirmed live. There is
deliberately no environment-variable override: a second source of truth is what this setup avoids.

Two things live outside the code and must be changed together with the domain: the repository variable `PRODUCTION_URL`
(read by `smoke.yml`) and the custom domain/route on the Cloudflare Worker.

## Rules that matter most
1. **Named exports only.** Default exports are allowed only where a tool requires them: Astro pages, layouts and the Astro
   config, and the Vitest, Playwright and ESLint configs (lint enforces this).
2. **Logic lives outside the template.** Pure logic goes in `src/lib/` (or the config module) with a spec next to it;
   `.astro` files and islands wire things together and render.
3. **Accessibility is not optional.** Keep the landmarks, the skip link, one `<h1>` per page, a `<title>` and meta
   description per page, and `aria-current="page"` on the active nav link. `tests/e2e/a11y.spec.ts` runs axe on every page.
4. **Keep budgets honest.** Change `.size-limit.json` or `lighthouserc.json` only for growth you intend, in the same PR,
   with the reason in the PR description.
5. **Comments explain why**, in plain sentences, above the code they describe.
6. **American English** in code, comments, docs and commit messages.
7. **No secrets, and no tracked file over 2 MB.** CI enforces only the size limit (`max-file-size` in `ci.yml`); keeping
   secrets out is on you.

## Verifying changes
- `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test:coverage` and `npm run build` pass.
- `npm run test:e2e` passes (after `npm run build`). It loads every page in desktop Chrome, mobile Chrome (Pixel 7) and
  mobile Safari (iPhone 15, WebKit), checks the h1, title, no console or page errors, that nav links navigate without a
  full page load (View Transitions), the skip link, and axe. WebKit must be installed locally
  (`npm run test:e2e:install`); CI's e2e job runs in the Playwright container image, which has every browser.
- `npm run size` and `npm run lighthouse` pass after a build (Lighthouse needs Chrome; Playwright's Chromium works).
- Deploy-affecting changes: `npm run preview`, then load each page by URL; the PR's Cloudflare preview URL is the same
  check against the real host.

## CI and deploys
Every pull request runs these checks. All of the actual CI/CD logic runs in the shared
[`tpetrus/ci-workflows`](https://github.com/tpetrus/ci-workflows) repo; the files under `.github/workflows/` here are
thin callers that invoke its reusable workflows (pinned to a commit SHA) with this repo's inputs.
**Caveat:** GitHub sometimes displays a job from a called reusable workflow under a compound name
(`<caller job> / <inner job>`) rather than the inner job name alone, so the exact string a branch ruleset and PR checks
list may not match what's written here. Treat these names as best-effort from reading the workflow files, not as
confirmed, until they are observed on a real PR's checks, and correct this table then.

| Check (calling workflow -> job(s) in the shared reusable workflow) | What it gates |
|---|---|
| `ci.yml` -> `result` (`node-ci.yml`) | the one required check: format, lint, typecheck, unit tests with the 95% coverage threshold, the build and the 2 MB file-size limit (`quality`, `build`, `max-file-size`) are never optional; the bundle-size budget (`size`), the Lighthouse budget (`lighthouse`), the sharded Playwright suite (`e2e-plan`/`e2e`/`e2e-result`) and an offline link check (`links`) must each pass or be cleanly skipped |
| `pr-checks.yml` -> `pr-title` (`pr-checks.yml`) | the PR title is a Conventional Commit (see "Versioning and releases") |
| `pr-checks.yml` -> `version` (`pr-checks.yml`) | `package.json` and `package-lock.json` carry the version the title calls for; docs/ci/test titles change nothing that ships |
| `security.yml` (`security.yml`) | known-vulnerable production dependencies, risky dependencies added by a PR, and a zizmor scan of the workflows |
| `codeql.yml` -> `analyze` (`codeql.yml`) | static security analysis of the TypeScript and the workflows |
| Workers Builds (Cloudflare) | the PR builds and deploys to a preview URL (once connected) |

After a merge, Cloudflare is expected to deploy `main` to production, and "Smoke (production)" (`smoke.yml`) then runs the
`@smoke` tests against the live site; it also runs daily. It reads the production URL from the repository variable
`PRODUCTION_URL` and **is skipped while that variable is unset**. It waits for the check run named
`Workers Builds: portfolio` (the Worker name in `wrangler.jsonc`); that name is unconfirmed until a real deploy reports
it. If the smoke test fails, roll back from the Cloudflare dashboard (Workers -> portfolio -> Deployments) or with
`npx wrangler rollback`, then fix forward. Never deploy from CI.

`update-snapshots.yml` regenerates visual baselines, but this repo has no visual spec yet; it points at
`tests/e2e/visual.spec.ts`, which does not exist, so the workflow would find no tests until that spec is added.

When a gate fails:
- **Budgets** (`.size-limit.json`, `lighthouserc.json`): if the growth or score drop is intended, change the limit in the
  same PR and say why. Don't loosen a limit to get an unrelated change through. The JS budget (30 kB gzip, excluding the
  unused React island runtime) is for the plain site. The 3D hero island gets its own budget of 250 kB in Step 4; add it
  as a separate entry then rather than raising this one.
- **Dependencies**: Dependabot opens weekly grouped PRs (`astro` + `@astrojs/*` together, `three` + `@react-three/*` +
  `@types/three` together). It skips majors of `typescript`, `eslint`, `@eslint/js`, `eslint-plugin-astro` and
  `@types/node` on purpose (see the comments in `.github/dependabot.yml`). `eslint-plugin-astro` is on 1.x because 2.x
  and later require ESLint 10. Never merge a Dependabot PR with failing checks. The Playwright container image tag is
  derived from the installed `@playwright/test` version by the shared workflow, so bumping `@playwright/test` alone is
  enough.

## Versioning and releases
The version in `package.json` is set by automation from the PR title, and each release is tagged and published on
GitHub. Nobody edits the version by hand, and nothing is ever pushed to `main` by automation, because every push to
`main` is a production deploy. It starts at `0.0.0`.

**PR titles are Conventional Commits:** `type(scope)?!?: description`, for example `fix(nav): mark the current page`.
The merge commit carries the title, so the title is also what the release notes list. Allowed types: `feat`, `fix`,
`perf`, `refactor`, `build`, `chore`, `revert`, `style`, `docs`, `ci`, `test`. The `pr-title` check enforces it.

| Title | Bump |
|---|---|
| any type with `!` before the colon (`feat!:`, `fix(api)!:`) | major |
| `feat` | minor |
| `fix`, `perf`, `refactor`, `build`, `chore`, `revert`, `style` | patch |
| `docs`, `ci`, `test` | none: the version must equal the base branch's |

A `docs`, `ci` or `test` PR must not change anything that ships (`src/**`, `public/**`, `astro.config.mjs`,
`wrangler.jsonc`, or the `dependencies`/`devDependencies` of `package.json`); the `version` check fails and asks for a
releasing type instead. Dependabot titles are `build(deps): ...` / `build(deps-dev): ...` and `ci(deps): ...`
(configured in `.github/dependabot.yml`), so npm bumps release a patch and action bumps release nothing.

**What the version bot does** (`version-bump.yml` is a thin caller of `tpetrus/ci-workflows`'s `version-bump.yml`, which
works as a GitHub App so its pushes re-run the checks): on every PR event for a same-repo PR it computes the expected
version from the base branch and the title and, if the head differs, commits `chore: set version to X.Y.Z` to the PR
branch (editing only the version lines of `package.json` and `package-lock.json`). On every push to `main` it merges
`main` into each open same-repo PR branch and re-derives the version. It never runs code from the PR branch (it runs
with secrets under `pull_request_target`; the zizmor suppression in the workflow explains why that is safe). If the bot
is down, run `npx --yes --package=github:tpetrus/ci-workflows#v1 ci-tools release write-version <version>` yourself; the failing
`version` check names the exact version.

**What `release.yml` does:** on every push to `main`, if the tag `v<package.json version>` does not exist, it builds the
release notes from the PR titles merged since the previous tag, creates the tag and a GitHub Release, and otherwise
exits. To replace the generated notes, add `.github/release-notes/v<version>.md` in the PR.

## One-time setup (repository admin; none of this is done yet)
1. Create the GitHub repository and push this branch.
2. Create a GitHub App (Settings -> Developer settings -> GitHub Apps) with repository permissions Contents: read and
   write, Pull requests: read and write, Workflows: read and write, Metadata: read. No webhook is needed. Install it on
   this repository only. Add its App ID as the secret `RELEASE_APP_ID` and a generated private key as
   `RELEASE_APP_PRIVATE_KEY`, in both Settings -> Secrets -> Actions and Settings -> Secrets -> Dependabot.
3. In the `main` ruleset, require the `result` (CI), `pr-title` and `version` checks (confirm the exact names on a real PR)
   and require branches to be up to date before merging.
4. Connect the repository to Cloudflare Workers Builds for the Worker `portfolio` (production branch `main`, build command
   `npm run build`; the deploy and preview commands are Cloudflare's defaults, `wrangler deploy` and `wrangler preview`;
   confirm in the dashboard).
5. After the first deploy, set the repository variable `PRODUCTION_URL` (Settings -> Secrets and variables -> Actions ->
   Variables) to the live URL so "Smoke (production)" starts running.

## Testing
Specs sit next to the file they test (`foo.ts` -> `foo.test.ts`). `npm run test:coverage` enforces 95% for lines,
statements, functions and branches over `src/lib/**` and `src/config/**` (`vitest.config.ts`); keep it green, and write
specs rather than excluding files. Specs run in node. End-to-end specs live in `tests/e2e/`; tag tests that are safe to
run against production `@smoke`. App code must never import from `tests/` (lint enforces it). `npm run test:smoke` runs
only the Chromium projects (`chromium-*`) because the shared smoke workflow installs Chromium alone.

## Known gaps (don't copy, don't build on)
- **`npm install` on Windows can break the lockfile for Linux.** It drops the bundled
  `@tailwindcss/oxide-wasm32-wasi/node_modules/*` entries, so `npm ci` fails on Linux ("Missing: ... from lock file").
  Run `npm run check:lockfile` after any install on Windows; every workflow runs the equivalent check before `npm ci`.
  To repair, take `main`'s copy (`git checkout origin/main -- package-lock.json`) and redo the install, or install on
  Linux/WSL. **`npm run check:lockfile` itself currently fails on Node 24.13 on Windows** with
  `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, because `npx` installs the TypeScript CLI under `node_modules`, where
  Node refuses to strip types. Until that is fixed in `tpetrus/ci-workflows`, run its script from a local checkout:
  `node <path-to>/ci-workflows/scripts/check-lockfile.ts package-lock.json`.
  The fix (tpetrus/ci-workflows PR #2, to be released as v0.1.3) ships the CLI as built JavaScript; once `v1`
  points at that release, `npm run check:lockfile` works again and this workaround goes away.
- **The initial lockfile was repaired by hand.** The six entries Windows npm dropped were copied from the sibling
  AudioVisualizer-React lockfile (same `@tailwindcss/oxide` 4.3.3), because no `main` copy existed to restore from.
- **No visual-regression spec yet** (see "CI and deploys").
- **Dependency audit:** `npm install` reports vulnerabilities in dev tooling (not in production dependencies:
  `npm audit --omit=dev` reports none); CI's security workflow is the gate.
