import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';

import thumbnail from '../assets/projects/audio-visualizer.avif';
import type { CollectionEntry } from 'astro:content';
import ProjectCard from './ProjectCard.astro';

const PROJECT: CollectionEntry<'projects'>['data'] = {
    title: 'Fixture Project',
    description: 'A fixture.',
    tech: ['TypeScript'],
    status: 'live',
    repo: 'https://github.com/example/fixture',
    order: 1,
    thumbnail,
};

async function render(featured: boolean): Promise<string> {
    const container = await AstroContainer.create();
    return container.renderToString(ProjectCard, { props: { project: PROJECT, featured, number: 1 } });
}

describe('ProjectCard reading order', () => {
    it('puts a row title before its image, with no CSS reordering', async () => {
        const html = await render(false);

        expect(html.indexOf('Fixture Project</a>')).toBeGreaterThan(-1);
        expect(html.indexOf('Fixture Project</a>')).toBeLessThan(html.indexOf('<picture'));
        expect(html).not.toMatch(/\border-\d/);
    });

    it('keeps the cover image before its title', async () => {
        const html = await render(true);

        expect(html.indexOf('<picture')).toBeGreaterThan(-1);
        expect(html.indexOf('<picture')).toBeLessThan(html.indexOf('Fixture Project</a>'));
    });
});
