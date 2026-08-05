// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5372] `ctx.user.name` is the acting user's DISPLAY NAME, on every path.
 *
 * The defect these tests pin is not a missing key — it is a declared key
 * delivering a plausible WRONG value, which is strictly worse: `ctx.user.name`
 * read as a perfectly good string, so no consumer-side `??` could tell that it
 * was the raw user id, and app code that trusted the declaration wrote opaque
 * ids into user-facing surfaces (objectstack-ai/hotcrm#673's activity
 * timeline).
 *
 * Three dispatchers built the user object three different ways:
 *
 *   - REST `/actions` hardcoded `name: ec.userId`;
 *   - MCP `run_action` read `ec.userName ?? ec.userDisplayName ?? ec.userId`
 *     — neither alias is declared on `ExecutionContextSchema` and nothing in
 *     the repo ever assigned either, so the only reachable arm was the id;
 *   - the AI routes spelled the key `displayName` (same dead chain) and read
 *     the caller's address off `ec.userEmail`, which is not the declared field
 *     (`ec.email`), so `user.email` there was permanently `undefined`.
 *
 * So the assertions come in three families:
 *   1. the VALUE — `name` is `sys_user.name`, and `name === id` happens if and
 *      only if the user has no resolvable display name (both directions);
 *   2. the SHAPE — all three paths, plus the AI routes' second producer, emit
 *      ONE key set, so a body/handler never branches on which door it came in;
 *   3. the FAILURE MODE — a name that cannot be resolved is quiet: the
 *      dispatch still succeeds and `name` falls back to the id. A display name
 *      is not worth failing an action over.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from './http-dispatcher.js';
import { invokeBusinessAction } from './action-execution.js';
import { handleAIRequest } from './domains/ai.js';
import { actionBodyRunnerFactory } from './sandbox/body-runner.js';
import { QuickJSScriptRunner } from './sandbox/quickjs-runner.js';
import type { DomainHandlerDeps } from './domain-handler-registry.js';
import type { HttpProtocolContext } from './http-dispatcher.js';

const ACTION = {
    name: 'close_case',
    label: 'Close',
    objectName: 'crm_case',
    type: 'script',
    target: 'closeCase',
    ai: { exposed: true, description: 'Close a case.' },
};
const OBJECT_DEF = { name: 'crm_case', actions: [ACTION] };

/** The acting principal, as `resolveExecutionContext` actually builds one. */
function makeEc(overrides: Record<string, unknown> = {}) {
    return {
        userId: 'usr_admin',
        email: 'admin@objectos.ai',
        tenantId: 'org_1',
        positions: ['platform_admin'],
        permissions: ['admin_full_access'],
        systemPermissions: ['manage_metadata'],
        ...overrides,
    };
}

/**
 * An engine whose `sys_user` read answers with `row`. `undefined` = the row is
 * not there at all (a service principal, a deleted account); `throws: true` =
 * the read itself fails.
 */
