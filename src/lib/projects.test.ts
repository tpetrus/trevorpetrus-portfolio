import { z } from 'astro/zod';
import { describe, expect, it } from 'vitest';

import {
    isScreenshotTarget,
    projectHref,
    projectSchema,
    repoPath,
    sortProjects,
    statusLabel,
    thumbnailFile,
    thumbnailFrontmatter,
} from './projects';

const valid = {
    title: 'AudioVisualizer',
    status: 'live',
    repo: 'https://github.com/tpetrus/AudioVisualizer',
    subdomain: 'audio-visualizer',
    order: 1,
    appSelector: '#app',
};

const schema = projectSchema(z.string());

describe('projectSchema', () => {
    it('accepts a complete project and an optional thumbnail', () => {
        expect(schema.parse({ ...valid, thumbnail: '../../assets/projects/a.avif' }).thumbnail).toBe(
            '../../assets/projects/a.avif',
        );
    });

    it('accepts a project without a subdomain or thumbnail', () => {
        const { subdomain: _subdomain, appSelector: _selector, ...rest } = valid;
        const project = schema.parse(rest);
        expect(project.subdomain).toBeUndefined();
        expect(project.thumbnail).toBeUndefined();
    });

    it.each([
        ['an empty title', { title: '' }],
        ['an unknown status', { status: 'done' }],
        ['a non-GitHub repo', { repo: 'https://gitlab.com/tpetrus/x' }],
        ['a repo URL with a path', { repo: 'https://github.com/tpetrus/x/tree/main' }],
        ['a repo URL with a trailing slash', { repo: 'https://github.com/tpetrus/x/' }],
        ['an uppercase subdomain', { subdomain: 'Audio' }],
        ['a dotted subdomain', { subdomain: 'a.b' }],
        ['a fractional order', { order: 1.5 }],
    ])('rejects %s', (_name, override) => {
        expect(schema.safeParse({ ...valid, ...override }).success).toBe(false);
    });
});

describe('appSelector', () => {
    const { appSelector: _selector, ...withoutSelector } = valid;

    it('is required for a live project with a subdomain', () => {
        const result = schema.safeParse(withoutSelector);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(['appSelector']);
    });

    it('is optional when the project is not live or has no subdomain', () => {
        expect(schema.safeParse({ ...withoutSelector, status: 'archived' }).success).toBe(true);
        const { subdomain: _subdomain, ...noSubdomain } = withoutSelector;
        expect(schema.safeParse(noSubdomain).success).toBe(true);
    });

    it.each(['', '   '])('rejects a blank selector %j', (appSelector) => {
        expect(schema.safeParse({ ...valid, appSelector }).success).toBe(false);
    });
});

describe('repoPath', () => {
    it('returns owner/repo', () => {
        expect(repoPath('https://github.com/tpetrus/AudioVisualizer')).toBe('tpetrus/AudioVisualizer');
    });

    it('throws for anything else', () => {
        expect(() => repoPath('https://example.com/a/b')).toThrow(/Not a GitHub repo URL/);
    });
});

describe('projectHref', () => {
    it('links to the subdomain when there is one', () => {
        expect(projectHref(valid)).toBe('https://audio-visualizer.trevorpetr.us');
    });

    it('falls back to the repo', () => {
        expect(projectHref({ repo: valid.repo })).toBe(valid.repo);
    });
});

describe('statusLabel', () => {
    it.each([
        ['live', 'Live'],
        ['in-progress', 'In progress'],
        ['archived', 'Archived'],
    ] as const)('labels %s as %s', (status, label) => {
        expect(statusLabel(status)).toBe(label);
    });
});

describe('sortProjects', () => {
    it('sorts by order, then title, without mutating the input', () => {
        const input = [
            { order: 2, title: 'B' },
            { order: 1, title: 'Z' },
            { order: 2, title: 'A' },
        ];
        expect(sortProjects(input).map((p) => p.title)).toEqual(['Z', 'A', 'B']);
        expect(input[0]?.title).toBe('B');
    });
});

describe('isScreenshotTarget', () => {
    it('needs a live status and a subdomain', () => {
        expect(isScreenshotTarget({ status: 'live', subdomain: 'x' })).toBe(true);
        expect(isScreenshotTarget({ status: 'live' })).toBe(false);
        expect(isScreenshotTarget({ status: 'archived', subdomain: 'x' })).toBe(false);
    });
});

describe('thumbnail paths', () => {
    it('keeps the file and the frontmatter value pointing at the same asset', () => {
        expect(thumbnailFile('demo')).toBe('src/assets/projects/demo.avif');
        expect(thumbnailFrontmatter('demo')).toBe('../../assets/projects/demo.avif');
    });
});
