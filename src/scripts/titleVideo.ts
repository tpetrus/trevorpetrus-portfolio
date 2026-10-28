// Browser glue for the looping video behind a page title. It binds to the DOM, so it is outside unit-test coverage; it
// is exercised by tests/e2e/pageTitle.spec.ts. Imported from components/PageTitle.astro, so it only ships on pages
// that render one.
//
// The video has no `autoplay` attribute on purpose: playback is decided here, so a visitor who prefers reduced motion
// never gets motion, and the toggle (WCAG 2.2.2 Pause, Stop, Hide) can always stop it.

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Videos the visitor paused by hand stay paused when the media query changes.
const pausedByUser = new WeakSet<HTMLVideoElement>();
let cleanup: (() => void) | null = null;

function play(video: HTMLVideoElement): void {
    // play() rejects when the browser blocks it or the source fails; the poster is a fine resting state.
    video.play().catch(() => undefined);
}

function bind(video: HTMLVideoElement): () => void {
    const toggle = video.parentElement?.querySelector<HTMLButtonElement>('[data-title-video-toggle]') ?? null;

    const syncToggle = (): void => {
        toggle?.setAttribute('aria-pressed', String(!video.paused));
    };
    const onToggle = (): void => {
        if (video.paused) {
            pausedByUser.delete(video);
            play(video);
        } else {
            pausedByUser.add(video);
            video.pause();
        }
    };

    video.addEventListener('play', syncToggle);
    video.addEventListener('pause', syncToggle);
    toggle?.addEventListener('click', onToggle);
    if (toggle) toggle.hidden = false;
    syncToggle();
    if (!reducedMotion.matches) play(video);

    return () => {
        video.removeEventListener('play', syncToggle);
        video.removeEventListener('pause', syncToggle);
        toggle?.removeEventListener('click', onToggle);
    };
}

document.addEventListener('astro:page-load', () => {
    cleanup?.();
    const videos = [...document.querySelectorAll<HTMLVideoElement>('[data-title-video]')];
    const unbind = videos.map(bind);

    const onMotionChange = (): void => {
        for (const video of videos) {
            if (reducedMotion.matches) video.pause();
            else if (!pausedByUser.has(video)) play(video);
        }
    };
    reducedMotion.addEventListener('change', onMotionChange);

    cleanup = () => {
        for (const fn of unbind) fn();
        reducedMotion.removeEventListener('change', onMotionChange);
        cleanup = null;
    };
});

document.addEventListener('astro:before-swap', () => cleanup?.());
