# Trevor Petrus portfolio site

Personal portfolio: an intro page, a photography gallery and a projects list. Built with Astro (static output),
Tailwind CSS 4 and TypeScript, and served from Cloudflare Workers static assets. The projects page is built from a content collection (see AGENTS.md for adding a project and the manual
`npm run sync:projects`); the home and photography pages are placeholders for now.

## Develop

Requires Node 24 (`.nvmrc`).

```sh
npm install
npm run dev        # dev server
npm run build      # static build to dist/
npm run preview    # build, then serve it like production (wrangler dev)
```

Run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test:coverage` and `npm run build` before
sending a change. See [AGENTS.md](AGENTS.md) for all commands, the project layout, the CI setup and the rules.

The site's domain is set in one place: two adjacent constants, `SITE_URL` and `PROJECTS_DOMAIN`, in `src/config/site.ts`.
