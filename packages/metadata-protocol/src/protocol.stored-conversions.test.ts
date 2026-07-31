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

function makeStubEngine(seedRows: Array<Partial<Row> & { type: string; name: string; metadata: unknown }>) {
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
            return rows.find((r) => matches(r, opts.where)) ?? null;
        },
        async find(_t: string, opts: { where: Record<string, unknown> }) {
            return rows.filter((r) => matches(r, opts.where));
        },
        async insert() { return { id: 'x' }; },
        async update() { return { id: 'x' }; },
        async delete() { return { deleted: 0 }; },
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
const legacyActionRow = {
    type: 'action',
    name: 'convert',
    metadata: { name: 'convert', label: 'Convert', type: 'script', object: 'crm_invoice', execute: 'convertHandler' },
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
        expect(res).toEqual({ loaded: 2, errors: 0, invalid: 0 });

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
