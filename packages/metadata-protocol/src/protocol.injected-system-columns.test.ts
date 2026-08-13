// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6562] Every `/meta` object read exit serves the EFFECTIVE runtime schema —
 * the injected system columns included — and the write path takes them back off,
 * so nothing a read added is ever persisted.
 *
 * ## The defect
 *
 * `GET /api/v1/meta/object/:name` resolves through `sys_metadata` overlay →
 * MetadataService → SchemaRegistry, and only the last of those three has been
 * through `applySystemFields`. So an overlay-backed answer reported the
 * platform's own columns — `created_at`, `created_by`, `updated_at`,
 * `updated_by`, `organization_id`, `owner_id`, `owning_business_unit_id` — as
 * simply ABSENT, while a registry-backed answer for the same object reported
 * them present. Whether an object carries an overlay is invisible to the caller.
 * An author reading the overlay-backed answer concludes the columns do not
 * exist; every one of them is real in the database, filterable, orderable and
 * enforced read-only on write.
 *
 * Maintainer ruling (2026-08-08), Option B: the read serves the effective
 * schema, and the overlay-backed minority path converges on the registry-backed
 * majority. The ruling's three implementation constraints are the three
 * `describe` blocks below, one pin each:
 *
 *  1. injection at the READ EXITS only — `?layers=1`'s `overlay` layer stays
 *     byte-verbatim, so Studio's "what you customised" diff never shows a column
 *     nobody wrote;
 *  2. a write-side STRIP counterpart — the #4326 byte-identical GET → PUT
 *     round-trip keeps holding;
 *  3. `resolveInjectedSystemColumns` (spec, #5378) is the derivation — so every
 *     opt-out row is answered in one place and re-derived in none.
 *
 * The cross-package pin that the served answer actually EQUALS the registry's —
 * asserted against the real `SchemaRegistry` and the real `applySystemFields`,
 * in both `multiTenant` modes — is
 * `packages/objectql/src/protocol-meta-effective-schema.test.ts`. It cannot live
 * here: `@objectstack/objectql` depends on this package, so this file has no way
 * to reach the injection pass it is converging on, and a transcribed literal
 * would only compare the fix to a copy of itself.
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

const storedBody = (rows: Map<string, Row>, name: string) =>
    JSON.parse(Array.from(rows.values()).find((r) => r.name === name)!.metadata);

/**
 * An ordinary user-authored business object declaring NONE of the system
 * columns — the population the issue is about. Runtime-created (no artifact), so
 * `object`'s `allowRuntimeCreate: true` makes the overlay row genuinely
 * writable: this is the AI-authoring path, and the one where the WRITE half of
 * the invariant can be exercised end to end.
 */
const authored = (name: string) => ({
    name,
    label: 'Invoice',
    // [#8308] Authored OWD: the publish gate refuses an OWD-less custom object
    // (`security-owd-unset`) once #8310 declares `object` in `runtimeTypes`.
    sharingModel: 'private',
    fields: { amount: { type: 'currency', label: 'Amount' } },
});

/** The columns the platform provisions on such an object, absent any declaration. */
const INJECTED = [
    'created_at', 'created_by', 'updated_at', 'updated_by',
    'organization_id', 'owner_id', 'owning_business_unit_id',
] as const;

async function seed(name: string, item: Record<string, unknown> = authored(name), mode?: 'draft') {
    const { engine, rows } = makeStubEngine();
    const protocol = new ObjectStackProtocolImplementation(engine);
    await protocol.saveMetaItem({ type: 'object', name, item, ...(mode ? { mode } : {}) });
    return { protocol, rows, engine };
}

/** One `/meta` read exit: how a client gets an object document out of the protocol. */
interface Exit {
    readonly label: string;
    readonly mode?: 'draft';
    read(p: ObjectStackProtocolImplementation, name: string): Promise<Record<string, any> | undefined>;
}

const EXITS: readonly Exit[] = [
    {
        label: 'GET /meta/object/:name — single item',
        async read(p, name) { return (await p.getMetaItem({ type: 'object', name })).item as any; },
    },
    {
        label: 'GET /meta/objects/:name — the PLURAL spelling of the same route (#4432)',
        async read(p, name) { return (await (p as any).getMetaItem({ type: 'objects', name })).item; },
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
        async read(p, name) { return (await p.getMetaItemCached({ type: 'object', name }))?.data as any; },
    },
    {
        label: 'GET /meta/object/:name?layers=1 — the `effective` layer',
        async read(p, name) {
            return (await (p as any).getMetaItemLayered({ type: 'object', name }))?.effective;
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

describe('[#6562] every /meta object read exit serves the effective schema', () => {
    for (const exit of EXITS) {
        describe(exit.label, () => {
            it('reports the injected system columns the author never declared', async () => {
                const { protocol } = await seed('crm_invoice', authored('crm_invoice'), exit.mode);
                const served = await exit.read(protocol, 'crm_invoice');
                expect(served, 'the exit must actually resolve the item').toBeDefined();

                expect(Object.keys(served!.fields).sort()).toEqual(['amount', ...INJECTED].sort());
            });

            it('carries the same governance markers the registry answer carries', async () => {
                // Boundary (c) of the ruling — the `engine-audit-anchor-write`
                // pin's contract, restated on the read exits. A column reported
                // as present but writable would be the #4513 lie with an extra
                // step.
                const { protocol } = await seed('crm_invoice', authored('crm_invoice'), exit.mode);
                const served = await exit.read(protocol, 'crm_invoice');

                for (const field of AUDIT_PROVENANCE_FIELDS) {
                    expect(served!.fields[field], field).toMatchObject({ readonly: true, system: true });
                }
                expect(served!.fields.organization_id).toMatchObject({ readonly: true, system: true });
                expect(served!.fields.owning_business_unit_id).toMatchObject({ readonly: true, system: true });
                // Ownership is TRANSFERABLE — `owner_id` is the one injected
                // column that is `system` but deliberately NOT `readonly`.
                expect(served!.fields.owner_id).toMatchObject({ readonly: false, system: true });
            });

            it('leaves the author’s own fields exactly as declared', async () => {
                const { protocol } = await seed('crm_invoice', authored('crm_invoice'), exit.mode);
                const served = await exit.read(protocol, 'crm_invoice');
                expect(served!.fields.amount).toEqual({ type: 'currency', label: 'Amount' });
                expect(served!.label).toBe('Invoice');
            });
        });
    }

    it('the served document is one the spec fully accepts', async () => {
        // The read now ADDS field declarations, so the product's own `safeParse`
        // over exactly the body it just served is the check that they are
        // authorable declarations and not an internal shape leaking out.
        const { protocol } = await seed('crm_invoice');
        const served: any = (await protocol.getMetaItem({ type: 'object', name: 'crm_invoice' })).item;
        expect(served._diagnostics).toEqual({ valid: true });
    });

    it('a declared system column stays the AUTHOR’s — injection only ever adds', async () => {
        // `applySystemFields`' merge direction: `additions` LOSE to a declared
        // field of the same name. Forcing the platform definition over the
        // author's `owner_id` would be a different (and unruled) change.
        const { protocol } = await seed('crm_asset', {
            ...authored('crm_asset'),
            fields: {
                amount: { type: 'currency', label: 'Amount' },
                owner_id: { type: 'lookup', reference: 'sys_user', label: 'Responsible Engineer' },
            },
        });
        const served: any = (await protocol.getMetaItem({ type: 'object', name: 'crm_asset' })).item;
        expect(served.fields.owner_id).toEqual({
            type: 'lookup', reference: 'sys_user', label: 'Responsible Engineer',
        });
    });

    it('a non-object metadata type is never touched', async () => {
        // Gated on the metadata TYPE, not on "this document happens to have a
        // `fields` key" — nothing stops another type from carrying one, and
        // injecting columns there would invent a rule the engine does not have.
        // Seeded straight into `sys_metadata`: the subject is the READ path, and
        // a `page` body shaped like this is (correctly) refused by the save
        // path's schema.
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await engine.insert('sys_metadata', {
            type: 'page', name: 'invoice_page', organization_id: null, package_id: null,
            state: 'active',
            metadata: JSON.stringify({ name: 'invoice_page', fields: { amount: { type: 'currency' } } }),
        });
        const served: any = (await protocol.getMetaItem({ type: 'page', name: 'invoice_page' })).item;
        expect(Object.keys(served.fields)).toEqual(['amount']);
    });
});

/**
 * Ruling constraint 3: `resolveInjectedSystemColumns` (#5378) is the derivation.
 * Every row of its table is an object the platform provisions NOTHING (or less)
 * on, and the read must report exactly that — an injected column reported on an
 * object that does not carry one is the same lie pointing the other way.
 */
describe('[#6562] the opt-out rows are the spec derivation’s, re-derived nowhere', () => {
    const cases: ReadonlyArray<readonly [string, Record<string, unknown>, readonly string[]]> = [
        ['systemFields: false — the hard opt-out (seed/migration tables)',
            { systemFields: false }, []],
        ['managedBy: better-auth — better-auth owns the column layout',
            { managedBy: 'better-auth' }, []],
        ['systemFields.audit: false — no audit family',
            { systemFields: { audit: false } },
            ['organization_id', 'owner_id', 'owning_business_unit_id']],
        ['systemFields.tenant: false — no tenant anchor',
            { systemFields: { tenant: false } },
            ['created_at', 'created_by', 'updated_at', 'updated_by', 'owner_id', 'owning_business_unit_id']],
        ['tenancy.enabled: false — the schema-level shared-catalog declaration',
            { tenancy: { enabled: false } },
            ['created_at', 'created_by', 'updated_at', 'updated_by', 'owner_id', 'owning_business_unit_id']],
        ['ownership: org — no per-record ownership anchor, either tier',
            { ownership: 'org' },
            ['created_at', 'created_by', 'updated_at', 'updated_by', 'organization_id']],
        ['ownership: none — likewise',
            { ownership: 'none' },
            ['created_at', 'created_by', 'updated_at', 'updated_by', 'organization_id']],
        // Not an opt-out row — the one tier that SPLITS the two anchors
        // (ADR-0117 D1). It belongs in this table anyway: the read surface must
        // report `owner_id` as ABSENT on a unit-owned object, and serving a
        // person-owner on a row that has none is the same lie the rows above
        // guard against, pointing the other way. Authorable since #5678, so this
        // shape now arrives from authored metadata rather than only from an
        // engine-side derivation no author could reach.
        ['ownership: business_unit — the unit anchor WITHOUT owner_id',
            { ownership: 'business_unit' },
            ['created_at', 'created_by', 'updated_at', 'updated_by', 'organization_id',
                'owning_business_unit_id']],
    ];

    for (const [label, opts, expected] of cases) {
        it(label, async () => {
            const { engine } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);
            // Seeded directly: several of these bodies are deliberately shaped to
            // exercise the derivation rather than the save path's schema.
            await engine.insert('sys_metadata', {
                type: 'object', name: 'crm_invoice', organization_id: null, package_id: null,
                state: 'active',
                metadata: JSON.stringify({ ...authored('crm_invoice'), ...opts }),
            });
            const served: any = (await protocol.getMetaItem({ type: 'object', name: 'crm_invoice' })).item;
            expect(Object.keys(served.fields).sort()).toEqual(['amount', ...expected].sort());
        });
    }

    it('the `sys_*` namespace carries no ownership anchor', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await engine.insert('sys_metadata', {
            type: 'object', name: 'sys_widget', organization_id: null, package_id: null,
            state: 'active', metadata: JSON.stringify(authored('sys_widget')),
        });
        const served: any = (await protocol.getMetaItem({ type: 'object', name: 'sys_widget' })).item;
        expect(Object.keys(served.fields).sort()).toEqual(
            ['amount', 'created_at', 'created_by', 'updated_at', 'updated_by', 'organization_id'].sort(),
        );
    });

    it('the driver-provisioned primary key is NOT injected as a field', async () => {
        // `resolveInjectedSystemColumns` reports `id` unconditionally — it is
        // addressable on every object — but the injection PASS does not create a
        // field for it (`table.string('id').primary()` is the driver's), so
        // neither exit may serve one or the two answers diverge again.
        const { protocol } = await seed('crm_invoice');
        const served: any = (await protocol.getMetaItem({ type: 'object', name: 'crm_invoice' })).item;
        expect(served.fields.id).toBeUndefined();
    });
});

/**
 * Ruling constraint 1: injection happens at the read EXITS only. The `overlay`
 * layer is Studio's "what you customised" diff — an injected column appearing
 * there would report a customization nobody made.
 */
describe('[#6562] ?layers=1 — `overlay` stays byte-verbatim, `effective` is the runtime schema', () => {
    it('the overlay layer is exactly the stored row; the effective layer is injected', async () => {
        const { protocol } = await seed('crm_invoice');
        const layered: any = await (protocol as any).getMetaItemLayered({
            type: 'object', name: 'crm_invoice',
        });

        expect(Object.keys(layered.overlay.fields)).toEqual(['amount']);
        for (const c of INJECTED) {
            expect(layered.overlay.fields[c], `${c} must be absent from the overlay layer`).toBeUndefined();
        }
        expect(Object.keys(layered.effective.fields).sort()).toEqual(['amount', ...INJECTED].sort());
    });

    it('the overlay layer is byte-identical to what was persisted', async () => {
        const { protocol, rows } = await seed('crm_invoice');
        const layered: any = await (protocol as any).getMetaItemLayered({
            type: 'object', name: 'crm_invoice',
        });
        expect(layered.overlay).toEqual(storedBody(rows, 'crm_invoice'));
    });
});

/**
 * Ruling constraint 2: the write side keeps a strip counterpart, so #4326's
 * "a GET → PUT round-trip persists a byte-identical body" keeps holding.
 * `protocol.read-decorations.test.ts` owns that invariant for the DECORATIONS;
 * these are the overlay-backed object cases it did not have, because before this
 * change a read added no field declarations to strip.
 */
describe('[#6562] the write path takes back exactly what the read added (#4326)', () => {
    it('GET → PUT the whole served document stores no injected column', async () => {
        const { protocol, rows } = await seed('crm_invoice');
        const firstStored = storedBody(rows, 'crm_invoice');

        // What Studio actually holds: the SERVED document, injected columns and
        // decorations included.
        const served: any = (await protocol.getMetaItem({ type: 'object', name: 'crm_invoice' })).item;
        expect(Object.keys(served.fields).sort()).toEqual(['amount', ...INJECTED].sort()); // precondition

        // Edit one label and PUT the whole thing back, as the designer does.
        await protocol.saveMetaItem({
            type: 'object', name: 'crm_invoice', item: { ...served, label: 'Invoice (edited)' },
        });

        const stored = storedBody(rows, 'crm_invoice');
        expect(Object.keys(stored.fields)).toEqual(['amount']);
        expect('_diagnostics' in stored).toBe(false);
        expect(stored.label).toBe('Invoice (edited)');
        // Everything except the edited key is byte-identical to the first save.
        expect({ ...stored, label: firstStored.label }).toEqual(firstStored);
    });

    it('keeps the checksum stable across an injection-only round-trip', async () => {
        const { protocol, rows } = await seed('crm_lead', authored('crm_lead'));
        const before = Array.from(rows.values()).find((r) => r.name === 'crm_lead')!.checksum;

        const served: any = (await protocol.getMetaItem({ type: 'object', name: 'crm_lead' })).item;
        await protocol.saveMetaItem({ type: 'object', name: 'crm_lead', item: served });

        expect(Array.from(rows.values()).find((r) => r.name === 'crm_lead')!.checksum).toBe(before);
    });

    it('a draft read PUT back is equally clean', async () => {
        const { protocol, rows } = await seed('crm_quote', authored('crm_quote'), 'draft');
        const draft: any = (await protocol.getMetaItem({
            type: 'object', name: 'crm_quote', previewDrafts: true,
        })).item;
        expect(draft._draft).toBe(true);
        expect(draft.fields.created_at).toBeDefined();

        await protocol.saveMetaItem({ type: 'object', name: 'crm_quote', item: draft, mode: 'draft' });

        const stored = storedBody(rows, 'crm_quote');
        expect(Object.keys(stored.fields)).toEqual(['amount']);
        expect('_draft' in stored).toBe(false);
    });

    it('the strip removes ONLY the platform’s own definition, never the author’s field', async () => {
        // The exactness that makes this a strip and not a blocklist: a declared
        // `owner_id` is a real, spec-valid authored declaration, and deleting it
        // because it shares a name would destroy an author's work on every save.
        const item = {
            ...authored('crm_asset'),
            fields: {
                amount: { type: 'currency', label: 'Amount' },
                owner_id: { type: 'lookup', reference: 'sys_user', label: 'Responsible Engineer' },
            },
        };
        const { protocol, rows } = await seed('crm_asset', item);
        const served: any = (await protocol.getMetaItem({ type: 'object', name: 'crm_asset' })).item;
        await protocol.saveMetaItem({ type: 'object', name: 'crm_asset', item: served });

        const stored = storedBody(rows, 'crm_asset');
        expect(Object.keys(stored.fields).sort()).toEqual(['amount', 'owner_id']);
        expect(stored.fields.owner_id.label).toBe('Responsible Engineer');
    });

    it('a write that never saw a read is untouched', async () => {
        // The strip must be a no-op on an ordinary authored body, or it would be
        // rewriting documents nobody served.
        const { rows } = await seed('crm_invoice');
        expect(storedBody(rows, 'crm_invoice')).toEqual(authored('crm_invoice'));
    });
});
