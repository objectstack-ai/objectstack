// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27842] The `object` meta reads serve, beside the item, the packaged
 * actions this deployment's activation ledger switches off: `disabledActions`
 * on the item read (both doors) and, keyed by object name, beside the list's
 * items. It is the action twin of `registration` (#23316), and it takes that
 * key's four choices:
 *
 *  - read through the kernel's service table by name (`objectql`), for the
 *    optional member the engine declares on `IObjectQLEngine`
 *    (`getDisabledActions`) — this package imports no engine;
 *  - absent where no ledger answered (no engine, an engine without the
 *    member, or one with no ledger attached), never `[]` there;
 *  - `[]` where a ledger answered and none of the object's actions is off;
 *  - on the cached default door too, never in the ETag, and a read that
 *    carries it is never answered 304.
 *
 * And the one the card fixes: `item.actions` is served byte for byte as
 * declared, a switched-off action included.
 *
 * The engine double answers `getDisabledActions` the way `ObjectQL` does
 * (pinned on the real engine, with the real protocol, in
 * `@objectstack/objectql`'s `protocol-meta-disabled-actions.test.ts`).
 */
import { describe, expect, it, vi } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface StoredRow {
    id: string;
    type: string;
    name: string;
    package_id: string | null;
    state: string;
    metadata: string;
}

const storedRow = (type: string, name: string, body: unknown, extra: Partial<StoredRow> = {}): StoredRow => ({
    id: `r_${type}_${name}_${extra.state ?? 'active'}`,
    type,
    name,
    package_id: null,
    state: 'active',
    metadata: JSON.stringify(body),
    ...extra,
});

/** [#24371] One `where` value as the store reads it: `{ $in: [...] }` or equality. */
const whereValueMatches = (actual: unknown, want: unknown): boolean =>
    want !== null && typeof want === 'object' && Array.isArray((want as { $in?: unknown }).$in)
        ? (want as { $in: unknown[] }).$in.includes(actual)
        : actual === want;

const TASK = {
    name: 'showcase_task',
    label: 'Task',
    fields: { title: { name: 'title', type: 'text', label: 'Title' } },
    actions: [
        { name: 'showcase_mark_done', label: 'Mark Done', type: 'script', locations: ['record_header'] },
        { name: 'showcase_snooze', label: 'Snooze', type: 'script', locations: ['record_header'] },
    ],
};
const PROJECT = {
    name: 'showcase_project',
    label: 'Project',
    fields: { title: { name: 'title', type: 'text', label: 'Title' } },
    actions: [{ name: 'showcase_archive', label: 'Archive', type: 'script' }],
};
const NOTE = { name: 'showcase_note', label: 'Note', fields: { body: { name: 'body', type: 'text', label: 'Body' } } };
const ROWS = [storedRow('object', TASK.name, TASK), storedRow('object', PROJECT.name, PROJECT), storedRow('object', NOTE.name, NOTE)];

/**
 * The store double: `find` / `findOne` over `sys_metadata` rows, and a
 * registry that holds nothing of its own. ⛔ No write verb — the reads under
 * test issue none.
 */
function harness(rows: StoredRow[], services: Map<string, unknown> = new Map()) {
    const matching = (where: Record<string, unknown>) => {
        for (const k of Object.keys(where)) {
            if (k.startsWith('$')) throw new Error(`[test double] unsupported WHERE combinator '${k}'`);
        }
        return rows.filter((r) =>
            Object.entries(where).every(([k, v]) => v === undefined || whereValueMatches((r as unknown as Record<string, unknown>)[k], v)),
        );
    };
    const engine: any = {
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const matched = matching(opts?.where ?? {});
            // `check:objectql-double-limit` — the caller's bound, applied after the filter.
            return opts?.limit === undefined ? matched : matched.slice(0, opts.limit);
        },
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            // `check:engine-double-contract` — refuses what the real engine refuses.
            assertEngineFindOnePredicate(table, opts);
            if (table !== 'sys_metadata') return null;
            return matching(opts?.where ?? {})[0] ?? null;
        },
        registry: {
            listItems: () => [],
            getItem: () => undefined,
            getArtifactItem: () => undefined,
            getObject: () => undefined,
            registerItem: () => undefined,
            registerObject: () => undefined,
            getPackage: () => undefined,
            isPackageDisabled: () => false,
            applyNavContributions: (app: unknown) => app,
        },
    };
    return new ObjectStackProtocolImplementation(engine, () => services as Map<string, any>);
}

