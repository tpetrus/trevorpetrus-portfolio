// The ONE place the site's domain is configured. Switching to a custom domain later is a one-line change to SITE_URL
// below; everything else (astro.config.mjs `site`, canonical URLs, links to project subdomains) derives from it.
export const SITE_URL = 'https://portfolio.mypoke.workers.dev';

// A single DNS label: lowercase letters, digits and inner hyphens, at most 63 characters.
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Builds the address of a project that lives on its own subdomain: `https://<name>.<domain>`.
 *
 * @param name The project's subdomain label, e.g. `audio-visualizer`.
 * @param siteUrl The site's base URL; only its protocol and host are used, so a trailing slash or path is harmless.
 * @throws If `name` is not a valid lowercase DNS label.
 */
export function projectUrl(name: string, siteUrl: string = SITE_URL): string {
    if (!DNS_LABEL.test(name)) {
        throw new Error(`Invalid project subdomain "${name}": use lowercase letters, digits and inner hyphens only.`);
    }
    const { protocol, host } = new URL(siteUrl);
    return `${protocol}//${name}.${host}`;
}
