# Trevor Petrus portfolio site

A personal portfolio: an intro page (a 3D hero is planned), a photography gallery and a projects list. Static Astro site
served from Cloudflare Workers static assets. Step 1 (skeleton, tooling, CI), Step 2 (the Projects page, built from a
content collection) and Step 3 (the photo gallery pipeline and the Photography page) are done; the 3D hero is not. The
Photography page is real but empty ("Photos are on their way.") until photos are uploaded (see "Gallery"). The home page
is a placeholder, labeled as such on the page.

## Commands
| Task | Command |
|---|---|
| Dev server (HMR) | `npm run dev` |
| Format all files / check formatting (Prettier + `prettier-plugin-astro`) | `npm run format` / `npm run format:check` |
| Lint (`astro sync` first, so the generated content types exist on a clean checkout; then ESLint 9 flat config, type-aware, also lints `.astro`) | `npm run lint` |
| Type-check the app (`astro check`) and `tests/e2e/` (`tsc -p tests/e2e`) | `npm run typecheck` |
| Unit tests (vitest, node environment) | `npm run test` |
| Unit tests with coverage (fails under 95%) | `npm run test:coverage` |
| Production build (static output to `dist/`) | `npm run build` |
| Create starter alt-text sidecars for photos that lack one (`--dry-run` lists only; never overwrites; see "Gallery") | `npm run scaffold:gallery -- photography` |
| Bundle-size budget (reads the existing build) | `npm run size` |
| End-to-end tests (Playwright, 3 projects; the build must exist, served via wrangler) | `npm run test:e2e` (first time: `npm run test:e2e:install`) |
| Smoke tests (Chromium projects only) against `BASE_URL`, default the site URL in `src/config/site.ts` | `npm run test:smoke` |
| Lighthouse budget on all three pages, mobile then desktop (reads the existing build) | `npm run lighthouse` |
| Refresh the generated project assets by hand (GitHub last-commit dates and live-site screenshots; see "Projects") | `npm run sync:projects` |
| Publish a gallery collection by hand: processes JPEGs from `gallery-originals/<collection>` and, with `--upload`, uploads them to R2 and rewrites `src/data/gallery/<collection>.json`; a dry run without `--upload` (see "Gallery") | `npm run sync:gallery -- <collection> [--source <dir>] [--upload] [--bucket <name>] [--account <id>]` (the bucket defaults to `portfolio-photos`) |
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
- **PhotoSwipe 5** (`photoswipe`) is the gallery lightbox. Its glue is `src/scripts/galleryLightbox.ts`, imported by
  `Gallery.astro`, so its JS and CSS load only on a page that renders a gallery (not on the Photography page while it is
  empty). Astro runs a module script once, so the glue creates a lightbox on each `astro:page-load` that has `#gallery`
  and destroys it on `astro:before-swap` (PhotoSwipe binds to the elements present at `init()`, and `destroy()` is final).
- **React 19 via `@astrojs/react`**, only for future interactive islands (the 3D hero). No page uses it yet, so the
  island runtime (`dist/_astro/client.*.js`) is emitted but never loaded; the JS budget excludes it for that reason.
- **Tailwind CSS 4** via `@tailwindcss/vite`, entry `src/styles/global.css`.
- **TypeScript strict** (`astro/tsconfigs/strict`). `tests/e2e/` is its own TypeScript program
  (`tests/e2e/tsconfig.json`).
- **Fonts:** Archivo variable (display, headings), Inter variable (text) and IBM Plex Mono Regular 400 (captions, tags,
  footer), all latin only, SIL OFL 1.1, self-hosted. They use Astro's Fonts API (`fonts` in `astro.config.mjs`) with the
  `local` provider pointing at the woff2 files inside the installed `@fontsource-variable/archivo`,
  `@fontsource-variable/inter` and `@fontsource/ibm-plex-mono` packages, so the build stays offline. Do not switch to
  `fontProviders.fontsource()`, `google()` or the `npm` provider: the first two download at build time, and `npm` fails
  with `CannotFetchFontFile` in Astro 7.4.2 and ignores `subsets`. `<Font>` in `BaseLayout.astro` emits the `@font-face`
  rules (`font-display: swap`, metric-matched fallbacks) and preloads only Archivo, the face of the h1. The woff2 files
  land in `dist/_astro/fonts/` and have their own `.size-limit.json` entry. `global.css` maps them to Tailwind's
  `font-display`, `font-sans` and `font-mono`.