/** The engine's projection: `undefined` with no ledger attached, else the names it switches off. */
function engineDouble(off: string[] | undefined) {
    return { getDisabledActions: vi.fn((): string[] | undefined => (off === undefined ? undefined : [...off])) };
}

const withEngine = (off: string[] | undefined) => new Map<string, unknown>([['objectql', engineDouble(off)]]);

describe('[#27842] the item read: `disabledActions` beside `item`, the ledger\'s answer or nothing', () => {
    it('names the switched-off actions of THIS object, and serves `item.actions` byte for byte as declared', async () => {
        const services = withEngine(['showcase_mark_done', 'some_other_objects_action']);
        const plain: any = await harness(ROWS).getMetaItem({ type: 'object', name: TASK.name });
        const judged: any = await harness(ROWS, services).getMetaItem({ type: 'object', name: TASK.name });

        expect(judged.disabledActions).toEqual(['showcase_mark_done']);
        // The card's load-bearing half: the document is untouched — no action
        // removed, none rewritten `visible` / `disabled`.
        expect(JSON.stringify(judged.item.actions)).toBe(JSON.stringify(plain.item.actions));
        expect(judged.item.actions.map((a: any) => a.name)).toEqual(['showcase_mark_done', 'showcase_snooze']);
        expect(judged.item).not.toHaveProperty('disabledActions');
        expect(judged).toHaveProperty('lock');
    });

    it('`[]` when a ledger answered and none of this object\'s actions is off — and for an object with no actions', async () => {
        const services = withEngine(['showcase_mark_done']);
        expect((await harness(ROWS, services).getMetaItem({ type: 'object', name: PROJECT.name }) as any).disabledActions)
            .toEqual([]);
        expect((await harness(ROWS, services).getMetaItem({ type: 'object', name: NOTE.name }) as any).disabledActions)
            .toEqual([]);
        expect((await harness(ROWS, withEngine([])).getMetaItem({ type: 'object', name: TASK.name }) as any).disabledActions)
            .toEqual([]);
    });

    it('control: no key where no ledger answered — no engine, an engine without the member, an engine with no ledger', async () => {
        for (const services of [
            new Map<string, unknown>(),
            new Map<string, unknown>([['objectql', { find: async () => [] }]]),
            withEngine(undefined),
        ]) {
            const read: any = await harness(ROWS, services).getMetaItem({ type: 'object', name: TASK.name });
            expect(read.item.actions).toHaveLength(2);
            expect(read).not.toHaveProperty('disabledActions');
        }
    });

    it('the plural spelling of the type is folded first and answers the same', async () => {
        const read: any = await harness(ROWS, withEngine(['showcase_mark_done'])).getMetaItem({ type: 'objects', name: TASK.name });
        expect(read.disabledActions).toEqual(['showcase_mark_done']);
    });

    it('a type other than `object` reads no key, and the engine is never asked', async () => {
        const services = withEngine(['showcase_mark_done']);
        const read: any = await harness(
            [...ROWS, storedRow('view', 'task_board', { name: 'task_board', label: 'Board' })], services,
        ).getMetaItem({ type: 'view', name: 'task_board' });

        expect(read).not.toHaveProperty('disabledActions');
        expect((services.get('objectql') as ReturnType<typeof engineDouble>).getDisabledActions).not.toHaveBeenCalled();
    });

    it('the execution face carries none: it is the doors\' own read, not a served one', async () => {
        const services = withEngine(['showcase_mark_done']);
        const read: any = await harness(ROWS, services).getMetaItemForExecution({ type: 'object', name: TASK.name });
        expect(read).not.toHaveProperty('disabledActions');
    });
});

