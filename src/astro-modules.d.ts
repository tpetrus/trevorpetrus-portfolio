// ESLint's type-aware rules and Vitest read .astro files as plain TypeScript, which cannot see inside them. This gives
// an `import Component from './Component.astro'` in a .ts file (the Container API specs) the type Astro's container
// expects. `astro check` still type-checks `.astro` imports from `.astro` files by their real props.
declare module '*.astro' {
    import type { AstroComponentFactory } from 'astro/runtime/server/index.js';

    const component: AstroComponentFactory;
    // Describes the default export every .astro file has; it is not a default export of our own.
    // eslint-disable-next-line no-restricted-syntax
    export default component;
}
