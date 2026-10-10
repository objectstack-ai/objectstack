// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22646] The engine's own half of the `internal: true` data-door positions:
 *
 *  - the aggregate refusal (group-by / aggregate operand) carries the ADR-0112
 *    envelope — `INVALID_FIELD` / 400 — instead of the bare `Error` that
 *    reached the data door as an undeclared `500 INTERNAL_ERROR`;
 *  - a `$search` never scans an `internal: true` column — the field is dropped
 *    from the set the search expansion resolves over (a WITHHOLD, like the
 *    auto-default's `hidden` / credential-type exclusions), so a cross-field
 *    `$icontains` can never confirm a guessed prefix of a withheld credential.
 *
 * The filter / sort / per-aggregation-filter / explicit-`$searchFields` /
 * expand positions are refused at the generic data door, pinned in
 * `@objectstack/metadata-protocol`'s
 * `protocol.data-door-internal-field-positions.test.ts`; the engine keeps
 * serving them so the privileged internal consumers that call it directly (the
 * API-key verifier's `where: { key }`) are untouched — pinned by
 * `internal-fields.test.ts`'s "keeps the field usable as a WHERE filter".
 *
 * Refusal cases assert `code` AND `status` (ADR-0112): a bare
 * `rejects.toThrow()` stays green against a naked `Error`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL, type EngineReadOptions } from './engine.js';
import type { ServiceObject } from '@objectstack/spec/data';

function makeCaptureDriver() {
    const seenWhere: unknown[] = [];
    const store = new Map<string, Map<string, Record<string, unknown>>>();
    const s = (o: string) => { let m = store.get(o); if (!m) { m = new Map(); store.set(o, m); } return m; };
    let n = 0;
    const driver: any = {
        name: 'memory', version: '0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(object: string, ast: any) { seenWhere.push(ast?.where); return [...s(object).values()].map((r) => ({ ...r })); },
        async findOne(object: string, ast: any) { seenWhere.push(ast?.where); const r = [...s(object).values()][0]; return r ? { ...r } : null; },
        async count(object: string, ast: any) { seenWhere.push(ast?.where); return s(object).size; },
        // No `aggregate` method: the engine falls back to its in-memory
        // aggregation over find() rows, so the control buckets are real.
        async create(object: string, data: any) { n += 1; const id = data.id ?? `r_${n}`; const row = { ...data, id }; s(object).set(id, row); return { ...row }; },
        async update(object: string, id: string, data: any) { const row = { ...s(object).get(id), ...data, id }; s(object).set(id, row); return { ...row }; },
        async upsert(object: string, data: any) { return this.create(object, data); },
        async delete(object: string, id: string) { return s(object).delete(id); },
        async bulkCreate(o: string, rows: any[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; }, async commit() {}, async rollback() {},
    };
    return { driver, seenWhere };
}

// A `token` column that is `internal: true` but NOT `hidden` — so the ONLY
// thing that can keep it out of the auto-default search set is the internal
// flag (a `hidden` column is already excluded regardless).
const flagged: ServiceObject = {
    name: 'itest_vault', label: 'Vault', managedBy: 'better-auth',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        name: { name: 'name', label: 'Name', type: 'text' as const },
        prefix: { name: 'prefix', label: 'Prefix', type: 'text' as const },
        rank: { name: 'rank', label: 'Rank', type: 'number' as const },
        token: { name: 'token', label: 'Token', type: 'text' as const, internal: true },
    },
} as unknown as ServiceObject;

const plain: ServiceObject = {
    name: 'itest_plain', label: 'Plain',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        name: { name: 'name', label: 'Name', type: 'text' as const },
        token: { name: 'token', label: 'Token', type: 'text' as const },
    },
} as unknown as ServiceObject;

const SYSTEM: EngineReadOptions = { context: { isSystem: true } };

async function buildEngine() {
    const { driver, seenWhere } = makeCaptureDriver();
    const engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(flagged, 'internal-field-positions-test');
    engine.registry.registerObject(plain, 'internal-field-positions-test');
    return { engine, seenWhere };
}

