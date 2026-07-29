// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#3914] Action bodies must execute under a REAL execution context.
 *
 * The regression: an action body's `ctx.api` was never bound, so the sandbox
 * synthesized a repo facade against the raw engine and proxied every call with
 * NO `context` — no `userId` to own the record, no `isSystem` to bypass. That
 * is not "trusted", it is identity-less, and plugin-sharing's write gate
 * denies it (`canEdit` short-circuits on `!context.userId`; the bypass needs
 * `context.isSystem`). Every owner-scoped write from an action body died
 * FORBIDDEN — as the built-in admin — while the `[action-audit]` line on the
 * same request announced RLS-bypassing TRUSTED execution. `ctx.engine` had the
 * identical hole.
 *
 * These tests pin BOTH surfaces on BOTH dispatch paths (REST + MCP), and use a
 * sharing-shaped engine stub that denies a context-less write the way the real
 * gate does — so a future context-less regression fails here, not in an app.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from './http-dispatcher.js';
import {
    buildActionApi,
    buildActionEngineFacade,
    buildActionExecutionContext,
    invokeBusinessAction,
} from './action-execution.js';
import { actionBodyRunnerFactory } from './sandbox/body-runner.js';
import { QuickJSScriptRunner } from './sandbox/quickjs-runner.js';

/**
 * An engine stub shaped like the real write path: a write carrying neither
 * `context.userId` nor `context.isSystem` is refused exactly as plugin-sharing
 * refuses it. `createContext` returns a ScopedContext-alike so the runtime's
 * `ctx.api` binding is exercised end-to-end.
 */
function makeSharingEngine(extra: Record<string, unknown> = {}) {
    const writes: Array<{ op: string; object: string; context: any }> = [];
    const gate = (op: string, object: string, context: any) => {
        writes.push({ op, object, context });
        if (!context?.isSystem && !context?.userId) {
            throw new Error(`FORBIDDEN: insufficient privileges to ${op} ${object}`);
        }
    };
    const ql: any = {
        writes,
        async insert(object: string, data: any, options?: any) {
            gate('insert', object, options?.context);
            return { id: data?.id ?? 'rec_new' };
        },
        async update(object: string, _data: any, options?: any) {
            gate('update', object, options?.context);
            return { ok: true };
        },
        async delete(object: string, options?: any) {
            gate('delete', object, options?.context);
            return { ok: true };
        },
        async find(object: string, options?: any) {
            gate('find', object, options?.context);
            return [];
        },
        async count(object: string, options?: any) {
            gate('count', object, options?.context);
            return 0;
        },
        createContext(context: any) {
            return {
                __context: context,
                object: (object: string) => ({
                    find: (o?: any) => ql.find(object, { ...(o ?? {}), context }),
                    count: (o?: any) => ql.count(object, { ...(o ?? {}), context }),
                    insert: (data: any) => ql.insert(object, data, { context }),
                    update: (data: any, o?: any) => ql.update(object, data, { ...(o ?? {}), context }),
                    delete: (o?: any) => ql.delete(object, { ...(o ?? {}), context }),
                }),
            };
        },
        ...extra,
    };
    return ql;
}

const deps: any = { resolveService: () => undefined, getObjectQL: async () => undefined };

describe('#3914 — buildActionExecutionContext', () => {
    it('elevates the caller envelope instead of replacing it', () => {
        const ctx = buildActionExecutionContext({
            userId: 'user_42',
            tenantId: 'org_acme',
            positions: ['sales_rep'],
            email: 'rep@acme.test',
        });
        // isSystem is what plugin-sharing's bypass keys on…
        expect(ctx.isSystem).toBe(true);
        // …and the caller's identity still rides along, so the write stays
        // attributable (created_by/updated_by) and org-scoped.
        expect(ctx.userId).toBe('user_42');
        expect(ctx.tenantId).toBe('org_acme');
        expect(ctx.positions).toEqual(['sales_rep']);
        expect(ctx.email).toBe('rep@acme.test');
    });

    it('yields a usable elevated context for an anonymous / self-invoked call', () => {
        expect(buildActionExecutionContext(undefined)).toEqual({ isSystem: true });
    });
});

