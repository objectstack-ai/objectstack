// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4636 PR1 — the object-overlay WRITE path keys SchemaRegistry ownership by
 * the row's REAL package id, and stamps `_provenance: 'org'` server-side.
 *
 * ## What was wrong
 *
 * `applyObjectRegistryMutation` hard-wrote `'sys_metadata'` as the ownership
 * key for every object write. The ownership key IS the package-filter key
 * (`getAllObjects(packageId)` matches `contributor.packageId`), so an object
 * created through Studio's package workspace was invisible to its own
 * package's filter, and the boot re-hydration (#4636 PR2) could not be fixed
 * to use the real id without the two sides then fighting over the same object:
 * one registered `app.<slug>`, the other `'sys_metadata'`, and `registerObject`
 * throws `already owned by package …` on the second claim.
 *
 * ## Why the provenance stamp is in the same PR and not a follow-up
 *
 * Moving the key alone re-creates cloud#970. `applyProtection` stamps
 * `_provenance: 'package'` on any body handed to `registerObject` with a
 * package id and no provenance of its own; `getArtifactItem` reads exactly
 * that, `isArtifactBacked` turns true, and `object` declares
 * `allowOrgOverride: false` — so the NEXT save of the object the user just
 * created answers `403 not_overridable`. The B-minimal counter-example below
 * reproduces that on the real registry, so the stamp is pinned by the failure
 * it prevents rather than by a comment.
 *
 * The stamp is applied to a COPY, server-side, overriding whatever the body
 * carried: `metadata-read-decorations.ts` deliberately does not strip
 * `_provenance`, so a Studio GET → PUT round-trip echoes it back and a
 * consumer that trusted the request would be trusting its own output.
 *
 * This file lives in `@objectstack/objectql` and not next to the code it
 * tests because the assertion is about the REAL `SchemaRegistry` —
 * ownership clashes, `applyProtection`'s provenance defaulting,
 * `getAllObjects` filtering. `@objectstack/objectql` depends on
 * `@objectstack/metadata-protocol`, so only this direction can hold both
 * halves; the reverse import would close a cycle turbo rejects.
 */

import { describe, expect, it } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';
// [#4550 / #5480] The producer's OWN write-verb dispatch decisions, so this
// double cannot accept a call `ObjectQL.delete` / `ObjectQL.update` refuses.
import { assertEngineDeleteDispatch } from './engine-delete-dispatch.js';
import { assertEngineUpdateDispatch } from './engine-update-dispatch.js';

/** A Studio authoring workspace id — writable under ADR-0070. */
const APP_PKG = 'app.myapp';
const OTHER_PKG = 'app.otherapp';
/** The key a package-less overlay write keeps. */
const SENTINEL = 'sys_metadata';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum?: string;
    version?: number;
}

/** `sys_metadata_history` — the lineage `rollbackMetaItem` resolves through. */
interface HistoryRow {
    id: string;
    event_seq: number;
    type: string;
    name: string;
    version: number;
    operation_type: string;
    metadata: string | null;
    checksum: string | null;
    organization_id: string | null;
    recorded_at: string;
}

function matches(r: Record<string, unknown>, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (v === undefined) continue;
        if ((r as any)[k] !== v) return false;
    }
    return true;
}

function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

