// Browser glue for the Photography page's section navigation: the back-to-top links in each section heading row and the
// floating legend. It binds to the DOM, so it is outside unit-test coverage; tests/e2e/sectionNav.spec.ts exercises it.
// The decisions (which section is current, when things show) are pure functions in src/lib/sectionNav.ts. Imported from
// components/SectionLegend.astro, so it only ships on a page that renders the legend.
//
// All visual state is a data attribute that the component CSS reacts to: `data-js` and `data-scrolled` on the sections
// root, `data-shown` on the legend. Without JavaScript none of them is set, so the back-to-top links stay visible and the
// legend stays hidden and inert.

import {
    LEGEND_IDLE_MS,
    activeSectionId,
    isAtPageEnd,
    isNavPassed,
    readingLine,
    showsBackToTop,
    showsLegend,
    type LegendState,
    type SectionPosition,
} from '../lib/sectionNav';

// Makes this file a module, so its top-level names do not collide with the other scripts' in the type-check.
export {};

let cleanup: (() => void) | null = null;

function setUp(): void {
    cleanup?.();
    const legend = document.querySelector<HTMLElement>('[data-section-legend]');
    const root = document.querySelector<HTMLElement>('[data-sections-root]');
    const jumpNav = document.querySelector<HTMLElement>('[data-jump-nav]');
    if (!legend || !root) return;

    const legendLinks = [...legend.querySelectorAll<HTMLAnchorElement>('a[data-section-link]')];
    const sectionElements = legendLinks
        .map((link) => {
            const id = link.dataset.sectionLink ?? '';
            return { id, element: document.getElementById(id) };
        })
        .filter((item): item is { id: string; element: HTMLElement } => item.element !== null);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    // The legend is inert while hidden so keyboard focus never lands on an invisible link.
    const state: LegendState = { navPassed: false, recentlyScrolled: false, hovered: false, focused: false };
    const renderLegend = (): void => {
        const shown = showsLegend(state);
        legend.toggleAttribute('data-shown', shown);
        legend.toggleAttribute('inert', !shown);
    };

    // Every scroll restarts the countdown; when it runs out the legend fades unless it is hovered or focused.
    let idleTimer = 0;
    const markScrolled = (): void => {
        state.recentlyScrolled = true;
        window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => {
            state.recentlyScrolled = false;
            renderLegend();
        }, LEGEND_IDLE_MS);
        renderLegend();
    };

    // Only a mouse hovers. A touch "enter" ends with the tap, and holding the legend open then would strand it on screen.
    const onPointerEnter = (event: PointerEvent): void => {
        if (event.pointerType !== 'mouse') return;
        state.hovered = true;
        renderLegend();
    };
    const onPointerLeave = (event: PointerEvent): void => {
        if (event.pointerType !== 'mouse') return;
        state.hovered = false;
        renderLegend();
    };
    const onFocusIn = (): void => {
        state.focused = true;
        renderLegend();
    };
    const onFocusOut = (event: FocusEvent): void => {
        state.focused = legend.contains(event.relatedTarget as Node | null);
        renderLegend();
    };

    const update = (): void => {
        root.toggleAttribute('data-scrolled', showsBackToTop(window.scrollY));
        const positions: SectionPosition[] = sectionElements.map(({ id, element }) => ({
            id,
            top: element.getBoundingClientRect().top,
        }));
        const atEnd = isAtPageEnd(window.scrollY, window.innerHeight, document.documentElement.scrollHeight);
        const current = activeSectionId(positions, readingLine(window.innerHeight), atEnd);
        for (const link of legendLinks) {
            if (link.dataset.sectionLink === current) link.setAttribute('aria-current', 'true');
            else link.removeAttribute('aria-current');
        }
    };

    // One update per frame, however many scroll events arrive.
    let frame = 0;
    const onScroll = (): void => {
        markScrolled();
        if (frame !== 0) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            update();
        });
    };

    const onBackToTop = (event: Event): void => {
        const link = (event.target as Element | null)?.closest('[data-back-to-top]');
        if (!link) return;
        event.preventDefault();
        window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
        // Focus follows, so the next Tab starts at the top of the page; the scroll above is the only one.
        document.getElementById('main')?.focus({ preventScroll: true });
    };

    root.setAttribute('data-js', '');
    let observer: IntersectionObserver | null = null;
    if (jumpNav && typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver((entries) => {
            const entry = entries[entries.length - 1];
            if (!entry) return;
            state.navPassed = isNavPassed(entry.isIntersecting, entry.boundingClientRect.top);
            renderLegend();
        });
        observer.observe(jumpNav);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    root.addEventListener('click', onBackToTop);
    legend.addEventListener('pointerenter', onPointerEnter);
    legend.addEventListener('pointerleave', onPointerLeave);
    legend.addEventListener('focusin', onFocusIn);
    legend.addEventListener('focusout', onFocusOut);
    update();

    cleanup = () => {
        observer?.disconnect();
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
        root.removeEventListener('click', onBackToTop);
        legend.removeEventListener('pointerenter', onPointerEnter);
        legend.removeEventListener('pointerleave', onPointerLeave);
        legend.removeEventListener('focusin', onFocusIn);
        legend.removeEventListener('focusout', onFocusOut);
        window.clearTimeout(idleTimer);
        cancelAnimationFrame(frame);
        root.removeAttribute('data-js');
        root.removeAttribute('data-scrolled');
        cleanup = null;
    };
}

document.addEventListener('astro:page-load', setUp);
document.addEventListener('astro:before-swap', () => cleanup?.());
