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

// The Network Information API is not in lib.dom, so type just the one field this file reads.
interface ConnectionLike {
    saveData?: boolean;
}
const saveData = (): boolean =>
    (navigator as Navigator & { connection?: ConnectionLike }).connection?.saveData === true;

// Videos paused only because they scrolled out of view; they resume on return, unlike a pause by hand.
const pausedOffscreen = new WeakSet<HTMLVideoElement>();

function play(video: HTMLVideoElement): void {
    // play() rejects when the browser blocks it or the source fails; the poster is a fine resting state.
    video.play().catch(() => undefined);
}

function bind(video: HTMLVideoElement): () => void {
    const toggle = video.parentElement?.querySelector<HTMLButtonElement>('[data-title-video-toggle]') ?? null;

    const syncToggle = (): void => {
        const playing = !video.paused;
        toggle?.setAttribute('data-state', playing ? 'playing' : 'paused');
        // Named by its action, so the label never has to be read together with a pressed state. Both labels contain
        // the visible text "Video" (WCAG 2.5.3).
        toggle?.setAttribute('aria-label', playing ? 'Pause background video' : 'Play background video');
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

    // The ~0.8 MB video must never compete with the LCP image, so autoplay waits for the window load event. Reduced
    // motion and Save-Data visitors get no autoplay; the toggle can still start it.
    let onLoad: (() => void) | null = null;
    if (!reducedMotion.matches && !saveData()) {
        if (document.readyState === 'complete') play(video);
        else {
            onLoad = () => {
                onLoad = null;
                if (!reducedMotion.matches && !pausedByUser.has(video)) play(video);
            };
            window.addEventListener('load', onLoad, { once: true });
        }
    }

    // Off-screen playback only burns battery and bandwidth. The first callback reports "visible" and resumes nothing,
    // because pausedOffscreen is empty until the video has actually left the viewport while playing.
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) {
                if (!video.paused) {
                    pausedOffscreen.add(video);
                    video.pause();
                }
            } else if (pausedOffscreen.delete(video) && !pausedByUser.has(video) && !reducedMotion.matches) {
                play(video);
            }
        }
    });
    observer.observe(video);

    return () => {
        observer.disconnect();
        if (onLoad) window.removeEventListener('load', onLoad);
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
