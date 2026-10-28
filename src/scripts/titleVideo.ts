// Browser glue for the looping video behind a page title. It binds to the DOM, so it is outside unit-test coverage; it
// is exercised by tests/e2e/pageTitle.spec.ts. Imported from components/PageTitle.astro, so it only ships on pages
// that render one.
//
// The video autoplays: it starts as soon as the page is ready. It is started here rather than by an `autoplay`
// attribute so that a visitor who prefers reduced motion never sees it move, not even for the moment before a script
// could pause it. The framed video is itself a button that pauses and resumes it (WCAG 2.2.2 Pause, Stop, Hide).

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Videos the visitor paused by hand stay paused when the media query changes or the video scrolls back into view.
const pausedByUser = new WeakSet<HTMLVideoElement>();
// Videos paused only because they scrolled out of view; they resume on return, unlike a pause by hand.
const pausedOffscreen = new WeakSet<HTMLVideoElement>();
let cleanup: (() => void) | null = null;

function play(video: HTMLVideoElement): void {
    // play() rejects when the browser blocks it or the source fails; the poster is a fine resting state.
    video.play().catch(() => undefined);
}

function bind(video: HTMLVideoElement): () => void {
    const toggle = video.closest<HTMLButtonElement>('[data-title-video-toggle]');

    // Named by its action, so the label never has to be read together with a pressed state.
    const syncToggle = (): void => {
        const playing = !video.paused;
        toggle?.setAttribute('data-state', playing ? 'playing' : 'paused');
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
    if (toggle) toggle.disabled = false;
    if (!reducedMotion.matches) play(video);
    syncToggle();

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
