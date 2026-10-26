import { describe, expect, it } from 'vitest';

import { isCurrentPage, NAV_ITEMS, runningHeadText } from './nav';

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

describe('runningHeadText', () => {
    it('adds the current page name after the site name', () => {
        expect(runningHeadText('/photography/', 'Trevor Petrus')).toBe('Trevor Petrus — Photography');
        expect(runningHeadText('/projects', 'Trevor Petrus')).toBe('Trevor Petrus — Projects');
    });

    it('shows the site name alone on Home', () => {
        expect(runningHeadText('/', 'Trevor Petrus')).toBe('Trevor Petrus');
    });

    it('shows the site name alone on a path outside the nav', () => {
        expect(runningHeadText('/nowhere/', 'Trevor Petrus')).toBe('Trevor Petrus');
    });
});
