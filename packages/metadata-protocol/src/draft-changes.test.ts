// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24395] The draft save's per-key provenance, as three pure functions — see
 * `draft-changes.ts`. The save and read doors that call them are pinned
 * through the real protocol in `protocol.packageless-save-address.test.ts`'s
 * `[#24395]` block; these rows pin the rules themselves: the path grammar
 * (object keys only, an array is one leaf, `[]` is the whole body), the keep
 * rule (replace at or under), and the stored form (never `[]`).
 */
import { describe, expect, it } from 'vitest';
import { GetMetaItemResponseSchema } from '@objectstack/spec/api';
import { authoringClientOf, draftChangedPaths, mergeDraftChanges, storedDraftChanges, type DraftChangeEntry } from './draft-changes.js';

const AT = '2026-10-18T12:00:00.000Z';
const AT2 = '2026-10-18T12:05:00.000Z';

describe('draftChangedPaths — which key paths a draft save changed', () => {
    it('[] when nothing was replaced: the save created the item as a draft', () => {
        expect(draftChangedPaths(undefined, { name: 'v', label: 'L' }, 'view')).toEqual([[]]);
    });

    it('stops at the deepest key whose value differs, added or removed', () => {
        const before = { name: 'o', fields: { a: { type: 'text', label: 'A' } }, description: 'd' };
        const after = { name: 'o', fields: { a: { type: 'text', label: 'A2' }, b: { type: 'number' } } };
        expect(draftChangedPaths(before, after, 'object')).toEqual([
            ['fields', 'a', 'label'],
            ['fields', 'b'],
            ['description'],
        ]);
    });

    it('an array is one leaf: its path ends at its key and carries no index', () => {
        const before = { columns: [{ field: 'name' }], kanban: { columns: ['a'] } };
        const after = { columns: [{ field: 'name' }, { field: 'email' }], kanban: { columns: ['a', 'b'] } };
        expect(draftChangedPaths(before, after, 'view')).toEqual([['columns'], ['kanban', 'columns']]);
    });

    it('a segment is the key as stored, dots included, never one dotted string', () => {
        const before = { fields: { 'crm_lead.email': { readable: true } } };
        const after = { fields: { 'crm_lead.email': { readable: false } } };
        expect(draftChangedPaths(before, after, 'permission')).toEqual([['fields', 'crm_lead.email', 'readable']]);
    });

    it('an unchanged body, or a key order change in a map whose order is not content, changes nothing', () => {
        expect(draftChangedPaths({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } }, 'view')).toEqual([]);
        expect(draftChangedPaths({ a: 1, b: 2 }, { b: 2, a: 1 }, 'view')).toEqual([]);
    });

    it("a pure reorder of a declared ordered map (an object's `fields`) is a change at the map", () => {
        const before = { fields: { a: { type: 'text' }, b: { type: 'text' } } };
        const after = { fields: { b: { type: 'text' }, a: { type: 'text' } } };
        expect(draftChangedPaths(before, after, 'object')).toEqual([['fields']]);
        // The same reorder in a type with no ordered map is no change, as its hash says.
        expect(draftChangedPaths(before, after, 'view')).toEqual([]);
    });

    it('a change under an empty key is reported at its parent: an empty segment is no path', () => {
        expect(draftChangedPaths({ m: { '': 1, x: 1 } }, { m: { '': 2, x: 2 } }, 'view')).toEqual([['m']]);
    });

    it('every path it answers is one the spec admits', () => {
        const paths = draftChangedPaths({ a: { b: 1 } }, { a: { b: 2 }, c: [1] }, 'view');
        const parsed = GetMetaItemResponseSchema.safeParse({
            type: 'view', name: 'v', item: {},
            draftChanges: paths.map((path) => ({ path, by: 'studio', actor: null, at: AT })),
        });
        expect(parsed.success).toBe(true);
    });
});

