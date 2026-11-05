import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseProjectMeta, projectMetaEntrySchema } from './projectMeta';

// The publish job of sync-projects.yml cannot run this repository's code, so it checks the sync artifact with a jq
// filter that mirrors the entry schema. These specs are what keep the two copies of the rules together.
const FILTER_PATH = '.github/scripts/validate-project-meta.jq';
const WORKFLOW_PATH = '.github/workflows/sync-projects.yml';
const filter = readFileSync(FILTER_PATH, 'utf8');

const SLUG = 'some-project';
const VALID_ENTRY = {
    created: '2026-01-02T03:04:05Z',
    updated: '2026-02-03T04:05:06.789Z',
    description: 'A project.',
    tech: ['TypeScript'],
    capturedSha: 'a'.repeat(40),
};

/** The string array of a `def <name>: [...];` line of the filter. */
function filterList(name: string): unknown {
    const match = new RegExp(`^def ${name}: (\\[.*\\]);$`, 'm').exec(filter);
    if (!match) throw new Error(`${FILTER_PATH} has no "def ${name}: [...];" line`);
    return JSON.parse(match[1]);
}

/** Runs the filter the way the workflow does: the problem it prints, or `null` for a clean file. */
function runFilter(meta: unknown, slugs: readonly string[]): string | null {
    const result = spawnSync(
        'jq',
        ['-e', '-r', '--argjson', 'slugs', JSON.stringify(slugs), '--from-file', FILTER_PATH],
        {
            input: JSON.stringify(meta),
            encoding: 'utf8',
        },
    );
    if (result.status === 4) return null;
    if (result.status === 0) return result.stdout.trim();
    throw new Error(`jq failed (exit code ${String(result.status)}): ${result.error?.message ?? result.stderr}`);
}

function metaWith(fields: Record<string, unknown>): Record<string, unknown> {
    return { [SLUG]: { ...VALID_ENTRY, ...fields } };
}

describe('the jq filter and the meta schema', () => {
    const shape = projectMetaEntrySchema.shape;

    it('allows exactly the fields of the schema', () => {
        expect(filterList('fields')).toEqual(Object.keys(shape));
    });

    it('requires exactly the required fields of the schema', () => {
        const required = Object.entries(shape)
            .filter(([, field]) => !field.isOptional())
            .map(([name]) => name);
        expect(filterList('required')).toEqual(required);
    });

    it('is the filter the workflow reads', () => {
        expect(readFileSync(WORKFLOW_PATH, 'utf8')).toContain(FILTER_PATH);
    });
});

// jq is on every GitHub-hosted Ubuntu runner, where the publish job also runs, but not on every developer machine. So
// these skip only locally: in CI a missing jq fails them instead of quietly dropping the check.
const jqAvailable = spawnSync('jq', ['--version']).status === 0;

describe.skipIf(!jqAvailable && !process.env.CI)('running the jq filter', () => {
    it('accepts the committed meta file with the committed projects', () => {
        const slugs = readdirSync('src/content/projects')
            .filter((name) => name.endsWith('.md'))
            .map((name) => basename(name, '.md'));
        const meta: unknown = JSON.parse(readFileSync(join('src', 'data', 'project-meta.json'), 'utf8'));
        expect(runFilter(meta, slugs)).toBeNull();
    });

    it('accepts an entry without the optional capturedSha', () => {
        const { capturedSha: _capturedSha, ...entry } = VALID_ENTRY;
        expect(runFilter({ [SLUG]: entry }, [SLUG])).toBeNull();
    });

    // Each of these also fails the schema, so the two sets of rules are compared on the cases, not only on field names.
    it.each<[string, Record<string, unknown>, string]>([
        ['an extra key', metaWith({ latitude: 1 }), "unexpected key 'latitude'"],
        ['a newline after the date', metaWith({ created: '2026-01-02T03:04:05Z\n' }), "'created' is not an ISO"],
        ['a newline before the date', metaWith({ updated: '\n2026-01-02T03:04:05Z' }), "'updated' is not an ISO"],
        ['a date with an offset', metaWith({ created: '2026-01-02T03:04:05+01:00' }), "'created' is not an ISO"],
        ['a date that is no string', metaWith({ created: 1 }), "'created' is not an ISO"],
        ['an empty description', metaWith({ description: '' }), "'description' must be"],
        ['a whitespace description', metaWith({ description: ' \n\t' }), "'description' must be"],
        ['a description that is no string', metaWith({ description: 1 }), "'description' must be"],
        ['no tech', metaWith({ tech: [] }), "'tech' must be"],
        ['an empty tech name', metaWith({ tech: [''] }), "'tech' must be"],
        ['a newline after the SHA', metaWith({ capturedSha: `${'a'.repeat(40)}\n` }), "'capturedSha' must be"],
        ['an uppercase SHA', metaWith({ capturedSha: 'A'.repeat(40) }), "'capturedSha' must be"],
        ['a short SHA', metaWith({ capturedSha: 'a'.repeat(39) }), "'capturedSha' must be"],
    ])('rejects %s, as the schema does', (_name, meta, problem) => {
        expect(runFilter(meta, [SLUG])).toContain(problem);
        expect(() => parseProjectMeta(meta)).toThrow();
    });

    it.each(['created', 'updated', 'description', 'tech'])(
        'rejects an entry without %s, as the schema does',
        (field) => {
            const entry: Record<string, unknown> = { ...VALID_ENTRY };
            delete entry[field];
            const meta = { [SLUG]: entry };
            expect(runFilter(meta, [SLUG])).toContain(`missing '${field}'`);
            expect(() => parseProjectMeta(meta)).toThrow();
        },
    );

    it.each<[string, Record<string, unknown>, string]>([
        ['a description over 500 characters', metaWith({ description: 'a'.repeat(501) }), "'description' must be"],
        ['more than 20 tech names', metaWith({ tech: Array.from({ length: 21 }, () => 'a') }), "'tech' must be"],
        ['a tech name over 40 characters', metaWith({ tech: ['a'.repeat(41)] }), "'tech' must be"],
    ])('caps %s, which only the filter limits', (_name, meta, problem) => {
        expect(runFilter(meta, [SLUG])).toContain(problem);
    });

    it('names a key that has no project file, which a deleted project leaves behind', () => {
        expect(runFilter({ ...metaWith({}), gone: VALID_ENTRY }, [SLUG])).toContain("unknown project key 'gone'");
    });

    it('names a project with no key', () => {
        expect(runFilter(metaWith({}), [SLUG, 'other'])).toContain("missing project 'other'");
    });

    it('rejects an entry that is not an object', () => {
        expect(runFilter({ [SLUG]: 'text' }, [SLUG])).toContain('the entry is not an object');
    });
});
