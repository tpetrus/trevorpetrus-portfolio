// The ONE place the site's domain is configured. Two adjacent constants, because they are two different settings:
// SITE_URL is where this site itself lives (astro.config.mjs `site`, canonical URLs), and PROJECTS_DOMAIN is the domain
// that project subdomains hang off. On workers.dev they differ, since every Worker is `<worker>.<account>.workers.dev`
// and siblings share the account part. Switching to the custom domain means editing these two lines (both become the
// bare domain, e.g. 'https://example.com' and 'example.com'), plus the PRODUCTION_URL repository variable.
export const SITE_URL = 'https://trevorpetrus-portfolio.mypoke.workers.dev';
export const PROJECTS_DOMAIN = 'mypoke.workers.dev';

// A single DNS label: lowercase letters, digits and inner hyphens, at most 63 characters.
const DNS_LABEL_PATTERN = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const DNS_LABEL = new RegExp(`^${DNS_LABEL_PATTERN}$`);

/** True when `value` is a single valid DNS label (lowercase letters, digits and inner hyphens, 1-63 characters). */
export function isDnsLabel(value: string): boolean {
    return DNS_LABEL.test(value);
}

// A bare host: one or more dot-separated DNS labels. No protocol, path or port.
const BARE_HOST = new RegExp(`^${DNS_LABEL_PATTERN}(?:\\.${DNS_LABEL_PATTERN})*$`);

/**
 * Builds the address of a project that lives on its own subdomain: `https://<name>.<projectsDomain>`.
 *
 * @param name The project's subdomain label, e.g. `audio-visualizer`.
 * @param projectsDomain The bare host project subdomains hang off, e.g. `example.com` (no protocol or path).
 * @throws If `name` is not a valid lowercase DNS label, or `projectsDomain` is not a bare host.
 */
export function projectUrl(name: string, projectsDomain: string = PROJECTS_DOMAIN): string {
    if (!isDnsLabel(name)) {
        throw new Error(`Invalid project subdomain "${name}": use lowercase letters, digits and inner hyphens only.`);
    }
    if (!BARE_HOST.test(projectsDomain)) {
        throw new Error(`Invalid projects domain "${projectsDomain}": use a bare host such as "example.com".`);
    }
    return `https://${name}.${projectsDomain}`;
}
