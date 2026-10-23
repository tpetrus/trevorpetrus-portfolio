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
