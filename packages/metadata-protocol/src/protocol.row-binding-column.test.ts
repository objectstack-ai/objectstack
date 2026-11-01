// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28673] Every metadata read states the package a stored row's `package_id`
 * COLUMN records, and none the column does not: a `_packageId` the row's body
 * carries is replaced by the column's package, or dropped when the row is bound
 * to no package. One rule, {@link withRowBinding}, the one the list read's
 * `storedOverlayEntries` took first (#28594): the save door already strips a
 * body's stamp (`stripDerivedProvenance`: the server states provenance, a
 * caller never does), but a row at rest can still carry one, and the reads
 * below used to stamp the column's package only while the body named none, so
 * they echoed it.
 *
 *  1. The rule itself: replaced, dropped, kept, and a copy.
 *  2. The by-name active read (and the strict draft read, the same site).
 *  3. The by-name draft preview (`previewDrafts`).
 *  4. The draft list (`getMetaItems` with `previewDrafts`).
 *  5. The list merge (`mergePackageAwareOverlay`): a package-less row, served
 *     as itself or standing in for a package's slot.
 *  6. Hydration (`hydrateOverlayIntoRegistry`): the registered body, and the
 *     items a view container row expands to.
 *
 * Each read has its control: an absent or agreeing stamp is served as before.
 * The list read's own pins are `protocol-stored-overlay-reads.test.ts`; the
 * scoped list's view-expansion stand-in (a package-less row the merge held
 * back, served in a package's slot) is `protocol.scoped-list-fallback.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { assertEngineFindOnePredicate, isCodeArtifactBody } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation, mergePackageAwareOverlay, withRowBinding } from './protocol.js';

const TYPE = 'dashboard';
const NAME = 'd_bound';
const HOST = 'com.acme.host';
const PKG_A = 'com.acme.authored';

interface StoredRow {
    id: string;
    type: string;
    name: string;
    package_id: string | null;
    state: string;
    metadata: string;
}

const whereValueMatches = (actual: unknown, want: unknown): boolean =>
    want !== null && typeof want === 'object' && Array.isArray((want as { $in?: unknown }).$in)
        ? (want as { $in: unknown[] }).$in.includes(actual)
        : actual === want;

/** A stored row of {@link NAME}: its column `packageId`, its body's own stamp `stamp` (absent when `undefined`). */
function stored(
    packageId: string | null,
    stamp: string | undefined,
    state: 'active' | 'draft' = 'active',
    extra: Record<string, unknown> = {},
): StoredRow {
    return {
        id: `r_${packageId ?? 'none'}_${state}`,
        type: TYPE,
        name: NAME,
        package_id: packageId,
        state,
        metadata: JSON.stringify({
            name: NAME,
            label: `${state} row`,
            ...(stamp === undefined ? {} : { _packageId: stamp }),
            ...extra,
        }),
    };
}

