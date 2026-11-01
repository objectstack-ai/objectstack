// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `callData`'s `aggregate` arm — the HTTP MCP bridge's `aggregate_records` —
 * hands a caller's `where`, `groupBy` and `aggregations` to the ObjectQL engine
 * without passing through the protocol's `findData`, where the data door
 * refuses to EVALUATE a field declared `internal: true`. So the arm asks the
 * door's own gate (`assertNoInternalFieldEvaluated`) of the `protocol` service
 * before the engine aggregates, and throws what the door throws.
 *
 * Driven against the REAL `ObjectStackProtocolImplementation` registered as the
 * `protocol` service, and asserted against it: for each position the refusal is
 * the one `findData` itself answers for the same body — code, status, object,
 * field, position and message — and the engine never aggregates. Every caller
 * meets it, a system context included, as at the door. CONTROLS: an ordinary
 * field in every position reaches the engine unchanged, and a host that
 * registers no protocol has no door to agree with and is served as before.
 */

import { describe, expect, it, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { callData, type ActionExecutionDeps } from './action-execution.js';
import type { HttpProtocolContext } from './http-dispatcher.js';

const REQ = { request: {} } as HttpProtocolContext;
const MEMBER = { userId: 'ai_member', isSystem: false, positions: [], permissions: [] } as any;
const ADMIN = { userId: 'ai_admin', isSystem: false, roles: ['admin'], isPlatformAdmin: true, positions: [], permissions: [] } as any;
const SYSTEM = { isSystem: true } as any;

const F = 'pin';
const SCHEMAS: Record<string, unknown> = {
    ai_vault: {
        name: 'ai_vault',
        label: 'Vault',
        fields: {
            id: { name: 'id', label: 'ID', type: 'text' },
            name: { name: 'name', label: 'Name', type: 'text' },
            rank: { name: 'rank', label: 'Rank', type: 'number' },
            [F]: { name: F, label: 'Pin', type: 'text', internal: true },
        },
    },
};

function makeHarness(opts: { withProtocol?: boolean } = {}) {
    const aggregate = vi.fn(async () => [{ n: 1 }]);
    const find = vi.fn(async () => [{ id: 'v1', name: 'alpha', rank: 1 }]);
    const engine: any = { registry: { getObject: (n: string) => SCHEMAS[n] }, find, aggregate };
    const protocol = new ObjectStackProtocolImplementation(engine);
    const services: Record<string, any> = {
        metadata: { getObject: async (n: string) => SCHEMAS[n] },
        objectql: engine,
        ...(opts.withProtocol === false ? {} : { protocol }),
    };
    const deps: ActionExecutionDeps = {
        resolveService: (async (_ctx: HttpProtocolContext, name: string) => services[name]) as any,
        getObjectQL: async () => engine,
    };
    return { deps, aggregate, protocol };
}

const envelope = (e: any) => ({ code: e?.code, status: e?.status, object: e?.object, field: e?.field, param: e?.param, message: e?.message });

const COUNT = { function: 'count', alias: 'n' };
const POSITIONS: Array<[string, { where?: unknown; groupBy?: unknown[]; aggregations: unknown[] }]> = [
    ['where', { where: { [F]: 'x' }, aggregations: [COUNT] }],
    ['where ($startsWith)', { where: { [F]: { $startsWith: 'x' } }, aggregations: [COUNT] }],
    ['group key', { groupBy: [F], aggregations: [COUNT] }],
    ['aggregation operand', { aggregations: [{ function: 'max', field: F, alias: 'm' }] }],
    ["aggregation's own filter", { aggregations: [{ ...COUNT, filter: { [F]: 'x' } }] }],
];

describe('callData aggregate asks the data door\'s internal-field gate before the engine aggregates', () => {
    for (const [label, body] of POSITIONS) {
        for (const [persona, context] of Object.entries({ member: MEMBER, admin: ADMIN, system: SYSTEM })) {
            it(`${label} — ${persona}: findData's own refusal, and the engine never aggregates`, async () => {
                const h = makeHarness();
                const door = await h.protocol.findData({ object: 'ai_vault', query: { ...body } as any }).then(() => undefined, (e) => e);
                expect(envelope(door)).toMatchObject({ code: 'INVALID_FIELD', status: 400, object: 'ai_vault', field: F });

                const err = await callData(h.deps, REQ, 'aggregate', { object: 'ai_vault', ...body }, undefined, undefined, context)
                    .then(() => undefined, (e) => e);
                expect(err, 'the aggregate arm evaluated a position the door refuses').toBeDefined();
                expect(envelope(err)).toEqual(envelope(door));
                expect(h.aggregate).not.toHaveBeenCalled();
            });
        }
    }

    it('CONTROL — ordinary fields in every position reach the engine unchanged', async () => {
        const h = makeHarness();
        const body = {
            where: { name: 'alpha' },
            groupBy: ['name'],
            aggregations: [{ function: 'max', field: 'rank', alias: 'm', filter: { name: 'alpha' } }],
        };
        const res = await callData(h.deps, REQ, 'aggregate', { object: 'ai_vault', ...body }, undefined, undefined, MEMBER);
        expect(res).toEqual({ object: 'ai_vault', rows: [{ n: 1 }] });
        expect(h.aggregate).toHaveBeenCalledTimes(1);
        expect(h.aggregate).toHaveBeenCalledWith('ai_vault', expect.objectContaining(body));
    });

    it('CONTROL — a host that registers no protocol has no door to agree with, and is served as before', async () => {
        const h = makeHarness({ withProtocol: false });
        const res = await callData(
            h.deps, REQ, 'aggregate', { object: 'ai_vault', where: { [F]: 'x' }, aggregations: [COUNT] }, undefined, undefined, MEMBER,
        );
        expect(res).toEqual({ object: 'ai_vault', rows: [{ n: 1 }] });
        expect(h.aggregate).toHaveBeenCalledTimes(1);
    });
});
