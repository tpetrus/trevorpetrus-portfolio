import { describe, expect, it } from 'vitest';
import {
    GUST_MAX,
    LEAF_FILLS,
    LEAF_SCALE_MAX,
    LEAF_SCALE_REF_PX,
    LEAF_SEED,
    LEAF_SHAPES,
    LEAF_TIERS,
    MAX_FRAME_MS,
    MAX_LEAVES,
    MIN_STILL_FLIP,
    POINTER_RADIUS_PX,
    applyGust,
    createLeaves,
    createWind,
    leafCount,
    leafScale,
    leafSizeCss,
    leafTierCss,
    leafTransform,
    step,
    stillTransform,
} from './leaves';

const viewport = { width: 1000, height: 800 };

describe('leaf scale', () => {
    it('keeps the seeded size up to the reference width, then grows with the width up to the cap', () => {
        expect(leafScale(320)).toBe(1);
        expect(leafScale(LEAF_SCALE_REF_PX)).toBe(1);
        expect(leafScale(1920)).toBeCloseTo(1920 / LEAF_SCALE_REF_PX);
        expect(leafScale(2560)).toBeCloseTo(2.5);
        expect(leafScale(10_000)).toBe(LEAF_SCALE_MAX);
    });

    it('writes the same curve as a CSS clamp, so the still leaves match the moving ones', () => {
        expect(leafSizeCss(20)).toBe(
            `clamp(20px, ${Math.round((2000 / LEAF_SCALE_REF_PX) * 100) / 100}vw, ${20 * LEAF_SCALE_MAX}px)`,
        );
        // The preferred vw term equals size * leafScale at any width between the bounds.
        const vw = Number(/, ([\d.]+)vw,/.exec(leafSizeCss(32))?.[1]);
        expect((vw * 2560) / 100).toBeCloseTo(32 * leafScale(2560), 0);
    });

    it('wraps and pushes by the scaled size', () => {
        const [leaf] = createLeaves(3, 1);
        Object.assign(leaf, { size: 40 });
        const big = { ...viewport, scale: 2 };
        // 80 px wide at scale 2: still partly visible at half that past the left edge, gone past all of it.
        const across = (80 / big.width) * 100;
        leaf.x = -across + 0.01;
        step([leaf], 0, createWind(), big);
        expect(leaf.x).toBe(-across + 0.01);
        leaf.x = -across - 0.01;
        step([leaf], 0, createWind(), big);
        expect(leaf.x).toBe(100);
        leaf.x = 100;
        step([leaf], 0, createWind(), big);
        expect(leaf.x).toBe(-across);

        // The pointer at the scaled center pushes nothing; at the unscaled center it is off-center and pushes.
        Object.assign(leaf, { x: 50, y: 50, vx: 0, vy: 0 });
        const wind = createWind();
        wind.pointer = { x: 500 + 40, y: 400 + 40, active: true };
        step([leaf], 16, wind, big);
        expect([leaf.vx, leaf.vy]).toEqual([0, 0]);
        Object.assign(leaf, { x: 50, y: 50 });
        wind.pointer = { x: 500 + 20, y: 400 + 40, active: true };
        step([leaf], 16, wind, big);
        expect(leaf.vx).toBeGreaterThan(0);
    });
});

