// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23603 row 3 — the referential pass ESCALATES a spec-default `set_null` on a
 * REQUIRED lookup to `restrict`.
 *
 * Replaces the platform half of objectstack-ai/hotcrm `test/line-item-cascade.test.ts`
 * (the R residue in #15953's classification table, row 3), so hotcrm can retire
 * that half (objectstack-ai/hotcrm#1583). hotcrm keeps its K half — which of
 * its own lookups cascade — because that is a business ruling, not an engine
 * fact.
 *
 * ## The semantics hotcrm pinned, and why they are the engine's
 *
 * A required lookup that declares no `deleteBehavior` is not "no opinion":
 * `FieldSchema` materializes the contract default `set_null` on it, so the
 * resolved field reads `set_null` with nothing in source. `cascadeDeleteRelations`
 * then escalates that `set_null` to `restrict`, because a NOT NULL column cannot
 * be cleared. A delete of the referenced record is refused as
 * `DELETE_RESTRICTED` / 409 BEFORE any write reaches the dependent — so the
 * caller is never answered with the dependent's own `required` 400 about a
 * field on an object it did not address.
 *
 * Everything here goes through the spec seam the way an app's metadata does:
 * the fields are `FieldSchema.parse`d, so the premise (the materialized
 * default) and the consequence (the refusal) are read on the same field.
 * The two controls keep the refusal attributable: the same lookup without
 * `required` is cleared and the parent deleted, and an authored `cascade` on
 * the same required lookup removes exactly the dependents of the deleted
 * record and no other.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FieldSchema } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

function makeStubDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (o: string) => { let s = stores.get(o); if (!s) { s = new Map(); stores.set(o, s); } return s; };
    let nextId = 0;
    const matchOne = (stored: unknown, spec: unknown): boolean => {
        if (spec !== null && typeof spec === 'object' && !Array.isArray(spec)) {
            const [op, cmp] = Object.entries(spec as Record<string, unknown>)[0] ?? [];
            if (op === '$eq') return (stored ?? null) === ((cmp as any) ?? null);
            if (op === '$in') return (cmp as unknown[]).includes(stored);
            return false;
        }
        return (stored ?? null) === ((spec as any) ?? null);
    };
    const matches = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$or') { if (!(v as any[]).some((sub) => matches(row, sub))) return false; continue; }
            if (k === '$and') { if (!(v as any[]).every((sub) => matches(row, sub))) return false; continue; }
            if (k.startsWith('$')) continue;
            if (!matchOne(row[k], v)) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(o: string, ast: any) { return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)); },
        async findOne(o: string, ast: any) { for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r; return null; },
        async create(o: string, data: Record<string, unknown>) {
            nextId += 1; const id = (data.id as string) ?? `r_${nextId}`; const row = { ...data, id }; storeFor(o).set(id, row); return row;
        },
        async update(o: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(o); const cur = s.get(id); if (!cur) throw new Error(`nf ${o}/${id}`);
            const up = { ...cur, ...data, id }; s.set(id, up); return up;
        },
        async delete(o: string, id: string) { return storeFor(o).delete(id); },
        async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
        async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; }, async commit() {}, async rollback() {},
    };
    return { driver, storeFor };
}

const text = (name: string) => ({ name, ...FieldSchema.parse({ name, type: 'text' }) });
/** The parent lookup, as an app would author it: no `deleteBehavior` at all. */
const parentLookup = (extra: Record<string, unknown> = {}) =>
    ({ name: 'deal', ...FieldSchema.parse({ name: 'deal', label: 'Deal', type: 'lookup', reference: 'deal', ...extra }) });

const deal = { name: 'deal', label: 'Deal', fields: { name: text('name') } };
const requiredLine = {
    name: 'deal_line', label: 'Deal Line',
    fields: { label: text('label'), deal: parentLookup({ required: true }) },
};
const optionalNote = {
    name: 'deal_note', label: 'Deal Note',
    fields: { body: text('body'), deal: parentLookup() },
};
const cascadingLine = {
    name: 'deal_part', label: 'Deal Part',
    fields: { label: text('label'), deal: parentLookup({ required: true, deleteBehavior: 'cascade' }) },
};

describe('row 3 — a spec-default set_null on a REQUIRED lookup escalates to restrict (hotcrm line-item-cascade)', () => {
    let engine: ObjectQL;
    let storeFor: ReturnType<typeof makeStubDriver>['storeFor'];
    let lineWrites: number;

    beforeEach(async () => {
        engine = new ObjectQL();
        const d = makeStubDriver();
        storeFor = d.storeFor;
        engine.registerDriver(d.driver, true);
        await engine.init();
        for (const o of [deal, requiredLine, optionalNote, cascadingLine]) engine.registry.registerObject(o as any);
        lineWrites = 0;
        engine.on('beforeUpdate', 'deal_line', () => { lineWrites += 1; });
    });

    it('PREMISE: declaring nothing resolves to set_null on the parsed field', () => {
        expect(requiredLine.fields.deal.required).toBe(true);
        expect(requiredLine.fields.deal.deleteBehavior).toBe('set_null');
    });

    it('refuses the parent delete as DELETE_RESTRICTED / 409, before any write reaches the dependent', async () => {
        const d = await engine.insert('deal', { name: 'Itemised' });
        const line = await engine.insert('deal_line', { label: 'L1', deal: d.id });

        const err = await engine.delete('deal', { where: { id: d.id } } as any).catch((e) => e);
        // ADR-0112 envelope: an unescalated engine fails here with the
        // dependent's `required` VALIDATION_FAILED instead.
        expect(err).toMatchObject({
            code: 'DELETE_RESTRICTED', status: 409, dependentObject: 'deal_line', dependentCount: 1,
        });
        expect(lineWrites, 'the escalation precedes the set_null write').toBe(0);
        expect(storeFor('deal').has(d.id)).toBe(true);
        expect(storeFor('deal_line').get(line.id)?.deal).toBe(d.id);
    });

    it('control: the same lookup WITHOUT required is cleared and the parent deleted', async () => {
        const d = await engine.insert('deal', { name: 'Noted' });
        const note = await engine.insert('deal_note', { body: 'n', deal: d.id });

        await engine.delete('deal', { where: { id: d.id } } as any);

        expect(storeFor('deal').has(d.id)).toBe(false);
        expect(storeFor('deal_note').get(note.id)?.deal).toBeNull();
    });

    it('control: an authored cascade on the same required lookup removes exactly the deleted record\'s dependents', async () => {
        const doomed = await engine.insert('deal', { name: 'Doomed' });
        const bystander = await engine.insert('deal', { name: 'Bystander' });
        await engine.insert('deal_part', { label: 'gone', deal: doomed.id });
        const keep = await engine.insert('deal_part', { label: 'kept', deal: bystander.id });

        await engine.delete('deal', { where: { id: doomed.id } } as any);

        expect(storeFor('deal').has(doomed.id)).toBe(false);
        expect([...storeFor('deal_part').keys()]).toEqual([keep.id]);
        expect(storeFor('deal').has(bystander.id)).toBe(true);
    });
});
