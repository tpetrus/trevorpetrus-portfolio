import { describe, expect, it } from 'vitest';

import { formatDate, isoDate } from './date';

describe('formatDate', () => {
    it('formats a UTC day with a short month', () => {
        expect(formatDate(new Date('2026-10-05T12:00:00Z'))).toBe('Oct 5, 2026');
    });

    it('keeps the UTC day just after midnight UTC', () => {
        expect(formatDate(new Date('2026-01-01T00:00:01Z'))).toBe('Jan 1, 2026');
    });

    it('keeps the UTC day just before midnight UTC', () => {
        expect(formatDate(new Date('2025-12-31T23:59:59Z'))).toBe('Dec 31, 2025');
    });
});

describe('isoDate', () => {
    it('returns the UTC day as YYYY-MM-DD', () => {
        expect(isoDate(new Date('2026-10-05T12:00:00Z'))).toBe('2026-10-05');
    });

    it('does not shift the day for times near midnight or non-UTC offsets', () => {
        expect(isoDate(new Date('2026-01-01T00:00:01Z'))).toBe('2026-01-01');
        expect(isoDate(new Date('2026-01-01T01:30:00+02:00'))).toBe('2025-12-31');
    });
});
