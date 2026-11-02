// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `callData` — the HTTP MCP bridge's data mouth — refuses to EVALUATE a field
 * declared `internal: true` exactly as the data door does, whether or not the
 * host registers a `protocol` service.
 *
 * The refusal is the ENGINE's one definition (`QueryEvaluationGate` on the
 * `objectql` slot, which the engine's own read path also applies to every
 * non-system caller). The `aggregate` arm never reaches `findData`, so it asks
 * that member of the engine itself, for every caller it admits, a system
 * context included; the `query` arm's fallback on a host with no protocol does
 * the same before `ql.find`.
 *
 * Driven against a REAL `ObjectQL` over a recording driver, and compared with
 * the REAL `ObjectStackProtocolImplementation`'s `findData` over the same
 * engine: for each position the refusal is the door's — code, status, object,
 * field, position and message — and the driver is never asked. CONTROLS: an
 * ordinary field in every position is served, with and without a protocol.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { callData, type ActionExecutionDeps } from './action-execution.js';
import type { HttpProtocolContext } from './http-dispatcher.js';

const REQ = { request: {} } as HttpProtocolContext;
const MEMBER = { userId: 'ai_member', isSystem: false, positions: [], permissions: [] } as any;
const ADMIN = { userId: 'ai_admin', isSystem: false, roles: ['admin'], isPlatformAdmin: true, positions: [], permissions: [] } as any;
const SYSTEM = { isSystem: true } as any;
const PERSONAS = { member: MEMBER, admin: ADMIN, system: SYSTEM } as const;

const F = 'pin';
const VAULT = {
    name: 'ai_vault',
    label: 'Vault',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' },
        name: { name: 'name', label: 'Name', type: 'text' },
        rank: { name: 'rank', label: 'Rank', type: 'number' },
        [F]: { name: F, label: 'Pin', type: 'text', internal: true },
    },
};

function makeRecordingDriver() {
    const rows: Record<string, unknown>[] = [{ id: 'v1', name: 'alpha', rank: 1, [F]: 'p1' }];
    const calls: string[] = [];
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string) { calls.push(`find:${object}`); return rows.map((r) => ({ ...r })); },
        async findOne(object: string) { calls.push(`findOne:${object}`); return { ...rows[0] }; },
        async count(object: string) { calls.push(`count:${object}`); return rows.length; },
        async aggregate(object: string) { calls.push(`aggregate:${object}`); return [{ n: rows.length }]; },
        async create(_o: string, data: Record<string, unknown>) { return { id: 'v2', ...data }; },
        async update(_o: string, id: string, data: Record<string, unknown>) { return { id, ...data }; },
        async updateMany() { return 0; }, async delete() { return true; }, async deleteMany() { return 0; },
        async upsert(_o: string, data: Record<string, unknown>) { return data; },
        async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return { driver, calls };
}

async function makeHarness(opts: { withProtocol: boolean }) {
    const engine = new ObjectQL();
    const recording = makeRecordingDriver();
    engine.registerDriver(recording.driver, true);
    await engine.init();
    engine.registry.registerObject(VAULT as any);
    // The door over the same engine — the reference every answer is compared with.
    const door = new ObjectStackProtocolImplementation(engine as any);
    const services: Record<string, any> = {
        metadata: { getObject: async (n: string) => (n === VAULT.name ? VAULT : undefined) },
        objectql: engine,
        ...(opts.withProtocol ? { protocol: door } : {}),
    };
    const deps: ActionExecutionDeps = {
        resolveService: (async (_ctx: HttpProtocolContext, name: string) => services[name]) as any,
        getObjectQL: async () => engine,
    };
    return { deps, door, calls: recording.calls };
}

const envelope = (e: any) => ({ code: e?.code, status: e?.status, object: e?.object, field: e?.field, param: e?.param, message: e?.message });

async function doorAnswer(door: ObjectStackProtocolImplementation, query: Record<string, unknown>) {
    const err = await door.findData({ object: 'ai_vault', query: { ...query } as any }).then(() => undefined, (e) => e);
    expect(envelope(err)).toMatchObject({ code: 'INVALID_FIELD', status: 400, object: 'ai_vault', field: F });
    return err;
}

