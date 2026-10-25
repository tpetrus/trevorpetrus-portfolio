import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import astro from 'eslint-plugin-astro';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Files whose default export is required by a tool (Astro, Vitest, Playwright) or by ESLint itself.
const DEFAULT_EXPORT_ALLOWED = [
    'src/pages/**',
    'src/layouts/**',
    'src/components/**/*.astro',
    'astro.config.mjs',
    'vitest.config.ts',
    'playwright.config.ts',
    'eslint.config.js',
];

export default defineConfig(
    {
        ignores: [
            'dist/',
            '.astro/',
            '.wrangler/',
            'coverage/',
            'node_modules/',
            'playwright-report/',
            'test-results/',
            'blob-report/',
            '.lighthouseci/',
            '.claude/',
        ],
    },
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    astro.configs['flat/recommended'],
    astro.configs['flat/jsx-a11y-recommended'],
    // eslint-plugin-astro registers the jsx-a11y plugin for .astro files; this covers React islands (.jsx/.tsx).
    { ...jsxA11y.flatConfigs.recommended, files: ['**/*.{jsx,tsx}'] },
    {
        languageOptions: {
            parserOptions: {
                // Type-aware rules read tsconfig.json (and tests/e2e/tsconfig.json for the end-to-end program).
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
                extraFileExtensions: ['.astro'],
            },
        },
        rules: {
            // A leading underscore marks a parameter that is intentionally unused.
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
            ],
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'ExportDefaultDeclaration',
                    message: 'Use a named export. Default exports are only allowed where a tool requires them.',
                },
                {
                    selector: "ExportNamedDeclaration > ExportSpecifier[exported.name='default']",
                    message: 'Use a named export. Default exports are only allowed where a tool requires them.',
                },
            ],
        },
    },
    {
        // astro-eslint-parser does not support projectService, so .astro files use the equivalent `project: true`.
        files: ['**/*.astro'],
        languageOptions: { parserOptions: { projectService: false, project: true } },
    },
    {
        files: ['src/**/*.{ts,tsx}'],
        languageOptions: { globals: globals.browser },
    },
    {
        files: ['*.{js,mjs,ts}', 'scripts/**/*.ts', 'tests/**/*.ts'],
        languageOptions: { globals: globals.node },
    },
    {
        // The end-to-end tests are a separate program that imports from the app, never the other way round.
        files: ['src/**/*.{ts,tsx,astro}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['**/tests', '**/tests/**'],
                            message:
                                'App code must not import from tests/. The end-to-end tests depend on the app, not the reverse.',
                        },
                    ],
                },
            ],
        },
    },
    {
        // Playwright specs run in Node but pass callbacks to `page.evaluate`, which run in the browser.
        files: ['tests/e2e/**/*.ts'],
        languageOptions: { globals: { ...globals.node, ...globals.browser } },
    },
    {
        files: DEFAULT_EXPORT_ALLOWED,
        rules: { 'no-restricted-syntax': 'off' },
    },
    {
        // Tailwind's preflight removes list markers, and Safari/VoiceOver then stops announcing a `<ul>` as a list
        // unless it carries an explicit role. The rule's default flags that role as redundant, so allow it.
        files: ['**/*.astro'],
        rules: { 'astro/jsx-a11y/no-redundant-roles': ['error', { ul: ['list'], ol: ['list'] }] },
    },
    {
        // Plain JS config files are not part of the TypeScript project, so type-aware rules cannot run on them.
        files: ['**/*.{js,mjs}'],
        extends: [tseslint.configs.disableTypeChecked],
    },
    // Must stay last so it can turn off any stylistic rule that would fight Prettier.
    prettier,
);
