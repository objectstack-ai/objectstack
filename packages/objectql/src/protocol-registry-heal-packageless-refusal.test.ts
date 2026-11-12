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
    const matches = (row: Record<string, unknown>, where: Record<string, unknown> = {}) =>
        Object.entries(where).every(([k, v]) => (row[k] ?? null) === v);
    const engine: Record<string, unknown> = {
        registry,
        async find(table: string, q: { where?: Record<string, unknown> } = {}) { return table === 'sys_metadata' ? rows.filter((r) => matches(r, q.where)) : []; },
        async findOne(table: string, q: { where?: Record<string, unknown> } = {}) {
            assertEngineFindOnePredicate(table, q as never);
            return table === 'sys_metadata' ? rows.find((r) => matches(r, q.where)) ?? null : null;
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
