// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8421 — the two PRODUCTION paths that re-save a row taking its type from an
 * existing `sys_metadata` row, measured against a residue row.
 *
 * The refusal this card ships closes the door that MINTS a namespace, and it
 * deliberately leaves `deleteMetaItem` open: rows written under an unrecognised
 * type BEFORE the refusal are real, nothing rewrites them on upgrade, and
 * refusing their removal would turn the accumulation the card is about into an
 * accumulation nobody can clear. Residue is re-SAVED as well as deleted, though,
 * and by the platform itself:
 *
 *  - {@link ObjectStackProtocolImplementation.migrateStoredMetadata} —
 *    `source: 'migrate-stored'`, the `os migrate meta --stored --apply` pass;
 *  - {@link ObjectStackProtocolImplementation.duplicatePackage} — the copy/clone
 *    path, which re-saves every row of a package under a new name.
 *
 * ## The two paths do NOT behave the same, and only measurement says which
 *
 * Both were read from their call sites as "would be refused". One of them is
 * not, and the reason is structural rather than lucky — which is exactly the
 * kind of claim that must be pinned rather than argued:
 *
 *  - **migrate never reaches the door.** `applyConversionsToStoredItem` keys the
 *    ADR-0087 chain on the type's MANIFEST COLLECTION (`SINGULAR_TO_PLURAL`), and
 *    an unrecognised type has none — so the body comes back untouched, the pass
 *    emits no notice, and the row is recorded `canonical` without `saveMetaItem`
 *    ever being called. An unrecognised type can never acquire a conversion
 *    chain (nothing declares one for a type the platform does not have), so this
 *    is a property of the design, not of this fixture's body.
 *  - **the copy DID reach it**, and answered
 *    `{success: false, copiedCount: 0, failedCount: 1}` — a package holding one
 *    residue row could not be duplicated at all. That contradicts the
 *    `deleteMetaItem` reasoning directly, so exempting an already-stored
 *    namespace is a repair of this change rather than a new decision.
 *
 * Every case therefore asserts the OUTCOME of the whole pass, not "it did not
 * throw": a copy that silently dropped the residue row would also not throw, and
 * would be the partial-copy-reported-as-whole defect #7819 closed.
 */
import { describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions, so the fake engine
// below cannot accept a call ObjectQL itself refuses.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

function matches(r: Record<string, any>, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (v === undefined) continue;
        // ⚠️ Conjoined with its siblings, never early-returned: a
        // `return branches.some(...)` discards every other key in the clause and
        // silently widens the match (#7846 / #7620).
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matches(r, c))) return false;
            continue;
        }
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if ((r[k] ?? null) !== v) return false;
    }
    return true;
}

/**
 * A multi-table stub engine — `sys_metadata` seeded, every other table
 * (`sys_metadata_history`, `sys_metadata_audit`, `sys_packages`) created on
 * first write. The shape `protocol.stored-migration.test.ts` uses, because the
 * claim under test is what the REAL write path does with these rows.
 */
function makeStubEngine(seedRows: Array<Record<string, any>>) {
    let nextId = 0;
    const tables = new Map<string, Record<string, any>[]>();
    tables.set('sys_metadata', seedRows.map((r) => ({
        id: `r_${++nextId}`,
        organization_id: null,
        package_id: null,
        state: 'active',
        checksum: `sha256:seed_${nextId}`,
        ...r,
        metadata: typeof r.metadata === 'string' ? r.metadata : JSON.stringify(r.metadata),
    })));
    const rowsOf = (t: string): Record<string, any>[] => {
        let rows = tables.get(t);
        if (!rows) tables.set(t, (rows = []));
        return rows;
    };
    const engine: any = {
        async find(t: string, opts?: { where?: Record<string, unknown> }) {
            return rowsOf(t).filter((r) => matches(r, opts?.where ?? {}));
        },
        async findOne(t: string, opts?: { where?: Record<string, unknown> }) {
            return rowsOf(t).find((r) => matches(r, opts?.where ?? {})) ?? null;
        },
        async insert(t: string, row: Record<string, any>) {
            const withId = { id: row.id ?? `r_${++nextId}`, ...row };
            rowsOf(t).push(withId);
            return withId;
        },
        async update(t: string, patch: Record<string, any>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(patch, opts);
            const target = rowsOf(t).find((r) => matches(r, opts.where));
            if (target) Object.assign(target, patch);
            return target ?? { id: 'x' };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            return { deleted: 0 };
        },
        async count() { return 0; },
        async transaction(fn: (ctx: unknown) => Promise<unknown>) { return fn(undefined); },
        async execute() { return {}; },
        async getObjectSchema() { return undefined; },
        registry: {
            listItems: () => [],
            isPackageDisabled: () => false,
            registerItem: () => { /* no-op */ },
            registerObject: () => { /* no-op */ },
            unregisterItem: () => { /* no-op */ },
            getItem: () => undefined,
            getArtifactItem: () => undefined,
            getPackage: () => undefined,
        },
    };
    return { engine, tables };
}

