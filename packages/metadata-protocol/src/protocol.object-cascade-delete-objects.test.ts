// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28001] The `object` item read serves, beside the item, the objects a
 * delete of one of its records can cascade into: `cascadeDeleteObjects` on
 * both doors. It takes `disabledActions`' (#27842) four positions:
 *
 *  - read through the kernel's service table by name (`objectql`), for the
 *    optional member the engine declares on `IObjectQLEngine`
 *    (`getCascadeDeleteObjects`) — this package imports no engine and holds no
 *    copy of which relations cascade;
 *  - absent where no engine answered (no engine, an engine without the
 *    member, or one that does not hold the object), never `[]` there;
 *  - `[]` where the engine answered that nothing cascades;
 *  - on the cached default door too, never in its ETag, and a read that
 *    carries it is never answered 304 (the REST door folds it instead).
 *
 * `item` is served as stored: the list is beside it, never in it.
 *
 * The engine double answers the way `ObjectQL` does (pinned on the real
 * engine, with the real protocol, in `@objectstack/objectql`'s
 * `engine-cascade-delete-objects.test.ts`).
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

/** The engine's answer: the cascade per object name, `undefined` for an object it does not hold. */
function engineDouble(cascades: Record<string, string[]>) {
    return {
        getCascadeDeleteObjects: vi.fn((objectName: string): string[] | undefined =>
            Object.prototype.hasOwnProperty.call(cascades, objectName) ? [...cascades[objectName]!] : undefined),
    };
}

const CASCADES = { [TASK.name]: ['showcase_subtask', 'showcase_checklist_item'], [PROJECT.name]: [] };
const withEngine = (cascades: Record<string, string[]> = CASCADES) =>
    new Map<string, unknown>([['objectql', engineDouble(cascades)]]);

describe('[#28001] the item read: `cascadeDeleteObjects` beside `item`, the engine\'s answer or nothing', () => {
    it('names what a delete of this object cascades into, and serves `item` as stored', async () => {
        const plain: any = await harness(ROWS).getMetaItem({ type: 'object', name: TASK.name });
        const judged: any = await harness(ROWS, withEngine()).getMetaItem({ type: 'object', name: TASK.name });

        expect(judged.cascadeDeleteObjects).toEqual(['showcase_subtask', 'showcase_checklist_item']);
        expect(JSON.stringify(judged.item)).toBe(JSON.stringify(plain.item));
        expect(judged.item).not.toHaveProperty('cascadeDeleteObjects');
        expect(judged).toHaveProperty('lock');
    });

    it('`[]` when the engine answered that nothing cascades', async () => {
        expect((await harness(ROWS, withEngine()).getMetaItem({ type: 'object', name: PROJECT.name }) as any).cascadeDeleteObjects)
            .toEqual([]);
    });

    it('control: no key where no engine answered — no engine, an engine without the member, an object it does not hold', async () => {
        const cases: Array<[Map<string, unknown>, string]> = [
            [new Map<string, unknown>(), TASK.name],
            [new Map<string, unknown>([['objectql', { find: async () => [] }]]), TASK.name],
            [withEngine(), NOTE.name],
        ];
        for (const [services, name] of cases) {
            const read: any = await harness(ROWS, services).getMetaItem({ type: 'object', name });
            expect(read.item.name).toBe(name);
            expect(read).not.toHaveProperty('cascadeDeleteObjects');
        }
    });

    it('the plural spelling of the type is folded first and answers the same', async () => {
        const read: any = await harness(ROWS, withEngine()).getMetaItem({ type: 'objects', name: TASK.name });
        expect(read.cascadeDeleteObjects).toEqual(['showcase_subtask', 'showcase_checklist_item']);
    });

    it('a type other than `object` reads no key, and the engine is never asked', async () => {
        const services = withEngine();
        const read: any = await harness(
            [...ROWS, storedRow('view', 'task_board', { name: 'task_board', label: 'Board' })], services,
        ).getMetaItem({ type: 'view', name: 'task_board' });

        expect(read).not.toHaveProperty('cascadeDeleteObjects');
        expect((services.get('objectql') as ReturnType<typeof engineDouble>).getCascadeDeleteObjects).not.toHaveBeenCalled();
    });

    it('the execution face carries none', async () => {
        const read: any = await harness(ROWS, withEngine()).getMetaItemForExecution({ type: 'object', name: TASK.name });
        expect(read).not.toHaveProperty('cascadeDeleteObjects');
    });

    it('the list carries none: the item read is the one the delete confirmations read', async () => {
        const list: any = await harness(ROWS, withEngine()).getMetaItems({ type: 'object' });
        expect(list.items.length).toBe(3);
        expect(list).not.toHaveProperty('cascadeDeleteObjects');
        for (const item of list.items) expect(item).not.toHaveProperty('cascadeDeleteObjects');
    });
});

describe('[#28001] the cached read — the default door — carries it beside `data`, never in the ETag', () => {
    it('serves the engine\'s answer beside the document, with an ETag over the document alone', async () => {
        const judged: any = await harness(ROWS, withEngine()).getMetaItemCached({ type: 'object', name: TASK.name });
        const unjudged: any = await harness(ROWS).getMetaItemCached({ type: 'object', name: TASK.name });

        expect(judged.cascadeDeleteObjects).toEqual(['showcase_subtask', 'showcase_checklist_item']);
        expect(judged.data).not.toHaveProperty('cascadeDeleteObjects');
        expect(judged.etag).toEqual(unjudged.etag);
        expect(unjudged).not.toHaveProperty('cascadeDeleteObjects');
    });

    it('a read that carries the key is never answered 304; control: one where no engine answered still is', async () => {
        const first: any = await harness(ROWS, withEngine()).getMetaItemCached({ type: 'object', name: TASK.name });
        const revalidate = { type: 'object', name: TASK.name, cacheRequest: { ifNoneMatch: `"${first.etag.value}"` } };

        const judged: any = await harness(ROWS, withEngine()).getMetaItemCached(revalidate);
        expect(judged.notModified).toBe(false);
        expect(judged.cascadeDeleteObjects).toEqual(['showcase_subtask', 'showcase_checklist_item']);

        const unjudged: any = await harness(ROWS, new Map()).getMetaItemCached(revalidate);
        expect(unjudged.notModified).toBe(true);
    });
});
