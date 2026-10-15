// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23603 row 11 — the query layer's filter-token vocabulary: `resolveFilterTokens`
 * REFUSES the `{TODAY()}` spelling and KNOWS `{today}`.
 *
 * Replaces the two query-layer PREMISE cases of objectstack-ai/hotcrm
 * `test/flow-filter-today-token.test.ts` (row 11 of #15953's classification
 * table), so hotcrm can retire them (objectstack-ai/hotcrm#1583). The
 * service-automation half — the flow pre-pass that resolves its own date
 * spelling before the query — is its own card and is not pinned here, and the
 * static census of shipped flow filters is #15953's D residue.
 *
 * hotcrm pinned this because its flow sweeps rest on the two layers
 * DISAGREEING about the token: the query layer must refuse `{TODAY()}` loudly
 * (`FILTER_TOKEN_UNKNOWN` / 400) rather than compare it as a literal string —
 * which matches nothing and reads exactly like an empty answer — and must
 * resolve `{today}` to the calendar day, so `$lt '{today}'` excludes a row
 * dated today. Both are pinned at the resolver and on the engine's read path
 * (the refusal before the driver is reached, the resolution on the rows it
 * selects).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveFilterTokens } from '@objectstack/core';
import { ObjectQL } from './engine.js';

const ymd = (offsetDays: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.toISOString().slice(0, 10);
};
const UTC = { timezone: 'UTC' };

function makeDriver() {
    const rows = new Map<string, any>();
    let finds = 0;
    const matchOne = (stored: any, spec: any): boolean => {
        if (spec !== null && typeof spec === 'object') {
            return Object.entries(spec).every(([op, cmp]: [string, any]) => {
                if (op === '$lt') return stored != null && String(stored) < String(cmp);
                if (op === '$eq') return stored === cmp;
                throw new Error(`fake driver: unsupported operator ${op}`);
            });
        }
        return stored === spec;
    };
    const matches = (row: any, where: any): boolean =>
        !where || typeof where !== 'object' || Object.entries(where).every(([k, v]) => matchOne(row?.[k], v));
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(_o: string, ast: any) { finds += 1; return [...rows.values()].filter((r) => matches(r, ast?.where)); },
        async findOne(_o: string, ast: any) { finds += 1; return [...rows.values()].find((r) => matches(r, ast?.where)) ?? null; },
        async create(_o: string, data: any) { rows.set(data.id, data); return data; },
        async update(_o: string, id: string, data: any) { const r = { ...rows.get(id), ...data, id }; rows.set(id, r); return r; },
        async delete(_o: string, id: string) { return rows.delete(id); },
        async count() { return rows.size; },
        async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; }, async commit() {}, async rollback() {},
    };
    return { driver, rows, finds: () => finds };
}

describe('row 11 — the query layer refuses {TODAY()} and knows {today} (hotcrm flow-filter-today-token)', () => {
    describe('resolveFilterTokens', () => {
        it('refuses {TODAY()} as FILTER_TOKEN_UNKNOWN / 400 instead of passing it through as a literal', () => {
            let err: any;
            try { resolveFilterTokens({ end_date: { $lt: '{TODAY()}' } }, UTC); } catch (e) { err = e; }
            expect(err).toMatchObject({ code: 'FILTER_TOKEN_UNKNOWN', status: 400, token: 'TODAY()' });
        });

        it('resolves {today} to the calendar day, YYYY-MM-DD', () => {
            const now = new Date('2026-03-10T23:30:00.000Z');
            expect(resolveFilterTokens({ end_date: { $lt: '{today}' } }, { ...UTC, now }))
                .toEqual({ end_date: { $lt: '2026-03-10' } });
        });
    });

    describe('on the engine read path', () => {
        let engine: ObjectQL;
        let d: ReturnType<typeof makeDriver>;

        beforeEach(async () => {
            const quiet: any = { warn() {}, debug() {}, info() {}, error() {}, trace() {}, fatal() {}, child() { return quiet; } };
            engine = new ObjectQL({ logger: quiet });
            d = makeDriver();
            engine.registerDriver(d.driver, true);
            await engine.init();
            engine.registry.registerObject({
                name: 'contract',
                fields: { status: { type: 'text' }, end_date: { type: 'date' } },
            } as any);
            for (const [id, offset] of [['k_past', -3], ['k_yesterday', -1], ['k_today', 0], ['k_future', 30]] as const) {
                d.rows.set(id, { id, status: 'activated', end_date: ymd(offset) });
            }
        });

        it('a find carrying {TODAY()} is refused before the driver is reached', async () => {
            const err = await engine.find('contract', {
                where: { status: 'activated', end_date: { $lt: '{TODAY()}' } }, context: UTC,
            } as any).then(() => undefined, (e: any) => e);

            expect(err).toMatchObject({ code: 'FILTER_TOKEN_UNKNOWN', status: 400 });
            expect(d.finds()).toBe(0);
        });

        it('a find carrying {today} selects exactly the rows dated before today', async () => {
            const rows = await engine.find('contract', {
                where: { status: 'activated', end_date: { $lt: '{today}' } }, context: UTC,
            } as any);

            expect(rows.map((r: any) => r.id).sort()).toEqual(['k_past', 'k_yesterday']);
        });
    });
});
