export interface NavItem {
    readonly label: string;
    readonly href: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
    { label: 'Home', href: '/' },
    { label: 'Photography', href: '/photography/' },
    { label: 'Projects', href: '/projects/' },
];

function withoutTrailingSlash(path: string): string {
    return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/** True when `currentPath` is the page `href` points to; trailing slashes are ignored and Home matches only `/`. */
export function isCurrentPage(currentPath: string, href: string): boolean {
    return withoutTrailingSlash(currentPath) === withoutTrailingSlash(href);
}

/**
 * The text of the decorative vertical running head: the site name, then the current page's name taken from the nav
 * items. Home and any path outside the nav show the site name alone, so the head never repeats itself.
 */
export function runningHeadText(currentPath: string, siteName: string): string {
    const page = NAV_ITEMS.find((item) => item.href !== '/' && isCurrentPage(currentPath, item.href));
    return page ? `${siteName} — ${page.label}` : siteName;
}