/** The engine double: `find` / `findOne` over `sys_metadata`, and a registry holding nothing of the type. */
function harness(rows: StoredRow[]) {
    const registry = {
        getArtifactItem: (_type: string, _name: string) => undefined,
        getItem: () => undefined,
        listItems: () => [],
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

const byName = async (rows: StoredRow[], request: Record<string, unknown> = {}): Promise<any> =>
    ((await harness(rows).getMetaItem({ type: TYPE, name: NAME, ...request } as any)) as any).item;

const listed = async (rows: StoredRow[], request: Record<string, unknown> = {}): Promise<any[]> =>
    (((await harness(rows).getMetaItems({ type: TYPE, ...request } as any)) as any).items as any[])
        .filter((item) => item?.name === NAME);

// ── 1. The rule ─────────────────────────────────────────────────────────────

describe('[#28673] 1. withRowBinding — the row\'s binding is its column\'s', () => {
    it('a body stamp on a row bound to no package is dropped, on a copy', () => {
        const body = { name: 'a', _packageId: HOST };
        for (const column of [undefined, null, '', 'sys_metadata']) {
            const bound = withRowBinding(body, column) as Record<string, unknown>;
            expect(bound, String(column)).not.toHaveProperty('_packageId');
            expect(bound).not.toBe(body);
        }
        expect(body._packageId).toBe(HOST);
    });

    it('a body stamp naming another package is replaced by the column\'s, on a copy', () => {
        const body = { name: 'a', _packageId: HOST };
        const bound = withRowBinding(body, PKG_A) as Record<string, unknown>;
        expect(bound._packageId).toBe(PKG_A);
        expect(body._packageId).toBe(HOST);
    });

    it('control: an absent stamp is stated from the column, an agreeing one kept; a body that already says it is returned as it is', () => {
        expect((withRowBinding({ name: 'a' }, PKG_A) as any)._packageId).toBe(PKG_A);
        const agreeing = { name: 'a', _packageId: PKG_A };
        expect(withRowBinding(agreeing, PKG_A)).toBe(agreeing);
        const unbound = { name: 'a' };
        expect(withRowBinding(unbound, null)).toBe(unbound);
        // Not a record: nothing to state.
        for (const v of [undefined, null, 'x', 3, [{ _packageId: HOST }]]) expect(withRowBinding(v, PKG_A)).toBe(v);
    });
});

// ── 2. The by-name active read ──────────────────────────────────────────────

describe('[#28673] 2. the by-name active read serves the column\'s package', () => {
    it('a package-less row whose body carries `_packageId` serves none', async () => {
        const item = await byName([stored(null, HOST)]);
        expect(item?.label).toBe('active row');
        expect(item).not.toHaveProperty('_packageId');
    });

    it('a row whose body names another package serves the column\'s', async () => {
        const item = await byName([stored(PKG_A, HOST)], { packageId: PKG_A });
        expect(item?.label).toBe('active row');
        expect(item?._packageId).toBe(PKG_A);
    });

    it('the strict draft read, the same site: a package-less draft whose body carries one serves none', async () => {
        const item = await byName([stored(null, HOST, 'draft')], { state: 'draft' });
        expect(item?.label).toBe('draft row');
        expect(item).not.toHaveProperty('_packageId');
        const other = await byName([stored(PKG_A, HOST, 'draft')], { state: 'draft', packageId: PKG_A });
        expect(other?._packageId).toBe(PKG_A);
    });

    it('control: an absent or agreeing stamp is served as before', async () => {
        expect((await byName([stored(PKG_A, undefined)], { packageId: PKG_A }))?._packageId).toBe(PKG_A);
        expect((await byName([stored(PKG_A, PKG_A)], { packageId: PKG_A }))?._packageId).toBe(PKG_A);
        expect(await byName([stored(null, undefined)])).not.toHaveProperty('_packageId');
    });
});

// ── 3. The by-name draft preview ────────────────────────────────────────────

describe('[#28673] 3. the by-name draft preview serves the column\'s package', () => {
    it('a package-less draft whose body carries `_packageId` previews none', async () => {
        const item = await byName([stored(null, undefined), stored(null, HOST, 'draft')], { previewDrafts: true });
        expect(item?.label).toBe('draft row');
        expect(item?._draft).toBe(true);
        expect(item).not.toHaveProperty('_packageId');
    });

    it('a draft whose body names another package previews the column\'s', async () => {
        const item = await byName([stored(PKG_A, HOST, 'draft')], { previewDrafts: true, packageId: PKG_A });
        expect(item?.label).toBe('draft row');
        expect(item?._packageId).toBe(PKG_A);
    });

    it('control: an absent or agreeing stamp previews as before', async () => {
        expect((await byName([stored(PKG_A, undefined, 'draft')], { previewDrafts: true, packageId: PKG_A }))?._packageId).toBe(PKG_A);
        expect((await byName([stored(PKG_A, PKG_A, 'draft')], { previewDrafts: true, packageId: PKG_A }))?._packageId).toBe(PKG_A);
        expect(await byName([stored(null, undefined, 'draft')], { previewDrafts: true })).not.toHaveProperty('_packageId');
    });
});

// ── 4. The draft list ───────────────────────────────────────────────────────

describe('[#28673] 4. the draft list serves the column\'s package', () => {
    it('a package-less draft whose body carries `_packageId` is listed with none', async () => {
        const items = await listed([stored(null, HOST, 'draft')], { previewDrafts: true });
        expect(items.map((i) => i.label)).toEqual(['draft row']);
        expect(items[0]).not.toHaveProperty('_packageId');
    });

    it('a draft whose body names another package is listed under the column\'s', async () => {
        const items = await listed([stored(PKG_A, HOST, 'draft')], { previewDrafts: true });
        expect(items.map((i) => [i.label, i._packageId])).toEqual([['draft row', PKG_A]]);
    });

    it('control: an absent or agreeing stamp is listed as before', async () => {
        expect((await listed([stored(PKG_A, undefined, 'draft')], { previewDrafts: true })).map((i) => i._packageId)).toEqual([PKG_A]);
        expect((await listed([stored(PKG_A, PKG_A, 'draft')], { previewDrafts: true })).map((i) => i._packageId)).toEqual([PKG_A]);
        expect(await listed([stored(null, undefined, 'draft')], { previewDrafts: true })).toEqual([
            expect.not.objectContaining({ _packageId: expect.anything() }),
        ]);
    });
});

// ── 5. The list merge ───────────────────────────────────────────────────────

describe('[#28673] 5. the list merge serves a stored row under its own binding', () => {
    const record = (stamp: string | undefined, packageId: string | undefined, standIn = false) => ({
        data: { name: NAME, label: 'row', ...(stamp === undefined ? {} : { _packageId: stamp }) },
        packageId,
        stored: { type: TYPE },
        ...(standIn ? { standIn: true } : {}),
    });

    it('a package-less row whose body carries `_packageId` is served with none', () => {
        const out = mergePackageAwareOverlay(TYPE, [], [record(HOST, undefined)]) as any[];
        expect(out).toHaveLength(1);
        expect(out[0]).not.toHaveProperty('_packageId');
    });

    it('a package-less row standing in for a package\'s slot is served as that package\'s, whatever its body says', () => {
        const base = { name: NAME, label: 'packaged', _packageId: PKG_A };
        const out = mergePackageAwareOverlay(TYPE, [base], [record(HOST, undefined)]) as any[];
        expect(out.map((i) => [i.label, i._packageId])).toEqual([['row', PKG_A]]);
    });

    it('a row whose body names another package is served under its own', () => {
        const out = mergePackageAwareOverlay(TYPE, [], [record(HOST, PKG_A)]) as any[];
        expect(out.map((i) => i._packageId)).toEqual([PKG_A]);
    });

    it('control: an absent or agreeing stamp is served as before, and the caller\'s body is not written', () => {
        const rec = record(undefined, undefined);
        const base = { name: NAME, label: 'packaged', _packageId: PKG_A };
        expect((mergePackageAwareOverlay(TYPE, [base], [rec]) as any[]).map((i) => i._packageId)).toEqual([PKG_A]);
        expect(rec.data).not.toHaveProperty('_packageId');
        expect((mergePackageAwareOverlay(TYPE, [], [record(PKG_A, PKG_A)]) as any[]).map((i) => i._packageId)).toEqual([PKG_A]);
        expect(mergePackageAwareOverlay(TYPE, [], [record(undefined, undefined)])).toEqual([
            expect.not.objectContaining({ _packageId: expect.anything() }),
        ]);
    });
});

// ── 6. Hydration ────────────────────────────────────────────────────────────

/** A protocol whose registry records every `registerItem` call. */
function hydrationHarness() {
    const registered: Array<{ type: string; item: Record<string, unknown> }> = [];
    const registry = {
        registerItem: (type: string, item: Record<string, unknown>) => { registered.push({ type, item }); },
        unregisterItem: () => undefined,
        getArtifactItem: (_type: string, _name: string, _pkg?: string) => undefined,
        getItem: () => undefined,
        listItems: () => [],
        getObject: () => undefined,
        getPackagedObjectOwner: () => undefined,
        getPackage: () => undefined,
        isPackageDisabled: () => false,
    };
    const engine: any = {
        async find() { return []; },
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            return null;
        },
        registry,
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map());
    const hydrate = (type: string, data: unknown, packageId: string | null) =>
        (protocol as any).hydrateOverlayIntoRegistry(type, data, { packageId, organizationId: null }) as Promise<boolean>;
    return { registered, hydrate };
}

describe('[#28673] 6. hydration registers a row under its column\'s package', () => {
    it('a package-less row whose body carries `_packageId` registers with none', async () => {
        const { registered, hydrate } = hydrationHarness();
        await hydrate(TYPE, { name: NAME, _packageId: HOST }, null);
        expect(registered.map(({ item }) => item.name)).toEqual([NAME]);
        expect(registered[0]!.item).not.toHaveProperty('_packageId');
    });

    it('a row whose body names another package registers under the column\'s', async () => {
        const { registered, hydrate } = hydrationHarness();
        await hydrate(TYPE, { name: NAME, _packageId: HOST }, PKG_A);
        expect(registered.map(({ item }) => item._packageId)).toEqual([PKG_A]);
    });

    it('a package-less view container whose body carries `_packageId`: no item it expands to is registered as that package\'s', async () => {
        const { registered, hydrate } = hydrationHarness();
        await hydrate('view', {
            name: 'crm_note',
            object: 'crm_note',
            list: { type: 'grid', columns: ['name'] },
            _packageId: HOST,
        }, null);
        const expanded = registered.filter(({ item }) => item.name !== 'crm_note');
        expect(expanded.length).toBeGreaterThan(0);
        for (const { item } of expanded) expect(item, String(item.name)).not.toHaveProperty('_packageId');
    });

    it('control: an absent or agreeing stamp registers as before', async () => {
        const { registered, hydrate } = hydrationHarness();
        await hydrate(TYPE, { name: NAME }, PKG_A);
        await hydrate(TYPE, { name: NAME, _packageId: PKG_A }, PKG_A);
        await hydrate(TYPE, { name: NAME }, null);
        expect(registered.map(({ item }) => item._packageId)).toEqual([PKG_A, PKG_A, undefined]);
    });
});
