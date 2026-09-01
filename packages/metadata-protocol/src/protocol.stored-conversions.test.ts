// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3903 — stored `sys_metadata` rows replay the FULL ADR-0087 conversion
 * chain at rehydration.
 *
 * Every seam that turns a row's `metadata` JSON into an in-memory item
 * (`loadMetaFromDb`, `getMetaItems`, `getMetaItem`) canonicalizes it first —
 * including `retiredFromLoadPath` entries, because a row at rest has no
 * author for a tombstone to teach: the alias that protocol 17 removed from
 * the AUTHORING surface must keep reading canonically from data written
 * under protocol ≤ 16 forever.
 *
 * The rows below are seeded directly into the stub engine — deliberately
 * bypassing `saveMetaItem`'s schema gate, exactly like a real row written
 * years ago under an older protocol.
 */
import { describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update), so the fake engine below cannot accept a call ObjectQL
// refuses. Imported from `@objectstack/metadata-core` and not from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright — which is why all 26
// of this package's (file, verb) pairs sat in the gate's DEBT ledger until
// #5619 sank the two predicates into a package both sides already depend on.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

function matches(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (v === undefined) continue;
        if ((r as any)[k] !== v) return false;
    }
    return true;
}

// `metadata` is `Omit`-ed out of the `Partial<Row>` half, never merely
// intersected over it: `string & unknown` is `string`, so a plain
// intersection refuses every body written as an object literal.
function makeStubEngine(
    seedRows: Array<Omit<Partial<Row>, 'metadata'> & { type: string; name: string; metadata: unknown }>,
) {
    let nextId = 0;
    const rows: Row[] = seedRows.map((r) => ({
        id: `r_${++nextId}`,
        organization_id: null,
        package_id: null,
        state: 'active',
        ...r,
        metadata: typeof r.metadata === 'string' ? r.metadata : JSON.stringify(r.metadata),
    }));
    const registered: Array<{ kind: 'object' | 'item'; type?: string; body: any }> = [];

    const engine: any = {
        async findOne(_t: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(_t, opts);
            return rows.find((r) => matches(r, opts.where)) ?? null;
        },
        async find(_t: string, opts: { where: Record<string, unknown> }) {
            return rows.filter((r) => matches(r, opts.where));
        },
        async insert() { return { id: 'x' }; },
        async update(_t: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, opts);
            return { id: 'x' };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            return { deleted: 0 };
        },
        registry: {
            listItems: () => [],
            isPackageDisabled: () => false,
            registerItem: (type: string, body: any) => { registered.push({ kind: 'item', type, body }); },
            registerObject: (body: any) => { registered.push({ kind: 'object', body }); },
        },
    };
    return { engine, rows, registered };
}

// A protocol-≤16 object row: the `conditionalRequired` alias was removed from
// the spec in 17 (#3855) and its conversion is `retiredFromLoadPath` — the
// authored load seam refuses it, but the stored seam must keep lowering it.
const legacyObjectRow = {
    type: 'object',
    name: 'crm_invoice',
    metadata: {
        name: 'crm_invoice',
        label: 'Invoice',
        fields: {
            status: { type: 'select', label: 'Status' },
            amount: { type: 'currency', label: 'Amount', conditionalRequired: "record.status == 'sent'" },
        },
    },
};

// A pre-17 standalone action row still carrying the removed `execute` alias.
// NOTE: this once wrote `object: 'crm_invoice'`. `ActionSchema` has never
// declared `object` — the key is `objectName` — and `.strip` ate it, so the
// fixture read as a claim about real legacy data while being a typo. Closing
// the shape (#4001) made it a diagnostic. Sixth strip-era fiction this campaign
// has found in a test, and the first one dressed as a stored ROW.
const legacyActionRow = {
    type: 'action',
    name: 'convert',
    metadata: { name: 'convert', label: 'Convert', type: 'script', objectName: 'crm_invoice', execute: 'convertHandler' },
};

