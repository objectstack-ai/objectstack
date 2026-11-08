// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31399] `getMetaItems({ type: 'seed' })`, the read behind
 * `GET /api/v1/meta/seed`, lists every stored seed row, each carrying its
 * row's name: the name `getMetaItem('seed', name)` already serves it under.
 *
 * A seed body states no name (`SeedSchema` declares none; the name lives on
 * the `sys_metadata` row's `name` column). The list merge
 * (`mergePackageAwareOverlay`) keyed every stored body by the body's own name,
 * so it skipped each seed: N stored rows listed 0 items while the by-name read
 * served all N. It now slots a body that states no name by its row's name.
 *
 *  1. N stored seed rows of a package give N listed items, named, one each,
 *     on the environment's list and on the list scoped to the package, and
 *     each listed body is the body `getMetaItem` serves under that name.
 *  2. A seed the package ships (the registry's item) and a stored row of the
 *     same package and name give ONE slot, the stored row's: no duplicate.
 *     Another package's seed of the same name keeps its own slot.
 *  3. The draft preview lists a draft seed row by its row's name too.
 *  4. Control: a stored body that states a name keeps it, whatever the row
 *     says, and the stored body itself is not written by the list.
 */
// Pays the lint root's first load at collection, never inside a clocked case.
import './lint-root-preload.testkit.js';
import { describe, expect, it } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const PKG = 'app.seedlist31399';
const OTHER = 'app.other31399';
const SEED_NAMES = ['s_one', 's_two', 's_three'] as const;

interface StoredRow {
    id: string;
    type: string;
    name: string;
    package_id: string | null;
    state: string;
    metadata: string;
}

const seedBody = (marker: string) => ({
    object: 'seedlist_thing',
    mode: 'upsert',
    externalId: 'name',
    records: [{ name: marker }],
});

function seedRow(name: string, opts: { packageId?: string | null; state?: 'active' | 'draft'; body?: Record<string, unknown> } = {}): StoredRow {
    const state = opts.state ?? 'active';
    return {
        id: `r_${name}_${state}_${opts.packageId ?? 'none'}`,
        type: 'seed',
        name,
        package_id: opts.packageId === undefined ? PKG : opts.packageId,
        state,
        metadata: JSON.stringify(opts.body ?? seedBody(`stored ${name}${state === 'draft' ? ' (draft)' : ''}`)),
    };
}

const whereValueMatches = (actual: unknown, want: unknown): boolean =>
    want !== null && typeof want === 'object' && Array.isArray((want as { $in?: unknown }).$in)
        ? (want as { $in: unknown[] }).$in.includes(actual)
        : actual === want;

/**
 * The engine double: `find` / `findOne` over `sys_metadata` rows, and a
 * registry holding the seeds packages ship (`shipped`), answering a
 * package-scoped lookup with that package's items only.
 */
function harness(rows: StoredRow[], shipped: Array<Record<string, unknown>> = []) {
    const ofPackage = (packageId?: string) => shipped.filter((i) => !packageId || i._packageId === packageId);
    const registry = {
        getArtifactItem: () => undefined,
        getItem(asked: string, name: string, packageId?: string) {
            return asked === 'seed' ? ofPackage(packageId).find((i) => i.name === name) : undefined;
        },
        listItems(asked: string, packageId?: string) {
            return asked === 'seed' ? structuredClone(ofPackage(packageId)) : [];
        },
        getObject: () => undefined,
        registerObject: () => undefined,
        getPackage: () => undefined,
        isPackageDisabled: () => false,
        applyNavContributions: (app: unknown) => app,
    };
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
        async insert() {
            return {};
        },
        registry,
    };
    return new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_1');
}

const listed = async (protocol: ObjectStackProtocolImplementation, request: Record<string, unknown> = {}): Promise<any[]> =>
    ((await protocol.getMetaItems({ type: 'seed', ...request } as any)) as any).items as any[];

const markerOf = (item: any): unknown => item?.records?.[0]?.name;

describe('[#31399] §1 N stored seed rows list as N named items', () => {
    const rows = SEED_NAMES.map((name) => seedRow(name));

    it('the environment\'s list: one item per stored row, each carrying its row\'s name', async () => {
        const items = await listed(harness(rows));
        expect(items).toHaveLength(SEED_NAMES.length);
        expect(items.map((i) => i.name).sort()).toEqual([...SEED_NAMES].sort());
        for (const item of items) {
            expect(item._packageId).toBe(PKG);
            expect(markerOf(item)).toBe(`stored ${item.name}`);
        }
    });

    it('the list scoped to the package lists the same N items', async () => {
        const items = await listed(harness(rows), { packageId: PKG });
        expect(items.map((i) => i.name).sort()).toEqual([...SEED_NAMES].sort());
    });

    it('each listed body is the body the by-name read serves under that name', async () => {
        const protocol = harness(rows);
        const items = await listed(protocol);
        for (const name of SEED_NAMES) {
            const read: any = await protocol.getMetaItem({ type: 'seed', name });
            const item = items.find((i) => i.name === name);
            expect(markerOf(item)).toBe(markerOf(read.item));
            expect(item.object).toBe(read.item.object);
        }
    });

    it('`names` narrows the list by the row\'s name', async () => {
        const items = await listed(harness(rows), { names: ['s_two'] });
        expect(items.map((i) => i.name)).toEqual(['s_two']);
    });
});

describe('[#31399] §2 no duplicate against a shipped seed of the same name', () => {
    it('the package\'s shipped seed and its stored row of the same name are ONE slot, the stored row\'s', async () => {
        const shipped = [{ name: 's_one', ...seedBody('shipped s_one'), _packageId: PKG }];
        const items = await listed(harness(SEED_NAMES.map((name) => seedRow(name)), shipped));
        expect(items.filter((i) => i.name === 's_one')).toHaveLength(1);
        expect(markerOf(items.find((i) => i.name === 's_one'))).toBe('stored s_one');
        expect(items).toHaveLength(SEED_NAMES.length);
    });

    it('another package\'s shipped seed of the same name keeps its own slot', async () => {
        const shipped = [{ name: 's_one', ...seedBody('shipped by other'), _packageId: OTHER }];
        const items = await listed(harness([seedRow('s_one')], shipped));
        const slots = items.filter((i) => i.name === 's_one').map((i) => [i._packageId, markerOf(i)]);
        expect(slots.sort()).toEqual([[OTHER, 'shipped by other'], [PKG, 'stored s_one']]);
    });
});

describe('[#31399] §3 the draft preview', () => {
    it('a draft seed row is previewed under its row\'s name', async () => {
        const rows = [seedRow('s_one'), seedRow('s_one', { state: 'draft' }), seedRow('s_new', { state: 'draft' })];
        const items = await listed(harness(rows), { previewDrafts: true });
        expect(items.filter((i) => i.name === 's_one').map(markerOf)).toEqual(['stored s_one (draft)']);
        expect(items.filter((i) => i.name === 's_new').map(markerOf)).toEqual(['stored s_new (draft)']);
    });
});

describe('[#31399] §4 CONTROL — a body that states a name keeps it; the stored body is not written', () => {
    it('a dashboard body naming itself is listed under its own name, not the row\'s', async () => {
        const row: StoredRow = {
            id: 'r_dash', type: 'dashboard', name: 'row_spelling', package_id: PKG, state: 'active',
            metadata: JSON.stringify({ name: 'body_spelling', label: 'Body' }),
        };
        const res: any = await harness([row]).getMetaItems({ type: 'dashboard' });
        expect((res.items as any[]).map((i) => i.name)).toEqual(['body_spelling']);
    });

    it('listing does not write the stored seed body', async () => {
        const rows = [seedRow('s_one')];
        const before = rows[0]!.metadata;
        await listed(harness(rows));
        expect(rows[0]!.metadata).toBe(before);
        expect(JSON.parse(rows[0]!.metadata)).not.toHaveProperty('name');
    });
});
