import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

import { projectSchema } from './lib/projects';

// One markdown file per project; the file name (without .md) is the entry id and the key in src/data/project-meta.json.
// A frontmatter error fails the build, which is the point: a bad card should never reach production.
const projects = defineCollection({
    loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
    schema: ({ image }) => projectSchema(image()),
});

export const collections = { projects };
