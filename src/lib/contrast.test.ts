import { describe, expect, it } from 'vitest';

import { contrastRatio, relativeLuminance } from './contrast';

describe('relativeLuminance', () => {
    it('is 0 for black and 1 for white', () => {
        expect(relativeLuminance('#000000')).toBe(0);
        expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
    });

    it('uses the linear segment for very dark channels', () => {
        // 10/255 is below the 0.04045 knee, so the channel is divided by 12.92 instead of using the power curve.
        expect(relativeLuminance('#0a0a0a')).toBeCloseTo(10 / 255 / 12.92, 6);
    });

    it('is case-insensitive and rejects anything but #rrggbb', () => {
        expect(relativeLuminance('#FF4D1F')).toBe(relativeLuminance('#ff4d1f'));
        expect(() => relativeLuminance('#fff')).toThrow('Expected a #rrggbb color');
        expect(() => relativeLuminance('red')).toThrow('Expected a #rrggbb color');
    });
});

describe('contrastRatio', () => {
    it('is 21 between black and white and 1 for equal colors', () => {
        expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10);
        expect(contrastRatio('#336699', '#336699')).toBe(1);
    });

    it('does not depend on argument order', () => {
        expect(contrastRatio('#ff00ff', '#ffffff')).toBe(contrastRatio('#ffffff', '#ff00ff'));
    });

    it('reproduces the known magenta-on-white figure (about 3.14)', () => {
        expect(contrastRatio('#ff00ff', '#ffffff')).toBeCloseTo(3.14, 2);
    });
});
