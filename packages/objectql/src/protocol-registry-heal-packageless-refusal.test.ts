// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32366, seat ruling 6812637203 Q2, ADR-0150 D3/D5] After a package-less
 * heal is refused, the removed row's entry in the bare slot is retired and no
 * baseline is registered; the bare read then answers the store's 409, which
 * names every holder.
 *
 * The behavioural half, over a real `SchemaRegistry` (the registry decides
 * which holders a bare read's 409 names, so a double cannot stand in for it)
 * and a real `MetadataManager` holding two packages' `action` items. The
 * protocol's own pins of the heal's tiers live in
 * `@objectstack/metadata-protocol`'s `protocol.registry-heal-package-read.test.ts`.
 *
 * Measured while writing this file, at the PR head before the ruling's change:
 * - the ruling's case (no composite slot in the registry, both holders in the
 *   service): the heal is refused and logged, the removed row's entry stays in
 *   the bare slot, and the bare read already answers the store's 409;
 * - the shape #32551's contract review measured (both holders in composite
 *   slots, a stale package-less entry in the bare slot): the heal's TIER 1
 *   (`removeRuntimeShadow`) lifts that entry before any baseline is read, and
 *   the delete door does not reach the heal there at all (the package-less row
 *   of a name code packages ship is sealed against removal, 403). Pin 3 runs
 *   the heal directly on that shape.
 */
import './__fixtures__/lint-root-preload.testkit.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { MetadataManager } from '@objectstack/metadata';
import { assertEngineDeleteDispatch, assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SchemaRegistry } from './registry.js';
import { PackageScopedNameRefusedError } from './package-scoped-read.js';

const A = 'com.acme.alpha';
const B = 'com.acme.beta';
const NAME = 'digest';
const manifest = (id: string) => ({ id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop()! }) as never;
const body = (label: string, extra: Record<string, unknown> = {}) => ({ name: NAME, label, type: 'script', target: `${label}_impl`, ...extra });

/** The one engine double both harnesses read: a control-plane kernel's `sys_metadata` over `rows`. */
function engineOver(registry: SchemaRegistry, rows: Array<Record<string, unknown>>): Record<string, unknown> {
    // The engine double: equality and `$in`, and nothing else — any other
    // operator or combinator is refused loudly rather than read as a field
    // (the matcher of `package-scoped-exact-qualifier.test.ts`).
    const matches = (row: Record<string, unknown>, where: Record<string, unknown> | undefined) =>
        Object.entries(where ?? {}).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`engine double: logical operator ${k} is not implemented`);
            if (v !== null && typeof v === 'object') {
                const ops = Object.keys(v);
                if (ops.length !== 1 || ops[0] !== '$in' || !Array.isArray((v as { $in?: unknown }).$in)) {
                    throw new Error(`engine double: operator ${ops.join(', ')} is not implemented`);
                }
                return (v as { $in: unknown[] }).$in.includes(row[k]);
            }
            return (row[k] ?? null) === v;
        });
    const pick = (table: string, opts?: { where?: Record<string, unknown>; limit?: number }) => {
        if (table !== 'sys_metadata') return [];
        const hits = rows.filter((r) => matches(r, opts?.where));
        return typeof opts?.limit === 'number' ? hits.slice(0, opts.limit) : hits;
    };
    const engine: Record<string, unknown> = {
        registry,
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) { return pick(table, opts); },
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts as never);
            return pick(table, opts)[0] ?? null;
        },
        async insert(_t: string, data: Record<string, unknown>) { return { id: 'inserted', ...data }; },
        async update(_t: string, data: Record<string, unknown>, options?: Record<string, unknown>) { assertEngineUpdateDispatch(data, options); return { id: null }; },
        async delete(_t: string, options?: Record<string, unknown>) {
            assertEngineDeleteDispatch(options);
            const at = rows.findIndex((r) => r.id === (options as any)?.where?.id);
            if (at >= 0) rows.splice(at, 1);
            return { deleted: at >= 0 ? 1 : 0 };
        },
        async count() { return 0; },
        async transaction(fn: (ctx: unknown) => Promise<unknown>) { return fn(undefined); },
        async execute() { return {}; },
    };
    return engine;
}

