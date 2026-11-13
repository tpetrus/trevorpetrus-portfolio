export type LeafFill = 'paper-2' | 'paper-3' | 'accent-tint';
export const LEAF_FILLS: readonly LeafFill[] = ['paper-2', 'paper-3', 'accent-tint'];
export const LEAF_SHAPES = 3;
export const MAX_LEAVES = 15;

export interface LeafTier {
    readonly minWidthRem: number;
    readonly count: number;
}

// More leaves only where there is room for them; the last tier equals MAX_LEAVES.
export const LEAF_TIERS: readonly LeafTier[] = [
    { minWidthRem: 0, count: 4 },
    { minWidthRem: 48, count: 8 },
    { minWidthRem: 64, count: 11 },
    { minWidthRem: 80, count: 15 },
];

export function leafCount(widthPx: number): number {
    let count = LEAF_TIERS[0].count;
    for (const tier of LEAF_TIERS) if (tier.minWidthRem * 16 <= widthPx) count = tier.count;
    return count;
}

// Without JavaScript this is what limits the visible leaves. A later tier first
// restores every leaf, then hides its own surplus, so the blocks do not depend on
// what the earlier ones hid. The restore selector has the same specificity as the
// hide selectors, (0,2,0), so it wins by coming later; a plain [data-leaf] would lose.
export function leafTierCss(): string {
    return LEAF_TIERS.map((tier, t) => {
        const hide = [];
        for (let i = tier.count; i < MAX_LEAVES; i++) hide.push(`[data-leaf][data-leaf-index="${i}"]`);
        const rules =
            (t ? '[data-leaf][data-leaf-index]{display:revert}' : '') +
            (hide.length ? `${hide.join(',')}{display:none}` : '');
        return t ? `@media (min-width:${tier.minWidthRem}rem){${rules}}` : rules;
    }).join('\n');
}

// Leaves grow with the viewport width: a seeded size (18-40 px) is the size up to LEAF_SCALE_REF_PX, then scales with
// the width up to LEAF_SCALE_MAX times (2.5x on a 2560 px screen), so a big monitor does not get a sprinkle of crumbs.
// The rendered width (leafSizeCss) and the physics (leafScale, through Viewport.scale) use the same numbers.
export const LEAF_SCALE_REF_PX = 1024;
export const LEAF_SCALE_MAX = 3;

export function leafScale(widthPx: number): number {
    return clamp(widthPx / LEAF_SCALE_REF_PX, 1, LEAF_SCALE_MAX);
}

// The same curve in CSS, so the still composition is sized right without JavaScript. vw includes a classic scrollbar,
// like the innerWidth the script passes to leafScale.
export function leafSizeCss(size: number): string {
    return `clamp(${size}px, ${num((size * 100) / LEAF_SCALE_REF_PX)}vw, ${size * LEAF_SCALE_MAX}px)`;
}

export const LEAF_SEED = 20240611;
export const GUST_MAX = 160;
export const POINTER_RADIUS_PX = 120;
export const MAX_FRAME_MS = 50;
// Time constant of the wind and push decay: exp(-2 / 0.6) is about 3.6%, under the 5% the
// contract asks for after 2 s, and exponential decay makes that true at any frame size.
export const DECAY_S = 0.6;
export const GUST_GAIN = 4;
export const POINTER_PUSH = 500;
// The smallest |scaleX| a leaf starts with, so no leaf of the still composition is drawn edge-on.
export const MIN_STILL_FLIP = 0.4;

export interface Leaf {
    readonly index: number;
    readonly shape: number;
    readonly fill: LeafFill;
    readonly size: number;
    readonly homeX: number;
    readonly homeY: number;
    x: number;
    y: number;
    rotation: number;
    flip: number;
    vx: number;
    vy: number;
    // Seconds of motion so far; the sway and the flip are functions of it.
    t: number;
    // Fall speed in percent of the viewport height per second (15-25 s top to bottom).
    readonly fall: number;
    // Peak horizontal sway speed in percent of the width per second, and its angular rate.
    readonly sway: number;
    readonly swayRate: number;
    // Degrees per second, signed.
    readonly spin: number;
    readonly flipRate: number;
    readonly phase: number;
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo);
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
const frac = (n: number) => n - Math.floor(n);

