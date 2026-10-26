import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { WCAG, contrastRatio } from './contrast';
import { THEME_COLOR } from './theme';

// The CSS is the one source of the palette; the spec reads it so a changed color is checked, not just a copy of it.
const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

function token(name: string): string {
    const match = new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6});`, 'i').exec(css);
    if (!match?.[1]) throw new Error(`--color-${name} is not defined in global.css.`);
    return match[1];
}

const paper = token('paper');
const paper2 = token('paper-2');
const ink = token('ink');
const inkMuted = token('ink-muted');
const inkMutedOnInk = token('ink-muted-on-ink');
const accent = token('accent');
const accentDeep = token('accent-deep');

describe('design tokens', () => {
    it('keeps the theme-color meta equal to the paper background', () => {
        expect(THEME_COLOR).toBe(paper);
    });

    // Every pair the site uses (text on its background), with the WCAG bar it must clear and the ratio computed when
    // the palette was chosen, rounded to the two decimals shown in the PR's contrast table.
    const passingPairs = [
        ['ink on paper', ink, paper, WCAG.enhancedText, 17.13],
        ['ink on paper-2', ink, paper2, WCAG.enhancedText, 15.36],
        ['ink-muted on paper', inkMuted, paper, WCAG.text, 6.91],
        ['ink-muted on paper-2', inkMuted, paper2, WCAG.text, 6.2],
        ['paper on ink', paper, ink, WCAG.enhancedText, 17.13],
        ['ink-muted-on-ink on ink', inkMutedOnInk, ink, WCAG.enhancedText, 7.77],
        ['accent on ink', accent, ink, WCAG.text, 5.83],
        ['ink on accent', ink, accent, WCAG.text, 5.83],
        ['accent-deep on paper', accentDeep, paper, WCAG.text, 5.43],
        ['accent-deep on paper-2', accentDeep, paper2, WCAG.text, 4.87],
        ['paper on accent-deep', paper, accentDeep, WCAG.text, 5.43],
    ] as const;

    it.each(passingPairs)('%s clears its WCAG bar', (_name, foreground, background, minimum, expected) => {
        const ratio = contrastRatio(foreground, background);

        expect(ratio).toBeGreaterThanOrEqual(minimum);
        expect(Math.round(ratio * 100) / 100).toBe(expected);
    });

    // The documented traps: the accent fails even the 3:1 non-text bar on paper, in either direction.
    it.each([
        ['accent on paper', accent, paper],
        ['paper on accent', paper, accent],
    ] as const)('%s stays out of use because it fails 3:1', (_name, foreground, background) => {
        expect(contrastRatio(foreground, background)).toBeLessThan(WCAG.largeTextOrUi);
    });
});
