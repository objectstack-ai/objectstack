// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21803, ADR-0010 §3.3, ADR-0048 §3.4] The item lock on the REAL
 * `SchemaRegistry`: when two installed code packages ship one `(type, name)`,
 * the `_lock` gate and both reads take the lock from every package that ships
 * it, the strictest per-package answer, whatever order the packages were
 * registered in.
 *
 * The metadata protocol's own enumeration pin
 * (`packages/metadata-protocol/src/protocol.lock-one-resolution.test.ts`)
 * runs on a registry double, because that package cannot import this one. The
 * resolution's artifact layer depends on THIS registry's answers
 * (`getArtifactItem` prefer-local and first-registered, `listItems` hiding a
 * disabled package, `getAllPackages` naming every installed one), so the
 * card's case is pinned here on the real thing:
 *
 *  1. Package B ships `_lock: 'full'`, package A ships no lock. Before #21803,
 *     with B registered first a read naming A said `'none'` while the door
 *     refused, and with A registered first a read naming B said `'full'` while
 *     the door admitted. Now every read and the door say `'full'`.
 *  2. B is disabled: still installed, its lock still binds.
 *  3. A ships no lock, B ships `'no-delete'`, the stored row declares
 *     `'no-overlay'`: the door refused the save under one order and the delete
 *     under the other, and refuses both under both orders now.
 */
import { describe, expect, it } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { SchemaRegistry } from './registry.js';

const A = 'com.example.a';
const B = 'com.example.b';

type Lock = 'none' | 'no-overlay' | 'no-delete' | 'full';

interface Arrangement {
    readonly name: string;
    readonly locks: Readonly<Record<string, Lock | undefined>>;
    readonly rowLock?: Lock;
    readonly disabled?: readonly string[];
}

/** One protocol over a real registry with the packages registered in `order`, and the stored row, if any. */
function protocolFor(arrangement: Arrangement, order: readonly string[]) {
    const registry = new SchemaRegistry({ multiTenant: false, logLevel: 'silent' });
    for (const packageId of order) {
        const lock = arrangement.locks[packageId];
        registry.registerItem('view', {
            name: arrangement.name,
            label: `view of ${packageId}`,
            object: 'account',
            viewKind: 'list',
            ...(lock ? { protection: { lock, reason: `Packaged lock of ${packageId}.` } } : {}),
        } as Record<string, unknown>, 'name' as never, packageId);
    }
    for (const packageId of arrangement.disabled ?? []) {
        registry.installPackage({ id: packageId, name: packageId, version: '1.0.0', type: 'app' } as never);
        registry.disablePackage(packageId);
    }
    const rows = arrangement.rowLock === undefined ? [] : [{
        id: 'row_1', type: 'view', name: arrangement.name, organization_id: null, package_id: null, state: 'active',
        metadata: JSON.stringify({
            name: arrangement.name, label: 'stored row', object: 'account', _provenance: 'org', _lock: arrangement.rowLock,
        }),
    }];
    const matching = (where: Record<string, unknown> = {}) =>
        rows.filter((r) => Object.entries(where).every(([k, v]) => v === undefined || (r as Record<string, unknown>)[k] === v));
    const engine = {
        registry,
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const matched = matching(opts?.where);
            // `check:objectql-double-limit` — the caller's bound, applied after the filter.
            return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
        },
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            // `check:engine-double-contract` — refuses what the real engine refuses.
            assertEngineFindOnePredicate(table, opts);
            return table === 'sys_metadata' ? (matching(opts?.where)[0] ?? null) : null;
        },
        async insert() {
            return {};
        },
    };
    return new ObjectStackProtocolImplementation(engine as never, () => new Map(), 'env_1');
}

const ORDERS = [
    { order: 'package B registered first', packages: [B, A] },
    { order: 'package A registered first', packages: [A, B] },
] as const;

const REQUESTS = [
    { request: 'naming package A', packageId: A },
    { request: 'naming package B', packageId: B },
    { request: 'naming no package', packageId: undefined },
] as const;