export function createLeaves(seed: number, max: number = MAX_LEAVES): Leaf[] {
    const r = mulberry32(seed);
    const ox = r();
    const oy = r();
    return Array.from({ length: max }, (_, index) => {
        // A low-discrepancy (R2) sequence plus a little jitter spreads even the first few
        // leaves across the viewport, whatever the count.
        const homeX = clamp(frac(ox + index * 0.7548776662) * 100 + between(r, -3, 3), 0, 100);
        const homeY = clamp(frac(oy + index * 0.5698402909) * 100 + between(r, -3, 3), 0, 100);
        // Every fourth leaf may be the accent: at most 1 in 4 overall.
        const fill = index % 4 === 3 && r() < 0.6 ? 'accent-tint' : LEAF_FILLS[Math.floor(r() * 2)];
        // The flip starts at cos(phase); near a zero crossing the still leaf would be drawn edge-on, a sliver. A quarter
        // turn moves it to where |cos| is above 0.9, without drawing another random number (the rest stays as seeded).
        const drawn = r() * Math.PI * 2;
        const phase = Math.abs(Math.cos(drawn)) < MIN_STILL_FLIP ? drawn + Math.PI / 2 : drawn;
        return {
            index,
            shape: Math.floor(r() * LEAF_SHAPES),
            fill,
            size: Math.round(between(r, 18, 40)),
            homeX,
            homeY,
            x: homeX,
            y: homeY,
            rotation: r() * 360,
            flip: Math.cos(phase),
            vx: 0,
            vy: 0,
            t: 0,
            fall: 100 / between(r, 15, 25),
            sway: between(r, 1, 2.5),
            swayRate: between(r, 0.5, 1.2),
            spin: between(r, 6, 20) * (r() < 0.5 ? -1 : 1),
            flipRate: between(r, 0.4, 1),
            phase,
        };
    });
}

export interface Viewport {
    width: number;
    height: number;
    // leafScale of the viewport: what the seeded sizes are multiplied by. Absent means 1.
    scale?: number;
}
export interface Wind {
    gust: number;
    pointer: { x: number; y: number; active: boolean };
}

export function createWind(): Wind {
    return { gust: 0, pointer: { x: 0, y: 0, active: false } };
}

export function applyGust(wind: Wind, scrollDelta: number): void {
    wind.gust = clamp(wind.gust + scrollDelta * GUST_GAIN, -GUST_MAX, GUST_MAX);
}

export function step(leaves: Leaf[], dtMs: number, wind: Wind, viewport: Viewport): void {
    const dt = clamp(dtMs, 0, MAX_FRAME_MS) / 1000;
    const w = viewport.width || 1;
    const h = viewport.height || 1;
    const decay = Math.exp(-dt / DECAY_S);
    const p = wind.pointer;
    const scale = viewport.scale ?? 1;
    wind.gust *= decay;
    for (const l of leaves) {
        const size = l.size * scale;
        l.t += dt;
        l.vx *= decay;
        l.vy *= decay;
        if (p.active) {
            const dx = (l.x * w) / 100 + size / 2 - p.x;
            const dy = (l.y * h) / 100 + size / 2 - p.y;
            const d = Math.hypot(dx, dy);
            if (d < POINTER_RADIUS_PX) {
                const k = ((1 - d / POINTER_RADIUS_PX) * POINTER_PUSH * dt) / (d || 1);
                l.vx += dx * k;
                l.vy += dy * k;
            }
        }
        const sway = l.sway * Math.cos(l.phase + l.t * l.swayRate);
        l.x += sway * dt + ((wind.gust + l.vx) * dt * 100) / w;
        l.y += l.fall * dt + (l.vy * dt * 100) / h;
        l.rotation += l.spin * dt;
        l.flip = Math.cos(l.phase + l.t * l.flipRate);
        const below = 100 + (size / h) * 100;
        // The leaf's width in percent: x is its left edge, so it is fully off the left at -across and off the right at 100.
        const across = (size / w) * 100;
        if (l.y > below) {
            // No RNG here: a fixed, per-leaf shift keeps the respawns from lining up. The leaf is above the top, out of
            // sight, so it may land anywhere across the width.
            l.y = -(size / h) * 100;
            l.x = (((l.x + 31 + l.index * 7) % 100) + 100) % 100;
        } else if (l.x >= 100) {
            // Blown off the right, it comes back in from just past the left edge (and the other way round), so a leaf
            // never pops into view or out of it.
            l.x = -across;
        } else if (l.x < -across) {
            l.x = 100;
        }
    }
}

const num = (n: number) => Math.round(n * 100) / 100;
const transform = (dx: number, dy: number, leaf: Leaf) =>
    `translate3d(${num(dx)}px, ${num(dy)}px, 0) rotate(${num(leaf.rotation)}deg) scaleX(${num(leaf.flip)})`;

export function leafTransform(leaf: Leaf, viewport: Viewport): string {
    return transform(
        ((leaf.x - leaf.homeX) * viewport.width) / 100,
        ((leaf.y - leaf.homeY) * viewport.height) / 100,
        leaf,
    );
}

export function stillTransform(leaf: Leaf): string {
    return transform(0, 0, leaf);
}
