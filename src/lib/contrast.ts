// WCAG 2.2 contrast math (https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio), used by the design-token spec.

const HEX_COLOR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/** Minimum ratios from WCAG 2.2: 1.4.3 (text), 1.4.6 (enhanced text) and 1.4.11 (non-text UI, large text). */
export const WCAG = { text: 4.5, enhancedText: 7, largeTextOrUi: 3 } as const;

/** Linearizes one 0-255 sRGB channel. */
function linearize(channel: number): number {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a `#rrggbb` color, from 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
    const match = HEX_COLOR.exec(hex);
    if (!match) throw new Error(`Expected a #rrggbb color, got "${hex}".`);
    const [, red = '', green = '', blue = ''] = match;
    return (
        0.2126 * linearize(Number.parseInt(red, 16)) +
        0.7152 * linearize(Number.parseInt(green, 16)) +
        0.0722 * linearize(Number.parseInt(blue, 16))
    );
}

/** Contrast ratio between two `#rrggbb` colors, from 1 to 21; the order of the arguments does not matter. */
export function contrastRatio(first: string, second: string): number {
    const firstLuminance = relativeLuminance(first);
    const secondLuminance = relativeLuminance(second);
    const lighter = Math.max(firstLuminance, secondLuminance);
    const darker = Math.min(firstLuminance, secondLuminance);
    return (lighter + 0.05) / (darker + 0.05);
}
