import { describe, expect, it } from 'vitest';

import { isDnsLabel, PHOTOS_ORIGIN, PROJECTS_DOMAIN, projectUrl, SITE_URL } from './site';

describe('PHOTOS_ORIGIN', () => {
    it('is a bare https origin: no path and no trailing slash, so URLs can be appended to it', () => {
        const url = new URL(PHOTOS_ORIGIN);
        expect(url.protocol).toBe('https:');
        expect(PHOTOS_ORIGIN).toBe(url.origin);
    });
});

describe('SITE_URL', () => {
    it('is an absolute https URL', () => {
        expect(new URL(SITE_URL).protocol).toBe('https:');
    });
});

describe('PROJECTS_DOMAIN', () => {
    it('is a bare host: no protocol, port or path', () => {
        expect(PROJECTS_DOMAIN).not.toMatch(/[:/]/);
    });
});

describe('isDnsLabel', () => {
    it.each(['a', 'audio-visualizer', 'a'.repeat(63)])('accepts %j', (value) => {
        expect(isDnsLabel(value)).toBe(true);
    });

    it.each(['', 'Demo', 'a.b', '-a', 'a-', 'a'.repeat(64)])('rejects %j', (value) => {
        expect(isDnsLabel(value)).toBe(false);
    });
});

describe('projectUrl', () => {
    it('puts a project under its own subdomain of the configured projects domain', () => {
        expect(projectUrl('audiovisualizer')).toBe('https://audiovisualizer.trevorpetr.us');
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
