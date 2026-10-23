import { describe, expect, it } from 'vitest';

import { isCurrentPage, NAV_ITEMS } from './nav';

describe('isCurrentPage', () => {
    it('matches the same path', () => {
        expect(isCurrentPage('/photography/', '/photography/')).toBe(true);
    });

    it('ignores a trailing slash on either side', () => {
        expect(isCurrentPage('/projects', '/projects/')).toBe(true);
        expect(isCurrentPage('/projects/', '/projects')).toBe(true);
        expect(isCurrentPage('/projects//', '/projects')).toBe(true);
    });

    it('matches Home only on the root', () => {
        expect(isCurrentPage('/', '/')).toBe(true);
        expect(isCurrentPage('/projects/', '/')).toBe(false);
    });

    it('does not treat a longer path as a match for its prefix', () => {
        expect(isCurrentPage('/projects/audio-visualizer/', '/projects/')).toBe(false);
        expect(isCurrentPage('/projects-old/', '/projects/')).toBe(false);
    });

    it('marks exactly one nav item current on each page', () => {
        for (const { href } of NAV_ITEMS) {
            expect(NAV_ITEMS.filter((item) => isCurrentPage(href, item.href))).toHaveLength(1);
        }
    });
});
