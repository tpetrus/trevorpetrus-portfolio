// GitHub topics are lowercase slugs (`threejs`, `github-actions`); a card shows curated display names (`three.js`,
// `GitHub Actions`). The sync maps every topic through this table, and a topic missing from it fails the sync with its
// slug named, so a new topic on a repo never shows up as a raw slug: add it here in the same change.
export const TOPIC_NAMES: Readonly<Record<string, string>> = {
    'agentic-coding': 'Agentic coding',
    'agentic-workflow': 'Agentic workflows',
    astro: 'Astro',
    'ci-cd': 'CI/CD',
    'claude-agents': 'Claude agents',
    'claude-code': 'Claude Code',
    'claude-skills': 'Claude skills',
    'cloudflare-workers': 'Cloudflare Workers',
    dsap: 'DSAP',
    'github-actions': 'GitHub Actions',
    gsap: 'GSAP',
    javascript: 'JavaScript',
    lighthouse: 'Lighthouse',
    nodejs: 'Node.js',
    photoswipe: 'PhotoSwipe',
    playwright: 'Playwright',
    python: 'Python',
    react: 'React',
    tailwindcss: 'Tailwind CSS',
    threejs: 'three.js',
    typescript: 'TypeScript',
    vitest: 'Vitest',
    'web-audio-api': 'Web Audio API',
    xml: 'XML',
};

/** The topics' display names in the given order, plus every slug the table does not know (never guessed). */
export interface MappedTopics {
    readonly tech: string[];
    readonly unknown: string[];
}

/** Maps topic slugs to display names through `names` (the committed table by default). */
export function mapTopics(
    topics: readonly string[],
    names: Readonly<Record<string, string>> = TOPIC_NAMES,
): MappedTopics {
    const tech: string[] = [];
    const unknown: string[] = [];
    for (const slug of topics) {
        const name = Object.hasOwn(names, slug) ? names[slug] : undefined;
        if (name === undefined) unknown.push(slug);
        else tech.push(name);
    }
    return { tech, unknown };
}
