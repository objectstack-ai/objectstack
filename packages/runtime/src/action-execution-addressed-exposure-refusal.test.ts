// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23528] `callData`'s ADDRESSED-object exposure refusal
 * (`refuseUnexposedDataAction`) is the data door's: an `Error` carrying `code`
 * and `status`, the addressed object as `object`, and the effective operation
 * set as `allowed` on a 405. Its nested-relation target refusal already
 * answered that way (`action-execution-calldata-relation-target-exposure.test.ts`),
 * and so do `RestServer` and the MCP stdio face for the same declaration.
 *
 * ## What was open
 *
 * The gate threw `{ statusCode, message }` with no `code`. Each door then
 * answered it without the data door's code:
 *
 *  - the runtime dispatcher's `/data` door derived `404 RESOURCE_NOT_FOUND` /
 *    `405 METHOD_NOT_ALLOWED` from the status
 *    (`domains/data-write-request-gate.test.ts` pins both doors on a real store);
 *  - the `/mcp` tools render a thrown `code` since #23509, and rendered this
 *    refusal as its message alone (`buildMcpBridge` calls `callData` on every
 *    data verb, pinned below).
 *
 * The status and the message are unchanged. Every row asserts `code` and
 * `status` and that neither the protocol nor the engine was asked.
 */

import { describe, expect, it, vi } from 'vitest';
import { callData, type ActionExecutionDeps } from './action-execution.js';
import { buildMcpBridge } from './domains/mcp.js';
import type { HttpProtocolContext } from './http-dispatcher.js';

const MEMBER = { userId: 'ax_member', isSystem: false, positions: [], permissions: [] } as any;
const REQ = { request: {}, executionContext: MEMBER } as HttpProtocolContext;

const object = (name: string, enable?: Record<string, unknown>) => ({
    name,
    label: name,
    ...(enable ? { enable } : {}),
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' },
        name: { name: 'name', label: 'Name', type: 'text' },
    },
});

/** The fixture: `ax_hidden` is not exposed at all, `ax_getonly` exposes `get` alone. */
const SCHEMAS: Record<string, unknown> = {
    ax_hidden: object('ax_hidden', { apiEnabled: false }),
    ax_getonly: object('ax_getonly', { apiMethods: ['get'] }),
};

const HIDDEN = { code: 'OBJECT_API_DISABLED', status: 404, object: 'ax_hidden', allowed: undefined };
const HIDDEN_MESSAGE = 'object is not exposed via the API';

/** The protocol and engine `callData` would reach, each verb a spy, so a refusal is shown to ask neither. */
function makeHarness() {
    const protocol = {
        createData: vi.fn(async (req: any) => ({ object: req.object, id: 'n1', record: req.data })),
        getData: vi.fn(async (req: any) => ({ object: req.object, id: req.id, record: { id: req.id } })),
        updateData: vi.fn(async (req: any) => ({ object: req.object, id: req.id, record: req.data })),
        deleteData: vi.fn(async (req: any) => ({ object: req.object, id: req.id, success: true })),
        findData: vi.fn(async (req: any) => ({ object: req.object, records: [], total: 0, hasMore: false })),
    };
    const engine = {
        registry: { getObject: (n: string) => SCHEMAS[n] },
        find: vi.fn(async () => []),
        insert: vi.fn(async () => ({ id: 'n1' })),
        update: vi.fn(async () => ({})),
        delete: vi.fn(async () => ({})),
        aggregate: vi.fn(async () => []),
    };
    const services: Record<string, unknown> = {
        metadata: { getObject: async (n: string) => SCHEMAS[n] },
        protocol,
        objectql: engine,
    };
    const deps: ActionExecutionDeps = {
        resolveService: (async (_ctx: HttpProtocolContext, name: string) => services[name]) as any,
        getObjectQL: async () => engine as any,
    };
    const asked = () => [...Object.values(protocol), engine.find, engine.insert, engine.update, engine.delete, engine.aggregate]
        .reduce((n, spy) => n + spy.mock.calls.length, 0);
    return { deps, protocol, asked };
}

/** What a door reads off the refusal: the envelope pair and the two context fields. */
const refusal = (e: any) => ({ code: e?.code, status: e?.status, object: e?.object, allowed: e?.allowed });