const settle = (run: Promise<unknown>) => run.then(() => null, (e: unknown) => e as any);

async function readsAndDoor(protocol: ObjectStackProtocolImplementation, name: string, packageId: string | undefined) {
    const scope = packageId ? { packageId } : {};
    const byName: any = await protocol.getMetaItem({ type: 'view', name, ...scope });
    const layered: any = await protocol.getMetaItemLayered({ type: 'view', name, ...scope });
    const save = await settle(protocol.saveMetaItem({
        type: 'view', name, item: { name, label: 'edited', object: 'account', viewKind: 'list' }, ...scope,
    }));
    const remove = await settle(protocol.deleteMetaItem({ type: 'view', name }));
    return {
        byName: { lock: byName.lock, editable: byName.editable, deletable: byName.deletable },
        layered: { lock: layered.lock, editable: layered.editable, deletable: layered.deletable },
        body: byName.item?._lock,
        servedPackage: byName.item?._packageId,
        save: save ? { code: save.code, status: save.status, lock: save.lock } : 'admitted',
        delete: remove ? { code: remove.code, status: remove.status, lock: remove.lock } : 'admitted',
    };
}

const LOCKED_FULL = { lock: 'full', editable: false, deletable: false };
const REFUSED_FULL = { code: 'ITEM_LOCKED', status: 403, lock: 'full' };

describe('[#21803] two installed packages ship one view: the real SchemaRegistry, both registration orders', () => {
    describe('1. B ships _lock \'full\', A ships no lock', () => {
        const arrangement: Arrangement = { name: 'v_art', locks: { [A]: undefined, [B]: 'full' } };
        for (const { order, packages } of ORDERS) {
            for (const { request, packageId } of REQUESTS) {
                it(`${order} · request ${request}: both reads and the door say 'full'`, async () => {
                    const got = await readsAndDoor(protocolFor(arrangement, packages), arrangement.name, packageId);
                    expect(got.byName).toEqual(LOCKED_FULL);
                    expect(got.layered).toEqual(LOCKED_FULL);
                    expect(got.body).toBe('full');
                    // Content stays prefer-local (ADR-0048).
                    if (packageId) expect(got.servedPackage).toBe(packageId);
                    expect(got.save).toEqual(REFUSED_FULL);
                    expect(got.delete).toEqual(REFUSED_FULL);
                });
            }
        }
    });

    describe('2. B is disabled: still installed, its lock still binds', () => {
        const arrangement: Arrangement = { name: 'v_dis', locks: { [A]: undefined, [B]: 'full' }, disabled: [B] };
        for (const { order, packages } of ORDERS) {
            it(`${order} · request naming package A`, async () => {
                const protocol = protocolFor(arrangement, packages);
                const registry = (protocol as any).engine.registry as SchemaRegistry;
                expect(registry.isPackageDisabled(B)).toBe(true);
                expect(registry.listItems<{ _packageId?: string }>('view').map((i) => i._packageId)).toEqual([A]);
                const got = await readsAndDoor(protocol, arrangement.name, A);
                expect(got.byName).toEqual(LOCKED_FULL);
                expect(got.save).toEqual(REFUSED_FULL);
                expect(got.delete).toEqual(REFUSED_FULL);
            });
        }
    });

    describe('3. never a widening: A ships no lock, B ships \'no-delete\', the stored row declares \'no-overlay\'', () => {
        const arrangement: Arrangement = { name: 'v_join', locks: { [A]: undefined, [B]: 'no-delete' }, rowLock: 'no-overlay' };
        for (const { order, packages } of ORDERS) {
            for (const { request, packageId } of REQUESTS) {
                it(`${order} · request ${request}: both verbs refused, and the reads say so`, async () => {
                    const got = await readsAndDoor(protocolFor(arrangement, packages), arrangement.name, packageId);
                    expect(got.byName).toEqual(LOCKED_FULL);
                    expect(got.layered).toEqual(LOCKED_FULL);
                    expect(got.save).toEqual(REFUSED_FULL);
                    expect(got.delete).toEqual(REFUSED_FULL);
                });
            }
        }
    });
});
