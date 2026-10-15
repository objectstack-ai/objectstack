// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23603 row 10 — on the CALLER path a key the object does not declare is
 * refused as `INVALID_FIELD` / 400, on insert and on update, before anything
 * is written.
 *
 * Replaces the caller-path half of objectstack-ai/hotcrm
 * `test/undeclared-key-probe.test.ts` (row 10 of #15953's classification
 * table, its "half 1"), so hotcrm can retire it (objectstack-ai/hotcrm#1583).
 * The per-driver half — a key a HOOK writes refused as one ADR-0112 envelope
 * on every driver — is a driver conformance and stays on #15953; it is not
 * pinned here.
 *
 * hotcrm's reason for pinning it: every hook, action and flow writes by NAME,
 * and a misspelled key was once a silent successful write that stored a field
 * the object never declared — outside field-level security by construction,
 * since an undeclared field carries no permission entry. The guarantee is
 * pinned WITH hotcrm's two controls, without which a red-free run could be
 * measuring nothing: the same row without the key is accepted, and the same
 * key on an object that DECLARES it is accepted and stored. A plain
 * misspelling of a declared field is refused the same way, so the refusal is
 * about declaration, not about one borrowed name.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

function makeRecordingDriver() {
    const stores = new Map<string, Map<string, any>>();
    const storeFor = (o: string) => { let s = stores.get(o); if (!s) { s = new Map(); stores.set(o, s); } return s; };
    const writes: string[] = [];
    const matches = (row: any, where: any): boolean =>
        !where || typeof where !== 'object' || Object.entries(where).every(([k, v]) => row?.[k] === v);
    let n = 0;
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(o: string, ast: any) { return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)); },
        async findOne(o: string, ast: any) { for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r; return null; },
        async create(o: string, data: Record<string, unknown>) {
            writes.push(`create ${o}`);
            n += 1; const id = (data.id as string) ?? `r_${n}`; const row = { ...data, id }; storeFor(o).set(id, row); return row;
        },
        async update(o: string, id: string, data: Record<string, unknown>) {
            writes.push(`update ${o}`);
            const s = storeFor(o); const row = { ...s.get(id), ...data, id }; s.set(id, row); return row;
        },
        async delete(o: string, id: string) { return storeFor(o).delete(id); },
        async count() { return 0; },
        async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; }, async commit() {}, async rollback() {},
    };
    return { driver, storeFor, writes };
}

/** Declared on `quote`, not on `quote_line` — hotcrm's declared/undeclared pair. */
const KEY = 'tax';
/** A plain misspelling of a field `quote_line` really declares. */
const TYPO = 'unit_pric';
const SYS = { isSystem: true };

const refusal = (p: Promise<unknown>) => p.then(() => undefined, (e: any) => e);

describe('row 10 — an undeclared key on the caller path is refused as INVALID_FIELD / 400 (hotcrm undeclared-key-probe)', () => {
    let engine: ObjectQL;
    let rec: ReturnType<typeof makeRecordingDriver>;

    beforeEach(async () => {
        const quiet: any = { warn() {}, debug() {}, info() {}, error() {}, trace() {}, fatal() {}, child() { return quiet; } };
        engine = new ObjectQL({ logger: quiet });
        rec = makeRecordingDriver();
        engine.registerDriver(rec.driver, true);
        await engine.init();
        engine.registry.registerObject({
            name: 'quote_line',
            fields: { quantity: { type: 'number' }, unit_price: { type: 'number' } },
        } as any);
        engine.registry.registerObject({
            name: 'quote',
            fields: { name: { type: 'text' }, [KEY]: { type: 'number' } },
        } as any);
    });

    it('control: the same row WITHOUT the key is accepted', async () => {
        const row = await engine.insert('quote_line', { quantity: 1, unit_price: 100 }, { context: SYS } as any);
        expect(rec.storeFor('quote_line').get(row.id)?.unit_price).toBe(100);
    });

    it('control: the same key on an object that DECLARES it is accepted and stored', async () => {
        const row = await engine.insert('quote', { name: 'Q', [KEY]: 10 }, { context: SYS } as any);
        expect(rec.storeFor('quote').get(row.id)?.[KEY]).toBe(10);
    });

    it('insert carrying the undeclared key is refused, and nothing reaches the driver', async () => {
        const err = await refusal(engine.insert('quote_line', { quantity: 1, unit_price: 100, [KEY]: 10 }, { context: SYS } as any));
        expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400 });
        expect(String(err?.message)).toContain(KEY);
        expect(rec.writes).toEqual([]);
    });

    it('update carrying the undeclared key is refused the same way, and the row is unchanged', async () => {
        rec.storeFor('quote_line').set('l1', { id: 'l1', quantity: 1, unit_price: 100 });

        const err = await refusal(engine.update('quote_line', { id: 'l1', [KEY]: 42 }, { context: SYS } as any));

        expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400 });
        expect(String(err?.message)).toContain(KEY);
        expect(rec.writes).toEqual([]);
        expect(rec.storeFor('quote_line').get('l1')).toEqual({ id: 'l1', quantity: 1, unit_price: 100 });
    });

    it('a plain misspelling of a declared field is refused too', async () => {
        const err = await refusal(engine.insert('quote_line', { quantity: 1, [TYPO]: 7 }, { context: SYS } as any));
        expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400 });
        expect(String(err?.message)).toContain(TYPO);
        expect(rec.writes).toEqual([]);
    });
});
