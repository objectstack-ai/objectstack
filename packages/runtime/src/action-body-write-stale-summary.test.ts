// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28861] A write an action body makes through `ctx.engine` or `ctx.api` that
 * the engine STORED, but whose parent roll-up summary it could not recompute
 * after it, answers the write's own success in the body — never the
 * refusal, which stopped the body's later steps and made the action door
 * report a failure for a write that had landed (the caller then retried).
 *
 * ## The defect, measured on `origin/main` (`2af0ae2a`) before this file
 *
 * The engine reports that case as objectql's `SummaryRecomputeError`
 * (`ERR_SUMMARY_RECOMPUTE`, "the triggering records WERE written", carrying
 * `written`). `buildActionEngineFacade` (`ctx.engine`) and `buildActionApi`
 * (`ctx.api`, objectql's `createContext`) handed it straight into the body,
 * so a body's next line never ran, the action had no result, and both doors
 * answered the throw: REST a `500`, the MCP bridge a throw with the audit row
 * `failed`.
 *
 * ## What is pinned (seat ruling 6570987196)
 *
 * - each write surface returns what the call returns when every roll-up
 *   recomputes: `ctx.engine.insert` its `{ id }`, `update` and `delete`
 *   resolve, a multi-id `delete` deletes every id, and `ctx.api.object(x)`'s
 *   verbs answer the engine's result — so the body runs on and the door
 *   answers the body's OWN result, the audit row `succeeded`;
 * - the stale column is logged once per field, at `error`;
 * - a refusal raised before the write is stored reaches the body exactly as
 *   before (NEGATIVE PIN);
 * - the doors read a write's attached answer only on the declarative-update
 *   arm (addendum 6567869052 point 2): a body that throws a refusal carrying
 *   a write's data answer is answered as the failure it is — never with that
 *   data as the action's result — at REST, on the MCP bridge and in the audit
 *   row (NEGATIVE PIN).
 *
 * The engine is a double whose writes apply and then throw objectql's own
 * `SummaryRecomputeError`; `ctx.api` is objectql's real `ScopedContext` over it.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ScopedContext, SummaryRecomputeError } from '@objectstack/objectql';
import { earnedAnswerOf, withEarnedAnswer } from '@objectstack/types';

import { HttpDispatcher } from './http-dispatcher.js';

const OBJECT = 'stv_account';
const CHILD = 'stv_visit';
const ACTION = {
    name: 'log_visit', label: 'Log visit', objectName: OBJECT, type: 'script', target: 'logVisit',
    ai: { exposed: true, description: 'Log a visit.' },
};

/** One parent whose roll-up could not be recomputed, as the engine names it. */
const FAILURES = [{ childObject: CHILD, parentObject: OBJECT, parentId: 'a1', field: 'visit_count', error: new Error('sum over text') }];

type Handler = (ctx: any) => Promise<unknown>;

/**
 * The dispatcher over an engine whose `insert` / `update` / `delete` apply the
 * write, then report the stale roll-up — or refuse before writing anything
 * when the payload or the id says `refused`. `handler` is the action body.
 */
function makeRig(handler: Handler) {
    const events: any[] = [];
    const audit = { recordActionInvocation: vi.fn(async (e: any) => { events.push(e); }) };
    const rows = new Map<string, Record<string, unknown>>([['v0', { id: 'v0', title: 'old' }]]);
    const writes: string[] = [];
    const refuse = (object: string) =>
        Object.assign(new Error(`You do not have permission to write ${object}`), { code: 'PERMISSION_DENIED', status: 403 });

    const objectDef = { name: OBJECT, fields: { name: { type: 'text' } }, actions: [ACTION] };
    const schemaOf = (n: string) => (n === OBJECT ? objectDef : undefined);
    const ql: any = {
        executeAction: vi.fn(async (object: string, key: string, ctx: any) => {
            if (object === OBJECT && key === ACTION.target) return handler(ctx);
            throw new Error(`Action '${key}' on object '${object}' not found`);
        }),
        getSchema: schemaOf,
        registry: { getObject: schemaOf, getItem: () => undefined },
        find: vi.fn(async () => []),
        insert: vi.fn(async (object: string, data: any) => {
            if (data?.title === 'refused') throw refuse(object);
            const row = { ...data };
            rows.set(String(data.id), row);
            writes.push(`insert:${data.id}`);
            throw new SummaryRecomputeError(FAILURES as any, { ...row });
        }),
        update: vi.fn(async (object: string, data: any, options?: any) => {
            assertEngineUpdateDispatch(data, options);
            const id = String(options?.where?.id);
            if (id === 'refused') throw refuse(object);
            const row = { ...(rows.get(id) ?? { id }), ...data };
            rows.set(id, row);
            writes.push(`update:${id}`);
            throw new SummaryRecomputeError(FAILURES as any, { ...row });
        }),
        delete: vi.fn(async (object: string, options?: any) => {
            assertEngineDeleteDispatch(options);
            const id = String(options?.where?.id);
            if (id === 'refused') throw refuse(object);
            rows.delete(id);
            writes.push(`delete:${id}`);
            throw new SummaryRecomputeError(FAILURES as any, { id });
        }),
        createContext: (ec: any) => new ScopedContext(ec, ql),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        loadMany: vi.fn(async () => []),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async (n: string) => schemaOf(n)),
    };
    const services: Record<string, unknown> = { objectql: ql, data: ql, metadata, audit };
    const resolve = (n: string) => services[n] ?? null;
    const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
    const dispatcher = new HttpDispatcher(kernel);

    const ctx = (): any => ({
        request: { headers: { host: 'app.example.test' } },
        environmentId: 'platform',
        executionContext: { userId: 'u_member', tenantId: 'org_1', systemPermissions: [] },
    });

    /** REST `POST /actions/:object/:action` — the console's click, the SDK's call. */
    const viaRest = async () => {
        const res: any = await dispatcher.handleActions(`/${OBJECT}/${ACTION.name}`, 'POST', {}, ctx());
        return res.response;
    };
    /** The real `/mcp` bridge's `runAction` — what the `run_action` tool calls. */
    const viaMcp = async () => {
        const bridge = (dispatcher as any).buildMcpBridge(ctx());
        try {
            return { value: await bridge.runAction(ACTION.name, { objectName: OBJECT }) };
        } catch (err: any) {
            return { err };
        }
    };
    return { events, rows, writes, viaRest, viaMcp };
}