describe('[#27842] the list: `disabledActions` beside the items, keyed by object name', () => {
    it('one entry per listed object, `[]` included; the items stay as declared; the engine is asked once', async () => {
        const services = withEngine(['showcase_mark_done', 'showcase_archive']);
        const list: any = await harness(ROWS, services).getMetaItems({ type: 'object' });

        expect(list.disabledActions).toEqual({
            [TASK.name]: ['showcase_mark_done'],
            [PROJECT.name]: ['showcase_archive'],
            [NOTE.name]: [],
        });
        for (const item of list.items) expect(item).not.toHaveProperty('disabledActions');
        expect(list.items.find((i: any) => i.name === TASK.name).actions.map((a: any) => a.name))
            .toEqual(['showcase_mark_done', 'showcase_snooze']);
        expect((services.get('objectql') as ReturnType<typeof engineDouble>).getDisabledActions).toHaveBeenCalledTimes(1);
    });

    it('control: no ledger answered — no key; and the execution face never carries one', async () => {
        const bare: any = await harness(ROWS, withEngine(undefined)).getMetaItems({ type: 'object' });
        expect(bare.items.length).toBe(3);
        expect(bare).not.toHaveProperty('disabledActions');

        const execution: any = await harness(ROWS, withEngine(['showcase_mark_done'])).getMetaItemsForExecution({ type: 'object' });
        expect(execution).not.toHaveProperty('disabledActions');
    });

    it('a pending draft overlaid on the list gets no entry', async () => {
        const draftOnly = { name: 'draft_only', label: 'Draft', actions: [{ name: 'showcase_mark_done', label: 'X' }] };
        const list: any = await harness(
            [...ROWS, storedRow('object', 'draft_only', draftOnly, { state: 'draft' })],
            withEngine(['showcase_mark_done']),
        ).getMetaItems({ type: 'object', previewDrafts: true });

        expect(list.items.map((i: any) => i.name)).toContain('draft_only');
        expect(Object.keys(list.disabledActions)).not.toContain('draft_only');
        expect(list.disabledActions[TASK.name]).toEqual(['showcase_mark_done']);
    });
});

describe('[#27842] the cached read — the default door — carries it beside `data`, never in the ETag', () => {
    it('serves the ledger\'s answer live beside the document, with an ETag over the document alone', async () => {
        const judged: any = await harness(ROWS, withEngine(['showcase_mark_done'])).getMetaItemCached({ type: 'object', name: TASK.name });
        const unjudged: any = await harness(ROWS).getMetaItemCached({ type: 'object', name: TASK.name });

        expect(judged.disabledActions).toEqual(['showcase_mark_done']);
        expect(judged.data).not.toHaveProperty('disabledActions');
        expect(JSON.stringify(judged.data.actions)).toBe(JSON.stringify(unjudged.data.actions));
        // In no validator: the same document, the same ETag.
        expect(judged.etag).toEqual(unjudged.etag);
        expect(unjudged).not.toHaveProperty('disabledActions');
    });

    it('a read that carries the key is never answered 304; control: one where no ledger answered still is', async () => {
        const services = withEngine(['showcase_mark_done']);
        const first: any = await harness(ROWS, services).getMetaItemCached({ type: 'object', name: TASK.name });
        const revalidate = { type: 'object', name: TASK.name, cacheRequest: { ifNoneMatch: `"${first.etag.value}"` } };

        const judged: any = await harness(ROWS, services).getMetaItemCached(revalidate);
        expect(judged.notModified).toBe(false);
        expect(judged.disabledActions).toEqual(['showcase_mark_done']);

        const unjudged: any = await harness(ROWS, withEngine(undefined)).getMetaItemCached(revalidate);
        expect(unjudged.notModified).toBe(true);
    });
});