function makeHarness() {
    const registry = new SchemaRegistry({ multiTenant: false });
    registry.logLevel = 'silent';
    const rows = new Map<string, Row>();
    const historyRows: HistoryRow[] = [];
    const synced: string[] = [];
    let nextId = 0;
    const findRow = (w: Record<string, unknown>) => {
        for (const [k, r] of rows) if (matches(r, w)) return { key: k, row: r };
        return null;
    };
    const engine: any = {
        registry,
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matches(h as any, opts.where)) ?? null;
            }
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') {
                return historyRows.filter((h) => matches(h as any, opts.where));
            }
            return Array.from(rows.values()).filter((r) => matches(r, opts.where));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_history') {
                const h = { id: `h_${++nextId}`, ...(data as any) } as HistoryRow;
                historyRows.push(h);
                return { id: h.id };
            }
            if (table !== 'sys_metadata') return { id: 'side_table' };
            const row = { id: `r_${++nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            if (table !== 'sys_metadata') return { id: null };
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            return { deleted: 0 };
        },
        async syncObjectSchema(name: string) { synced.push(name); },
    };
    // A PROJECT kernel (`environmentId` set) — the topology cloud#970 was
    // reported on, and the only one where `saveMetaItem`'s overlay gate is
    // engaged at all.
    const protocol = new ObjectStackProtocolImplementation(engine, undefined, 'env_test');
    // `engine` is returned so a test can wrap a verb and stage a REAL concurrent
    // write between two of the protocol's reads (see the #6215 conflict pin) —
    // the only way the optimistic lock can still refuse a rollback now that the
    // parent hash and the write scope come from the same row.
    return { registry, protocol, rows, historyRows, synced, engine };
}

function objectBody(name: string, extra?: Record<string, unknown>): ServiceObject {
    return {
        name,
        label: 'Invoice',
        fields: {
            name: { name: 'name', type: 'text', label: 'Name' },
            amount: { name: 'amount', type: 'number', label: 'Amount' },
        },
        ...extra,
    };
}

/** The owning contributor recorded for `name` (no namespace → fqn === name). */
const owner = (registry: SchemaRegistry, name: string) =>
    registry.getObjectOwner(name);

describe('#4636 — object write path keys ownership by the real package id', () => {
    it('records the request packageId as the contributor, not the sentinel', async () => {
        const { registry, protocol } = makeHarness();

        const res = await protocol.saveMetaItem({
            type: 'object',
            name: 'myapp_invoice',
            packageId: APP_PKG,
            item: objectBody('myapp_invoice'),
        });

        expect(res.success).toBe(true);
        expect(owner(registry, 'myapp_invoice')?.packageId).toBe(APP_PKG);
    });

    it('keeps the sentinel for a package-less write', async () => {
        const { registry, protocol } = makeHarness();

        await protocol.saveMetaItem({
            type: 'object',
            name: 'global_invoice',
            item: objectBody('global_invoice'),
        });

        expect(owner(registry, 'global_invoice')?.packageId).toBe(SENTINEL);
    });

    it('getAllObjects(packageId) sees a just-created object on the FIRST save', async () => {
        const { registry, protocol } = makeHarness();

        await protocol.saveMetaItem({
            type: 'object',
            name: 'myapp_invoice',
            packageId: APP_PKG,
            item: objectBody('myapp_invoice'),
        });

        // The sidebar package filter (runtime `meta.ts` → `getAllObjects`).
        // Pre-fix this was empty until something re-registered the object.
        expect(registry.getAllObjects(APP_PKG).map((o: any) => o.name)).toEqual(['myapp_invoice']);
        // …and it does NOT leak into another package's filter.
        expect(registry.getAllObjects(OTHER_PKG)).toEqual([]);
    });
});

describe('#4636 — `_provenance: \'org\'` is stamped by the SERVER', () => {
    it('stamps org provenance when the body carries none', async () => {
        const { registry, protocol } = makeHarness();

        await protocol.saveMetaItem({
            type: 'object',
            name: 'myapp_invoice',
            packageId: APP_PKG,
            item: objectBody('myapp_invoice'),
        });

        expect((owner(registry, 'myapp_invoice')?.definition as any)?._provenance).toBe('org');
    });

    it('OVERRIDES a client-supplied `_provenance: \'package\'` — the request never wins', async () => {
        const { registry, protocol } = makeHarness();

        // The exact shape a Studio GET → PUT round-trip can produce:
        // `metadata-read-decorations.ts` does not strip `_provenance`, so the
        // served document hands it back to the write.
        await protocol.saveMetaItem({
            type: 'object',
            name: 'myapp_invoice',
            packageId: APP_PKG,
            item: objectBody('myapp_invoice', { _provenance: 'package' }),
        });

        expect((owner(registry, 'myapp_invoice')?.definition as any)?._provenance).toBe('org');
    });

    it('does not write the registry stamps back onto the caller\'s body', async () => {
        const { protocol } = makeHarness();
        const item = objectBody('myapp_invoice');

        await protocol.saveMetaItem({
            type: 'object',
            name: 'myapp_invoice',
            packageId: APP_PKG,
            item,
        });

        // The stamp lands on a COPY: the persisted body (and the caller's
        // object) keep exactly what the author wrote.
        expect((item as any)._provenance).toBeUndefined();
        expect((item as any)._packageId).toBeUndefined();
    });
});