describe('[#22646] the aggregate refusal carries the ADR-0112 envelope', () => {
    let ctx: Awaited<ReturnType<typeof buildEngine>>;
    beforeEach(async () => { ctx = await buildEngine(); });
    const seed = () => ctx.engine.insert('itest_vault', { name: 'k', prefix: 'osk_', rank: 1, token: 'h1' }, SYSTEM as any);

    const envelopeOf = async (run: () => Promise<unknown>) => {
        try { await run(); } catch (e: any) { return e; }
        throw new Error('expected a refusal, but the query ran');
    };

    it('group-by the flagged field: INVALID_FIELD / 400, located at object + field', async () => {
        await seed();
        const err = await envelopeOf(() => ctx.engine.aggregate('itest_vault', {
            aggregations: [{ function: 'count', alias: 'n' }], groupBy: ['token'],
        }, SYSTEM));
        expect(err.code).toBe('INVALID_FIELD');
        expect(err.status).toBe(400);
        expect(err.httpStatus).toBe(400);
        expect(err.object).toBe('itest_vault');
        expect(err.field).toBe('token');
    });

    it('aggregate operand over the flagged field: INVALID_FIELD / 400', async () => {
        await seed();
        const err = await envelopeOf(() => ctx.engine.aggregate('itest_vault', {
            aggregations: [{ function: 'max', field: 'token', alias: 'm' }],
        }, SYSTEM));
        expect(err.code).toBe('INVALID_FIELD');
        expect(err.status).toBe(400);
    });

    it('CONTROL: an ordinary column still aggregates (the guard is not a no-op)', async () => {
        await seed();
        await ctx.engine.insert('itest_vault', { name: 'k2', prefix: 'osk_', rank: 2, token: 'h2' }, SYSTEM as any);
        const rows = await ctx.engine.aggregate('itest_vault', {
            aggregations: [{ function: 'count', alias: 'n' }], groupBy: ['prefix'],
        }, SYSTEM);
        expect(Object.fromEntries(rows.map((r: any) => [r.prefix, Number(r.n)]))).toEqual({ osk_: 2 });
    });
});

describe('[#22646] a $search never scans an `internal: true` column', () => {
    let ctx: Awaited<ReturnType<typeof buildEngine>>;
    beforeEach(async () => { ctx = await buildEngine(); });

    const lastSearchWhere = () => ctx.seenWhere[ctx.seenWhere.length - 1];

    it('the generated search filter names the ordinary text columns, never the flagged one', async () => {
        await ctx.engine.insert('itest_vault', { name: 'alpha', prefix: 'osk_', rank: 1, token: 'h1' }, SYSTEM as any);
        await ctx.engine.find('itest_vault', { search: 'alp', context: { isSystem: true } } as any);
        const blob = JSON.stringify(lastSearchWhere() ?? null);
        expect(blob).toContain('name');
        expect(blob).not.toContain('token');
    });

    it('an explicit searchFields naming the flagged column is intersected away at the engine (withheld)', async () => {
        await ctx.engine.insert('itest_vault', { name: 'alpha', prefix: 'osk_', rank: 1, token: 'h1' }, SYSTEM as any);
        await ctx.engine.find('itest_vault', { search: 'h1', searchFields: ['token'], context: { isSystem: true } } as any);
        const blob = JSON.stringify(lastSearchWhere() ?? null);
        // The override narrowed to nothing scannable, so the engine falls back
        // to the (internal-free) default set — never a clause on `token`.
        expect(blob).not.toContain('token');
    });

    it('CONTROL: an object with no flagged field scans its text columns including `token`', async () => {
        await ctx.engine.insert('itest_plain', { name: 'alpha', token: 'h1' }, SYSTEM as any);
        await ctx.engine.find('itest_plain', { search: 'alp', context: { isSystem: true } } as any);
        const blob = JSON.stringify(lastSearchWhere() ?? null);
        expect(blob).toContain('token');
    });
});