/** Every action `callData` serves, with params naming `object`. */
const VERBS: ReadonlyArray<readonly [string, (object: string) => Record<string, unknown>]> = [
    ['create', (o) => ({ object: o, data: { name: 'x' } })],
    ['get', (o) => ({ object: o, id: 'r1' })],
    ['update', (o) => ({ object: o, id: 'r1', data: { name: 'x' } })],
    ['delete', (o) => ({ object: o, id: 'r1' })],
    ['query', (o) => ({ object: o, query: {} })],
    ['find', (o) => ({ object: o, query: {} })],
    ['aggregate', (o) => ({ object: o, aggregations: [{ function: 'count', alias: 'n' }] })],
];

describe('[#23528] callData refuses an addressed object its declaration does not expose with the data door\'s code', () => {
    for (const [action, params] of VERBS) {
        it(`${action} on an \`apiEnabled: false\` object: 404 OBJECT_API_DISABLED, nothing asked`, async () => {
            const h = makeHarness();
            const err: any = await callData(h.deps, REQ, action, params('ax_hidden'), undefined, undefined, MEMBER).catch((e) => e);
            expect(err).toBeInstanceOf(Error);
            expect(refusal(err)).toEqual(HIDDEN);
            expect(err.message).toBe(HIDDEN_MESSAGE);
            expect(h.asked()).toBe(0);
        });
    }

    it('create on an object exposing `get` alone: 405 OBJECT_API_METHOD_NOT_ALLOWED naming the effective set, nothing asked', async () => {
        const h = makeHarness();
        const err: any = await callData(h.deps, REQ, 'create', { object: 'ax_getonly', data: { name: 'x' } }, undefined, undefined, MEMBER)
            .catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(refusal(err)).toEqual({ code: 'OBJECT_API_METHOD_NOT_ALLOWED', status: 405, object: 'ax_getonly', allowed: ['get'] });
        expect(err.message).toBe("API operation 'create' is not allowed for this object");
        expect(h.asked()).toBe(0);
    });

    it('CONTROL: the verb the whitelist grants is served', async () => {
        const h = makeHarness();
        await callData(h.deps, REQ, 'get', { object: 'ax_getonly', id: 'r1' }, undefined, undefined, MEMBER);
        expect(h.protocol.getData).toHaveBeenCalledTimes(1);
    });

    it('CONTROL: a system context is not asked, so the hidden object is served', async () => {
        const h = makeHarness();
        await callData(h.deps, REQ, 'query', { object: 'ax_hidden', query: {} }, undefined, undefined, { isSystem: true } as any);
        expect(h.protocol.findData).toHaveBeenCalledTimes(1);
    });
});

/**
 * The `/mcp` face: `buildMcpBridge` is the bridge `handleMcp` hands the MCP
 * tools, and each data member reaches `callData`. The tools render a thrown
 * string `code` and numeric `status` as `{ error: { code, message, status } }`
 * (`@objectstack/mcp`'s `thrownRefusalEnvelope`, pinned in its
 * `mcp-coded-refusal.test.ts`), so the bridge must hand them the coded refusal.
 */
describe('[#23528] the /mcp bridge hands its tools the coded refusal on every data member', () => {
    const MEMBERS: ReadonlyArray<readonly [string, (bridge: any) => Promise<unknown>]> = [
        ['query', (b) => b.query('ax_hidden', {})],
        ['get', (b) => b.get('ax_hidden', 'r1')],
        ['aggregate', (b) => b.aggregate('ax_hidden', { aggregations: [{ function: 'count', alias: 'n' }] })],
        ['create', (b) => b.create('ax_hidden', { name: 'x' })],
        ['update', (b) => b.update('ax_hidden', 'r1', { name: 'x' })],
        ['remove', (b) => b.remove('ax_hidden', 'r1')],
    ];

    for (const [member, call] of MEMBERS) {
        it(`${member}: 404 OBJECT_API_DISABLED, nothing asked`, async () => {
            const h = makeHarness();
            const bridge = buildMcpBridge(h.deps as any, REQ);
            const err: any = await call(bridge).catch((e) => e);
            expect(err).toBeInstanceOf(Error);
            expect(refusal(err)).toEqual(HIDDEN);
            expect(err.message).toBe(HIDDEN_MESSAGE);
            expect(h.asked()).toBe(0);
        });
    }
});