function makeHarness(opts: { composite: boolean; row: boolean }) {
    const registry = new SchemaRegistry({ multiTenant: false });
    for (const id of [A, B]) registry.installPackage(manifest(id), 'code');
    if (opts.composite) for (const id of [A, B]) registry.registerItem('action', body(id), 'name' as never, id);
    // The removed row's entry, in the bare slot.
    registry.registerItem('action', body('stale', opts.row ? { _provenance: 'org' } : {}), 'name' as never);
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    for (const id of [A, B]) manager.registerInMemory('action', NAME, body(id, { _packageId: id }));
    const rows: Array<Record<string, unknown>> = opts.row
        ? [{ id: 'row_digest', type: 'action', name: NAME, organization_id: null, package_id: null, state: 'active', checksum: 'sha256:head', metadata: JSON.stringify(body('stale')) }]
        : [];
    const engine = engineOver(registry, rows);
    // A control-plane kernel, whose registry takes stored rows.
    const protocol = new ObjectStackProtocolImplementation(engine as never, () => new Map<string, unknown>([['metadata', manager]]) as never, undefined);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bareSlot = () => ((registry as any).metadata.get('action') as Map<string, unknown>).has(NAME);
    const bareRead = async () => {
        try {
            await protocol.getMetaItem({ type: 'action', name: NAME });
        } catch (err) {
            expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
            return err as PackageScopedNameRefusedError;
        }
        throw new Error('the bare read answered; a refusal was expected');
    };
    return { protocol, rows, logged, bareSlot, bareRead };
}

const healLines = (logged: { mock: { calls: unknown[][] } }): string[] =>
    logged.mock.calls.map((call: unknown[]) => String(call[0])).filter((line: string) => line.includes('registry heal'));

afterEach(() => { vi.restoreAllMocks(); });

describe('[#32366, ruling 6812637203 Q2] a refused package-less heal retires the removed row\'s bare-slot entry', () => {
    it('DELETE of the package-less row of a name two packages hold: the entry leaves the bare slot, no baseline is registered, and the next bare read answers the store\'s 409 naming every package holder', async () => {
        const h = makeHarness({ composite: false, row: true });

        const result = await h.protocol.deleteMetaItem({ type: 'action', name: NAME } as never);

        expect((result as { success?: boolean }).success).toBe(true);
        expect(h.rows).toHaveLength(0);
        // At bf53824e: still in the bare slot.
        expect(h.bareSlot()).toBe(false);
        const err = await h.bareRead();
        expect([err.code, err.status, err.refusal.reason]).toEqual(['RESOURCE_CONFLICT', 409, 'ambiguous-in-environment']);
        expect(err.refusal.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
        // The heal still says so once, at error, naming both holders.
        const lines = healLines(h.logged);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(A);
        expect(lines[0]).toContain(B);
    });

    it('the shape #32551\'s review measured — holders in composite slots, a stale package-less entry with no row behind it: before the heal the 409 names it as the platform\'s; after the heal it does not', async () => {
        const h = makeHarness({ composite: true, row: false });
        const before = await h.bareRead();
        expect(before.refusal.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }, { kind: 'platform' }]);

        await (h.protocol as any).restoreArtifactRegistryView('action', NAME, null, null);

        expect(h.bareSlot()).toBe(false);
        const after = await h.bareRead();
        expect(after.refusal.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
    });
});

/**
 * [#32620, epic ruling 6818436831, ADR-0150 D3/D5, ADR-0146] A row bound to a
 * NON-HOLDER (an installed package holding no item of the name) on a name two
 * packages hold, where the pair relation names no single base: the heal's
 * baseline read is refused, and the removed row's bare-slot entry is retired
 * as the package-less row's is (Q2 above). Entry kept → retired.
 *
 * Measured at a557fa38 over this harness (boot hydration of the stored row,
 * then the delete door naming the row's package), every package-slotted type
 * in both registration orders: `flow` and `permission`, the two whose bound
 * row has no package overlay slot, kept the removed row's entry in the bare
 * slot, so the non-holder's read served the deleted body and each holder's
 * read was refused with the non-holder as its candidate. Every other
 * package-slotted type already retires the row's own package slot (#33127);
 * for those only the line moves (`action` below, the CONTROL). Since #32780 a
 * `permission` row bound to a package takes that package's own slot too, so
 * `permission` reads as the CONTROL and `flow` alone keeps the bare-slot shape.
 *
 * The holders here are served by the metadata service only (no composite slot
 * in the registry), the shape Q2's first pin measures.
 */
