import { describe, expect, it } from 'vitest';

import { activeSectionId, currentSectionId, isAtPageEnd, readingLine, showsBackToTop, showsLegend } from './sectionNav';

const sections = [
    { id: 'landscape', top: -900 },
    { id: 'portrait', top: 120 },
    { id: 'car', top: 1500 },
];

describe('readingLine', () => {
    it('is 40% of the viewport height', () => {
        expect(readingLine(1000)).toBe(400);
    });
});

describe('currentSectionId', () => {
    it('returns the last section whose top is at or above the line', () => {
        expect(currentSectionId(sections, 400)).toBe('portrait');
        expect(currentSectionId(sections, 120)).toBe('portrait');
    });

    it('returns undefined above the first section and for no sections', () => {
        expect(currentSectionId([{ id: 'a', top: 50 }], 10)).toBeUndefined();
        expect(currentSectionId([], 400)).toBeUndefined();
    });

    it('returns the last section when all are above the line', () => {
        expect(currentSectionId(sections, 5000)).toBe('car');
    });
});

describe('activeSectionId', () => {
    it('uses the reading line away from the end', () => {
        expect(activeSectionId(sections, 400, false)).toBe('portrait');
    });

    it('picks the last section at the end of the page', () => {
        expect(activeSectionId(sections, 400, true)).toBe('car');
    });

    it('has no section at the end when there are none', () => {
        expect(activeSectionId([], 400, true)).toBeUndefined();
    });
});

describe('isAtPageEnd', () => {
    it('allows a pixel or two of rounding', () => {
        expect(isAtPageEnd(1599, 800, 2400)).toBe(true);
        expect(isAtPageEnd(1000, 800, 2400)).toBe(false);
    });
});

describe('showsBackToTop', () => {
    it('is hidden at the very top and shown after any scroll', () => {
        expect(showsBackToTop(0)).toBe(false);
        expect(showsBackToTop(1)).toBe(true);
    });
});

describe('showsLegend', () => {
    it('shows only when the nav has scrolled out above the viewport', () => {
        expect(showsLegend(true, 100)).toBe(false);
        expect(showsLegend(false, -80)).toBe(true);
        expect(showsLegend(false, 1200)).toBe(false);
    });
});
