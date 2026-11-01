import { describe, expect, it } from 'vitest';

import { mapTopics, TOPIC_NAMES } from './topicMap';

describe('mapTopics', () => {
    it('maps known slugs to display names in the given order', () => {
        expect(mapTopics(['typescript', 'threejs', 'github-actions'])).toEqual({
            tech: ['TypeScript', 'three.js', 'GitHub Actions'],
            unknown: [],
        });
    });

    it('reports unknown slugs and never guesses a name', () => {
        expect(mapTopics(['react', 'made-up', 'also-new'])).toEqual({
            tech: ['React'],
            unknown: ['made-up', 'also-new'],
        });
    });

    it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
        'treats the inherited key %s as unknown',
        (slug) => {
            expect(mapTopics([slug])).toEqual({ tech: [], unknown: [slug] });
        },
    );

    it('accepts a custom table', () => {
        expect(mapTopics(['a'], { a: 'A' }).tech).toEqual(['A']);
    });

    it('has a non-empty display name for every slug', () => {
        for (const name of Object.values(TOPIC_NAMES)) expect(name.length).toBeGreaterThan(0);
    });
});