describe('mergeDraftChanges — no two entries share a path; the longest prefix answers', () => {
    const copilot = { by: 'copilot' as const, actor: 'u_1', at: AT };
    const studio = { by: 'studio' as const, actor: 'u_1', at: AT2 };

    it('a save replaces every entry at or under each path it changes', () => {
        const entries = mergeDraftChanges([], [['fields', 'a', 'label'], ['fields', 'b'], ['label']], copilot);
        const next = mergeDraftChanges(entries, [['fields']], studio);
        expect(next).toEqual([
            { path: ['label'], ...copilot },
            { path: ['fields'], ...studio },
        ]);
    });

    it('an entry above a changed path is kept: a key under it is answered by the deeper entry', () => {
        const entries = mergeDraftChanges([], [['kanban']], copilot);
        const next = mergeDraftChanges(entries, [['kanban', 'columns']], studio);
        expect(next).toEqual([
            { path: ['kanban'], ...copilot },
            { path: ['kanban', 'columns'], ...studio },
        ]);
    });

    it('a sibling path is not under a changed path: a shared first segment is not a prefix', () => {
        const entries = mergeDraftChanges([], [['fields', 'ab']], copilot);
        expect(mergeDraftChanges(entries, [['fields', 'a']], studio)).toHaveLength(2);
    });

    it('the whole body ([]) replaces every entry', () => {
        const entries = mergeDraftChanges([], [['a'], ['b', 'c']], copilot);
        expect(mergeDraftChanges(entries, [[]], studio)).toEqual([{ path: [], ...studio }]);
    });

    it('re-saving the same path keeps one entry, restamped', () => {
        const entries = mergeDraftChanges([], [['label']], copilot);
        expect(mergeDraftChanges(entries, [['label']], studio)).toEqual([{ path: ['label'], ...studio }]);
    });

    it('[#27176] an `mcp` stamp carries its client onto each path; a stamp with none adds no `client` key', () => {
        const mcp = { by: 'mcp' as const, actor: 'u_1', at: AT, client: { id: 'cli_1', name: 'Claude' } };
        expect(mergeDraftChanges([], [['label'], ['columns']], mcp)).toEqual([
            { path: ['label'], ...mcp },
            { path: ['columns'], ...mcp },
        ]);
        const [bare] = mergeDraftChanges([], [['label']], { by: 'mcp', actor: null, at: AT });
        expect('client' in bare!).toBe(false);
    });
});

describe('[#27176] authoringClientOf — the one shape a client takes', () => {
    it('copies a non-empty id and an optional non-empty name, member by member', () => {
        expect(authoringClientOf({ id: 'cli_1' })).toEqual({ id: 'cli_1' });
        expect(authoringClientOf({ id: 'cli_1', name: 'Claude' })).toEqual({ id: 'cli_1', name: 'Claude' });
    });

    it.each([
        ['not an object', 'cli_1'],
        ['null', null],
        ['an array', [{ id: 'cli_1' }]],
        ['an empty id', { id: '' }],
        ['no id', { name: 'Claude' }],
        ['an empty name', { id: 'cli_1', name: '' }],
        ['a non-string name', { id: 'cli_1', name: 7 }],
        ['an extra member', { id: 'cli_1', secret: 's' }],
    ])('%s is not a client', (_label, value) => {
        expect(authoringClientOf(value)).toBeUndefined();
    });
});

describe('storedDraftChanges — the stored form, never []', () => {
    const entry: DraftChangeEntry = { path: ['label'], by: 'copilot', actor: null, at: AT };

    it('reads the serialized column and an already-parsed value alike', () => {
        expect(storedDraftChanges(JSON.stringify([entry]))).toEqual([entry]);
        expect(storedDraftChanges([entry])).toEqual([entry]);
    });

    it('[#27176] reads an `mcp` entry with its client, and one without', () => {
        const mcp: DraftChangeEntry = { path: ['label'], by: 'mcp', actor: 'u_1', at: AT, client: { id: 'cli_1', name: 'Claude' } };
        const bare: DraftChangeEntry = { path: ['columns'], by: 'mcp', actor: 'u_1', at: AT };
        expect(storedDraftChanges(JSON.stringify([mcp, bare]))).toEqual([mcp, bare]);
    });

    it.each([
        ['NULL (a row saved before the writer)', null],
        ['an absent column', undefined],
        ['an empty string', ''],
        ['an empty list', '[]'],
        ['not JSON', '{'],
        ['an unknown surface', JSON.stringify([{ ...entry, by: 'robot' }])],
        ['an empty segment', JSON.stringify([{ ...entry, path: [''] }])],
        ['a dotted-string path', JSON.stringify([{ ...entry, path: 'a.b' }])],
        ['a client beside a surface other than mcp', JSON.stringify([{ ...entry, client: { id: 'cli_1' } }])],
        ['a malformed client', JSON.stringify([{ ...entry, by: 'mcp', client: { id: '' } }])],
    ])('%s reads as not recorded (undefined), never []', (_label, raw) => {
        expect(storedDraftChanges(raw)).toBeUndefined();
    });
});
