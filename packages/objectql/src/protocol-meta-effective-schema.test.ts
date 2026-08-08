// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6562] THE core pin: `GET /api/v1/meta/object/:name` reports the SAME field
 * set whichever link of its resolution chain produced the answer.
 *
 * ## The defect, measured on `origin/main` before the fix
 *
 * The read resolves through `sys_metadata` overlay → MetadataService →
 * SchemaRegistry, and only the last of those three has been through
 * `applySystemFields`. So for one object, with one authored body:
 *
 * ```
 * registry-backed fields: [amount, created_at, created_by, organization_id,
 *                          owner_id, owning_business_unit_id, updated_at, updated_by]
 * overlay-backed  fields: [amount]
 * ```
 *
 * Whether an object carries an overlay is invisible to the caller, so the same
 * request reported the platform's own columns or not and nothing said which had
 * happened. An author reading the overlay-backed answer concludes `created_at`
 * and `owner_id` do not exist — while every one of them is real in the database,
 * filterable, orderable, and enforced read-only on write. Maintainer ruling
 * (2026-08-08), Option B: the read serves the EFFECTIVE runtime schema, and the
 * overlay-backed minority path converges on the registry-backed majority.
 *
 * ## Why this file lives in `@objectstack/objectql`
 *
 * The convergence is a claim about TWO producers agreeing, and only this package
 * has both: the real `SchemaRegistry.registerObject` (hence the real
 * `applySystemFields`) on one side, and the real protocol read on the other. A
 * pin written in `@objectstack/metadata-protocol` would have to transcribe the
 * registry's answer into a literal and would then be comparing the fix to a copy
 * of itself. Here the registry-backed answer is produced by the engine, live, in
 * both `multiTenant` modes — so the day the injection table and the injection
 * pass disagree, this fails.
 *
 * The exit-by-exit and boundary pins (`?layers=1`, the #4326 round-trip, the
 * opt-out rows) live next to the read path itself, in
 * `packages/metadata-protocol/src/protocol.injected-system-columns.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
// [#5619] The producer's OWN write-verb dispatch decisions, so the fake engine
// below cannot accept a call ObjectQL refuses.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SchemaRegistry } from './registry.js';

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

function matches(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (v === undefined) continue;
        if ((r as any)[k] !== v) return false;
    }
    return true;
}

function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

/**
 * A `sys_metadata` store over a real {@link SchemaRegistry} — the two layers
 * whose disagreement is the subject.
 */
function makeHost(multiTenant: boolean) {
    const registry = new SchemaRegistry({ multiTenant });
    const rows = new Map<string, Row>();
    let nextId = 0;
    const findRow = (w: Record<string, unknown>) => {
        for (const [k, r] of rows) if (matches(r, w)) return { key: k, row: r };
        return null;
    };
    const engine: any = {
        registry,
        async findOne(_t: string, opts: { where: Record<string, unknown> }) {
            return findRow(opts.where)?.row ?? null;
        },
        async find(_t: string, opts: { where: Record<string, unknown> }) {
            return Array.from(rows.values()).filter((r) => matches(r, opts.where));
        },
        async insert(table: string, data: Record<string, unknown>) {
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
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() { /* no DDL in this stub */ },
        async count() { return 0; },
        async aggregate() { return []; },
    };
    return { registry, engine, rows, protocol: new ObjectStackProtocolImplementation(engine) };
}

/**
 * An ordinary user-authored business object that declares NONE of the system
 * columns — the case the issue is about. `ownership` is left omitted so the
 * default (`user`) tier applies and both ownership anchors are injected.
 */
const authored = () => ({
    name: 'crm_invoice',
    label: 'Invoice',
    fields: { amount: { type: 'currency', label: 'Amount' } },
});

const namesOf = (doc: any): string[] => Object.keys(doc.fields).sort();

/**
 * Every `(field, key)` on which the two answers disagree.
 *
 * Computed rather than enumerated: the test below asserts the WHOLE list, so a
 * NEW divergence — a key one producer grows and the other does not — fails here
 * by name instead of hiding behind an assertion that only checked the keys
 * somebody thought to list.
 */
function divergences(a: any, b: any): string[] {
    const out: string[] = [];
    const fields = new Set([...Object.keys(a.fields), ...Object.keys(b.fields)]);
    for (const f of [...fields].sort()) {
        const fa = (a.fields[f] ?? {}) as Record<string, unknown>;
        const fb = (b.fields[f] ?? {}) as Record<string, unknown>;
        for (const k of [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort()) {
            if (fa[k] !== fb[k]) out.push(`${f}.${k}`);
        }
    }
    return out;
}

describe.each([true, false])('[#6562] /meta object read — effective schema (multiTenant: %s)', (multiTenant) => {
    /**
     * Read the object registry-backed, then let an overlay row shadow it and read
     * again. ONE object, ONE authored body, one endpoint — which is exactly the
     * sentence the issue makes, so it is exactly what the fixture reproduces.
     */
    async function bothAnswers() {
        const host = makeHost(multiTenant);
        host.registry.registerObject(authored() as any, 'app.crm');

        const registryBacked: any = (await host.protocol.getMetaItem({
            type: 'object', name: 'crm_invoice',
        })).item;
        const registryBackedList: any = ((await host.protocol.getMetaItems({ type: 'object' })).items as any[])
            .find((i) => i?.name === 'crm_invoice');

        // The customization row: the SAME authored body, stored verbatim, and
        // from here on it wins over the registry entry it shadows.
        //
        // Seeded straight into `sys_metadata` rather than through
        // `saveMetaItem` — the same reason #4513's `page` row is, and the reason
        // is the point of this file: the subject here is the READ path, and
        // `object` carries `allowOrgOverride: false`, so a save over an
        // ARTIFACT-backed object is (correctly) refused with `NOT_OVERRIDABLE`
        // and going through it would only measure that refusal. The rows this
        // shape stands for are real and reachable three ways: a runtime-created
        // (artifact-free) object — `allowRuntimeCreate: true`, the AI-authoring
        // path the issue's "why it matters" is about — a MetadataService body,
        // and any deployment listing `object` in `OS_METADATA_WRITABLE`. The
        // WRITE half is exercised on the runtime-created path in
        // `packages/metadata-protocol/src/protocol.injected-system-columns.test.ts`.
        await host.engine.insert('sys_metadata', {
            type: 'object', name: 'crm_invoice', organization_id: null, package_id: null,
            state: 'active', metadata: JSON.stringify(authored()),
        });

        const overlayBacked: any = (await host.protocol.getMetaItem({
            type: 'object', name: 'crm_invoice',
        })).item;
        const overlayBackedList: any = ((await host.protocol.getMetaItems({ type: 'object' })).items as any[])
            .find((i) => i?.name === 'crm_invoice');

        return { host, registryBacked, registryBackedList, overlayBacked, overlayBackedList };
    }

    it('getMetaItem: the overlay-backed answer reports the registry-backed field set', async () => {
        const { registryBacked, overlayBacked } = await bothAnswers();

        // The precondition, stated so a reader can see the fixture is the real
        // case: the author declared exactly one field.
        expect(Object.keys(authored().fields)).toEqual(['amount']);

        expect(namesOf(overlayBacked)).toEqual(namesOf(registryBacked));
        expect(namesOf(overlayBacked)).toEqual([
            'amount',
            'created_at', 'created_by',
            'organization_id',
            'owner_id', 'owning_business_unit_id',
            'updated_at', 'updated_by',
        ]);
    });

    it('getMetaItems: the LIST exit converges too', async () => {
        const { registryBackedList, overlayBackedList } = await bothAnswers();
        expect(overlayBackedList, 'the list must actually serve the object').toBeDefined();
        expect(namesOf(overlayBackedList)).toEqual(namesOf(registryBackedList));
    });

    it('the injected columns carry the SAME metadata the registry answer carries', async () => {
        const { registryBacked, overlayBacked } = await bothAnswers();

        // The whole disagreement, computed. `organization_id.indexed` is the ONE
        // residual entry and it is not this issue's: `indexed` is not a
        // `FieldSchema` key at all — removed in the 16.x line (#2377, ADR-0049)
        // and rejected BY NAME by the strict schema — so `applySystemFields`
        // stamping it is why a registry-backed read already answers
        // `_diagnostics: { valid: false }` (pinned below, filed as #6810). Its
        // only consumer is `driver-mongodb`'s schema builder, which reads the
        // REGISTERED schema and never a served document. Converging the served
        // answer onto a key the object schema refuses would have spread that
        // defect instead of closing this one.
        expect(divergences(registryBacked, overlayBacked)).toEqual(['organization_id.indexed']);

        // …and the markers the `engine-audit-anchor-write` pin is about, spelled
        // out so a failure names the contract rather than a key list.
        for (const f of ['created_at', 'created_by', 'updated_at', 'updated_by'] as const) {
            expect(overlayBacked.fields[f], f).toMatchObject({ readonly: true, system: true });
        }
        expect(overlayBacked.fields.organization_id).toMatchObject({
            type: 'lookup', reference: 'sys_organization', readonly: true, system: true, hidden: true,
        });
        // Ownership is TRANSFERABLE, so `owner_id` is `system` but deliberately
        // not `readonly` — the one injected column that is not.
        expect(overlayBacked.fields.owner_id).toMatchObject({
            type: 'lookup', reference: 'sys_user', readonly: false, system: true,
        });
        expect(overlayBacked.fields.owning_business_unit_id).toMatchObject({
            type: 'lookup', reference: 'sys_business_unit', readonly: true, system: true, hidden: true,
        });
    });

    it('multiTenant moves the INDEX, never the field set', async () => {
        // `resolveInjectedSystemColumns` says so in its header and
        // `injected-system-columns-parity.test.ts` pins it for the injection
        // pass; this is the same fact one layer up, on the SERVED document —
        // which is why nothing in the read path takes a `multiTenant` input.
        const { registryBacked, overlayBacked } = await bothAnswers();
        expect(namesOf(registryBacked)).toContain('organization_id');
        expect(overlayBacked.fields.organization_id.indexed).toBeUndefined();
        expect(registryBacked.fields.organization_id.indexed).toBe(multiTenant);
    });

    it('the served correction never becomes a phantom customization', async () => {
        // The read reports the EFFECTIVE schema; `sys_metadata` keeps what the
        // author actually stored. Collapsing the two would make the layered
        // read's `code` vs `overlay` diff report seven columns nobody declared,
        // and would break the #4326 byte-identical round-trip.
        const { host } = await bothAnswers();
        await host.protocol.getMetaItem({ type: 'object', name: 'crm_invoice' });
        await host.protocol.getMetaItems({ type: 'object' });
        const stored = JSON.parse(Array.from(host.rows.values()).find((r) => r.name === 'crm_invoice')!.metadata);
        expect(Object.keys(stored.fields)).toEqual(['amount']);
        // …and the object the registry holds is still the registry's own, not a
        // read-hydrated copy of the overlay.
        expect(Object.keys((host.registry.getObject('crm_invoice') as any).fields).sort())
            .toContain('organization_id');
    });

    it('[residual, filed as #6810] only the registry-backed answer fails its own schema', async () => {
        // Not a defect this PR introduces and not one it papers over: the
        // registry stamps `indexed`, `FieldSchema` rejects it by name, so the
        // registry-backed exit has been answering `valid: false` on every
        // multi-tenant-capable object since #4001 closed the schema. Pinned in
        // both directions so #6810's fix at the injection site has to come back
        // and flip these lines, rather than leave a stale expectation behind.
        const { registryBacked, overlayBacked } = await bothAnswers();
        expect(overlayBacked._diagnostics).toEqual({ valid: true });
        expect(registryBacked._diagnostics.valid).toBe(false);
        expect(registryBacked._diagnostics.errors[0]).toMatchObject({
            path: 'fields.organization_id',
            code: 'unrecognized_keys',
        });
    });
});
