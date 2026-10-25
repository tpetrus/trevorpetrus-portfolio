import { z } from 'astro/zod';
import { parse } from 'yaml';

import { projectSchema } from './projects';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

// The thumbnail is a path string here: only Astro's `image()` can resolve it, and that exists solely inside the build.
const schema = projectSchema(z.string());
export type ProjectFrontmatter = z.output<typeof schema>;

/** Parses and validates the YAML frontmatter of a project markdown file, throwing a readable error when it is bad. */
export function readProjectFrontmatter(markdown: string, source: string): ProjectFrontmatter {
    const block = FRONTMATTER.exec(markdown)?.[1];
    if (block === undefined) {
        throw new Error(`${source}: no frontmatter block found`);
    }
    const result = schema.safeParse(parse(block));
    if (!result.success) {
        throw new Error(`${source}: invalid frontmatter\n${z.prettifyError(result.error)}`);
    }
    return result.data;
}