/** Both doors over one body: the REST answer, the MCP answer, and what each wrote. */
async function viaBothDoors(handler: Handler) {
    const rest = makeRig(handler);
    const restRes = await rest.viaRest();
    const mcp = makeRig(handler);
    const mcpOut = await mcp.viaMcp();
    return { rest, restRes, mcp, mcpOut };
}

/** The body's own result answered at both doors, every write applied once, both audit rows `succeeded`. */
function expectBodyResultAnswered(run: Awaited<ReturnType<typeof viaBothDoors>>, result: unknown, writes: string[]) {
    expect(run.restRes.status, JSON.stringify(run.restRes.body)).toBe(200);
    expect(run.restRes.body.data).toEqual(result);
    expect(run.rest.writes).toEqual(writes);
    expect(run.mcpOut.err, String(run.mcpOut.err)).toBeUndefined();
    expect(run.mcpOut.value).toEqual({ ok: true, action: ACTION.name, objectName: OBJECT, result });
    expect(run.mcp.writes).toEqual(writes);
    for (const events of [run.rest.events, run.mcp.events]) {
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ actionName: ACTION.name, outcome: 'succeeded' });
    }
}

let errorLog: ReturnType<typeof vi.spyOn>;
beforeAll(() => { errorLog = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterAll(() => { errorLog.mockRestore(); });

describe('[#28861] ctx.engine: a write that landed under a failing roll-up answers its success in the body', () => {
    it('insert answers the new id, and the body runs on to its own result', async () => {
        const run = await viaBothDoors(async (ctx) => {
            const created = await ctx.engine.insert(CHILD, { id: 'v1', title: 'visit' });
            return { created, after: 'insert' };
        });
        expectBodyResultAnswered(run, { created: { id: 'v1' }, after: 'insert' }, ['insert:v1']);
    });

    it('update resolves, and the body runs on to its own result', async () => {
        const run = await viaBothDoors(async (ctx) => {
            await ctx.engine.update(CHILD, 'v0', { title: 'revisited' });
            return { after: 'update' };
        });
        expectBodyResultAnswered(run, { after: 'update' }, ['update:v0']);
        expect(run.rest.rows.get('v0')).toEqual({ id: 'v0', title: 'revisited' });
    });

    it('a multi-id delete deletes every id, each landed delete answered as the success it is', async () => {
        const run = await viaBothDoors(async (ctx) => {
            await ctx.engine.delete(CHILD, ['v0', 'v1']);
            return { after: 'delete' };
        });
        expectBodyResultAnswered(run, { after: 'delete' }, ['delete:v0', 'delete:v1']);
    });
});

describe('[#28861] ctx.api: a write that landed under a failing roll-up answers its success in the body', () => {
    it('object(x).insert answers the stored record, and the body runs on to its own result', async () => {
        const run = await viaBothDoors(async (ctx) => {
            const created = await ctx.api.object(CHILD).insert({ id: 'v2', title: 'via api' });
            return { created, after: 'insert' };
        });
        expectBodyResultAnswered(run, { created: { id: 'v2', title: 'via api' }, after: 'insert' }, ['insert:v2']);
    });

    it('object(x).update and object(x).delete answer what the engine answers, and the body runs on', async () => {
        const run = await viaBothDoors(async (ctx) => {
            const updated = await ctx.api.object(CHILD).update({ title: 'via api' }, { where: { id: 'v0' } });
            const deleted = await ctx.api.object(CHILD).deleteById('v0');
            return { updated, deleted, after: 'delete' };
        });
        expectBodyResultAnswered(
            run,
            { updated: { id: 'v0', title: 'via api' }, deleted: { id: 'v0' }, after: 'delete' },
            ['update:v0', 'delete:v0'],
        );
    });

    it('a context the api derives answers the same way (sudo)', async () => {
        const run = await viaBothDoors(async (ctx) => {
            const created = await ctx.api.sudo().object(CHILD).insert({ id: 'v3', title: 'elevated' });
            return { created };
        });
        expectBodyResultAnswered(run, { created: { id: 'v3', title: 'elevated' } }, ['insert:v3']);
    });
});

describe('[#28861] a refusal raised before the write is stored reaches the body exactly as before (NEGATIVE PIN)', () => {
    it.each([
        ['ctx.engine.insert', (ctx: any) => ctx.engine.insert(CHILD, { id: 'x', title: 'refused' })],
        ['ctx.engine.update', (ctx: any) => ctx.engine.update(CHILD, 'refused', { title: 'x' })],
        ['ctx.engine.delete', (ctx: any) => ctx.engine.delete(CHILD, 'refused')],
        ['ctx.api insert', (ctx: any) => ctx.api.object(CHILD).insert({ id: 'x', title: 'refused' })],
        ['ctx.api deleteById', (ctx: any) => ctx.api.object(CHILD).deleteById('refused')],
    ])('%s: the body is handed the refusal, the doors answer it, nothing written', async (_label, write) => {
        const seen: string[] = [];
        const run = await viaBothDoors(async (ctx) => {
            try {
                await write(ctx);
            } catch (e: any) {
                seen.push(e?.code);
                throw e;
            }
            return { never: true };
        });
        expect(seen).toEqual(['PERMISSION_DENIED', 'PERMISSION_DENIED']);
        expect(run.restRes.status).toBe(403);
        expect(run.restRes.body.error.code).toBe('PERMISSION_DENIED');
        expect(run.mcpOut.err?.code).toBe('PERMISSION_DENIED');
        expect(run.rest.writes).toEqual([]);
        expect(run.mcp.writes).toEqual([]);
        expect(run.mcp.events.map((e) => e.outcome)).toEqual(['failed']);
    });
});

describe('[#28861] the doors read a write\'s attached answer on the declarative arm only (NEGATIVE PIN)', () => {
    /** A body that throws a refusal carrying a WRITE's data answer — never the action's own result. */
    const carrying = () => withEarnedAnswer(
        new SummaryRecomputeError(FAILURES as any, { id: 'v9' }),
        { object: CHILD, id: 'v9', record: { id: 'v9', title: 'a write answer' } },
    );
    /** The same refusal with nothing attached: what the doors answer for a body's failure. */
    const bare = () => new SummaryRecomputeError(FAILURES as any, { id: 'v9' });

    it('REST answers the body\'s failure, never the attached write answer as the action\'s result', async () => {
        const carried = await viaBothDoors(async () => { throw carrying(); });
        const control = await viaBothDoors(async () => { throw bare(); });
        expect(control.restRes.status).not.toBe(200);
        expect(carried.restRes.status).toBe(control.restRes.status);
        expect(carried.restRes.body).toEqual(control.restRes.body);
        expect(JSON.stringify(carried.restRes.body)).not.toContain('a write answer');
        expect(carried.rest.events.map((e) => e.outcome)).toEqual(control.rest.events.map((e) => e.outcome));
    });

    it('the MCP bridge throws the refusal with no answer attached, and the audit row says failed', async () => {
        const carried = await viaBothDoors(async () => { throw carrying(); });
        expect(carried.mcpOut.value).toBeUndefined();
        expect(carried.mcpOut.err?.code).toBe('ERR_SUMMARY_RECOMPUTE');
        expect(earnedAnswerOf(carried.mcpOut.err)).toBeUndefined();
        expect(carried.mcp.events).toHaveLength(1);
        expect(carried.mcp.events[0]).toMatchObject({ actionName: ACTION.name, outcome: 'failed' });
    });
});

describe('[#28861] the stale column is said, at error', () => {
    it('once per field per process', () => {
        const lines = errorLog.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.includes('could not be recomputed'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(`"${OBJECT}.visit_count"`);
        expect(lines[0]).toContain(`"${CHILD}"`);
    });
});
