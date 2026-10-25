// The ONE place the site's domain is configured. Two adjacent constants, because they are two different settings:
// SITE_URL is where this site itself lives (astro.config.mjs `site`, canonical URLs), and PROJECTS_DOMAIN is the domain
// that project subdomains hang off. They differ right now: the site is on its custom domain, but the projects are still
// served from workers.dev (`<worker>.<account>.workers.dev`; `audio-visualizer.trevorpetr.us` does not resolve yet).
// When a project gets its custom domain, switch PROJECTS_DOMAIN to 'trevorpetr.us' (a bare host, no protocol).
export const SITE_URL = 'https://trevorpetr.us';
export const PROJECTS_DOMAIN = 'mypoke.workers.dev';

// The host that serves gallery images: originals from an R2 bucket and resized variants from Cloudflare Images
// transformations (`/cdn-cgi/image/...`). It is configured here and nowhere else. Transformations only run on a
// hostname in the Cloudflare zone, never on workers.dev, which is why this is not derived from SITE_URL.
export const PHOTOS_ORIGIN = 'https://photos.trevorpetr.us';

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