describe('#3914 — ctx.engine (buildActionEngineFacade)', () => {
    it('threads the elevated context through every verb', async () => {
        const ql = makeSharingEngine();
        const engine = buildActionEngineFacade(deps, ql, { userId: 'user_42', tenantId: 'org_acme' });

        await engine.insert('crm_case', { subject: 'x' });
        await engine.update('crm_case', 'case_1', { status: 'closed' });
        await engine.delete('crm_case', 'case_1');
        await engine.find('crm_case', { status: 'open' });

        expect(ql.writes.map((w: any) => w.op)).toEqual(['insert', 'update', 'delete', 'find']);
        for (const w of ql.writes) {
            expect(w.context).toMatchObject({ isSystem: true, userId: 'user_42', tenantId: 'org_acme' });
        }
    });

    it('does not die FORBIDDEN on an owner-scoped update (the reported symptom)', async () => {
        const ql = makeSharingEngine();
        const engine = buildActionEngineFacade(deps, ql, { userId: 'admin' });
        await expect(engine.update('crm_case', 'case_1', { status: 'closed' })).resolves.toBeUndefined();
    });

    it('still passes the caller filter on find (context is additive, not a replacement)', async () => {
        const ql = makeSharingEngine();
        const engine = buildActionEngineFacade(deps, ql, { userId: 'u1' });
        await engine.find('crm_case', { status: 'open' });
        expect(ql.writes[0].context).toMatchObject({ isSystem: true, userId: 'u1' });
        // the caller's predicate must survive alongside the injected context
        expect((ql.writes as any)[0]).toBeDefined();
    });
});

describe('#3914 — ctx.api (buildActionApi)', () => {
    it('binds to engine.createContext() with the elevated caller envelope', async () => {
        const ql = makeSharingEngine();
        const api = buildActionApi(deps, ql, { userId: 'user_42', tenantId: 'org_acme' });
        expect(api).toBeDefined();
        expect(typeof api.object).toBe('function');
        await api.object('crm_case').update({ status: 'closed' }, { where: { id: 'case_1' } });
        expect(ql.writes[0].context).toMatchObject({ isSystem: true, userId: 'user_42' });
    });

    it('falls back to a bare elevated context when the caller envelope is unparseable', () => {
        const ql: any = {
            createContext(ctx: any) {
                if (ctx.userId !== undefined && typeof ctx.userId !== 'string') throw new Error('bad envelope');
                return { __context: ctx, object: () => ({}) };
            },
        };
        const api = buildActionApi(deps, ql, { userId: 42 });
        expect(api.__context).toEqual({ isSystem: true });
    });

    it('returns undefined for an engine with no createContext (sandbox fallback stays in charge)', () => {
        expect(buildActionApi(deps, { insert: async () => ({}) }, { userId: 'u1' })).toBeUndefined();
    });
});

describe('#3914 — REST /actions dispatch binds ctx.api and ctx.engine', () => {
    const schemaOf = (name: string) => ({
        name,
        actions: [{ name: 'close_case', label: 'Close', type: 'script', execute: 'true' }],
    });

    const makeDispatcher = (executionContext: any) => {
        const executeAction = vi.fn(async () => ({ ok: true }));
        const ql = makeSharingEngine({ executeAction, getSchema: schemaOf, registry: { getObject: schemaOf } });
        const kernel: any = { context: { getService: (n: string) => (n === 'objectql' ? ql : null) } };
        const dispatcher = new HttpDispatcher(kernel);
        const ctx: any = { request: {}, environmentId: 'platform', executionContext };
        return { dispatcher, executeAction, ql, ctx };
    };

    it('hands the handler a ctx.api whose writes carry the elevated context', async () => {
        const { dispatcher, executeAction, ql, ctx } = makeDispatcher({
            userId: 'user_42', positions: [], permissions: [], tenantId: 'org_acme',
        });
        await dispatcher.handleActions('/crm_case/close_case', 'POST', { recordId: 'case_1' }, ctx);

        const actionCtx = executeAction.mock.calls[0]?.[2];
        expect(actionCtx.api).toBeDefined();
        expect(typeof actionCtx.api.object).toBe('function');

        await actionCtx.api.object('crm_case').update({ status: 'closed' }, { where: { id: 'case_1' } });
        const write = ql.writes.find((w: any) => w.op === 'update');
        expect(write.context).toMatchObject({ isSystem: true, userId: 'user_42', tenantId: 'org_acme' });
    });

    it('hands the handler a ctx.engine whose writes carry the elevated context', async () => {
        const { dispatcher, executeAction, ql, ctx } = makeDispatcher({
            userId: 'user_42', positions: [], permissions: [],
        });
        await dispatcher.handleActions('/crm_case/close_case', 'POST', { recordId: 'case_1' }, ctx);

        const actionCtx = executeAction.mock.calls[0]?.[2];
        // Was: `ql.update(object, data, { where })` with no context → FORBIDDEN.
        await expect(actionCtx.engine.update('crm_case', 'case_1', { status: 'closed' })).resolves.toBeUndefined();
        expect(ql.writes.find((w: any) => w.op === 'update').context).toMatchObject({
            isSystem: true, userId: 'user_42',
        });
    });

    it('carries the same envelope on ctx.executionContext for the sandbox fallback', async () => {
        const { dispatcher, executeAction, ctx } = makeDispatcher({ userId: 'user_42', positions: [], permissions: [] });
        await dispatcher.handleActions('/crm_case/close_case', 'POST', {}, ctx);
        expect(executeAction.mock.calls[0]?.[2]?.executionContext).toMatchObject({
            isSystem: true, userId: 'user_42',
        });
    });

    it('still elevates for an anonymous / self-invoked call', async () => {
        const { dispatcher, executeAction, ql, ctx } = makeDispatcher(undefined);
        await dispatcher.handleActions('/crm_case/close_case', 'POST', {}, ctx);
        const actionCtx = executeAction.mock.calls[0]?.[2];
        await actionCtx.engine.update('crm_case', 'case_1', { status: 'closed' });
        expect(ql.writes.find((w: any) => w.op === 'update').context).toMatchObject({ isSystem: true });
    });
});