describe('#4636 — cloud#970 counter-example: a freshly created app stays editable', () => {
    it('a second save of the same package-bound object SUCCEEDS and evolves the schema', async () => {
        const { registry, protocol, rows } = makeHarness();

        await protocol.saveMetaItem({
            type: 'object',
            name: 'myapp_invoice',
            packageId: APP_PKG,
            item: objectBody('myapp_invoice'),
        });

        // The edit a user makes one minute later: add a field.
        const evolved = objectBody('myapp_invoice');
        (evolved.fields as any).due_date = { name: 'due_date', type: 'date', label: 'Due' };
        const second = await protocol.saveMetaItem({
            type: 'object',
            name: 'myapp_invoice',
            packageId: APP_PKG,
            item: evolved,
        });

        expect(second.success).toBe(true);
        // In memory: the registry serves the evolved schema, so CRUD on the
        // new field works without a restart.
        expect(Object.keys((registry.getObject('myapp_invoice') as any).fields)).toContain('due_date');
        // On disk: one row, still bound to its package, carrying the new body.
        const stored = Array.from(rows.values()).filter((r) => r.name === 'myapp_invoice');
        expect(stored).toHaveLength(1);
        expect(stored[0].package_id).toBe(APP_PKG);
        expect(Object.keys(JSON.parse(stored[0].metadata).fields)).toContain('due_date');
    });

    it('B-minimal counter-example: the SAME key without the stamp answers 403 not_overridable', async () => {
        const { registry, protocol } = makeHarness();

        // Exactly what `applyObjectRegistryMutation` would do if it moved the
        // ownership key and left the provenance stamp out — the shape measured
        // as "B-minimal" on this issue. Nothing else about the run differs.
        registry.registerObject(objectBody('myapp_invoice'), APP_PKG);

        await expect(protocol.saveMetaItem({
            type: 'object',
            name: 'myapp_invoice',
            packageId: APP_PKG,
            item: objectBody('myapp_invoice'),
        })).rejects.toThrow(/not_overridable/);

        // The mechanism, stated so a future reader does not have to re-derive
        // it: with no `_provenance`, `applyProtection` defaults the row to
        // package provenance, and the registry then answers "code artifact".
        expect((owner(registry, 'myapp_invoice')?.definition as any)?._provenance).toBe('package');
    });
});

