// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24662] A write an authored hook `condition` refused because the condition
 * could not be evaluated on the record answers a coded `400 VALIDATION_ERROR`,
 * not the unclassified `500 INTERNAL_ERROR`.
 *
 * Driven through a REAL engine (`ObjectQL` + sqlite `SqlDriver`), a real
 * `ObjectStackProtocolImplementation`, the hook bound by the engine's own
 * `bindHooksToEngine`, and `RestServer`'s registered handlers — the harness
 * `rest-data-create-address-unknown-key.test.ts` boots. The hook is the
 * card's: `beforeInsert`, condition
 * `record.name.startsWith('qa-fc') && int(record.name) > 0`, which faults on
 * `qa-fc-abc` (`int()` cannot convert it).
 *
 * Measured on `origin/main` `eadea5720` before the arm: the single-record door
 * answered `500 {"error":"Internal server error","code":"INTERNAL_ERROR"}` and
 * logged `[REST] Unhandled error: HookConditionError: Hook 'qa_failclosed'
 * could not evaluate its condition (runtime: int() type error: cannot convert
 * to int) — operation aborted.`; `createMany` answered the same `500` and the
 * same line. The row was absent both times, which is the half that must not
 * move.
 *
 * The controls: a hook that refuses ON PURPOSE (a declared `403
 * PERMISSION_DENIED`) answers byte for byte what it answered before, and a
 * condition that never COMPILED keeps its sanitised `500` and its log line —
 * the second is also the positive control proving this file's log spy sees a
 * `[REST] Unhandled error` line when there is one.
 */

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

// This file observes the REST fault log, so it declares the level it asserts
// against ('info' is the shipped default) instead of the suite's quiet one.
beforeAll(() => { vi.stubEnv('OS_REST_LOG', 'info'); });
afterAll(() => { vi.unstubAllEnvs(); });

const PACKAGE_ID = 'objectstack-test';
const INQUIRY = {
    name: 'inquiry', label: 'Inquiry', systemFields: false,
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
};

/** The card's hook: its condition compiles, and faults on a `qa-fc` name that is not an integer. */
const CARD_CONDITION = "record.name.startsWith('qa-fc') && int(record.name) > 0";
const UNEVALUABLE = {
    name: 'qa_failclosed', object: 'inquiry', events: ['beforeInsert'],
    condition: CARD_CONDITION, handler: async () => {},
};
/** CONTROL: a hook that refuses on purpose, declaring its ADR-0112 envelope. */
const REFUSING = {
    name: 'qa_refuse', object: 'inquiry', events: ['beforeInsert'],
    handler: async () => {
        throw Object.assign(new Error('Inquiries are closed.'), { status: 403, code: 'PERMISSION_DENIED' });
    },
};
/** CONTROL: a condition that never compiled — `reason: 'uncompilable'`, not this card's. */
const UNCOMPILABLE = {
    name: 'qa_broken', object: 'inquiry', events: ['beforeInsert'],
    condition: 'record.name ==', handler: async () => {},
};

const UNEVALUABLE_MESSAGE =
    "Hook 'qa_failclosed' could not evaluate its condition (runtime: int() type error: cannot convert to int)"
    + ' — operation aborted.';

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    vi.restoreAllMocks();
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (body: any) => { res.body = body; return res; };
    res.header = () => res;
    res.setHeader = () => {};
    res.send = () => res;
    res.end = () => res;
    res.write = () => true;
    return res;
}

async function boot(hooks: any[]) {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    engine.registry.registerObject(INQUIRY as any, PACKAGE_ID);
    await engine.syncSchemas();
    const bound = bindHooksToEngine(engine, hooks as any, { packageId: PACKAGE_ID });
    expect(bound.registered).toBe(hooks.length);

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const noop = () => {};
    const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
    const rest: any = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
    rest.resolveExecCtx = async () => ({ userId: 'test-user', isSystem: false });
    rest.registerRoutes();
    const route = (path: string) => {
        const found = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === `/api/v1/data/:object${path}`);
        if (!found) throw new Error(`POST /api/v1/data/:object${path} is not registered`);
        return found;
    };
    const unhandled = vi.spyOn(console, 'error').mockImplementation(() => {});
    const drive = async (path: string, body: unknown) => {
        const res = makeRes();
        await route(path).handler({
            method: 'POST', path: `/api/v1/data/inquiry${path}`, params: { object: 'inquiry' },
            headers: { 'content-type': 'application/json' }, query: {}, body,
        }, res);
        return { status: res.statusCode as number, body: res.body as Record<string, unknown> };
    };
    return {
        create: (body: unknown) => drive('', body),
        createMany: (body: unknown) => drive('/createMany', body),
        rows: async () => ((await engine.find('inquiry', {})) as unknown[]).length,
        /** Every `[REST] Unhandled error` line this boot printed. */
        unhandledLines: () => unhandled.mock.calls.filter((c) => c[0] === '[REST] Unhandled error:'),
    };
}

describe('[#24662] an unevaluable hook condition is a coded refusal on the REST data doors', () => {
    it("the card's request: 400 VALIDATION_ERROR naming the hook, the row absent, no Unhandled line", async () => {
        const stack = await boot([UNEVALUABLE]);

        const res = await stack.create({ id: 'r1', name: 'qa-fc-abc' });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: UNEVALUABLE_MESSAGE, code: 'VALIDATION_ERROR', object: 'inquiry' });
        // What the sentence names: the hook and the CEL fault. Never the
        // condition source, never the value that faulted.
        expect(String(res.body.error)).not.toContain(CARD_CONDITION);
        expect(String(res.body.error)).not.toContain('qa-fc-abc');
        // Fail-closed holds: nothing was written.
        expect(await stack.rows()).toBe(0);
        // A refusal the caller was told about is not an unhandled fault.
        expect(stack.unhandledLines()).toEqual([]);
    });

    it('the bulk door (createMany, through handleRouteError) answers the same refusal', async () => {
        const stack = await boot([UNEVALUABLE]);

        const res = await stack.createMany([{ id: 'r1', name: 'qa-fc-abc' }]);

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: UNEVALUABLE_MESSAGE, code: 'VALIDATION_ERROR', object: 'inquiry' });
        expect(await stack.rows()).toBe(0);
        expect(stack.unhandledLines()).toEqual([]);
    });

    it('CONTROL: a hook that refuses on purpose answers exactly as before', async () => {
        const stack = await boot([REFUSING]);

        const res = await stack.create({ id: 'r1', name: 'qa-fc-abc' });

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: 'Inquiries are closed.', code: 'PERMISSION_DENIED', object: 'inquiry' });
        expect(await stack.rows()).toBe(0);
        expect(stack.unhandledLines()).toEqual([]);
    });

    it('CONTROL: a condition that never compiled keeps its sanitised 500 and its log line', async () => {
        const stack = await boot([UNCOMPILABLE]);

        const res = await stack.create({ id: 'r1', name: 'x' });

        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
        expect(await stack.rows()).toBe(0);
        // The positive control for the spy the two cases above read as empty.
        const lines = stack.unhandledLines();
        expect(lines).toHaveLength(1);
        expect((lines[0][1] as Error).name).toBe('HookConditionError');
        expect((lines[0][1] as { reason?: unknown }).reason).toBe('uncompilable');
    });
});
