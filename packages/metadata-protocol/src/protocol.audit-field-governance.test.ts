// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4513] Every `/meta` object read exit reports the audit family the way the
 * ENGINE enforces it — `readonly: true, system: true` — and never the
 * `readonly: false` a stored artifact/overlay body happens to declare.
 *
 * ## The defect, measured on `origin/main` before the fix
 *
 * `#4447` made the audit family engine-owned on the WRITE path: the registry's
 * `applySystemFields` forces `{ readonly: true, system: true }` over a declared
 * `created_at`, and `ObjectQL.update` strips a non-system caller's write to it.
 * The READ path never learned it — a `/meta` object read resolves through
 * `sys_metadata` overlay → MetadataService → SchemaRegistry, and only the last
 * of those three has ever been through `applySystemFields`. With the showcase's
 * materialized `created_at` (FieldSchema defaults, so `readonly: false`) stored
 * as the overlay body, all four exits answered:
 *
 * ```
 * single  read: {"type":"datetime","label":"Created At","readonly":false}
 * list    read: {"type":"datetime","label":"Created At","readonly":false}
 * cached  read: {"type":"datetime","label":"Created At","readonly":false}
 * layered read: {"type":"datetime","label":"Created At","readonly":false}
 * ```
 *
 * while a PATCH to that same field was being refused. One field, two answers,
 * and the machine-readable one — the only face a client, or an AI author
 * writing code off `/meta`, can see — was the wrong one.
 *
 * ## Why one case table and not one file per exit
 *
 * The exits are several faces of ONE contract, and the defect is that they can
 * answer differently. A per-exit file lets a future divergence hide in the file
 * nobody added a case to; driving every exit from one table means a new exit
 * that disagrees fails here, and the table is where you add it.
 *
 * `_diagnostics.valid` is asserted alongside every row on purpose: the rule
 * judges a VALUE (who may write the column), so its fixture has to be a
 * document the spec fully accepts — otherwise the row would be pinning the
 * governance of something no author could have written in the first place.
 */

import { describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions, so the fake engine
// below cannot accept a call ObjectQL refuses. From `@objectstack/metadata-core`
// and not `@objectstack/objectql`: objectql DEPENDS ON this package, so that
// import would close a cycle turbo rejects outright.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { AUDIT_PROVENANCE_FIELDS } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation } from './index.js';

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

function makeStubEngine() {
    const rows = new Map<string, Row>();
    let nextId = 0;
    const findRow = (w: Record<string, unknown>) => {
        for (const [k, r] of rows) if (matches(r, w)) return { key: k, row: r };
        return null;
    };
    const engine: any = {
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
        registry: {
            listItems: () => [],
            isPackageDisabled: () => false,
            getItem: () => undefined,
            registerItem: () => {},
            registerObject: () => {},
            getPackage: () => undefined,
        },
    };
    return { engine, rows };
}

/**
 * The showcase's built object body, verbatim in the shape that caused #4447 —
 * a MATERIALIZED audit field carrying only FieldSchema defaults. `readonly` is
 * spelled `false` on two of the four and left ABSENT on the other two, because
 * absent defaults to false as well and the read must not be right only for the
 * spelling that happens to be explicit.
 */
const artifactObject = (name: string) => ({
    name,
    label: 'Invoice',
    fields: {
        amount: { type: 'currency', label: 'Amount' },
        created_at: {
            label: 'Created At', type: 'datetime', required: false,
            searchable: false, multiple: false, unique: false,
            deleteBehavior: 'set_null', hidden: false,
            readonly: false, sortable: true, externalId: false,
        },
        created_by: { type: 'lookup', reference: 'sys_user', label: 'Created By' },
        updated_at: { type: 'datetime', label: 'Updated At', readonly: false },
        updated_by: { type: 'lookup', reference: 'sys_user', label: 'Updated By' },
    },
});

/** One `/meta` read exit: how a client gets an object document out of the protocol. */
interface Exit {
    /** The route this exit serves, so a failure names the surface a client would hit. */
    readonly label: string;
    /** Seeded before the read (draft exits need a draft row rather than an active one). */
    readonly mode?: 'draft';
    read(
        protocol: ObjectStackProtocolImplementation,
        name: string,
    ): Promise<Record<string, any> | undefined>;
}

const EXITS: readonly Exit[] = [
    {
        label: 'GET /meta/object/:name — single item',
        async read(p, name) {
            return (await p.getMetaItem({ type: 'object', name })).item as any;
        },
    },
    {
        label: 'GET /meta/objects/:name — the PLURAL spelling of the same route (#4432)',
        async read(p, name) {
            return (await (p as any).getMetaItem({ type: 'objects', name })).item;
        },
    },
    {
        label: 'GET /meta/objects — list',
        async read(p, name) {
            const list: any = await p.getMetaItems({ type: 'object' });
            return (list.items as any[]).find((i) => i?.name === name);
        },
    },
    {
        label: 'GET /meta/object/:name — cached / ETag branch',
        async read(p, name) {
            const cached: any = await p.getMetaItemCached({ type: 'object', name });
            return cached?.data;
        },
    },
    {
        label: 'GET /meta/object/:name?layers=1 — the `effective` layer',
        async read(p, name) {
            const layered: any = await (p as any).getMetaItemLayered({ type: 'object', name });
            return layered?.effective;
        },
    },
    {
        label: 'GET /meta/object/:name?preview=draft — draft overlaid on active',
        mode: 'draft',
        async read(p, name) {
            return (await p.getMetaItem({ type: 'object', name, previewDrafts: true })).item as any;
        },
    },
    {
        label: 'GET /meta/object/:name?state=draft — the strict draft read',
        mode: 'draft',
        async read(p, name) {
            return (await p.getMetaItem({ type: 'object', name, state: 'draft' })).item as any;
        },
    },
];

async function seed(mode: 'active' | 'draft', name: string) {
    const { engine, rows } = makeStubEngine();
    const protocol = new ObjectStackProtocolImplementation(engine);
    await protocol.saveMetaItem({
        type: 'object', name, item: artifactObject(name),
        ...(mode === 'draft' ? { mode: 'draft' as const } : {}),
    });
    return { protocol, rows };
}

describe('[#4513] the /meta read surface agrees with the enforced write behaviour', () => {
    for (const exit of EXITS) {
        describe(exit.label, () => {
            it('reports every audit-provenance field as engine-owned', async () => {
                const { protocol } = await seed(exit.mode ?? 'active', 'crm_invoice');
                const served = await exit.read(protocol, 'crm_invoice');
                expect(served, 'the exit must actually resolve the item').toBeDefined();

                for (const field of AUDIT_PROVENANCE_FIELDS) {
                    expect(
                        served!.fields[field],
                        `${field} is stripped from a non-system caller's write; the read must say so`,
                    ).toMatchObject({ readonly: true, system: true });
                }
            });

            it('keeps every non-governance key the author declared', async () => {
                const { protocol } = await seed(exit.mode ?? 'active', 'crm_invoice');
                const served = await exit.read(protocol, 'crm_invoice');
                // Governance is `readonly` + `system` and nothing else — the
                // author's presentation and storage shape survive untouched.
                expect(served!.fields.created_at).toMatchObject({
                    label: 'Created At', type: 'datetime', sortable: true, required: false,
                });
                expect(served!.fields.created_by).toMatchObject({
                    type: 'lookup', reference: 'sys_user', label: 'Created By',
                });
                // …and an ordinary business field is not touched at all.
                expect(served!.fields.amount).toEqual({ type: 'currency', label: 'Amount' });
            });
        });
    }

    it('the governed document is one the spec fully accepts', async () => {
        // The rule judges a VALUE, so the fixture has to parse green — otherwise
        // every row above would be pinning the writability of a document no
        // author could have written. `_diagnostics` is the product's own
        // `safeParse` over exactly the body it just served.
        const { protocol } = await seed('active', 'crm_invoice');
        const served: any = (await protocol.getMetaItem({ type: 'object', name: 'crm_invoice' })).item;
        expect(served._diagnostics).toEqual({ valid: true });
    });

    it('an object that opts OUT of the audit family is left exactly as declared', async () => {
        // The mirror row. `systemFields: { audit: false }` makes
        // `applySystemFields` skip the family entirely, so the engine enforces
        // NOTHING on this object's `created_at` — and a read that forced
        // `readonly: true` here would be the same lie pointing the other way.
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const optedOut = {
            ...artifactObject('legacy_ledger'),
            systemFields: { audit: false },
        };
        await protocol.saveMetaItem({ type: 'object', name: 'legacy_ledger', item: optedOut });

        const served: any = (await protocol.getMetaItem({ type: 'object', name: 'legacy_ledger' })).item;
        expect(served.fields.created_at.readonly).toBe(false);
        expect(served.fields.created_at.system).toBeUndefined();
        expect(served.fields.created_by.readonly).toBeUndefined();
    });

    it('a non-object metadata type is never touched', async () => {
        // The governance is an OBJECT-schema contract, so the normalizer is
        // gated on the metadata TYPE and not on "this document happens to have
        // a `fields` key" — nothing stops another type from carrying one, and
        // rewriting it there would be inventing a rule the engine does not have.
        //
        // Seeded straight into `sys_metadata` rather than through
        // `saveMetaItem`: the subject here is the READ path, and a `page` body
        // shaped like this is (correctly) refused by the save path's schema, so
        // going through it would only measure that refusal.
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const stored = {
            name: 'invoice_page',
            fields: { created_at: { type: 'datetime', label: 'Created At', readonly: false } },
        };
        await engine.insert('sys_metadata', {
            type: 'page', name: 'invoice_page', organization_id: null, package_id: null,
            state: 'active', metadata: JSON.stringify(stored),
        });

        const served: any = (await protocol.getMetaItem({ type: 'page', name: 'invoice_page' })).item;
        expect(served.fields.created_at).toEqual({
            type: 'datetime', label: 'Created At', readonly: false,
        });
    });
});

describe('[#4513] the served correction does not become a phantom customization', () => {
    it('the overlay row keeps what the author actually stored', async () => {
        // The read reports the EFFECTIVE value; `sys_metadata` keeps the
        // author's declaration. Collapsing the two would make the layered
        // read's `code` vs `overlay` diff report a customization nobody made.
        const { protocol, rows } = await seed('active', 'crm_invoice');
        await protocol.getMetaItem({ type: 'object', name: 'crm_invoice' });

        const stored = JSON.parse(Array.from(rows.values()).find((r) => r.name === 'crm_invoice')!.metadata);
        expect(stored.fields.created_at.readonly).toBe(false);
        expect(stored.fields.created_at.system).toBeUndefined();
    });

    it('the layered read still shows the raw `code`/`overlay` layers beside the governed `effective`', async () => {
        const { protocol } = await seed('active', 'crm_invoice');
        const layered: any = await (protocol as any).getMetaItemLayered({
            type: 'object', name: 'crm_invoice',
        });
        // The diagnostic's whole point is seeing the layers as they are…
        expect(layered.overlay.fields.created_at.readonly).toBe(false);
        // …while `effective` keeps its documented promise of being what
        // `getMetaItem` would return.
        expect(layered.effective.fields.created_at).toMatchObject({ readonly: true, system: true });
    });
});
