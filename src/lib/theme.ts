/**
 * The browser UI color for `<meta name="theme-color">`: the paper background. It repeats `--color-paper` from
 * `src/styles/global.css` because a `<meta>` cannot read a CSS variable; `designTokens.test.ts` fails if they drift.
 */
export const THEME_COLOR = '#f4f1ea';