const metaRows = (tables: Map<string, Record<string, any>[]>) => tables.get('sys_metadata') ?? [];

/**
 * A row of exactly the class the card was filed about: minted through the old
 * permissive plugin path under a type the platform does not have, sitting in a
 * package alongside ordinary metadata. Seeded straight into the store, which is
 * the only way it can exist now — `saveMetaItem` refuses to create it.
 */
const RESIDUE_ROW = {
    type: 'fieldz',
    name: 'showcase_task.title',
    package_id: 'app.source',
    metadata: { name: 'showcase_task.title', label: 'Residue' },
};

/** An ordinary, recognised row in the same package — the copy's control. */
const CANONICAL_ROW = {
    type: 'view',
    name: 'showcase_task.open',
    package_id: 'app.source',
    metadata: {
        name: 'showcase_task.open',
        label: 'Open',
        object: 'showcase_task',
        viewKind: 'list',
        columns: [{ field: 'title', label: 'Title' }],
    },
};

describe('#8421 — `migrate meta --stored` and a residue row', () => {
    it('reports it canonical and writes nothing — the mint door is never reached', async () => {
        const { engine, tables } = makeStubEngine([RESIDUE_ROW]);
        const before = JSON.stringify(metaRows(tables));
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true });

        // `failed: 0` is the assertion that matters. `saveMetaItem`'s refusal
        // would land here (the pass wraps that call and records the thrown text
        // as report DATA), so a green `scanned: 1` alone would not distinguish
        // "not refused" from "not reached".
        expect(report).toMatchObject({ scanned: 1, canonical: 1, failed: 0, rewritten: 0 });
        expect(report.rows).toHaveLength(0);
        // …and the row is byte-identical, so nothing was rewritten under it.
        expect(JSON.stringify(metaRows(tables))).toBe(before);
    });

    it('still migrates a REAL legacy row in the same pass', async () => {
        // ANTI-VACUITY for the case above: this pass can and does re-save, so
        // "canonical, nothing written" is a verdict about the residue row rather
        // than a pass that does nothing at all.
        const { engine, tables } = makeStubEngine([RESIDUE_ROW, {
            type: 'object',
            name: 'crm_invoice',
            package_id: 'app.source',
            metadata: {
                name: 'crm_invoice',
                label: 'Invoice',
                fields: {
                    amount: { type: 'currency', label: 'Amount', conditionalRequired: "record.status == 'sent'" },
                },
            },
        }]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true });

        expect(report).toMatchObject({ scanned: 2, rewritten: 1, failed: 0 });
        const invoice = metaRows(tables).find((r) => r.name === 'crm_invoice')!;
        expect(JSON.parse(invoice.metadata).fields.amount.requiredWhen).toBe("record.status == 'sent'");
    });
});

describe('#8421 — `duplicatePackage` and a residue row', () => {
    it('copies it instead of failing the duplicate', async () => {
        const { engine, tables } = makeStubEngine([RESIDUE_ROW, CANONICAL_ROW]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const result = await protocol.duplicatePackage({
            sourcePackageId: 'app.source',
            targetPackageId: 'app.copy',
        });

        // Measured BEFORE the already-stored exemption:
        // `{success: false, copiedCount: 0, failedCount: 1}` with the residue
        // row's refusal text in `failed[0].error` — one pre-existing row made a
        // whole package unduplicatable.
        expect(result).toMatchObject({ success: true, copiedCount: 2, failedCount: 0 });
        expect(result.failed).toEqual([]);
        // The store, not the return value: the copy really landed under the
        // target package, with the residue type key intact.
        const copied = metaRows(tables).filter((r) => r.package_id === 'app.copy');
        expect(copied.map((r) => r.type).sort()).toEqual(['fieldz', 'view']);
    });

    it('POSITIVE CONTROL — the copy does not re-open the mint door', async () => {
        // The pair that makes the exemption a policy rather than a hole: the
        // duplicate above succeeded because `fieldz` ALREADY had a row. A type
        // nothing has ever stored is still refused, in the same store, on the
        // ordinary authoring door.
        const { engine, tables } = makeStubEngine([RESIDUE_ROW, CANONICAL_ROW]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.duplicatePackage({ sourcePackageId: 'app.source', targetPackageId: 'app.copy' });

        await expect(
            protocol.saveMetaItem({ type: 'objectt', name: 'showcase_task', item: { name: 'showcase_task' } }),
        ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
        expect(metaRows(tables).some((r) => r.type === 'objectt')).toBe(false);
    });
});
