// Browser glue for the gallery's reveal: a photo fades in and rises a few pixels as it scrolls into view. It binds to
// the DOM, so it is outside unit-test coverage; tests/e2e/photography.spec.ts exercises it. Imported from
// components/Gallery.astro, so it only ships on pages that render a gallery.
//
// Photos are fully visible without JavaScript: the CSS hides a photo only under `[data-gallery][data-reveal]`, an
// attribute this script adds, and only until it sets `data-revealed` on that photo.

// Reveals start a little before the photo enters the viewport, so a fast scroll does not show an empty gap.
const ROOT_MARGIN = '0px 0px 80px 0px';
// Photos that enter together (a row) are staggered by this much, up to a few, so a row ripples in and a long batch
// does not make the last photo wait.
const STAGGER_MS = 70;
const MAX_STAGGER_STEPS = 3;

// Makes this file a module, so its top-level names do not collide with the other scripts' in the type-check.
export {};

let observer: IntersectionObserver | null = null;

function disconnect(): void {
    observer?.disconnect();
    observer = null;
}

function reveal(photo: HTMLElement, step: number): void {
    photo.style.transitionDelay = `${Math.min(step, MAX_STAGGER_STEPS) * STAGGER_MS}ms`;
    photo.dataset.revealed = '';
}

function setUp(): void {
    disconnect();
    const galleries = document.querySelectorAll<HTMLElement>('[data-gallery]');
    // No motion is wanted, or there is nothing to observe with: leave every photo visible.
    if (
        galleries.length === 0 ||
        typeof IntersectionObserver === 'undefined' ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
        return;
    }

    observer = new IntersectionObserver(
        (entries) => {
            let step = 0;
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                reveal(entry.target as HTMLElement, step++);
                observer?.unobserve(entry.target);
            }
        },
        { rootMargin: ROOT_MARGIN },
    );

    for (const gallery of galleries) {
        gallery.dataset.reveal = '';
        for (const photo of gallery.querySelectorAll<HTMLElement>('.photo')) {
            const { top, bottom } = photo.getBoundingClientRect();
            // Already on screen: show it now, in the same task as the hiding rule, so it never flashes and the
            // LCP image is never delayed by an animation.
            if (top < window.innerHeight && bottom > 0) {
                photo.dataset.revealed = '';
            } else {
                observer.observe(photo);
            }
        }
    }
}

document.addEventListener('astro:page-load', setUp);
// The swapped-out DOM goes away with the old page; the observer must not keep holding its photos.
document.addEventListener('astro:before-swap', disconnect);
