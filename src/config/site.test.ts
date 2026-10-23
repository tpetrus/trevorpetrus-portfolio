import { describe, expect, it } from 'vitest';

import { PROJECTS_DOMAIN, projectUrl, SITE_URL } from './site';

describe('SITE_URL', () => {
    it('is an absolute https URL', () => {
        expect(new URL(SITE_URL).protocol).toBe('https:');
    });
});

describe('PROJECTS_DOMAIN', () => {
    it('is a bare host that the site itself lives under', () => {
        expect(PROJECTS_DOMAIN).not.toMatch(/[:/]/);
        expect(new URL(SITE_URL).host.endsWith(PROJECTS_DOMAIN)).toBe(true);
    });
});

describe('projectUrl', () => {
    it('puts a workers.dev sibling next to the site, not under it', () => {
        expect(projectUrl('audio-visualizer')).toBe('https://audio-visualizer.mypoke.workers.dev');
    });

    it('puts the project name in front of a custom apex domain', () => {
        expect(projectUrl('audio-visualizer', 'example.com')).toBe('https://audio-visualizer.example.com');
    });

    it('defaults to the configured projects domain', () => {
        expect(projectUrl('demo')).toBe(`https://demo.${PROJECTS_DOMAIN}`);
    });

    it.each(['', 'Demo', 'my project', 'a.b', '-demo', 'demo-', 'demo/', 'café', 'a'.repeat(64)])(
        'rejects the invalid name %j',
        (name) => {
            expect(() => projectUrl(name, 'example.com')).toThrow(/Invalid project subdomain/);
        },
    );

    it.each(['a', 'a1', 'a-b', 'a'.repeat(63)])('accepts the valid name %j', (name) => {
        expect(projectUrl(name, 'example.com')).toBe(`https://${name}.example.com`);
    });

    it.each([
        '',
        'https://example.com',
        'example.com/',
        'example.com/path',
        'example.com:4321',
        '.example.com',
        'example..com',
        'Example.com',
    ])('rejects the invalid domain %j', (domain) => {
        expect(() => projectUrl('demo', domain)).toThrow(/Invalid projects domain/);
    });
});