- **Shell:** `.surface-ink` (in `global.css`) is the reusable ink surface: ink background, paper text, `.link` in paper and the
  `:focus-visible` ring in `accent`; the footer is its first user and the D4 photography section reuses it. On paper,
  `.link` is `accent-deep` plus an underline. No JavaScript is involved in the focus or selection styles.
- **Design tokens:** `@theme` in `src/styles/global.css` holds the palette (light "paper" theme only), the fluid type
  scale (`text-step-n1` to `text-step-6`) and `px-edge`, `gap-gutter`, `max-w-measure`. `src/lib/designTokens.test.ts`
  reads the CSS and asserts the WCAG contrast of every pair in use; a new color pair goes into that spec in the same
  change. The accent `#ff4d1f` is only a fill behind ink text or text on ink, never text, a border or a focus ring on
  paper (2.94:1): use `accent-deep` there.
- **Deploy:** Cloudflare Workers static assets: `wrangler.jsonc` (Worker name `trevorpetrus-portfolio`) serves `dist/`. Cloudflare
  Workers Builds is connected: it deploys `main` to production and PR branches to preview URLs (see
  "One-time setup"). GitHub Actions only checks; it never deploys.
- **Tooling:** Node 24 (`.nvmrc`), Prettier (4-space code, 2-space JSON/YAML), ESLint 9, Vitest, Playwright (Chromium and
  WebKit), size-limit, Lighthouse CI. `.github/workflows/` holds thin caller workflows; the actual CI/CD logic lives in
  [`tpetrus/ci-workflows`](https://github.com/tpetrus/ci-workflows) (referenced by exact release tag, currently `@v0.2.0`).

## Where things live
```
src/
  config/site.ts        THE site-config module: SITE_URL and PROJECTS_DOMAIN (the one place the domain is set), projectUrl(),
                        and PHOTOS_ORIGIN (the one place the image host is set)
  lib/                  pure, unit-tested logic (nav.ts; numbering.ts: stable index numbers by date, shared by Projects
                        and later Photography/Art; projects.ts: the project schema and card helpers; projectMeta.ts,
                        projectSource.ts: parsing for the sync script and the page; date.ts: UTC date formatting;
                        gallery.ts: the collection registry (GALLERY_COLLECTIONS) and the entry schema; photography.ts:
                        the photography caption/sidecar schemas and template, EXIF mapping and caption
                        formatting; sidecarPlaceholder.ts: the TODO alt marker the schema rejects; gallerySync.ts:
                        sync arguments, planning, merging and the wrangler arguments; gallerySidecars.ts: the scaffold's
                        arguments and plan; galleryView.ts: the per-entry view
                        model the Gallery renders; imageUrl.ts: original and resized-variant URLs and the fixed width
                        sets; thumbhash.ts: ThumbHash validation and the WebP placeholder; exifLocation.ts: which
                        metadata keys are a location; location.ts: the city/country schemas, sidecar-vs-derived
                        merge and the caption text; geonames.ts: offline place lookup and `cities1000`
                        parsing; zip.ts: a minimal zip reader for the GeoNames download)
  content.config.ts     the `projects` content collection (schema comes from lib/projects.ts)
  content/projects/     one markdown file per project; the frontmatter is the data (the body is unused)
  assets/projects/      generated screenshots (<slug>.avif), committed; rendered through astro:assets
  data/project-meta.json  generated last-updated and creation dates keyed by project slug, committed
  data/gallery/         <collection>.json, written by sync-gallery and committed: one entry per photo (key, size,
                        ThumbHash, caption, alt); `[]` until photos are uploaded
  content/<collection>/ one <image basename>.yml sidecar per photo with the `alt` text and an optional `order`
                        (e.g. content/photography/); hand-written
  layouts/              BaseLayout.astro: head/meta, skip link, running-head header and nav, View Transitions, ink footer
  pages/                index, photography, projects (default exports required by Astro)
  styles/global.css     Tailwind entry and theme
  styles/lightbox.css   the lightbox caption styles
  components/           ProjectCard.astro, Caption.astro (label/title/byline/credit stack, slots for title, `byline`,
                        `credit`), SectionIndex.astro (numbered `role="list"` rows with 1px ink rules, one named slot per
                        row id), GitHubIcon.astro, Gallery.astro (generic over the collection),
                        GeonamesCredit.astro (the CC BY 4.0 credit line),
                        RunningHead.astro (the decorative vertical site/page name, `aria-hidden`, shown from `xl` up)
  scripts/galleryLightbox.ts  (src/scripts/) browser glue for the PhotoSwipe lightbox (DOM only, outside unit-test coverage)
public/                 static files served from / (favicon.svg)
tests/e2e/              Playwright specs (smoke.spec.ts is tagged @smoke); its own tsconfig; lightbox.spec.ts skips while
                        the photography data file is empty
gallery-originals/      gitignored: the source JPEGs for sync-gallery (images never go in git)
scripts/smoke.ts        runs the @smoke tests against BASE_URL (Chromium projects only)
scripts/scaffold-gallery.ts  manual: writes starter sidecars (I/O only; logic is in src/lib/gallerySidecars.ts)
scripts/sync-projects.ts  manual: writes project-meta.json and the screenshots (I/O only; logic is in src/lib)
scripts/sync-gallery.ts   manual: processes and uploads gallery images and writes src/data/gallery/<collection>.json
scripts/galleryImage.ts   the image processing the sync uses (sharp and exifr), with the location guards and the
                          GPS-to-city lookup; specs sit next to it (scripts/galleryImage.test.ts)
scripts/geonames.ts       downloads and caches GeoNames `cities1000` (I/O only; logic is in src/lib/geonames.ts)
.github/                thin caller workflows and Dependabot config
```

## The domain: change it in one place
`SITE_URL`, `PROJECTS_DOMAIN` and `PHOTOS_ORIGIN` in `src/config/site.ts` are the only places a domain is written.
`astro.config.mjs` reads `SITE_URL` for Astro's `site` (canonical URLs), and `projectUrl(name)` derives
`https://<name>.<PROJECTS_DOMAIN>` for project subdomain links. They are separate settings, and today they differ: the
site is on its custom domain (`SITE_URL` is `https://trevorpetr.us`, the Worker `trevorpetrus-portfolio` still being its
origin), but the projects are still served from workers.dev, so `PROJECTS_DOMAIN` stays `mypoke.workers.dev` and a project
link is `https://audio-visualizer.mypoke.workers.dev` (`audio-visualizer.trevorpetr.us` does not resolve yet). When a
project gets its custom domain, `PROJECTS_DOMAIN` becomes `trevorpetr.us`, which is an edit of that one constant.
`PHOTOS_ORIGIN` is `https://photos.trevorpetr.us`, the custom domain of the R2 bucket `portfolio-photos`. There is
deliberately no environment-variable override: a second source of truth is what this setup avoids.

Two things live outside the code and must be changed together with the domain: the repository variable `PRODUCTION_URL`
(read by `smoke.yml`) and the custom domain/route on the Cloudflare Worker. `PRODUCTION_URL` is still the old workers.dev
URL: it must be changed to `https://trevorpetr.us` when the PR that moves the domain merges (a manual step in the
repository settings).

## Projects
The Projects page is built from the `projects` content collection (`src/content/projects/*.md`, schema in
`src/lib/projects.ts`; a bad frontmatter file fails the build). The lowest `order` renders as the cover (large image,
giant numeral, caption); the rest are a numbered index (`SectionIndex`: a 1px rule, the number, then the caption stack
with the image on the right from `md:`), newest first. Each card is a `Caption`: a bold caps status label (plain text, no
chip), a bold caps title, and a byline with the tech list and "Updated <date>". **Numbers** come from `numberItems` in
`src/lib/numbering.ts`: ascending by the repo's creation date (`created` in `project-meta.json`), so the oldest is 01, the
newest has the highest number, and adding a project never renumbers another; ties on the same date go by slug, and a
project with no recorded `created` is numbered after every dated one (by slug), so it still renders; run the sync to
give it its place. The page shows them highest first. A card's main link is `projectUrl(subdomain)` when `subdomain` is set, otherwise the repo;
every card also has a GitHub icon link. The status is `live`, `in-progress` or `archived`. Tech tags and the description
are curated by hand in the frontmatter; the sync script never rewrites them.

**Add a project:**
1. Create `src/content/projects/<slug>.md` with `title`, `description` (1-2 sentences), `tech`, `status`, `repo`
   (`https://github.com/<owner>/<repo>`), `order`, and `subdomain` if it has its own address (the DNS label only).
2. Run `npm run sync:projects` (set `GITHUB_TOKEN` to avoid the unauthenticated GitHub rate limit). It records the newest
   default-branch commit date (`updated`) and the repo's creation date (`created`, which numbers the project) in
   `src/data/project-meta.json`, and for live projects with a subdomain it screenshots the
   site to `src/assets/projects/<slug>.avif` and prints a reminder to add
   `thumbnail: ../../assets/projects/<slug>.avif` to the frontmatter. Add it, look at the screenshot, and commit all of it.
3. `thumbnail` is optional (a card without one renders without an image); the date is omitted, and the number comes last, when the meta file
   has no entry for the slug.

**The sync is manual and its outputs are committed.** The build makes no network calls. Re-run the script when a project
changes and commit the diff (the screenshot is written only if its bytes changed; it fails above 500 kB). The
AudioVisualizer screenshot shows its mandatory "Audio source" dialog because the app cannot be shown without choosing an
audio source. **Nothing checks external links**: CI's lychee runs `--offline` against `dist/`, so subdomain and github.com
links are verified only by the smoke tests reading the `href`, never by following them.

## Gallery
The Photography page renders `src/data/gallery/photography.json` through `components/Gallery.astro`, which takes a
`collection` name and the parsed entries, so a later `art` collection reuses it (each collection registers its caption
schema, sidecar schema and caption formatter in `GALLERY_COLLECTIONS` in `src/lib/gallery.ts`; `art` is not built).
Images are never in git: originals live in an R2 bucket served from `PHOTOS_ORIGIN` in `src/config/site.ts` (the one place
the host is set; Cloudflare Images transformations only run on a hostname in the Cloudflare zone, never on workers.dev).
The page uses resized variants from `<origin>/cdn-cgi/image/<options>/<key>` (helpers in `src/lib/imageUrl.ts`) and links
"View original" to `<origin>/<key>`. The data file is committed and holds, per photo, the key, size, ThumbHash, caption
(camera settings and the place) and alt text; the build makes no network calls, and the ThumbHash becomes a small WebP placeholder at build time.
With no entries the page shows "Photos are on their way." and references no PhotoSwipe JavaScript.

**Add photos:**
1. Put the JPEGs in `gallery-originals/photography/` (gitignored; create the folder if it does not exist).
2. Scaffold the sidecars: `npm run scaffold:gallery -- photography` (add `--dry-run` to only list what it would do). For
   every accepted JPEG without one it writes `src/content/photography/<basename>.yml` from the collection's template, and
   it never overwrites an existing sidecar (exclusive create). The template holds `alt: "TODO: describe this photo"` and a
   commented-out `# order: 1` and `# location:` (see "Where it was taken").
3. Replace each `TODO` with real alt text (EXIF has no alt text) and, optionally, set an integer `order` (lowest first,
   ahead of photos without one) and a `location` override (see "Where it was taken"). The photography sidecar schema rejects an `alt` that starts with `TODO`
   (`ALT_PLACEHOLDER_MARKER` in `src/lib/sidecarPlaceholder.ts`, case-insensitive), so the sync fails, dry run included,
   and lists every such sidecar. It also reports every missing sidecar, orphan sidecar, non-JPEG and duplicate name in one
   run.
4. Dry run: `npm run sync:gallery -- photography`. It processes in memory and prints what it would do; it touches neither
   R2 nor the JSON. Check the sizes and captions. Its last line says so: `49 new, ... entries (dry run: src/data/gallery/photography.json
   not written; re-run with --upload to publish)`, so the count of entries is not mistaken for a write.
5. Upload: `npm run sync:gallery -- photography --upload`. The bucket defaults to `portfolio-photos` (override with
   `--bucket` or `R2_BUCKET`). The account ID is deliberately not in the repo: the script reads the user-scope environment
   variable `CLOUDFLARE_ACCOUNT_ID` (the 32-character number in any Cloudflare dashboard URL,
   `dash.cloudflare.com/<id>/...`), and `--account <id>` overrides it when given. Set it once in PowerShell, then open a
   new terminal (a running one does not see it):
   `[Environment]::SetEnvironmentVariable('CLOUDFLARE_ACCOUNT_ID', '<account id>', 'User')`. The R2 API token is the
   user-scope environment variable `CLOUDFLARE_R2_BUCKET_READ_WRITE_API_KEY`. The script hands the token to
   `wrangler r2 object put` through the child process's environment only and never prints it. The JSON is rewritten only
   after every upload succeeded.
6. Commit `src/data/gallery/photography.json` and the sidecars (`src/content/photography/*.yml`), never the JPEGs.

**What the processing does** (`scripts/galleryImage.ts`, run on every changed original): auto-orients, converts to sRGB
and tags the profile, strips GPS, XMP and IPTC (sharp cannot drop only the GPS tags, so the camera fields are read first
and written into a fresh EXIF block), and re-encodes as a quality-92 4:4:4 JPEG. It keeps `Make`, `Model`, `LensModel`,
`FocalLength`, `FNumber`, `ExposureTime`, `ISO` and `DateTimeOriginal` (with the time of day) exactly as the camera
wrote them. The sync throws, before anything is uploaded, if the output still has any location data (`assertNoLocation`)
or if the camera fields do not round-trip. A file whose bytes and `PROCESSING_VERSION` (in `src/lib/gallerySync.ts`;
bump it when the processing changes) are unchanged is skipped.

**Where it was taken.** Each photo's caption starts with the city and country (`Lisbon, Portugal · Canon EOS R5 · ...`),
stored as `caption.location: { city, country, source }` in the JSON. Exact GPS coordinates are still stripped from the
uploaded original, and they are never written to the JSON or anywhere else in the repo: the schema is strict (an extra
key such as `latitude` fails the build), and `src/lib/galleryData.test.ts` checks the committed data for coordinate-like
keys and number pairs.
- **Derived (`source: "geonames"`).** At sync time `deriveSourceLocation` (in `scripts/galleryImage.ts`) reads the GPS of the
  SOURCE file and returns only the nearest place's city and country; the coordinates do not leave that function. The lookup is
  offline: the first use downloads GeoNames `cities1000` (about 11 MB zipped, every place over 1,000 people; CC BY 4.0,
  https://download.geonames.org/export/dump/) and caches the unzipped text in `node_modules/.cache/geonames/cities1000.txt`;
  delete that file to refresh. The download times out after 120 s (`DOWNLOAD_TIMEOUT_MS` in `scripts/geonames.ts`) with an error
  that names the URL; nothing is cached on failure, and a response announcing more than 64 MB is refused. The sync locates
  every photo before it uploads any, so a failed lookup aborts the run with nothing uploaded. No coordinate is ever sent
  anywhere, and the build never needs the dataset or the network.
  The zip is read by `src/lib/zip.ts` (Node's `zlib` plus a small central-directory reader, CRC-checked), so there is no zip
  dependency. The place is chosen from the haversine
  distance and the population column: the most populous place within `PREFERRED_RADIUS_KM` (10 km; the nearer on a tie)
  wins, so Times Square is "New York City", not Weehawken, and the Eiffel Tower is "Paris", not the "Paris 16 Passy"
  district (a plain `PPL` row, so no feature-code filter can remove it); if none is within 10 km, the nearest wins. `PPLX`
  rows (sections of a populated place) are skipped, and country names come from `Intl.DisplayNames`. A chosen place more
  than `MAX_PLACE_DISTANCE_KM` (25 km, `src/lib/geonames.ts`) from the photo, one with
  GPS of (0, 0), or one in a country ICU does not know gets no place (the first and last also print a warning that names the
  photo and suggests an override; never a coordinate). Expect an occasional odd name (a big city a photo only borders
  beats the small town it is actually in); fix those with an override.
- **Override.** `location:` in the sidecar, with `city` and `country`, replaces the derived place (and names a photo that has
  no GPS; `source: "sidecar"`). `location: false` shows no place. Absent means derive.
- **No re-upload.** The place is not in the uploaded bytes, so it does not touch `PROCESSING_VERSION`: every sync recomputes
  it for every photo, including unchanged ones, so existing entries gain a place on the next sync like an alt-text edit does.
- **Attribution.** The Photography page shows "Place names from GeoNames, CC BY 4.0" (`GeonamesCredit.astro`) only when at
  least one entry has `source: "geonames"`.

**R2 objects are never deleted by the script.** A photo whose source is gone is dropped from the JSON with a notice; remove
its object by hand.

**Transformation quota.** Cloudflare bills Images transformations per unique transformation (5,000 a month on the free
plan), and every distinct width of every image counts (`format` and `quality` do not). So the page only uses the fixed
width sets in `src/lib/imageUrl.ts` (`GRID_WIDTHS` 320/640/960 and `LIGHTBOX_WIDTHS` 1280/1920/2560, six per photo).
Do not add widths casually. `format=auto` serves AVIF only up to 1,200 px.

**Loading.** The first three tiles load eagerly and only the first has `fetchpriority="high"` (the likely LCP image); the
rest are lazy. Tiles are cropped to 3:2 with `object-fit: cover`, and the lightbox shows the uncropped photo.

**Unverified until the first real upload:** the upload path (wrangler's R2 `object put` against the real bucket), whether
Cloudflare Images transformations are enabled on the `trevorpetr.us` zone (a probe of `/cdn-cgi/image/...` could not tell),
and the lightbox against real photos. Wrangler's "Basin Catalog validation" prompt only appears when the API answers error
10081, which happens only for a bucket with R2 Data Catalog enabled; the sync does not pass `--force`, and in a
non-interactive child wrangler would answer the prompt itself ("yes"). `tests/e2e/lightbox.spec.ts` skips while the data file
is empty.

## Rules that matter most
1. **Named exports only.** Default exports are allowed only where a tool requires them: Astro pages, layouts and the Astro
   config, and the Vitest, Playwright and ESLint configs (lint enforces this).
2. **Logic lives outside the template.** Pure logic goes in `src/lib/` (or the config module) with a spec next to it;
   `.astro` files and islands wire things together and render.
3. **Accessibility is not optional.** Keep the landmarks, the skip link, one `<h1>` per page, a `<title>` and meta
   description per page, and `aria-current="page"` on the active nav link. `tests/e2e/a11y.spec.ts` runs axe on every page. Lists carry an explicit `role="list"` because Tailwind's preflight removes
   list markers and Safari then stops announcing them (ESLint is configured to allow it).
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
- `tests/e2e/visual.spec.ts` compares a full-page screenshot of every page in each Playwright project with a committed
  baseline in `tests/e2e/visual.spec.ts-snapshots/` (reduced motion, fonts awaited, remote gallery photos stubbed with a
  fixed image, the footer and `<time>` elements masked because they change with the date). Baselines are Linux-only: the
  snapshot names carry the platform, so Windows or macOS runs skip the spec unless `VISUAL_LOCAL=1`, and their
  `*-win32.png` and `*-darwin.png` files are git-ignored. A deliberate visual change fails this spec until you
  regenerate the baselines: run the "Update visual snapshots" workflow on the branch (Actions tab, or
  `gh workflow run update-snapshots.yml --ref <branch>`), which builds and runs the spec with `--update-snapshots` in the
  Playwright container image and commits the images to the branch. Review them in the PR diff. Adding photos to
  `src/data/gallery/photography.json` also changes the Photography baseline.
- `npm run size` and `npm run lighthouse` pass after a build (Lighthouse needs Chrome; Playwright's Chromium works).
- Deploy-affecting changes: `npm run preview`, then load each page by URL; the PR's Cloudflare preview URL is the same
  check against the real host.

## CI and deploys
Every pull request runs these checks. All of the actual CI/CD logic runs in the shared
[`tpetrus/ci-workflows`](https://github.com/tpetrus/ci-workflows) repo; the files under `.github/workflows/` here are
thin callers that invoke its reusable workflows with this repo's inputs.

**Pinning policy.** Callers reference `tpetrus/ci-workflows` by exact version tag (`@vX.Y.Z`), never `v1` and never a
SHA; nobody moves tags, and releases are immutable from v0.1.4 on (v0.1.3 predates the setting). Since v0.2.0 this is
enforced, not just documented: `security / pins` fails any `tpetrus/ci-workflows` ref that is not an exact `vX.Y.Z` (a line
carrying `# zizmor: ignore[unpinned-uses]` is skipped). Third-party actions stay
pinned by commit SHA. `.github/zizmor.yml` tells zizmor's `unpinned-uses` audit to expect exactly that (`tpetrus/*`
ref-pinned, everything else hash-pinned). Dependabot's `github-actions` ecosystem bumps the exact-tag refs, and its 7-day cooldown
exempts `tpetrus/ci-workflows*` (our own releases, which also get their own PR group) while keeping it for every other
action. The `npx` ref in the
`release write-version` command below is a doc string, not a pin: use the tag `.github/workflows/` currently pins.

**Check names** below are the ones observed on a real PR (a called workflow's job shows as `<caller job> / <inner job>`),
so they are what a branch ruleset should require. `ci / result` aggregates the other `ci /` jobs.

| Check name on the PR | What it gates |
|---|---|
| `ci / result` (`ci.yml`) | the one required check: format, lint, typecheck, unit tests with the 95% coverage threshold, the build and the 2 MB file-size limit (`quality`, `build`, `max-file-size`) are never optional; the bundle-size budget (`size`), the Lighthouse budget (`lighthouse`), the sharded Playwright suite (`e2e-plan`/`e2e`/`e2e-result`) and an offline link check (`links`) must each pass or be cleanly skipped |
| `pr-checks / pr-title` | the PR title is a Conventional Commit (see "Versioning and releases") |
| `pr-checks / version` | `package.json` and `package-lock.json` carry the version the title calls for; docs/ci/test titles change nothing that ships |
| `security / audit`, `security / dependency-review`, `security / zizmor` | known-vulnerable production dependencies, risky dependencies added by a PR, and a zizmor scan of the workflows |
| `security / pins` | every `tpetrus/ci-workflows` reference is an exact `vX.Y.Z` release tag (the pinning policy, enforced since v0.2.0) |
| `codeql / analyze (actions)`, `codeql / analyze (javascript-typescript)` | static security analysis of the TypeScript and the workflows |
| `Workers Builds: trevorpetrus-portfolio` (Cloudflare) | the PR builds and deploys to a preview URL |

After a merge, Cloudflare is expected to deploy `main` to production, and "Smoke (production)" (`smoke.yml`) then runs the
`@smoke` tests against the live site; it also runs daily. It reads the production URL from the repository variable
`PRODUCTION_URL` and is skipped if that variable is unset (it must read `https://trevorpetr.us` once the domain PR merges; see "The domain"). It waits for the check run named
`Workers Builds: trevorpetrus-portfolio` (the Worker name in `wrangler.jsonc`, as observed). If the smoke test fails,
roll back from the Cloudflare dashboard (Workers -> trevorpetrus-portfolio -> Deployments) or with
`npx wrangler rollback`, then fix forward. Never deploy from CI.

`update-snapshots.yml` (run by hand from the Actions tab on a branch) regenerates the Linux baselines for
`tests/e2e/visual.spec.ts` in the Playwright container image and commits them to that branch; see "Verifying changes".

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
is down, run `npx --yes --package=github:tpetrus/ci-workflows#vX.Y.Z ci-tools release write-version <version>` yourself (`vX.Y.Z` is the
ci-workflows tag `.github/workflows/` currently pins); the failing
`version` check names the exact version.

**What `release.yml` does:** on every push to `main`, if the tag `v<package.json version>` does not exist, it builds the
release notes from the PR titles merged since the previous tag, creates the tag and a GitHub Release, and otherwise
exits. To replace the generated notes, add `.github/release-notes/v<version>.md` in the PR.

## One-time setup (repository admin)
1. Create the GitHub repository and push this branch. (Done.)
2. Create a GitHub App (Settings -> Developer settings -> GitHub Apps) with repository permissions Contents: read and
   write, Pull requests: read and write, Issues: read and write, Workflows: read and write, Metadata: read (the shared
   version-bump `sync-prs` job requests `permission-issues: write`; without it that job fails with `The permissions
   requested are not granted to this installation.`). No webhook is needed. Install it on
   this repository only. Add its App ID as the secret `RELEASE_APP_ID` and a generated private key as
   `RELEASE_APP_PRIVATE_KEY`, in both Settings -> Secrets -> Actions and Settings -> Secrets -> Dependabot. (The App and secrets exist, since
   `version-bump / bump-pr` passes; the Issues permission is the part to confirm.)
3. In the `main` ruleset, require `ci / result`, `pr-checks / pr-title` and `pr-checks / version` (the observed names;
   add the `security /` and `codeql /` checks if wanted) and require branches to be up to date before merging. Not
   confirmed done.
4. Connect the repository to Cloudflare Workers Builds for the Worker `trevorpetrus-portfolio` (done; production branch
   `main`, build command `npm run build`; the deploy and preview commands are Cloudflare's defaults, `wrangler deploy`
   and `wrangler preview`).
5. After the first deploy, set the repository variable `PRODUCTION_URL` (Settings -> Secrets and variables -> Actions ->
   Variables) to the live URL so "Smoke (production)" runs. (Done, but it still holds the old workers.dev URL: change it to
   `https://trevorpetr.us` when the domain PR merges.)

## Testing
Specs sit next to the file they test (`foo.ts` -> `foo.test.ts`). `npm run test:coverage` enforces 95% for lines,
statements, functions and branches over `src/lib/**` and `src/config/**` (`vitest.config.ts`); keep it green, and write
specs rather than excluding files. Specs run in node, through Astro's Vite config (`getViteConfig`), which is what lets
`src/components/Gallery.test.ts` render a component with Astro's Container API; `scripts/**/*.test.ts` run too (they
build tiny JPEGs in memory to prove the gallery's location guards fire) but only `src/lib` and `src/config` count toward
coverage. DOM glue such as `src/scripts/galleryLightbox.ts` is covered by the end-to-end specs. End-to-end specs live in `tests/e2e/`; tag tests that are safe to
run against production `@smoke`. App code must never import from `tests/` (lint enforces it). `npm run test:smoke` runs
only the Chromium projects (`chromium-*`) because the shared smoke workflow installs Chromium alone.

## Known gaps (don't copy, don't build on)
- **`npm install` on Windows can break the lockfile for Linux.** It drops the bundled
  `@tailwindcss/oxide-wasm32-wasi/node_modules/*` entries, so `npm ci` fails on Linux ("Missing: ... from lock file").
  CI checks this automatically: the shared setup action runs the lockfile check before `npm ci` in every job. To check
  locally after an install on Windows, run `npx --yes --package=github:tpetrus/ci-workflows#vX.Y.Z ci-tools check-lockfile`
  (`vX.Y.Z` is the ci-workflows tag `.github/workflows/` currently pins; there is deliberately no npm script, so no ref
  to bump by hand).
  To repair, run `npx --yes --package=github:tpetrus/ci-workflows#vX.Y.Z ci-tools repair-lockfile` (since v0.2.0; it
  downloads the affected packages' tarballs, checks their integrity hashes, adds back the missing entries and never changes
  existing ones; exit 1 means it could not repair). The version bot runs the same repair on same-repo PRs and commits
  `chore: repair package-lock.json for Linux`, so a Windows install usually fixes itself on the PR. Taking `main`'s copy
  (`git checkout origin/main -- package-lock.json`) and redoing the install, or installing on Linux/WSL, also works.
- **The initial lockfile was repaired by hand.** The six entries Windows npm dropped were copied from the sibling
  AudioVisualizer-React lockfile (same `@tailwindcss/oxide` 4.3.3), because no `main` copy existed to restore from.
- **Dependency audit:** `npm install` reports vulnerabilities in dev tooling (not in production dependencies:
  `npm audit --omit=dev` reports none); CI's security workflow is the gate.
