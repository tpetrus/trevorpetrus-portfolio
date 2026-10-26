import { describe, expect, it } from 'vitest';

import { ALT_PLACEHOLDER_MARKER, isPlaceholderAlt } from './sidecarPlaceholder';

describe('isPlaceholderAlt', () => {
    it.each([`${ALT_PLACEHOLDER_MARKER}: describe this photo`, 'todo', '  Todo later', `\t${ALT_PLACEHOLDER_MARKER}`])(
        'flags %j',
        (alt) => {
            expect(isPlaceholderAlt(alt)).toBe(true);
        },
    );

    it.each(['A harbor at dawn', 'Top up shot of a brick building', 'Not a TODO', ''])('accepts %j', (alt) => {
        expect(isPlaceholderAlt(alt)).toBe(false);
    });
});
