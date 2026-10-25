import { describe, expect, it } from 'vitest';

import { readProjectFrontmatter } from './projectSource';

const frontmatter = `title: Demo
description: A demo.
tech: [TypeScript]
status: live
repo: https://github.com/tpetrus/demo
subdomain: demo
order: 1`;

describe('readProjectFrontmatter', () => {
    it('parses valid frontmatter', () => {
        const project = readProjectFrontmatter(`---\n${frontmatter}\n---\n\nBody\n`, 'demo.md');
        expect(project).toMatchObject({ title: 'Demo', tech: ['TypeScript'], order: 1 });
    });

    it('handles CRLF line endings and a file that ends at the closing fence', () => {
        const crlf = `---\r\n${frontmatter.replaceAll('\n', '\r\n')}\r\n---`;
        expect(readProjectFrontmatter(crlf, 'demo.md').title).toBe('Demo');
    });

    it('names the file when there is no frontmatter', () => {
        expect(() => readProjectFrontmatter('# Just a body', 'demo.md')).toThrow('demo.md: no frontmatter block');
    });

    it('names the file and the bad field when validation fails', () => {
        const bad = `---\n${frontmatter.replace('status: live', 'status: nope')}\n---\n`;
        expect(() => readProjectFrontmatter(bad, 'demo.md')).toThrow(/demo\.md: invalid frontmatter[\s\S]*status/);
    });
});