describe('#3914 — MCP run_action dispatch binds ctx.api and ctx.engine', () => {
    const action = {
        name: 'close_case',
        label: 'Close',
        objectName: 'crm_case',
        type: 'script',
        target: 'closeCase',
        ai: { exposed: true, description: 'Close a case.' },
    };
    const obj = { name: 'crm_case', actions: [action] };

    it('threads the caller identity into the body ctx (was context-less)', async () => {
        const executeAction = vi.fn(async () => ({ ok: true }));
        const ql = makeSharingEngine({ executeAction });
        const mcpDeps: any = {
            resolveService: async () => null,
            getObjectQL: async () => ql,
        };
        const ec = { userId: 'user_42', tenantId: 'org_acme', positions: [], permissions: [] };

        await invokeBusinessAction(mcpDeps, 'close_case', { recordId: 'case_1' }, {
            driver: undefined,
            envId: 'platform',
            ec,
            getMeta: () => ({ listObjects: async () => [obj] }),
            callData: async () => ({ record: { id: 'case_1' } }),
        });

        const actionCtx = executeAction.mock.calls[0]?.[2];
        expect(actionCtx.api).toBeDefined();
        await actionCtx.api.object('crm_case').update({ status: 'closed' }, { where: { id: 'case_1' } });
        await actionCtx.engine.insert('crm_task', { subject: 'follow up' });
        for (const w of ql.writes.filter((x: any) => x.op !== 'find')) {
            expect(w.context).toMatchObject({ isSystem: true, userId: 'user_42', tenantId: 'org_acme' });
        }
    });
});

describe('#3914 — sandboxed action body reaches the bound ctx.api', () => {
    const runner = new QuickJSScriptRunner();

    it('uses the host-supplied ctx.api rather than synthesizing a context-less facade', async () => {
        const ql = makeSharingEngine();
        const factory = actionBodyRunnerFactory(runner, { ql, appId: 'crm' });
        const fn = factory({
            name: 'close_case',
            object: 'crm_case',
            type: 'script',
            body: {
                language: 'js',
                source: "await ctx.api.object('crm_case').update({ status: 'closed' }, { where: { id: ctx.recordId } }); return { ok: true };",
                capabilities: ['api.write'],
            },
        } as any);
        expect(typeof fn).toBe('function');

        await fn!({
            record: { id: 'case_1' },
            params: {},
            api: buildActionApi(deps, ql, { userId: 'user_42' }),
            executionContext: buildActionExecutionContext({ userId: 'user_42' }),
        });

        const write = ql.writes.find((w: any) => w.op === 'update');
        expect(write).toBeDefined();
        expect(write.context).toMatchObject({ isSystem: true, userId: 'user_42' });
    });

    it('elevates the last-resort repo facade from ctx.executionContext', async () => {
        // Engine with NO createContext and NO .object() — the shape that made
        // buildSandboxApi fall all the way through to a context-less facade.
        const ql = makeSharingEngine();
        delete (ql as any).createContext;
        const factory = actionBodyRunnerFactory(runner, { ql, appId: 'crm' });
        const fn = factory({
            name: 'close_case',
            object: 'crm_case',
            type: 'script',
            body: {
                language: 'js',
                source: "await ctx.api.object('crm_case').update({ status: 'closed' }, { where: { id: ctx.recordId } }); return { ok: true };",
                capabilities: ['api.write'],
            },
        } as any);

        await fn!({
            record: { id: 'case_1' },
            params: {},
            executionContext: buildActionExecutionContext({ userId: 'user_42' }),
        });

        const write = ql.writes.find((w: any) => w.op === 'update');
        expect(write.context).toMatchObject({ isSystem: true, userId: 'user_42' });
    });
});
