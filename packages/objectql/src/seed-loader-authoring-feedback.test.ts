// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8442 — the MANDATORY positive control for the seed `errors[].message`
 * withhold, driven through the REAL validator.
 *
 * The withhold itself is pinned in `@objectstack/metadata-protocol`'s
 * `seed-loader-driver-text.test.ts`. That file must stand in a fixture double
 * of `ValidationError`, because objectql depends on metadata-protocol and
 * importing it there would close a cycle. This file is the other half, and it
 * is the one that cannot be vacuous: a REAL `ObjectQL` engine, a REAL object
 * declaring a REAL constraint, and a genuinely malformed seed record — no
 * error is constructed by hand anywhere below.
 *
 * It is the analogue of #8333's broken-CEL approval flow, re-aimed at the field
 * this card touches. What it guards is the issue's own review bar: `errors[]`
 * is per-record authoring feedback, so the fix must FILTER, not delete. On this
 * producer the structured keys name only WHICH ROW (`field` is the literal
 * `'(write)'`, `targetField`/`attemptedValue` are the record's external key) —
 * so "which key was rejected and why" survives only if the validator's own
 * sentence is quoted. Blank the tail unconditionally and this test goes red,
 * which is exactly the wrong fix it exists to refuse.
 *
 * It also closes the last vacuity gap in the pair: it proves a real
 * `ValidationError` reaches the loader with its declaring shape intact, through
 * the BUILT package, rather than only the hand-built double asserting so.
 */

import { describe, it, expect } from 'vitest';
import { SeedLoaderService } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';

/**
 * `plan` carries a real `maxLength`, so a too-long value is rejected by
 * `validateRecord` — the engine's own validator — rather than by anything this
 * file arranges.
 */
const ACCT = {
    name: 'sd_acct',
    label: 'Account',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        plan: { name: 'plan', label: 'Plan', type: 'text' as const, maxLength: 4 },
    },
};

function makeMemoryDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    let nextId = 0;
    // `$and` / `$or` are conjoined WITH their sibling keys, the way a real
    // driver ANDs them. The short-circuiting shape this stub used to carry
    // (`if ($or) return $or.some(...)`) discarded every sibling equality key in
    // the same object, so a query like
    // `{ state:'draft', package_id, $or:[{organization_id:ORG},{organization_id:null}] }`
    // was silently answered on the `$or` alone — a different query than the one
    // written, with the suite still green. See #7620.
    const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$and' && Array.isArray(v)) {
                if (!v.every((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k === '$or' && Array.isArray(v)) {
                if (!v.some((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k.startsWith('$')) continue;
            const rowVal = row[k];
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            const a = rowVal === undefined ? null : rowVal;
            const b = expected === undefined ? null : expected;
            if (a !== b) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {} as any,
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: any) {
            return Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
        },
        async findOne(object: string, ast: any) {
            for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            nextId += 1;
            const id = (data.id as string) ?? `r_${nextId}`;
            const row = { ...data, id };
            storeFor(object).set(id, row);
            return row;
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(object);
            const cur = s.get(id);
            if (!cur) throw new Error(`not found: ${object}/${id}`);
            const updated = { ...cur, ...data, id };
            s.set(id, updated);
            return updated;
        },
        async upsert(object: string, data: Record<string, unknown>) {
            const id = data.id as string | undefined;
            if (id && storeFor(object).has(id)) return this.update(object, id, data);
            return this.create(object, data);
        },
        async delete(object: string, id: string) { return storeFor(object).delete(id); },
        async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r)));
        },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return { driver, stores };
}


const CONFIG = {
    dryRun: false, haltOnError: false, multiPass: true,
    defaultMode: 'upsert', batchSize: 1000, transaction: false,
};

async function seedLoaderOverRealEngine() {
    const engine = new ObjectQL();
    engine.registerDriver(makeMemoryDriver().driver, true);
    await engine.init();
    engine.registry.registerObject(ACCT as never, 'com.objectstack.test.8442');
    const metadata = { getObject: async () => ACCT, listObjects: async () => [ACCT] };
    const logger = { info() {}, warn() {}, error() {}, debug() {} };
    return new SeedLoaderService(engine as never, metadata as never, logger as never);
}

describe('[#8442] [GUARD] a malformed seed record still reports which record and which key', () => {
    it('the real validator’s verdict survives the driver-text withhold', async () => {
        const svc = await seedLoaderOverRealEngine();

        const result = await svc.load({
            seeds: [{
                object: 'sd_acct',
                externalId: 'name',
                mode: 'upsert',
                env: ['prod', 'dev', 'test'],
                records: [
                    { name: 'good_row', plan: 'pro' },
                    // Genuinely malformed: 10 characters into a maxLength: 4
                    // field. Nothing here throws on its own — the engine's
                    // validator rejects it.
                    { name: 'bad_row', plan: 'enterprise' },
                ],
            }],
            config: CONFIG,
        } as never);

        // The load is reported as failed, and only the offending row failed.
        expect(result.success).toBe(false);
        expect(result.summary.totalInserted).toBe(1);
        expect(result.summary.totalErrored).toBe(1);

        const error = result.errors[0];
        // WHICH RECORD — the structured half, untouched by this card.
        expect(error.sourceObject).toBe('sd_acct');
        expect(error.recordIndex).toBe(1);
        expect(error.attemptedValue).toBe('bad_row');
        // The authored prefix, unchanged.
        expect(error.message).toContain('Failed to write sd_acct record #1 (name=bad_row):');
        // WHICH KEY AND WHY — the half that exists ONLY in the validator's
        // sentence, and the half a blanket withhold would destroy.
        expect(error.message).toMatch(/plan/i);
        expect(error.message).toContain('4');
        // ⛔ The stable withheld line must NOT be what a real authoring
        // rejection answers with — that substitution is the wrong fix.
        expect(error.message).not.toContain('the reason is in the server log');
    });
});