describe('[#32620, ruling 6818436831] a refused heal of a non-holder\'s row retires its bare-slot entry', () => {
    const O = 'com.acme.other';
    const item = (label: string, extra: Record<string, unknown> = {}) => ({ name: NAME, label, description: label, ...extra });

    async function boot(type: string, order: readonly string[]) {
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.logLevel = 'silent' as never;
        for (const id of [O, ...order]) registry.installPackage(manifest(id), 'code');
        const manager = new MetadataManager({ formats: ['json'], loaders: [] });
        for (const id of order) manager.registerInMemory(type as never, NAME, item(`shipped:${id}`, { _packageId: id }));
        const rows: Array<Record<string, unknown>> = [{
            id: 'row_other', type, name: NAME, organization_id: null, package_id: O, state: 'active', checksum: 'sha256:head',
            metadata: JSON.stringify(item('row:other')),
        }];
        const engine = engineOver(registry, rows);
        const protocol: any = new ObjectStackProtocolImplementation(engine as never, () => new Map<string, unknown>([['metadata', manager]]) as never, undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        await protocol.loadMetaFromDb();
        const bareEntry = () => ((registry as any).metadata.get(type) as Map<string, { label?: string }> | undefined)?.get(NAME)?.label;
        /** The label a read naming `packageId` serves, or the refusal's code, status and candidates. */
        const read = async (packageId?: string) => {
            try {
                const res = await protocol.getMetaItem({ type, name: NAME, ...(packageId ? { packageId } : {}) });
                return (res?.item as { label?: string } | undefined)?.label;
            } catch (err) {
                expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
                const refusal = err as PackageScopedNameRefusedError;
                return [refusal.code, refusal.status, refusal.refusal.candidates];
            }
        };
        return { protocol, rows, logged, bareEntry, read };
    }

    const holders = (order: readonly string[]) => [...order].map((id) => ({ kind: 'package', packageId: id }));

    for (const type of ['flow']) {
        for (const order of [[A, B], [B, A]] as const) {
            it(`${type} (${order[0] === A ? 'alpha' : 'beta'} first): the non-holder's removed row leaves the bare slot; each holder's read answers its own item, the bare read is the 409 naming both holders, and the list shows the two holders only`, async () => {
                const h = await boot(type, order);
                // The row is in the bare slot, and a holder's read names it as a candidate.
                expect(h.bareEntry()).toBe('row:other');
                expect(await h.read(A)).toEqual(['RESOURCE_CONFLICT', 409, [{ kind: 'package', packageId: O }]]);

                const result = await h.protocol.deleteMetaItem({ type, name: NAME, packageId: O });

                expect(result.success).toBe(true);
                expect(h.rows).toHaveLength(0);
                // At a557fa38: 'row:other', still served to the non-holder's read.
                expect(h.bareEntry()).toBeUndefined();
                expect(await h.read(O)).toBeUndefined();
                expect([await h.read(A), await h.read(B)]).toEqual([`shipped:${A}`, `shipped:${B}`]);
                expect(await h.read()).toEqual(['RESOURCE_CONFLICT', 409, holders(order)]);
                const listed: any = await h.protocol.getMetaItems({ type });
                const items: Array<{ label?: string; _packageId?: string }> = listed.items ?? listed;
                expect(items.map((item) => item.label).sort()).toEqual([`shipped:${A}`, `shipped:${B}`]);
                const lines = healLines(h.logged);
                expect(lines).toHaveLength(1);
                expect(lines[0]).toContain('was retired from the bare slot');
            });
        }
    }

    it.each(['action', 'permission'])('CONTROL — %s, whose bound row takes its package\'s own slot (#33127, #32780): the holders serve as before the move, and the line says that slot was retired', async (type) => {
        const h = await boot(type, [A, B]);
        expect(h.bareEntry()).toBeUndefined();

        await h.protocol.deleteMetaItem({ type, name: NAME, packageId: O });

        expect(h.bareEntry()).toBeUndefined();
        expect([await h.read(A), await h.read(B), await h.read(O)]).toEqual([`shipped:${A}`, `shipped:${B}`, undefined]);
        expect(await h.read()).toEqual(['RESOURCE_CONFLICT', 409, holders([A, B])]);
        const lines = healLines(h.logged);
        expect(lines).toHaveLength(1);
        // At a557fa38: "left as it was and may serve the removed row".
        expect(lines[0]).toContain('retired from its own package\'s slot');
    });
});

/**
 * [#33832, ADR-0150 D3, epic ruling 6818436831] A `dashboard` or `report` is
 * addressed by `(package, name)` but stored in the metadata service by name
 * alone, so the service keeps the item registered LAST and answers it to a read
 * naming any package. The heal's tier 2 read it as the baseline after the
 * delete of a non-holder's row and registered it in the bare slot: a pick
 * between the two holders.
 *
 * The shape a real boot leaves (measured on a kernel booted from a compiled
 * two-package artifact through the artifact door and `AppPlugin`, both kernel
 * shapes, both orders): each holder in its composite slot, both in the
 * service with the last-registered one kept, and the non-holder's stored row
 * declined from the bare slot. There, at 45dee177, the delete left the
 * last-registered holder's item in the bare slot: every bare registry lookup
 * answered it and the registry listed it twice. The protocol's reads did not
 * move, because the composite slots answer them. Bare slot: picked holder's
 * item → empty.
 */
describe('[#33832, ruling 6818436831] the heal never registers a picked holder of a name the service stores by name alone', () => {
    const O = 'com.acme.other';
    const shippedItem = (type: string, id: string) => (type === 'report'
        ? { name: NAME, label: `shipped:${id}`, type: 'summary', dataset: 'qa_metrics', values: ['total'], _packageId: id }
        : { name: NAME, label: `shipped:${id}`, widgets: [], _packageId: id });

    async function boot(type: string, order: readonly string[]) {
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.logLevel = 'silent' as never;
        for (const id of [O, ...order]) registry.installPackage(manifest(id), 'code');
        // Each holder in its composite slot, as the package door registers it.
        for (const id of order) registry.registerItem(type as never, shippedItem(type, id), 'name' as never, id);
        // The service keeps one item per name for these types: the last one.
        const manager = new MetadataManager({ formats: ['json'], loaders: [] });
        for (const id of order) manager.registerInMemory(type as never, NAME, shippedItem(type, id));
        const rows: Array<Record<string, unknown>> = [{
            id: 'row_other', type, name: NAME, organization_id: null, package_id: O, state: 'active', checksum: 'sha256:head',
            metadata: JSON.stringify({ ...shippedItem(type, O), label: 'row:other', _packageId: undefined }),
        }];
        const engine = engineOver(registry, rows);
        const protocol: any = new ObjectStackProtocolImplementation(engine as never, () => new Map<string, unknown>([['metadata', manager]]) as never, undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        await protocol.loadMetaFromDb();
        const bareEntry = () => ((registry as any).metadata.get(type) as Map<string, { label?: string }> | undefined)?.get(NAME)?.label;
        const listed = () => (registry.listItems(type as never) as Array<{ name?: string; label?: string }>)
            .filter((item) => item?.name === NAME).map((item) => item.label).sort();
        const read = async (packageId?: string) => {
            try {
                const res = await protocol.getMetaItem({ type, name: NAME, ...(packageId ? { packageId } : {}) });
                return (res?.item as { label?: string } | undefined)?.label;
            } catch (err) {
                expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
                const refusal = err as PackageScopedNameRefusedError;
                return [refusal.code, refusal.status, refusal.refusal.candidates];
            }
        };
        return { protocol, rows, logged, bareEntry, listed, read };
    }

    for (const type of ['dashboard', 'report']) {
        for (const order of [[A, B], [B, A]] as const) {
            it(`${type} (${order[0] === A ? 'alpha' : 'beta'} first): the delete of a non-holder's row leaves the bare slot empty; the registry lists each holder once, and every read answers as before the delete`, async () => {
                const h = await boot(type, order);
                const holders = order.map((id) => ({ kind: 'package', packageId: id }));
                // The real boot's shape: the non-holder's row is not in the bare slot.
                expect(h.bareEntry()).toBeUndefined();

                const result = await h.protocol.deleteMetaItem({ type, name: NAME, packageId: O });

                expect(result.success).toBe(true);
                expect(h.rows).toHaveLength(0);
                // At 45dee177: `shipped:<the holder registered last>`, listed a second time.
                expect(h.bareEntry()).toBeUndefined();
                expect(h.listed()).toEqual([`shipped:${A}`, `shipped:${B}`]);
                expect([await h.read(A), await h.read(B)]).toEqual([`shipped:${A}`, `shipped:${B}`]);
                expect(await h.read()).toEqual(['RESOURCE_CONFLICT', 409, holders]);
                expect(healLines(h.logged)).toEqual([]);
            });
        }
    }

    it('CONTROL — dashboard, a name ONE package holds: the delete of a non-holder\'s row still registers that holder\'s baseline, as before', async () => {
        const h = await boot('dashboard', [A]);

        await h.protocol.deleteMetaItem({ type: 'dashboard', name: NAME, packageId: O });

        expect(h.bareEntry()).toBe(`shipped:${A}`);
        expect(await h.read(A)).toBe(`shipped:${A}`);
        expect(healLines(h.logged)).toEqual([]);
    });
});