const COUNT = { function: 'count', alias: 'n' };
const AGGREGATE_POSITIONS: Array<[string, { where?: unknown; groupBy?: unknown[]; aggregations: unknown[] }]> = [
    ['where', { where: { [F]: 'x' }, aggregations: [COUNT] }],
    ['where ($startsWith)', { where: { [F]: { $startsWith: 'x' } }, aggregations: [COUNT] }],
    ['group key', { groupBy: [F], aggregations: [COUNT] }],
    ['aggregation operand', { aggregations: [{ function: 'max', field: F, alias: 'm' }] }],
    ["aggregation's own filter", { aggregations: [{ ...COUNT, filter: { [F]: 'x' } }] }],
];
const QUERY_POSITIONS: Array<[string, Record<string, unknown>]> = [
    ['filter ($eq)', { where: { [F]: { $eq: 'x' } } }],
    ['filter ($startsWith)', { where: { [F]: { $startsWith: 'x' } } }],
    ['sort', { orderBy: [{ field: F, order: 'asc' }] }],
];

for (const withProtocol of [true, false]) {
    const host = withProtocol ? 'a host with a protocol service' : 'a host that registers no protocol service';

    describe(`callData refuses an internal field in every evaluate position — ${host}`, () => {
        for (const [label, body] of AGGREGATE_POSITIONS) {
            for (const [persona, context] of Object.entries(PERSONAS)) {
                it(`aggregate ${label} — ${persona}: the door's refusal, and the driver is never asked`, async () => {
                    const h = await makeHarness({ withProtocol });
                    const door = await doorAnswer(h.door, body);
                    const err = await callData(h.deps, REQ, 'aggregate', { object: 'ai_vault', ...body }, undefined, undefined, context)
                        .then(() => undefined, (e) => e);
                    expect(err, 'the aggregate arm evaluated a position the door refuses').toBeDefined();
                    expect(envelope(err)).toEqual(envelope(door));
                    expect(h.calls).toEqual([]);
                });
            }
        }

        for (const [label, query] of QUERY_POSITIONS) {
            for (const [persona, context] of Object.entries(PERSONAS)) {
                it(`query ${label} — ${persona}: the door's refusal, and the driver is never asked`, async () => {
                    const h = await makeHarness({ withProtocol });
                    const door = await doorAnswer(h.door, query);
                    const err = await callData(h.deps, REQ, 'query', { object: 'ai_vault', query }, undefined, undefined, context)
                        .then(() => undefined, (e) => e);
                    expect(err, 'the query arm evaluated a position the door refuses').toBeDefined();
                    expect(envelope(err)).toEqual(envelope(door));
                    expect(h.calls).toEqual([]);
                });
            }
        }

        it('CONTROL — ordinary fields in every position are served', async () => {
            const h = await makeHarness({ withProtocol });
            const res: any = await callData(h.deps, REQ, 'aggregate', {
                object: 'ai_vault',
                where: { name: 'alpha' },
                groupBy: ['name'],
                aggregations: [{ function: 'max', field: 'rank', alias: 'm', filter: { name: 'alpha' } }],
            }, undefined, undefined, MEMBER);
            expect(res).toMatchObject({ object: 'ai_vault' });
            expect(Array.isArray(res.rows)).toBe(true);
            const listed: any = await callData(h.deps, REQ, 'query', {
                object: 'ai_vault', query: { where: { name: 'alpha' }, orderBy: [{ field: 'name', order: 'asc' }] },
            }, undefined, undefined, MEMBER);
            expect(listed.records.map((r: any) => r.id)).toEqual(['v1']);
            // Served, and the flagged column still never on a row.
            expect(listed.records[0]).not.toHaveProperty(F);
            expect(h.calls.length).toBeGreaterThan(0);
        });
    });
}

describe('callData — the system context is refused at the door, and the engine path serves it', () => {
    let h: Awaited<ReturnType<typeof makeHarness>>;
    beforeEach(async () => { h = await makeHarness({ withProtocol: false }); });

    it('the server\'s own engine read (no door in between) still matches on the flagged column', async () => {
        const engine = await h.deps.getObjectQL(REQ);
        if (!engine) throw new Error('the harness serves an engine');
        const rows = await engine.find('ai_vault', { where: { [F]: 'p1' }, context: SYSTEM });
        expect(rows.map((r: any) => r.id)).toEqual(['v1']);
        expect(rows[0]).not.toHaveProperty(F);
    });
});
