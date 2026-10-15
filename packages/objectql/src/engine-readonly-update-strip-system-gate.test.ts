// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23603 row 8 — on the UPDATE path a statically `readonly` field the CALLER
 * supplies is stripped if and only if the context is not system; a value a
 * `beforeUpdate` hook stamps survives under every context.
 *
 * Replaces the engine half of objectstack-ai/hotcrm
 * `test/readonly-write-semantics.test.ts` (row 8 of #15953's classification
 * table: its "plain caller PATCH" and "beforeUpdate hook stamp" describes, each
 * measured under three caller contexts), so hotcrm can retire them
 * (objectstack-ai/hotcrm#1583). The flow-writer describes (`runAs` decides
 * `isSystem`) are service-automation's and are not pinned here; hotcrm's K
 * residue (how its escalate path splits privilege) stays in hotcrm.
 *
 * ## The variable is `isSystem`, nothing else
 *
 * The strip's gate is `!opCtx.context?.isSystem` on the update path, and it
 * takes only a key the caller supplied. hotcrm measured every writer against
 * all three contexts so the reading names the variable instead of confounding
 * it with the writer, and so does this file: `{ userId, isSystem }`,
 * `{ isSystem }`, and `{ userId }` without `isSystem`. A `userId` does not buy
 * the write; `isSystem` does, with or without one.
 *
 * Each case carries a CONTROL column, identical but for the flag: a run in
 * which the control also fails to land measured a broken harness, not a strip.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

function makeDriver() {
    const stores = new Map<string, Map<string, any>>();
    const storeFor = (o: string) => { let s = stores.get(o); if (!s) { s = new Map(); stores.set(o, s); } return s; };
    const matches = (row: any, where: any): boolean =>
        !where || typeof where !== 'object' || Object.entries(where).every(([k, v]) => row?.[k] === v);
    let n = 0;
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(o: string, ast: any) { return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)); },
        async findOne(o: string, ast: any) { for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r; return null; },
        async create(o: string, data: Record<string, unknown>) {
            n += 1; const id = (data.id as string) ?? `r_${n}`; const row = { ...data, id }; storeFor(o).set(id, row); return row;
        },
        async update(o: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(o); const row = { ...s.get(id), ...data, id }; s.set(id, row); return row;
        },
        async delete(o: string, id: string) { return storeFor(o).delete(id); },
        async count() { return 0; },
        async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; }, async commit() {}, async rollback() {},
    };
    return { driver, storeFor };
}

const PROBE = 'probe_readonly';

/** The three caller contexts hotcrm varies, by name. */
const CONTEXTS: Array<[label: string, ctx: Record<string, unknown>]> = [
    ['{ userId, isSystem }', { userId: 'user_1', isSystem: true }],
    ['{ isSystem }', { isSystem: true }],
    ['{ userId } (no isSystem)', { userId: 'user_1' }],
];

describe('row 8 — the update-path readonly strip runs iff the context is not system (hotcrm readonly-write-semantics)', () => {
    let engine: ObjectQL;
    let storeFor: ReturnType<typeof makeDriver>['storeFor'];

    beforeEach(async () => {
        const quiet: any = { warn() {}, debug() {}, info() {}, error() {}, trace() {}, fatal() {}, child() { return quiet; } };
        engine = new ObjectQL({ logger: quiet });
        const d = makeDriver();
        storeFor = d.storeFor;
        engine.registerDriver(d.driver, true);
        await engine.init();
        engine.registry.registerObject({
            name: PROBE,
            fields: {
                name: { type: 'text' },
                locked_flag: { type: 'boolean', readonly: true },
                open_flag: { type: 'boolean' },
            },
        } as any);
        // The hook writer: stamps the locked column — a value the caller did
        // not supply — keyed off a sentinel so it fires only for those cases.
        engine.registerHook('beforeUpdate', async (ctx: any) => {
            if (ctx.input?.data?.name !== 'stamp-me') return;
            ctx.input.data.locked_flag = true;
            ctx.input.data.open_flag = true;
        }, { object: PROBE });
    });

    const seedRow = () => {
        const id = `p_${storeFor(PROBE).size + 1}`;
        storeFor(PROBE).set(id, { id, name: 'probe', locked_flag: false, open_flag: false });
        return id;
    };
    const row = (id: string) => storeFor(PROBE).get(id);

    it.each(CONTEXTS)('a caller-supplied readonly value under %s lands exactly when isSystem', async (_label, context) => {
        const id = seedRow();

        await engine.update(PROBE, { id, locked_flag: true, open_flag: true }, { context } as any);

        expect(row(id).open_flag, 'the CONTROL column did not land — harness fault, not a strip').toBe(true);
        expect(row(id).locked_flag).toBe(context.isSystem === true);
    });

    it.each(CONTEXTS)('a beforeUpdate hook stamp under %s survives — it was not supplied by the caller', async (_label, context) => {
        const id = seedRow();

        await engine.update(PROBE, { id, name: 'stamp-me' }, { context } as any);

        expect(row(id).open_flag, 'the CONTROL column did not land — harness fault, not a strip').toBe(true);
        expect(row(id).locked_flag).toBe(true);
    });
});