describe('tiers', () => {
    it('is ascending, strictly increasing in count, from 4 to 15', () => {
        expect(LEAF_TIERS[0]).toEqual({ minWidthRem: 0, count: 4 });
        expect(LEAF_TIERS.at(-1)).toEqual({ minWidthRem: 80, count: 15 });
        for (let i = 1; i < LEAF_TIERS.length; i++) {
            expect(LEAF_TIERS[i].minWidthRem).toBeGreaterThan(LEAF_TIERS[i - 1].minWidthRem);
            expect(LEAF_TIERS[i].count).toBeGreaterThan(LEAF_TIERS[i - 1].count);
        }
        expect(LEAF_TIERS.at(-1)?.count).toBe(MAX_LEAVES);
    });

    it('counts leaves by width, with exact boundaries', () => {
        expect(leafCount(320)).toBe(LEAF_TIERS[0].count);
        expect(leafCount(768)).toBe(LEAF_TIERS[1].count);
        expect(leafCount(1280)).toBe(15);
        expect(leafCount(1920)).toBe(15);
        for (const tier of LEAF_TIERS) {
            expect(leafCount(tier.minWidthRem * 16)).toBe(tier.count);
        }
        for (const tier of LEAF_TIERS.slice(1)) {
            expect(leafCount(tier.minWidthRem * 16 - 1)).toBeLessThan(tier.count);
        }
    });

    it('writes css that hides exactly the indexes at or above each tier count', () => {
        const blocks = leafTierCss().split('\n');
        expect(blocks).toHaveLength(LEAF_TIERS.length);
        LEAF_TIERS.forEach((tier, t) => {
            const block = blocks[t];
            if (t === 0) expect(block).not.toContain('@media');
            else expect(block.startsWith(`@media (min-width:${tier.minWidthRem}rem)`)).toBe(true);
            const hidden = [...block.matchAll(/data-leaf-index="(\d+)"/g)].map((m) => Number(m[1]));
            const expected = Array.from({ length: MAX_LEAVES - tier.count }, (_, i) => tier.count + i);
            expect(hidden).toEqual(expected);
            // Each later tier restores the earlier tiers' hidden leaves with a selector as specific as theirs.
            if (t > 0) expect(block).toContain('[data-leaf][data-leaf-index]{display:revert}');
            // No rule with an empty selector list.
            expect(block).not.toMatch(/(^|[{}])\{/);
        });
    });
});

describe('createLeaves', () => {
    it('is deterministic for a seed and differs for another', () => {
        expect(createLeaves(LEAF_SEED)).toEqual(createLeaves(LEAF_SEED));
        expect(createLeaves(1)).not.toEqual(createLeaves(2));
    });

    it('builds a valid starting composition', () => {
        for (const seed of [1, 2, 3, LEAF_SEED, 99]) {
            const leaves = createLeaves(seed);
            expect(leaves).toHaveLength(MAX_LEAVES);
            expect(leaves.filter((l) => l.fill === 'accent-tint').length).toBeLessThanOrEqual(
                Math.floor(MAX_LEAVES / 4),
            );
            leaves.forEach((l, i) => {
                expect(l.index).toBe(i);
                for (const v of [l.homeX, l.homeY, l.x, l.y]) {
                    expect(v).toBeGreaterThanOrEqual(0);
                    expect(v).toBeLessThanOrEqual(100);
                }
                expect([l.x, l.y]).toEqual([l.homeX, l.homeY]);
                expect(LEAF_FILLS).toContain(l.fill);
                expect(Number.isInteger(l.shape)).toBe(true);
                expect(l.shape).toBeGreaterThanOrEqual(0);
                expect(l.shape).toBeLessThan(LEAF_SHAPES);
                expect(l.size).toBeGreaterThanOrEqual(18);
                expect(l.size).toBeLessThanOrEqual(40);
                expect([l.vx, l.vy]).toEqual([0, 0]);
            });
        }
    });

    it('honors a smaller max', () => {
        expect(createLeaves(5, 6)).toHaveLength(6);
    });
});

describe('step', () => {
    it('clamps the frame time', () => {
        const slow = createLeaves(7);
        const capped = createLeaves(7);
        step(slow, 10_000, createWind(), viewport);
        step(capped, MAX_FRAME_MS, createWind(), viewport);
        expect(slow).toEqual(capped);
        const still = createLeaves(7);
        step(still, -20, createWind(), viewport);
        expect(still).toEqual(createLeaves(7));
    });

    it('lets leaves fall over time', () => {
        const leaves = createLeaves(3, 1);
        leaves[0].y = 10;
        for (let i = 0; i < 60; i++) step(leaves, 16, createWind(), viewport);
        expect(leaves[0].y).toBeGreaterThan(10);
    });

    it('takes 15 to 25 seconds to cross the viewport', () => {
        for (const l of createLeaves(LEAF_SEED)) {
            expect(100 / l.fall).toBeGreaterThanOrEqual(15);
            expect(100 / l.fall).toBeLessThanOrEqual(25);
        }
    });

    it('wraps a leaf past the bottom to above the top, with x inside the width', () => {
        const [leaf] = createLeaves(3, 1);
        leaf.y = 99.99;
        leaf.x = 99.9;
        Object.assign(leaf, { size: 40 });
        for (let i = 0; i < 400 && leaf.y > 0; i++) step([leaf], 16, createWind(), viewport);
        expect(leaf.y).toBeLessThan(0);
        expect(leaf.x).toBeGreaterThanOrEqual(0);
        expect(leaf.x).toBeLessThan(100);
        expect(leaf.y).toBeGreaterThanOrEqual(-(40 / viewport.height) * 100 - 1);
    });

    it('lets a leaf leave the left edge out of sight before it comes back on the right', () => {
        const [leaf] = createLeaves(3, 1);
        Object.assign(leaf, { size: 40 });
        const across = (40 / viewport.width) * 100;
        const wind = createWind();
        // Partly off the left, still partly visible: it stays where it is.
        leaf.x = -across / 2;
        step([leaf], 0, wind, viewport);
        expect(leaf.x).toBe(-across / 2);
        // Fully off the left: it re-enters from just past the right edge, out of sight.
        leaf.x = -across - 0.01;
        step([leaf], 0, wind, viewport);
        expect(leaf.x).toBe(100);
    });

    it('lets a leaf leave the right edge out of sight before it comes back on the left', () => {
        const [leaf] = createLeaves(3, 1);
        Object.assign(leaf, { size: 40 });
        leaf.x = 99.9;
        step([leaf], 0, createWind(), viewport);
        expect(leaf.x).toBe(99.9);
        leaf.x = 100;
        step([leaf], 0, createWind(), viewport);
        expect(leaf.x).toBe(-(40 / viewport.width) * 100);
    });

    it('pushes only leaves within the pointer radius, away from it', () => {
        const [near, far] = createLeaves(4, 2);
        for (const l of [near, far]) l.rotation = 0;
        near.x = 50;
        near.y = 50;
        Object.assign(near, { size: 20 });
        far.x = 90;
        far.y = 10;
        Object.assign(far, { size: 20 });
        const cx = (near.x * viewport.width) / 100 + 10;
        const cy = (near.y * viewport.height) / 100 + 10;
        const wind = createWind();
        // The pointer sits 50 px to the left of and level with the near leaf's center.
        wind.pointer = { x: cx - 50, y: cy, active: true };
        step([near, far], 16, wind, viewport);
        expect(near.vx).toBeGreaterThan(0);
        expect(Math.abs(near.vy)).toBeLessThan(1e-9);
        expect(far.vx).toBe(0);
        expect(far.vy).toBe(0);
        const d = Math.hypot(cx - wind.pointer.x, cy - wind.pointer.y);
        expect(d).toBeLessThan(POINTER_RADIUS_PX);
    });

    it('does not push a leaf under the pointer exactly, or at the radius', () => {
        const [leaf] = createLeaves(4, 1);
        leaf.x = 50;
        leaf.y = 50;
        const cx = (leaf.x * viewport.width) / 100 + leaf.size / 2;
        const cy = (leaf.y * viewport.height) / 100 + leaf.size / 2;
        const wind = createWind();
        wind.pointer = { x: cx, y: cy, active: true };
        step([leaf], 16, wind, viewport);
        expect(leaf.vx).toBe(0);
        Object.assign(leaf, { x: 50, y: 50 });
        wind.pointer = { x: cx - POINTER_RADIUS_PX, y: cy, active: true };
        step([leaf], 16, wind, viewport);
        expect(leaf.vx).toBe(0);
    });

    it('ignores an inactive pointer', () => {
        const [leaf] = createLeaves(4, 1);
        const wind = createWind();
        wind.pointer = {
            x: (leaf.x * viewport.width) / 100 + leaf.size / 2 - 10,
            y: (leaf.y * viewport.height) / 100 + leaf.size / 2,
            active: false,
        };
        step([leaf], 16, wind, viewport);
        expect([leaf.vx, leaf.vy]).toEqual([0, 0]);
    });

    it('survives a zero-size viewport', () => {
        const leaves = createLeaves(4, 2);
        step(leaves, 16, createWind(), { width: 0, height: 0 });
        expect(leaves.every((l) => Number.isFinite(l.x) && Number.isFinite(l.y))).toBe(true);
    });
});

describe('applyGust', () => {
    it('follows the scroll direction', () => {
        const down = createWind();
        applyGust(down, 30);
        expect(down.gust).toBeGreaterThan(0);
        const up = createWind();
        applyGust(up, -30);
        expect(up.gust).toBeLessThan(0);
    });

    it('clamps a huge flick', () => {
        const wind = createWind();
        applyGust(wind, 1e6);
        expect(wind.gust).toBe(GUST_MAX);
        applyGust(wind, -1e9);
        expect(wind.gust).toBe(-GUST_MAX);
    });

    it.each([16, 50])('calms to under 5%% of the maximum after 2 s at %i ms frames', (frame) => {
        const wind = createWind();
        applyGust(wind, 1e6);
        for (let t = 0; t < 2000; t += frame) step([], frame, wind, viewport);
        expect(Math.abs(wind.gust)).toBeLessThan(GUST_MAX * 0.05);
    });
});

describe('transforms', () => {
    const format =
        /^translate3d\((-?\d+(\.\d{1,2})?)px, (-?\d+(\.\d{1,2})?)px, 0\) rotate\((-?\d+(\.\d{1,2})?)deg\) scaleX\((-?\d+(\.\d{1,2})?)\)$/;

    it('uses the documented format with at most 2 decimals', () => {
        const [leaf] = createLeaves(9, 1);
        for (let i = 0; i < 30; i++) step([leaf], 16, createWind(), viewport);
        expect(leafTransform(leaf, viewport)).toMatch(format);
        expect(stillTransform(leaf)).toMatch(format);
    });

    it('gives a fresh leaf the same transform as the still one', () => {
        for (const leaf of createLeaves(LEAF_SEED)) {
            expect(leafTransform(leaf, viewport)).toBe(stillTransform(leaf));
            expect(stillTransform(leaf)).toContain('translate3d(0px, 0px, 0)');
        }
    });

    it('never starts a leaf edge-on, so the still composition has no slivers', () => {
        for (const seed of [1, 2, 3, LEAF_SEED, 99]) {
            for (const leaf of createLeaves(seed)) expect(Math.abs(leaf.flip)).toBeGreaterThanOrEqual(MIN_STILL_FLIP);
        }
    });

    it('offsets by the distance from home in pixels and keeps the flip in range', () => {
        const [leaf] = createLeaves(9, 1);
        leaf.x = leaf.homeX + 10;
        leaf.y = leaf.homeY + 5;
        expect(leafTransform(leaf, viewport)).toMatch(/^translate3d\(100px, 40px, 0\)/);
        for (let i = 0; i < 200; i++) {
            step([leaf], 16, createWind(), viewport);
            expect(Math.abs(leaf.flip)).toBeLessThanOrEqual(1);
        }
    });
});
