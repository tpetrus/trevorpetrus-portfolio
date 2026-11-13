import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';

import {
    LEAF_FILLS,
    LEAF_SEED,
    LEAF_SHAPES,
    MAX_LEAVES,
    createLeaves,
    leafTierCss,
    stillTransform,
} from '../lib/leaves';
import HomeLeaves from './HomeLeaves.astro';

// The markup is parsed with regular expressions, as in Gallery.test.ts: the specs run in node, and Astro's output is
// plain `name="value"` attributes.
function tagsOf(html: string, name: string): string[] {
    return html.match(new RegExp(String.raw`<${name}\b[^>]*>`, 'g')) ?? [];
}

function attributesOf(tag: string): Record<string, string> {
    return Object.fromEntries(
        [...tag.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)].map(([, key, value]) => [key, value ?? '']),
    );
}

describe('HomeLeaves', () => {
    let html: string;
    let leaves: Record<string, string>[];

    beforeAll(async () => {
        const container = await AstroContainer.create();
        html = await container.renderToString(HomeLeaves);
        leaves = tagsOf(html, 'svg')
            .map(attributesOf)
            .filter((attributes) => 'data-leaf' in attributes);
    });

    it('renders one decorative, still layer that takes no pointer events', () => {
        const layers = tagsOf(html, 'div')
            .map(attributesOf)
            .filter((attributes) => 'data-leaves' in attributes);

        expect(layers).toHaveLength(1);
        const [layer] = layers;
        expect(layer?.['aria-hidden']).toBe('true');
        expect(layer?.['data-leaves-state']).toBe('still');
        expect(layer?.class?.split(' ')).toEqual(
            expect.arrayContaining(['pointer-events-none', 'fixed', 'inset-0', 'z-0', 'overflow-hidden']),
        );
    });

    it('renders every leaf of the seeded composition, indexed in order, at its still transform', () => {
        const expected = createLeaves(LEAF_SEED);

        expect(leaves).toHaveLength(MAX_LEAVES);
        for (const [index, leaf] of expected.entries()) {
            const attributes = leaves[index];
            expect(attributes?.['data-leaf-index']).toBe(String(index));
            expect(attributes?.focusable).toBe('false');
            const style = attributes?.style ?? '';
            expect(style).toContain(`left:${leaf.homeX}%`);
            expect(style).toContain(`top:${leaf.homeY}%`);
            expect(attributes?.class?.split(' ')).toContain(`text-${leaf.fill}`);
            expect(style).toContain(`transform:${stillTransform(leaf)}`);
            expect(LEAF_FILLS).toContain(leaf.fill);
        }
    });

    it('defines a symbol for every shape the leaves use', () => {
        const symbols = tagsOf(html, 'symbol').map((tag) => attributesOf(tag).id);
        const uses = tagsOf(html, 'use').map((tag) => attributesOf(tag).href);

        expect(symbols).toEqual(Array.from({ length: LEAF_SHAPES }, (_, shape) => `leaf-shape-${shape}`));
        expect(uses).toHaveLength(MAX_LEAVES);
        for (const href of uses) expect(symbols).toContain(href?.slice(1));
    });

    it('limits the visible leaves by viewport width with the tier CSS, so no script is needed', () => {
        expect(html).toContain(`<style>${leafTierCss()}</style>`);
    });

    it('contains nothing that can take focus', () => {
        expect(html).not.toMatch(/<(a|button|input|select|textarea)\b/);
        expect(html).not.toMatch(/tabindex=/);
    });
});
