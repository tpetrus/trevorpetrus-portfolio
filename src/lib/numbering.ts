/** Anything that can be numbered: a stable `key` (the tiebreak) and the date it is ordered by, when it has one. */
export interface Numberable {
    readonly key: string;
    readonly date?: Date | undefined;
}

export type Numbered<T extends Numberable> = T & { readonly number: number };

// Keys are unique here, so equality never happens. Compares by UTF-16 code units rather than `localeCompare`, whose result depends on the runtime's locale data.
function compareKeys(a: string, b: string): number {
    return a < b ? -1 : 1;
}

function timeOf({ date }: Numberable): number | undefined {
    const time = date?.getTime();
    return time === undefined || Number.isNaN(time) ? undefined : time;
}

/**
 * Numbers items by date, ascending: the oldest is 1 and the newest has the highest number, so adding a newer item
 * never renumbers an older one. Rules that keep the result deterministic:
 * - items with the same date are ordered by `key` (code-unit order);
 * - items without a valid date come after every dated item, ordered by `key`, so a missing date can never shift the
 *   numbers of dated items (it can shift undated ones, and an item that later gains a date moves to its dated place).
 * Returns the items in display order, highest number first, each with its `number`. Keys must be unique.
 */
export function numberItems<T extends Numberable>(items: readonly T[]): Numbered<T>[] {
    const keys = new Set(items.map(({ key }) => key));
    if (keys.size !== items.length) {
        throw new Error('Numbering needs unique keys.');
    }
    const ascending = [...items].sort((a, b) => {
        const timeA = timeOf(a);
        const timeB = timeOf(b);
        if (timeA === timeB) return compareKeys(a.key, b.key);
        if (timeA === undefined) return 1;
        if (timeB === undefined) return -1;
        return timeA - timeB;
    });
    return ascending.map((item, index) => ({ ...item, number: index + 1 })).reverse();
}

/** The number as shown: zero-padded to at least two digits ("01", "12", "100"). */
export function formatNumber(number: number): string {
    return String(number).padStart(2, '0');
}
