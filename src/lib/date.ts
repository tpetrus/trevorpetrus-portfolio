// Both helpers read the UTC calendar day. The build machine's time zone must not decide which day a commit "happened
// on", and a fixed zone keeps the output identical on every machine and in every browser.
const DISPLAY_FORMAT = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
});

/** Human-readable UTC day, e.g. `Oct 5, 2026`. */
export function formatDate(date: Date): string {
    return DISPLAY_FORMAT.format(date);
}

/** UTC day as `YYYY-MM-DD`, the machine-readable form for `<time datetime>`. */
export function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}
