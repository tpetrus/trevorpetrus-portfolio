import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseProjectMeta, projectMetaEntrySchema } from './projectMeta';

// The publish job of sync-projects.yml cannot run this repository's code, so it checks the sync artifact with a jq
// filter that mirrors the entry schema. These specs are what keep the two copies of the rules together.
// Paths come from this file's location, not the working directory, so the spec also runs from a subdirectory or an IDE.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FILTER_RELATIVE_PATH = '.github/scripts/validate-project-meta.jq';
const FILTER_PATH = join(ROOT, FILTER_RELATIVE_PATH);
const WORKFLOW_PATH = join(ROOT, '.github/workflows/sync-projects.yml');
const filter = readFileSync(FILTER_PATH, 'utf8');

const SLUG = 'some-project';
const VALID_ENTRY = {
    created: '2026-01-02T03:04:05Z',
    updated: '2026-02-03T04:05:06.789Z',
    description: 'A project.',
    tech: ['TypeScript'],
    capturedSha: 'a'.repeat(40),
};

// The order of the lists is not part of the rules, so a harmless reorder on either side must not fail the spec.
function sorted(list: unknown): string[] {
    return [...(list as string[])].sort();
}

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
        expect(sorted(filterList('fields'))).toEqual(sorted(Object.keys(shape)));
    });

    it('requires exactly the required fields of the schema', () => {
        const required = Object.entries(shape)
            // A field is optional when it accepts a missing value (zod deprecated isOptional() for exactly this check).
            .filter(([, field]) => !field.safeParse(undefined).success)
            .map(([name]) => name);
        expect(sorted(filterList('required'))).toEqual(sorted(required));
    });

    // Comments are dropped first: the workflow's comments name the file too, so they must not satisfy the check.
    it('is the filter the workflow runs, with the same arguments the spec uses', () => {
        const commands = readFileSync(WORKFLOW_PATH, 'utf8')
            .split('\n')
            .filter((line) => !line.trimStart().startsWith('#'))
            .join('\n');
        expect(commands).toContain(`filter="$PWD/${FILTER_RELATIVE_PATH}"`);
        expect(commands).toContain('jq -e -r --argjson slugs "$slugs_json" --from-file "$filter" "$meta"');
    });

    it('describes a valid entry as valid, so the rejections below are about their own field', () => {
        expect(() => parseProjectMeta({ [SLUG]: VALID_ENTRY })).not.toThrow();
    });
});

// jq is on every GitHub-hosted Ubuntu runner, where the publish job also runs, but not on every developer machine. So
// these skip only locally: in CI a missing jq fails them instead of quietly dropping the check.
const jqAvailable = spawnSync('jq', ['--version']).status === 0;

describe.skipIf(!jqAvailable && !process.env.CI)('running the jq filter', () => {
    it('accepts the committed meta file with the committed projects', () => {
        const slugs = readdirSync(join(ROOT, 'src', 'content', 'projects'))
            .filter((name) => name.endsWith('.md'))
            .map((name) => basename(name, '.md'));
        const meta: unknown = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'project-meta.json'), 'utf8'));
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

    // The filter and the schema must give the same verdict on the values where a regex alone would differ from
    // z.iso.datetime(): impossible calendar days, the leap-year rules, out-of-range times, and the optional parts.
    const filterAccepts = (fields: Record<string, unknown>) => runFilter(metaWith(fields), [SLUG]) === null;
    const schemaAcceptsSafely = (fields: Record<string, unknown>) => {
        try {
            parseProjectMeta(metaWith(fields));
            return true;
        } catch {
            return false;
        }
    };

    it.each<[string, boolean]>([
        ['2026-01-02T03:04:05Z', true],
        ['2026-01-02T03:04:05.5Z', true],
        ['2026-12-31T23:59:59Z', true],
        ['2024-02-29T00:00:00Z', true],
        ['2000-02-29T00:00:00Z', true],
        ['0000-02-29T00:00:00Z', true],
        ['2026-01-02T03:04Z', false],
        ['2026-01-02T03:04:05.Z', false],
        ['2026-02-29T00:00:00Z', false],
        ['1900-02-29T00:00:00Z', false],
        ['2026-04-31T00:00:00Z', false],
        ['2026-13-01T00:00:00Z', false],
        ['2026-00-10T00:00:00Z', false],
        ['2026-01-00T00:00:00Z', false],
        ['2026-01-32T00:00:00Z', false],
        ['2026-01-01T24:00:00Z', false],
        ['2026-01-01T00:60:00Z', false],
        ['2026-01-01T00:00:60Z', false],
        ['9999-99-99T99:99:99Z', false],
        ['2026-01-01t00:00:00Z', false],
        ['2026-01-01T00:00:00z', false],
    ])('agrees with the schema on the date %j (accepted: %s)', (value, accepted) => {
        for (const field of ['created', 'updated']) {
            expect(filterAccepts({ [field]: value })).toBe(accepted);
            expect(schemaAcceptsSafely({ [field]: value })).toBe(accepted);
        }
    });

    // Characters String.prototype.trim() removes are blank to the schema; U+0085, U+180E and U+200B are not. A regex
    // class such as \S gets U+0085 and U+FEFF the other way round.
    it.each<[string, number, boolean]>([
        ['a tab', 0x09, false],
        ['a line feed', 0x0a, false],
        ['a vertical tab', 0x0b, false],
        ['a form feed', 0x0c, false],
        ['a carriage return', 0x0d, false],
        ['a space', 0x20, false],
        ['a no-break space', 0xa0, false],
        ['an ogham space mark', 0x1680, false],
        ['an en quad', 0x2000, false],
        ['a hair space', 0x200a, false],
        ['a line separator', 0x2028, false],
        ['a paragraph separator', 0x2029, false],
        ['a narrow no-break space', 0x202f, false],
        ['a medium mathematical space', 0x205f, false],
        ['an ideographic space', 0x3000, false],
        ['a byte order mark', 0xfeff, false],
        ['a next line', 0x85, true],
        ['a Mongolian vowel separator', 0x180e, true],
        ['a zero width space', 0x200b, true],
    ])('agrees with the schema that %s alone is blank: %s', (_name, codePoint, hasText) => {
        const description = String.fromCodePoint(codePoint);
        expect(filterAccepts({ description })).toBe(hasText);
        expect(schemaAcceptsSafely({ description })).toBe(hasText);
        // With a letter beside it the description has text, whatever the character.
        expect(filterAccepts({ description: `${description}a${description}` })).toBe(true);
    });
});
