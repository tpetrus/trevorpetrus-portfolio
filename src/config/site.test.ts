import { describe, expect, it } from 'vitest';

import { projectUrl, SITE_URL } from './site';

describe('SITE_URL', () => {
    it('is an absolute https URL', () => {
        expect(new URL(SITE_URL).protocol).toBe('https:');
    });
});

describe('projectUrl', () => {
    it('puts the project name in front of the site host', () => {
        expect(projectUrl('audio-visualizer', 'https://example.com')).toBe('https://audio-visualizer.example.com');
    });

    it('ignores trailing slashes and paths on the site URL', () => {
        expect(projectUrl('demo', 'https://example.com/')).toBe('https://demo.example.com');
        expect(projectUrl('demo', 'https://example.com/some/path/')).toBe('https://demo.example.com');
    });

    it('keeps the protocol and port of the site URL', () => {
        expect(projectUrl('demo', 'http://localhost:4321')).toBe('http://demo.localhost:4321');
    });

    it('defaults to the configured site URL', () => {
        expect(projectUrl('demo')).toBe(`https://demo.${new URL(SITE_URL).host}`);
    });

    it.each(['', 'Demo', 'my project', 'a.b', '-demo', 'demo-', 'demo/', 'café', 'a'.repeat(64)])(
        'rejects the invalid name %j',
        (name) => {
            expect(() => projectUrl(name, 'https://example.com')).toThrow(/Invalid project subdomain/);
        },
    );

    it.each(['a', 'a1', 'a-b', 'a'.repeat(63)])('accepts the valid name %j', (name) => {
        expect(projectUrl(name, 'https://example.com')).toBe(`https://${name}.example.com`);
    });
});