describe('getMetaItems — stored rows are served canonical (#3903)', () => {
    it('lowers the retired conditionalRequired alias on a stored object row', async () => {
        const { engine } = makeStubEngine([legacyObjectRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);
        const res = await protocol.getMetaItems({ type: 'object' });
        const obj = (res.items as any[]).find((i) => i.name === 'crm_invoice');
        expect(obj.fields.amount.requiredWhen).toBe("record.status == 'sent'");
        expect('conditionalRequired' in obj.fields.amount).toBe(false);
    });

    it('lowers the retired execute alias on a stored action row', async () => {
        const { engine } = makeStubEngine([legacyActionRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);
        const res = await protocol.getMetaItems({ type: 'action' });
        const action = (res.items as any[]).find((i) => i.name === 'convert');
        expect(action.target).toBe('convertHandler');
        expect('execute' in action).toBe(false);
    });

    it('deliberately does NOT convert flow rows — that seam is registerFlow (conflict guard needs the executor registry)', async () => {
        const legacyFlow = {
            type: 'flow',
            name: 'purge_flow',
            metadata: {
                name: 'purge_flow',
                nodes: [{ id: 'n1', type: 'delete_record', config: { objectName: 'lead', filters: { status: 'stale' } } }],
            },
        };
        const { engine } = makeStubEngine([legacyFlow]);
        const protocol = new ObjectStackProtocolImplementation(engine);
        const res = await protocol.getMetaItems({ type: 'flow' });
        const flow = (res.items as any[]).find((i) => i.name === 'purge_flow');
        expect(flow.nodes[0].config.filters).toEqual({ status: 'stale' });
    });
});

// [#13700 — ui#6837 half 1] A stored object row carrying the legacy objectql
// `reference_to` dialect. `FieldSchema` has always REFUSED the key (so this
// row could only have been written by a seam that bypasses the parse — which
// is exactly what the stub seeding reproduces), and objectui's
// `reference ?? reference_to` fallback arms are being deleted on the strength
// of this suite: the serve face must only ever emit `reference`.
// Typed `any` like the stub engine above: the seed deliberately carries an
// object-literal `metadata` (makeStubEngine stringifies it), which `Row`'s
// stored shape (`metadata: string`) rejects at the call site.
const legacyReferenceToRow: any = {
    type: 'object',
    name: 'crm_contact',
    metadata: {
        name: 'crm_contact',
        label: 'Contact',
        fields: {
            company_id: { type: 'lookup', label: 'Company', reference_to: 'crm_company' },
            title: { type: 'text', label: 'Title' },
        },
    },
};

describe('getMetaItems — stored reference_to serves as reference (#13700, ui#6837 half 1)', () => {
    it('serves the lookup target under the canonical key ONLY', async () => {
        const { engine } = makeStubEngine([legacyReferenceToRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);
        const res = await protocol.getMetaItems({ type: 'object' });
        const obj = (res.items as any[]).find((i) => i.name === 'crm_contact');
        expect(obj.fields.company_id.reference).toBe('crm_company');
        expect('reference_to' in obj.fields.company_id).toBe(false);
        // The non-relationship sibling rides through untouched.
        expect(obj.fields.title).toEqual({ type: 'text', label: 'Title' });
    });

    it('single read is canonical too, with clean _diagnostics (chain-owned history is not "invalid")', async () => {
        const { engine } = makeStubEngine([legacyReferenceToRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);
        const res: any = await protocol.getMetaItem({ type: 'object', name: 'crm_contact' });
        expect(res.item.fields.company_id.reference).toBe('crm_company');
        expect('reference_to' in res.item.fields.company_id).toBe(false);
        // Unconverted, this row reads as invalid metadata (the dialect key is
        // an `unrecognized_keys` rejection); converted first, it is valid —
        // the serve face OWNS this history rather than reporting it broken.
        expect(res.item._diagnostics?.valid).toBe(true);
    });

    it('boot hydration registers the CONVERTED body', async () => {
        const { engine, registered } = makeStubEngine([legacyReferenceToRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);
        const res = await protocol.loadMetaFromDb();
        expect(res).toEqual({ loaded: 1, errors: 0, invalid: 0, storeUnavailable: false });
        const obj = registered.find((r) => r.kind === 'object')!;
        expect(obj.body.fields.company_id.reference).toBe('crm_company');
        expect('reference_to' in obj.body.fields.company_id).toBe(false);
    });
});

describe('getMetaItem — single stored read is canonical (#3903)', () => {
    it('returns the converted body with clean _diagnostics (chain-owned history is not "invalid")', async () => {
        const { engine } = makeStubEngine([legacyObjectRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);
        const res: any = await protocol.getMetaItem({ type: 'object', name: 'crm_invoice' });
        expect(res.item.fields.amount.requiredWhen).toBe("record.status == 'sent'");
        // Pre-#3903 this row validated RAW: the tombstoned alias made every
        // legacy row read as invalid metadata. Converted first, it is valid.
        expect(res.item._diagnostics?.valid).toBe(true);
    });
});

describe('loadMetaFromDb — boot hydration converts, diagnoses, never drops (#3903)', () => {
    it('registers the CONVERTED body and reports invalid: 0 for chain-owned history', async () => {
        const { engine, registered } = makeStubEngine([legacyObjectRow, legacyActionRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);
        const res = await protocol.loadMetaFromDb();
        // `storeUnavailable: false` (#5897) — a read that happened. The whole
        // return is asserted rather than the three counts, so a future field
        // cannot appear here unexamined.
        expect(res).toEqual({ loaded: 2, errors: 0, invalid: 0, storeUnavailable: false });

        const obj = registered.find((r) => r.kind === 'object')!;
        expect(obj.body.fields.amount.requiredWhen).toBe("record.status == 'sent'");
        expect('conditionalRequired' in obj.body.fields.amount).toBe(false);

        const action = registered.find((r) => r.kind === 'item' && r.type === 'action')!;
        expect(action.body.target).toBe('convertHandler');
    });

    it('counts a genuinely off-contract row as invalid but STILL registers it (availability)', async () => {
        const broken = {
            type: 'object',
            name: 'corrupt_thing',
            // `fields` as a number cannot be owned by any conversion — a real
            // contract violation, not chain history.
            metadata: { name: 'corrupt_thing', label: 'Corrupt', fields: 42 },
        };
        const { engine, registered } = makeStubEngine([broken]);
        const protocol = new ObjectStackProtocolImplementation(engine);
        const res = await protocol.loadMetaFromDb();
        expect(res.loaded).toBe(1);
        expect(res.invalid).toBe(1);
        expect(registered.some((r) => r.kind === 'object' && r.body?.name === 'corrupt_thing')).toBe(true);
    });
});
