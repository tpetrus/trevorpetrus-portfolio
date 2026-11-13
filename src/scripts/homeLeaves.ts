// Browser glue for the home page's falling leaves. It binds to the DOM, so it is outside unit-test coverage; it is
// exercised by tests/e2e/leavesMotion.spec.ts. Imported from components/LeavesToggle.astro, which only the home page
// renders. The motion itself is the pure logic in src/lib/leaves.ts; this file only feeds it time, wind and the
// viewport, and writes each leaf's transform.
//
// The server renders a still composition. A visitor who prefers reduced motion keeps it: no loop and no listeners other
// than the one that notices the preference change. Everyone else gets the loop, started when the browser is idle so it
// never competes with the first paint, and a button that pauses it (WCAG 2.2.2 Pause, Stop, Hide).

import {
    LEAF_SEED,
    applyGust,
    createLeaves,
    createWind,
    leafCount,
    leafTransform,
    step,
    type Leaf,
    type Viewport,
} from '../lib/leaves';

type LeavesState = 'still' | 'running' | 'paused';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
// Without requestIdleCallback (older Safari) the start waits this long instead.
const IDLE_FALLBACK_MS = 200;
// The longest the start may wait for an idle moment.
const IDLE_TIMEOUT_MS = 2000;
const RESIZE_DEBOUNCE_MS = 150;

let teardown: (() => void) | null = null;

function bind(layer: HTMLElement): () => void {
    // One controller per page load: aborting it removes every listener added below at once.
    const controller = new AbortController();
    const { signal } = controller;
    const toggle = document.querySelector<HTMLButtonElement>('[data-leaves-toggle]');
    const nodes = [...layer.querySelectorAll<SVGSVGElement>('[data-leaf]')];
    const leaves = createLeaves(LEAF_SEED, nodes.length);
    const wind = createWind();
    let viewport: Viewport = { width: 0, height: 0 };
    let active: Leaf[] = [];
    let frame = 0;
    let last = 0;
    // Cancels the pending idle start, with the API that scheduled it (their handles are separate number spaces).
    let cancelIdle: (() => void) | null = null;
    let resizeTimer = 0;
    let started = false;
    let pausedByUser = false;
    let lastScrollY = window.scrollY;

    // Only the leaves the tier CSS shows are moved; the others stay hidden at their still position.
    const measure = (): void => {
        viewport = { width: layer.clientWidth, height: layer.clientHeight };
        active = leaves.slice(0, leafCount(viewport.width));
    };

    const loop = (now: number): void => {
        // The first frame after a start or a resume moves nothing, so a pause never ends in a jump.
        step(active, last ? now - last : 0, wind, viewport);
        last = now;
        for (const leaf of active) {
            const node = nodes[leaf.index];
            if (node) node.style.transform = leafTransform(leaf, viewport);
        }
        frame = requestAnimationFrame(loop);
    };

    const stopLoop = (): void => {
        cancelAnimationFrame(frame);
        frame = 0;
        last = 0;
    };

    // Works out the state from the preference, the tab's visibility and the button, then starts or stops the loop.
    // Stopping leaves every leaf where it is: a live switch to reduced motion freezes the leaves rather than jumping.
    const update = (): void => {
        const state: LeavesState = reducedMotion.matches
            ? 'still'
            : pausedByUser || document.hidden
              ? 'paused'
              : 'running';
        layer.dataset.leavesState = state;
        if (state === 'running') {
            if (!frame) frame = requestAnimationFrame(loop);
            if (import.meta.env.DEV) console.debug('[leaves] running');
        } else if (frame) {
            stopLoop();
            if (import.meta.env.DEV) console.debug(`[leaves] ${state}`);
        }
        if (!toggle) return;
        toggle.hidden = state === 'still';
        // Named by its action, so the label never has to be read together with a pressed state.
        const label = pausedByUser ? 'Play falling leaves' : 'Pause falling leaves';
        toggle.setAttribute('aria-label', label);
        toggle.textContent = label;
        toggle.dataset.state = state === 'still' ? 'paused' : state;
    };

    const start = (): void => {
        if (started) return;
        started = true;
        measure();
        if (toggle) toggle.disabled = false;
        toggle?.addEventListener(
            'click',
            () => {
                pausedByUser = !pausedByUser;
                update();
            },
            { signal },
        );
        document.addEventListener('visibilitychange', update, { signal });
        window.addEventListener(
            'resize',
            () => {
                clearTimeout(resizeTimer);
                resizeTimer = window.setTimeout(measure, RESIZE_DEBOUNCE_MS);
            },
            { signal },
        );
        // A mouse or a pen nudges the leaves near it. A finger does not: on a touch screen the pointer is the scroll.
        window.addEventListener(
            'pointermove',
            (event) => {
                if (event.pointerType === 'touch') return;
                wind.pointer.x = event.clientX;
                wind.pointer.y = event.clientY;
                wind.pointer.active = true;
            },
            { passive: true, signal },
        );
        document.documentElement.addEventListener(
            'pointerleave',
            () => {
                wind.pointer.active = false;
            },
            { signal },
        );
        // Scrolling blows a short gust in the scroll direction; the lib clamps it and lets it die down.
        window.addEventListener(
            'scroll',
            () => {
                applyGust(wind, window.scrollY - lastScrollY);
                lastScrollY = window.scrollY;
            },
            { passive: true, signal },
        );
        update();
    };

    const schedule = (): void => {
        const begin = (): void => {
            cancelIdle = null;
            if (!signal.aborted) start();
        };
        if (typeof window.requestIdleCallback === 'function') {
            const handle = window.requestIdleCallback(begin, { timeout: IDLE_TIMEOUT_MS });
            cancelIdle = () => window.cancelIdleCallback(handle);
        } else {
            const handle = window.setTimeout(begin, IDLE_FALLBACK_MS);
            cancelIdle = () => clearTimeout(handle);
        }
    };

    reducedMotion.addEventListener(
        'change',
        () => {
            if (started) update();
            else if (!reducedMotion.matches) schedule();
        },
        { signal },
    );

    if (reducedMotion.matches) {
        layer.dataset.leavesState = 'still';
        if (toggle) toggle.hidden = true;
    } else {
        schedule();
    }

    return () => {
        controller.abort();
        cancelIdle?.();
        clearTimeout(resizeTimer);
        stopLoop();
    };
}

document.addEventListener('astro:page-load', () => {
    teardown?.();
    teardown = null;
    const layer = document.querySelector<HTMLElement>('[data-leaves]');
    if (layer) teardown = bind(layer);
});

document.addEventListener('astro:before-swap', () => {
    teardown?.();
    teardown = null;
});