function makeQl(row: Record<string, unknown> | undefined, opts: { throws?: boolean } = {}) {
    const executeAction = vi.fn(async () => ({ ok: true }));
    const userReads: any[] = [];
    const schemaOf = (n: string) => (n === OBJECT_DEF.name ? OBJECT_DEF : undefined);
    const ql: any = {
        executeAction,
        userReads,
        getSchema: schemaOf,
        registry: { getObject: schemaOf, getItem: () => undefined },
        find: vi.fn(async (object: string, options?: any) => {
            if (object === 'sys_user') {
                userReads.push(options);
                if (opts.throws) throw new Error('sys_user unavailable');
                return row ? [row] : [];
            }
            return [{ id: 'case_1', status: 'open' }];
        }),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    return ql;
}

/** REST — `POST /actions/crm_case/close_case/case_1`. Returns the body ctx. */
async function dispatchRest(ec: any, ql: any, context?: HttpProtocolContext) {
    const kernel: any = {
        context: { getService: (n: string) => (n === 'objectql' || n === 'data' ? ql : null) },
    };
    const ctx = context ?? ({ request: {}, environmentId: 'platform', executionContext: ec } as any);
    const res: any = await new HttpDispatcher(kernel).handleActions(
        '/crm_case/close_case/case_1', 'POST', {}, ctx,
    );
    return { response: res.response, actionCtx: ql.executeAction.mock.calls[0]?.[2] };
}

/** MCP — `run_action`. Returns the body ctx. */
async function dispatchMcp(ec: any, ql: any) {
    const deps: any = { resolveService: async () => null, getObjectQL: async () => ql };
    await invokeBusinessAction(deps, { request: {} } as any, 'close_case', { recordId: 'case_1' }, {
        driver: undefined,
        envId: 'platform',
        ec,
        getMeta: () => ({ listObjects: async () => [OBJECT_DEF] }),
        callData: async () => ({ record: { id: 'case_1' } }),
    });
    return { actionCtx: ql.executeAction.mock.calls[0]?.[2] };
}

const AI_ROUTE = '/api/v1/ai/tools/:toolName/execute';

/** AI route — `POST /ai/tools/create_object/execute`. Returns the handler's `req.user`. */
async function dispatchAi(ec: any, ql: any) {
    const seen: { req?: any } = {};
    const deps = {
        resolveService: (async (_c: any, name: string) => (name === 'ai' ? { chat: async () => ({}) } : undefined)) as any,
        getObjectQL: async () => ql,
        getRegisteredAiRoutes: () => [{
            method: 'POST', path: AI_ROUTE, auth: true,
            handler: async (req: any) => { seen.req = req; return { status: 200, body: { success: true, data: {} } }; },
        }],
        success: (data: any) => ({ status: 200, body: { success: true, data } }),
        error: (message: string, httpStatus = 500) => ({ status: httpStatus, body: { success: false, error: { message } } }),
        routeNotFound: (route: string) => ({ status: 404, body: { success: false, error: { route } } }),
    } as unknown as DomainHandlerDeps;
    await handleAIRequest(
        deps, '/ai/tools/create_object/execute', 'POST', {}, {},
        { executionContext: ec } as unknown as HttpProtocolContext,
    );
    return seen.req?.user;
}

const DEV_ADMIN = { id: 'usr_admin', name: 'Dev Admin', email: 'admin@objectos.ai' };

describe('#5372 — the VALUE: ctx.user.name is sys_user.name, not the id', () => {
    it('REST /actions — the path that was hardcoded to the id', async () => {
        const { actionCtx } = await dispatchRest(makeEc(), makeQl(DEV_ADMIN));

        expect(actionCtx.user.name).toBe('Dev Admin');
        expect(actionCtx.user.name).not.toBe(actionCtx.user.id);
        expect(actionCtx.user.id).toBe('usr_admin');
        // The alias carries the SAME value — one name, two spellings, never two
        // different answers.
        expect(actionCtx.user.displayName).toBe('Dev Admin');
    });

    it('MCP run_action — same value through the other dispatcher', async () => {
        const { actionCtx } = await dispatchMcp(makeEc(), makeQl(DEV_ADMIN));

        expect(actionCtx.user.name).toBe('Dev Admin');
        expect(actionCtx.user.displayName).toBe('Dev Admin');
        expect(actionCtx.user.id).toBe('usr_admin');
    });

    it('AI route req.user — same value again', async () => {
        const user = await dispatchAi(makeEc(), makeQl(DEV_ADMIN));

        expect(user.name).toBe('Dev Admin');
        expect(user.displayName).toBe('Dev Admin');
        // `email` used to read `ec.userEmail`, a field ExecutionContext does
        // not declare — permanently undefined. It reads the declared one now.
        expect(user.email).toBe('admin@objectos.ai');
    });

    it('a real sandboxed body reads it — end to end, dispatcher → VM', async () => {
        // `buildActionSandboxContext` was never where the name was lost (it
        // passes `actionCtx.user` through verbatim), so this closes the loop
        // on the OTHER end: what an author actually writes in a body.
        const ql = makeQl(DEV_ADMIN);
        const { actionCtx } = await dispatchRest(makeEc(), ql);
        const fn = actionBodyRunnerFactory(new QuickJSScriptRunner(), { ql, appId: 'crm' })({
            name: 'close_case',
            object: 'crm_case',
            type: 'script',
            body: { language: 'js', source: 'return ctx.user.name;', capabilities: [] },
        } as any);

        await expect(fn!(actionCtx)).resolves.toBe('Dev Admin');
    }, 60_000);
});

describe('#5372 — the VALUE, other direction: name === id iff there is no display name', () => {
    it('a sys_user row with no name falls back to the id', async () => {
        const { actionCtx } = await dispatchRest(makeEc(), makeQl({ id: 'usr_admin', email: 'a@b.c' }));

        expect(actionCtx.user.name).toBe('usr_admin');
        expect(actionCtx.user.name).toBe(actionCtx.user.id);
    });

    it('a blank/whitespace name is no display name', async () => {
        const { actionCtx } = await dispatchRest(makeEc(), makeQl({ id: 'usr_admin', name: '   ' }));

        expect(actionCtx.user.name).toBe('usr_admin');
    });

    it('no sys_user row at all (a principal with no profile) falls back to the id', async () => {
        const { actionCtx } = await dispatchRest(makeEc(), makeQl(undefined));

        expect(actionCtx.user.name).toBe('usr_admin');
    });

    it('a SELF-INVOKED dispatch is the `system` principal, unchanged (#2701); anonymous is 401 (#5519)', async () => {
        // REPLACED, not re-spelled: driven with `undefined` this was the
        // ANONYMOUS shape, and #5519 denies that at the door — `executeAction`
        // is never called, so `actionCtx` would be `undefined` and every
        // assertion below would read off nothing.
        //
        // The `system`-principal shape #2701 pinned is still real for the
        // caller that reaches the body without a `userId`: the self-invoked
        // `isSystem` context.
        const { actionCtx } = await dispatchRest({ isSystem: true }, makeQl(DEV_ADMIN));

        expect(actionCtx.user.id).toBe('system');
        expect(actionCtx.user.name).toBe('system');
        // …and it still carries the empty authority arrays, so a body reads
        // "holds nothing" rather than needing a `?? []`.
        expect(actionCtx.user.permissions).toEqual([]);
        expect(actionCtx.user.systemPermissions).toEqual([]);
    });

    it('a genuinely ANONYMOUS dispatch never reaches the body at all (#5519)', async () => {
        const ql = makeQl(DEV_ADMIN);
        const { response } = await dispatchRest(undefined, ql);

        expect(response.status).toBe(401);
        expect(ql.executeAction).not.toHaveBeenCalled();
    });
});

describe('#5372 — the FAILURE MODE: an unresolvable name is quiet', () => {
    it('a failing sys_user read falls back to the id and the action still runs', async () => {
        const ql = makeQl(DEV_ADMIN, { throws: true });
        const { response, actionCtx } = await dispatchRest(makeEc(), ql);

        expect(response.status).toBe(200);
        expect(actionCtx.user.name).toBe('usr_admin');
    });

    it('an engine with no `find` at all does not break the dispatch', async () => {
        const ql = makeQl(DEV_ADMIN);
        delete (ql as any).find;
        // The record pre-load needs `find` too, so this also proves the name
        // resolution is not what turns a degraded engine into a 500.
        const { response, actionCtx } = await dispatchRest(makeEc(), ql);

        expect(response.status).toBe(200);
        expect(actionCtx.user.name).toBe('usr_admin');
    });

    it('the read is system-elevated — resolving WHO the caller is cannot depend on their own grants', async () => {
        const ql = makeQl(DEV_ADMIN);
        await dispatchRest(makeEc(), ql);

        expect(ql.userReads[0]).toMatchObject({
            where: { id: 'usr_admin' }, limit: 1, context: { isSystem: true },
        });
    });

    it('resolves ONCE per request, however many actions the request dispatches', async () => {
        const ql = makeQl(DEV_ADMIN);
        const ec = makeEc();
        // One ExecutionContext object = one inbound request. The memo is keyed
        // on its identity, so nothing is cached across requests and a renamed
        // user is correct on their very next one.
        const context: any = { request: {}, environmentId: 'platform', executionContext: ec };
        await dispatchRest(ec, ql, context);
        await dispatchRest(ec, ql, context);

        expect(ql.userReads.length).toBe(1);
        expect(ql.executeAction.mock.calls.length).toBe(2);
    });
});

describe('#5372 — the SHAPE: one key set across every producer', () => {
    it('REST, MCP and the AI route agree key-for-key', async () => {
        const ec = makeEc();
        const rest = (await dispatchRest(ec, makeQl(DEV_ADMIN))).actionCtx.user;
        const mcp = (await dispatchMcp(makeEc(), makeQl(DEV_ADMIN))).actionCtx.user;
        const ai = await dispatchAi(makeEc(), makeQl(DEV_ADMIN));

        const keys = (u: any) => Object.keys(u).sort();
        expect(keys(mcp)).toEqual(keys(rest));
        expect(keys(ai)).toEqual(keys(rest));
        // The EvalUser core (ADR-0068 D1: id/name/email/positions/
        // isPlatformAdmin/organizationId) plus the two transport channels and
        // the id/name aliases the dispatch surfaces already published.
        expect(keys(rest)).toEqual([
            'displayName', 'email', 'id', 'isPlatformAdmin', 'name', 'organizationId',
            'permissions', 'positions', 'roles', 'systemPermissions', 'userId',
        ]);
    });

    it('and value-for-value, for one and the same caller', async () => {
        const rest = (await dispatchRest(makeEc(), makeQl(DEV_ADMIN))).actionCtx.user;
        const mcp = (await dispatchMcp(makeEc(), makeQl(DEV_ADMIN))).actionCtx.user;
        const ai = await dispatchAi(makeEc(), makeQl(DEV_ADMIN));

        expect(mcp).toEqual(rest);
        expect(ai).toEqual(rest);
        expect(rest).toEqual({
            id: 'usr_admin',
            userId: 'usr_admin',
            name: 'Dev Admin',
            displayName: 'Dev Admin',
            email: 'admin@objectos.ai',
            positions: ['platform_admin'],
            roles: ['platform_admin'],
            // Derived by `createEvalUser`, never stored — ADR-0068 D2.
            isPlatformAdmin: true,
            permissions: ['admin_full_access'],
            systemPermissions: ['manage_metadata'],
            organizationId: 'org_1',
        });
    });

    it('the ADR-0090 position aliases stay in lockstep (`roles` is `positions`)', async () => {
        const { actionCtx } = await dispatchRest(makeEc({ positions: ['sales_rep'] }), makeQl(DEV_ADMIN));

        expect(actionCtx.user.positions).toEqual(['sales_rep']);
        expect(actionCtx.user.roles).toEqual(actionCtx.user.positions);
    });
});