describe('#4636 — rollback re-registers under the row\'s own package binding', () => {
    it('resolves the ownership key from the ROW: a package-less rollback keeps the sentinel', async () => {
        const { registry, protocol } = makeHarness();

        await protocol.saveMetaItem({
            type: 'object',
            name: 'global_invoice',
            item: objectBody('global_invoice'),
        });
        const evolved = objectBody('global_invoice');
        (evolved.fields as any).due_date = { name: 'due_date', type: 'date', label: 'Due' };
        await protocol.saveMetaItem({
            type: 'object',
            name: 'global_invoice',
            item: evolved,
        });

        const back = await protocol.rollbackMetaItem({
            type: 'object',
            name: 'global_invoice',
            toVersion: 1,
        });

        expect(back.success).toBe(true);
        // `rollbackMetaItem` has no `packageId` parameter — the key comes from
        // the row, which here has none, so the sentinel is the right answer and
        // the registry serves the restored body.
        expect(owner(registry, 'global_invoice')?.packageId).toBe(SENTINEL);
        expect(Object.keys((registry.getObject('global_invoice') as any).fields)).not.toContain('due_date');
        expect((owner(registry, 'global_invoice')?.definition as any)?._provenance).toBe('org');
    });

    /**
     * #6215 — the flipped tripwire.
     *
     * This test used to assert the DEFECT (`[tripwire] a package-bound
     * rollback still 409s`): `SysMetadataRepository.restoreVersion` called
     * `put` with no `packageId`, `put` scoped its existing-row lookup with
     * `whereFor(ref, state, opts.packageId ?? null)`, and `null` is a
     * PREDICATE (`package_id IS NULL`) rather than "any package" — so the
     * lookup missed the package-bound row it was restoring, read its parent
     * hash as null, and every rollback of a package-bound row answered 409
     * before any registry write-through ran.
     *
     * `restoreVersion` now reads the raw active row and threads its
     * `package_id` into `put`, so this is the assertion #4636 PR1 staged one
     * test up, on the half that was unreachable then: the package-bound key,
     * carried through a real rollback.
     */
    it('resolves the ownership key from the ROW: a package-bound rollback keeps its package id', async () => {
        const { registry, protocol, rows } = makeHarness();

        await protocol.saveMetaItem({
            type: 'object',
            name: 'myapp_invoice',
            packageId: APP_PKG,
            item: objectBody('myapp_invoice'),
        });
        const evolved = objectBody('myapp_invoice');
        (evolved.fields as any).due_date = { name: 'due_date', type: 'date', label: 'Due' };
        await protocol.saveMetaItem({
            type: 'object',
            name: 'myapp_invoice',
            packageId: APP_PKG,
            item: evolved,
        });

        const back = await protocol.rollbackMetaItem({
            type: 'object',
            name: 'myapp_invoice',
            toVersion: 1,
        });

        expect(back.success).toBe(true);
        // The write-through half: the restored body is re-registered under the
        // row's OWN package id, never the sentinel, so the package filter that
        // `saveMetaItem` populates keeps matching after a rollback…
        expect(owner(registry, 'myapp_invoice')?.packageId).toBe(APP_PKG);
        expect(registry.getAllObjects(APP_PKG).map((o: any) => o.name)).toEqual(['myapp_invoice']);
        // …and the registry serves the RESTORED body, not the one being reverted.
        expect(Object.keys((registry.getObject('myapp_invoice') as any).fields)).not.toContain('due_date');
        // Same stamp as every other org write — a rollback is not a package install.
        expect((owner(registry, 'myapp_invoice')?.definition as any)?._provenance).toBe('org');
        // The defect's SECOND face: the lookup that missed the bound row would,
        // had the parent check passed, have INSERTED an unbound duplicate
        // instead of updating it. One row, still bound, carrying v1's body.
        // (`sys_metadata`'s partial unique index keys on
        // `COALESCE(package_id,'')`, so the duplicate would survive a real DB.)
        const stored = Array.from(rows.values()).filter((r) => r.name === 'myapp_invoice');
        expect(stored).toHaveLength(1);
        expect(stored[0].package_id).toBe(APP_PKG);
        expect(Object.keys(JSON.parse(stored[0].metadata).fields)).not.toContain('due_date');
    });

    /**
     * The refusal that must SURVIVE the fix. `rollbackMetaItem`'s 409 is not
     * retired — it is narrowed to the case it always claimed to report: the row
     * really did advance between the rollback's parent read and its write.
     *
     * Staging that needs a real interleaving, because the parent hash and the
     * write scope now come from the SAME read: the engine's `findOne` is
     * wrapped to hand the rollback a snapshot of the active row and, in the
     * same breath, let a concurrent publish land on the stored row. If the trap
     * never fires the rollback succeeds and this test goes red — it cannot rot
     * into a green that asserts nothing.
     */
    it('still refuses (METADATA_CONFLICT / 409) when the package-bound row REALLY advanced', async () => {
        const { protocol, engine, rows } = makeHarness();

        await protocol.saveMetaItem({
            type: 'object',
            name: 'myapp_invoice',
            packageId: APP_PKG,
            item: objectBody('myapp_invoice'),
        });
        const evolved = objectBody('myapp_invoice');
        (evolved.fields as any).due_date = { name: 'due_date', type: 'date', label: 'Due' };
        await protocol.saveMetaItem({
            type: 'object',
            name: 'myapp_invoice',
            packageId: APP_PKG,
            item: evolved,
        });

        const realFindOne = engine.findOne.bind(engine);
        // The concurrent publish lands between `restoreVersion`'s parent read
        // and `put`'s optimistic-lock read. That second read is identified by
        // the one property only it has — it runs INSIDE the write transaction,
        // so the engine call carries a `context` — rather than by counting
        // reads, which would silently stop covering anything the day a read is
        // added to the rollback path.
        let fired = false;
        engine.findOne = async (table: string, opts: Record<string, any>) => {
            const row = await realFindOne(table, opts);
            if (!fired && table === 'sys_metadata' && row && 'context' in opts && opts.where?.state === 'active') {
                fired = true;
                (row as any).checksum = `sha256:${'a'.repeat(64)}`; // someone else published
            }
            return row;
        };

        await expect(protocol.rollbackMetaItem({
            type: 'object',
            name: 'myapp_invoice',
            toVersion: 1,
        })).rejects.toMatchObject({ code: 'METADATA_CONFLICT', status: 409 });
        expect(fired).toBe(true);
        // The refusal is total: the stored row still carries the body the
        // concurrent writer left, and no unbound duplicate was created.
        const stored = Array.from(rows.values()).filter((r) => r.name === 'myapp_invoice');
        expect(stored).toHaveLength(1);
        expect(stored[0].package_id).toBe(APP_PKG);
        expect(Object.keys(JSON.parse(stored[0].metadata).fields)).toContain('due_date');
    });
});
