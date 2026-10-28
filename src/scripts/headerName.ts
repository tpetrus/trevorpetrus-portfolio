// Browser glue for the header-name handoff. It binds to the DOM, so it is outside unit-test coverage; it is exercised
// by tests/e2e/header.spec.ts. Imported from components/Wordmark.astro, so it only ships on pages with the big wordmark.
//
// The hidden state is CSS (global.css); this only toggles [data-docked] on the header's name link while the wordmark
// has scrolled under the sticky header. IntersectionObserver, not a scroll listener.

let observer: IntersectionObserver | null = null;
let resizeObserver: ResizeObserver | null = null;

function disconnect(): void {
    observer?.disconnect();
    resizeObserver?.disconnect();
    observer = null;
    resizeObserver = null;
}

function observe(wordmark: Element, name: Element, header: HTMLElement): void {
    observer?.disconnect();
    const headerHeight = Math.round(header.getBoundingClientRect().height);
    // The viewport's top edge is moved down to the header's bottom edge, so the wordmark counts as gone once it is
    // entirely under the header.
    observer = new IntersectionObserver(
        ([entry]) => {
            if (entry === undefined) return;
            const gone = !entry.isIntersecting && entry.boundingClientRect.bottom <= headerHeight + 1;
            name.toggleAttribute('data-docked', gone);
        },
        { rootMargin: `-${headerHeight}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(wordmark);
}

document.addEventListener('astro:page-load', () => {
    disconnect();
    const wordmark = document.querySelector('[data-wordmark]');
    const name = document.querySelector('[data-header-name]');
    const header = document.querySelector<HTMLElement>('[data-site-header]');
    if (wordmark === null || name === null || header === null) return;

    // The header can change height (the nav wraps on a narrow screen), so the margin follows it. The callback also
    // runs once on observe(), which creates the first observer.
    resizeObserver = new ResizeObserver(() => observe(wordmark, name, header));
    resizeObserver.observe(header);
});

document.addEventListener('astro:before-swap', disconnect);
