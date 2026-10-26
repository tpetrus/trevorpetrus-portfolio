import { describe, expect, it } from 'vitest';

import { formatNumber, numberItems } from './numbering';

const at = (key: string, date?: string) => ({ key, date: date ? new Date(date) : undefined });
const numbersByKey = (items: ReturnType<typeof numberItems>) => Object.fromEntries(items.map((i) => [i.key, i.number]));

describe('numberItems', () => {
    it('numbers by date ascending and returns the highest number first', () => {
        const result = numberItems([at('b', '2025-01-01'), at('c', '2026-01-01'), at('a', '2024-01-01')]);

        expect(result.map(({ key, number }) => [key, number])).toEqual([
            ['c', 3],
            ['b', 2],
            ['a', 1],
        ]);
    });

    it('does not renumber older items when a newer one is added', () => {
        const before = numbersByKey(numberItems([at('a', '2024-01-01'), at('b', '2025-01-01')]));
        const after = numbersByKey(numberItems([at('a', '2024-01-01'), at('b', '2025-01-01'), at('c', '2026-01-01')]));

        expect(after).toMatchObject(before);
        expect(after.c).toBe(3);
    });

    it('breaks ties on the same date by key, whatever the input order', () => {
        const forward = numbersByKey(numberItems([at('a', '2025-01-01'), at('b', '2025-01-01')]));
        const backward = numbersByKey(numberItems([at('b', '2025-01-01'), at('a', '2025-01-01')]));

        expect(forward).toEqual({ a: 1, b: 2 });
        expect(backward).toEqual(forward);
    });

    it('puts items without a date after every dated item, ordered by key', () => {
        const result = numbersByKey(numberItems([at('z'), at('a'), at('m', '2030-01-01'), at('n', '2020-01-01')]));

        expect(result).toEqual({ n: 1, m: 2, a: 3, z: 4 });
    });

    it('places an undated item last whichever way round the two are compared', () => {
        const dated = at('z', '2025-01-01');
        const undated = at('a');

        expect(numbersByKey(numberItems([dated, undated]))).toEqual({ z: 1, a: 2 });
        expect(numbersByKey(numberItems([undated, dated]))).toEqual({ z: 1, a: 2 });
    });

    it('treats an invalid date as missing', () => {
        const result = numbersByKey(numberItems([{ key: 'bad', date: new Date('nope') }, at('ok', '2025-01-01')]));

        expect(result).toEqual({ ok: 1, bad: 2 });
    });

    it('keeps the other fields of each item', () => {
        const [only] = numberItems([{ key: 'a', date: new Date('2025-01-01'), title: 'Hello' }]);

        expect(only?.title).toBe('Hello');
    });

    it('returns nothing for no items', () => {
        expect(numberItems([])).toEqual([]);
    });

    it('rejects duplicate keys', () => {
        expect(() => numberItems([at('a'), at('a')])).toThrow(/unique keys/);
    });
});

describe('formatNumber', () => {
    it.each([
        [1, '01'],
        [12, '12'],
        [100, '100'],
    ])('formats %i as %s', (number, expected) => {
        expect(formatNumber(number)).toBe(expected);
    });
});
