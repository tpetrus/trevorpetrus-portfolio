import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PHOTOGRAPHY_TITLE_VIDEO } from './pageTitle';

describe('PHOTOGRAPHY_TITLE_VIDEO', () => {
    const { webm, mp4, poster, width, height } = PHOTOGRAPHY_TITLE_VIDEO;

    it('points at files served from /video/', () => {
        for (const path of [webm, mp4, poster]) expect(path.startsWith('/video/')).toBe(true);
    });

    it('points at files that exist under public/', () => {
        for (const path of [webm, mp4, poster]) expect(existsSync(join(process.cwd(), 'public', path))).toBe(true);
    });

    it('has positive pixel dimensions', () => {
        expect(width).toBeGreaterThan(0);
        expect(height).toBeGreaterThan(0);
    });
});
