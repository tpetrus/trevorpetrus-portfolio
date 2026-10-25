/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

export default getViteConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            // Listing the sources (not just the files tests import) makes untested files show up as 0%.
            include: ['src/lib/**/*.ts', 'src/config/**/*.ts'],
            exclude: ['**/*.test.ts'],
            reporter: ['text', 'html'],
            // Fails `npm run test:coverage` if any metric across the included files drops below 95%.
            thresholds: { lines: 95, statements: 95, functions: 95, branches: 95 },
        },
    },
});
