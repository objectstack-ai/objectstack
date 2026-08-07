// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4705 — the AI routes' `req.user` must carry the CAPABILITY channel, and it
 * must stay a channel of its own.
 *
 * `resolveAuthzContext` resolves a caller into two lists that look alike and
 * are not (core/src/security/resolve-authz-context.ts):
 *
 *   - `permissions`       — permission-SET NAMES (`admin_full_access`,
 *                           `organization_admin`, `member_default`) plus the
 *                           synthesized `ai_seat`.
 *   - `systemPermissions` — CAPABILITIES (`manage_metadata`, `studio.access`,
 *                           `setup.access`, …), the union of every resolved
 *                           set's `systemPermissions[]`.
 *
 * `resolveExecutionContext` surfaces both, side by side. `domains/ai.ts` copied
 * only the first onto `req.user`, which made `/ai/*` the single route domain in
 * the repo where a capability gate could not be written: every other surface
 * tests `systemPermissions` (`domains/meta.ts`'s `manage_metadata` gate,
 * `action-execution.ts`, `rest/src/rest-server.ts`), so the same test written
 * against an AI route's `req.user.permissions` is permanently false — which
 * shuts the route on platform admins instead of tightening it. That is the
 * blocker cloud#1015 hit when it went to gate
 * `POST /api/v1/ai/tools/:toolName/execute`.
 *
 * These tests pin the transport, not a policy: no route in this repo gates on
 * the field. Three things must hold, and the third is why the first two are not
 * enough on their own —
 *
 *   1. a capability held on the ExecutionContext ARRIVES on
 *      `req.user.systemPermissions`;
 *   2. a caller holding none gets `[]`, never `undefined` (fail-closed, and it
 *      spares every consumer a `?? []` of its own);
 *   3. `permissions` still carries set names + `ai_seat` VERBATIM — the two
 *      channels are copied side by side, never merged. Flattening one into the
 *      other would corrupt every existing reader of `permissions` while looking
 *      like it fixed this.
 */

import { describe, it, expect } from 'vitest';

import { handleAIRequest } from './ai.js';
import { createDispatcherPlugin } from '../dispatcher-plugin.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

const TOOL_ROUTE = '/api/v1/ai/tools/:toolName/execute';

/** Captures the `req` the AI route handler is dispatched with. */
function makeDeps(seen: { req?: any }): DomainHandlerDeps {
    const aiService: any = { chat: async () => ({ text: 'ok' }) };
    return {
        // [#5155] The request comes first on every kernel-reading facility —
        // including the AI route table, which is cached on the request's own
        // kernel (`__aiRoutes`), not on the host's.
        resolveService: (async (_ctx: HttpProtocolContext, name: string) => (name === 'ai' ? aiService : undefined)) as any,
        getRegisteredAiRoutes: (_ctx: HttpProtocolContext) => [
            {
                method: 'POST',
                path: TOOL_ROUTE,
                auth: true,
                handler: async (req: any) => {
                    seen.req = req;
                    return { status: 200, body: { success: true, data: { ok: true } } };
                },
            },
        ],
        success: (data: any) => ({ status: 200, body: { success: true, data } }),
        error: (message: string, httpStatus = 500) => ({ status: httpStatus, body: { success: false, error: { message } } }),
        routeNotFound: (route: string) => ({ status: 404, body: { success: false, error: { code: 'ROUTE_NOT_FOUND', route } } }),
    } as unknown as DomainHandlerDeps;
}

/** Dispatch `POST /ai/tools/create_object/execute` under `executionContext`. */
async function dispatchToolExecute(executionContext: any) {
    const seen: { req?: any } = {};
    const context = { executionContext } as unknown as HttpProtocolContext;
    const result = await handleAIRequest(
        makeDeps(seen),
        '/ai/tools/create_object/execute',
        'POST',
        {},
        {},
        context,
    );
    return { result, user: seen.req?.user, req: seen.req };
}

describe('#4705 — /ai/* req.user carries the capability channel', () => {
    it('surfaces ec.systemPermissions on req.user.systemPermissions', async () => {
        // A platform admin as `resolveAuthzContext` actually resolves one: the
        // set NAME in `permissions`, the capabilities it grants in
        // `systemPermissions` (plugin-security's `admin_full_access` declares
        // `manage_metadata` / `studio.access` / `setup.access` there).
        const { user, result } = await dispatchToolExecute({
            userId: 'usr_admin',
            // [#5372] Was `userEmail:` — a spelling `ExecutionContextSchema`
            // does not declare and nothing ever assigned, matching the equally
            // undeclared key `domains/ai.ts` used to read. The declared field
            // is `email`; the fixture states a real ExecutionContext now.
            email: 'admin@objectos.ai',
            positions: ['platform_admin'],
            permissions: ['admin_full_access', 'ai_seat'],
            systemPermissions: ['manage_users', 'manage_metadata', 'studio.access', 'setup.access'],
            tenantId: 'org_1',
        });

        expect(result.handled).toBe(true);
        // The whole point of the issue: a capability gate on an AI route can
        // now be written and can actually pass for someone who holds it.
        expect(user.systemPermissions).toEqual([
            'manage_users', 'manage_metadata', 'studio.access', 'setup.access',
        ]);
        expect(new Set<string>(user.systemPermissions).has('manage_metadata')).toBe(true);
    });

    it('keeps `permissions` = permission-set names + ai_seat, unmerged with capabilities', async () => {
        const { user } = await dispatchToolExecute({
            userId: 'usr_admin',
            permissions: ['admin_full_access', 'ai_seat'],
            systemPermissions: ['manage_metadata', 'studio.access'],
            positions: ['platform_admin'],
        });

        // Verbatim — the set-name channel is untouched by the addition, and
        // `ai_seat` (synthesized by resolveExecutionContext) still rides it.
        expect(user.permissions).toEqual(['admin_full_access', 'ai_seat']);
        // The position channel, under its one canonical spelling — the `roles`
        // alias this line used to read was retired in #6011. Substance kept:
        // positions are still a THIRD channel, unmerged with either permission
        // list, which is what this case exists to prove.
        expect(user.positions).toEqual(['platform_admin']);
        expect('roles' in user).toBe(false);
        // …and neither list has absorbed the other. A capability must NOT be
        // readable off `permissions`, nor a set name off `systemPermissions`:
        // that conflation is the failure mode this issue exists to prevent.
        expect(user.permissions).not.toContain('manage_metadata');
        expect(user.systemPermissions).not.toContain('admin_full_access');
        expect(user.systemPermissions).not.toContain('ai_seat');
    });

    it('gives a caller with no capabilities [] — not undefined', async () => {
        // An ordinary member: holds an AI seat, holds no capability. The
        // ExecutionContext omits the field entirely (it is optional on
        // `ExecutionContextSchema`), which is the shape a consumer would
        // otherwise have to tolerate with a `?? []` of its own.
        const { user } = await dispatchToolExecute({
            userId: 'usr_member',
            permissions: ['member_default', 'ai_seat'],
            positions: ['member'],
        });

        expect(user.systemPermissions).toEqual([]);
        expect(user.systemPermissions).not.toBeUndefined();
        expect(new Set<string>(user.systemPermissions).has('manage_metadata')).toBe(false);
    });

    it('fails closed when ec.systemPermissions is not an array', async () => {
        const { user } = await dispatchToolExecute({
            userId: 'usr_member',
            permissions: ['member_default'],
            // A malformed/stringified value must never become authority.
            systemPermissions: 'manage_metadata',
        });

        expect(user.systemPermissions).toEqual([]);
    });
});

// ── The OTHER producer of an AI-route `req.user` ────────────────────────────
// `dispatcher-plugin`'s `resolveRequestUser` backs the concrete per-route
// mounts. It has no ExecutionContext to read, so it stays capability-less on
// purpose — but it must say so in the SAME shape, otherwise a consumer sees
// `undefined` on one path and `[]` on the other and reaches for a fallback to
// paper over the difference.

function makeFakeServer() {
    const routes: string[] = [];
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const rec = (verb: string) => (path: string, handler: any) => {
        routes.push(`${verb} ${path}`);
        handlers[`${verb} ${path}`] = handler;
    };
    return {
        routes,
        handlers,
        server: {
            get: rec('GET'), post: rec('POST'), put: rec('PUT'),
            delete: rec('DELETE'), patch: rec('PATCH'),
        },
    };
}

function makeCtx(fakeServer: any, aiRoutes: any[], onRequest: (req: any) => void, session?: any) {
    const kernel: any = {
        getService: () => undefined,
        getServiceAsync: async () => undefined,
        // The AIServicePlugin's cross-plugin cache the dispatcher recovers
        // routes from when the `ai:routes` hook fired before it was listening.
        __aiRoutes: aiRoutes.map((r) => ({
            ...r,
            handler: async (req: any) => { onRequest(req); return { status: 200, body: { ok: true } }; },
        })),
    };
    const authService: any = {
        api: {
            getSession: async () => session ?? ({
                user: { id: 'usr_admin', name: 'Admin', email: 'admin@objectos.ai' },
                session: { activeOrganizationId: 'org_1' },
            }),
        },
    };
    return {
        getKernel: () => kernel,
        getService: (name: string) =>
            name === 'http.server' ? fakeServer : name === 'auth' ? authService : undefined,
        environmentId: undefined,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        hook: () => {},
        on: () => {},
    } as any;
}

describe('#4705 — the concrete-mount producer agrees on the shape', () => {
    it('resolveRequestUser emits systemPermissions: [] (fail-closed, never undefined)', async () => {
        const { server, handlers } = makeFakeServer();
        let seen: any;
        const ctx = makeCtx(
            server,
            [{ method: 'POST', path: '/ai/tools/:toolName/execute', description: 'x', auth: true }],
            (req) => { seen = req; },
        );
        const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
        await plugin.start?.(ctx);

        const handler = handlers[`POST ${TOOL_ROUTE}`];
        expect(handler).toBeTypeOf('function');
        const res = { status() { return res; }, header() { return res; }, json() { return res; } } as any;
        await handler({ headers: {}, body: {}, params: { toolName: 'create_object' }, query: {} }, res);

        expect(seen.user.userId).toBe('usr_admin');
        // No ExecutionContext here → no authority, stated explicitly. Same
        // shape as the dispatch path, so a consumer needs no `?? []`.
        expect(seen.user.permissions).toEqual([]);
        expect(seen.user.systemPermissions).toEqual([]);
        // [#5372] …and the SAME key set, including the identity keys. This
        // producer reads the session's own `user.name` (better-auth's
        // projection of `sys_user.name`), so it needs no lookup of its own —
        // but it must answer under both spellings, like every other path.
        expect(seen.user.name).toBe('Admin');
        expect(seen.user.displayName).toBe('Admin');
        expect(Object.keys(seen.user).sort()).toEqual([
            'displayName', 'email', 'id', 'isPlatformAdmin', 'name', 'organizationId',
            'permissions', 'positions', 'systemPermissions', 'userId',
        ]);
    });

    it('[#5372] a session with no display name falls back to the id, not the email', async () => {
        // The biconditional the dispatch paths hold to: `name === id` means
        // "no display name", on every producer. The address stays reachable
        // under its own key — it is not a stand-in for a name.
        const { server, handlers } = makeFakeServer();
        let seen: any;
        const ctx = makeCtx(
            server,
            [{ method: 'POST', path: '/ai/tools/:toolName/execute', description: 'x', auth: true }],
            (req) => { seen = req; },
            { user: { id: 'usr_admin', email: 'admin@objectos.ai' }, session: {} },
        );
        const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
        await plugin.start?.(ctx);

        const res = { status() { return res; }, header() { return res; }, json() { return res; } } as any;
        await handlers[`POST ${TOOL_ROUTE}`](
            { headers: {}, body: {}, params: { toolName: 'create_object' }, query: {} }, res,
        );

        expect(seen.user.name).toBe('usr_admin');
        expect(seen.user.email).toBe('admin@objectos.ai');
    });

    it('mounts the /ai/* dispatch wildcard BEFORE the concrete AI routes', async () => {
        // Why the capability-less resolver above is not the live path: the
        // method-wildcards `registerAIRoutes` mounts go through
        // `dispatcher.dispatch()` → `domains/ai.ts`, i.e. the
        // ExecutionContext-backed `req.user`. They are registered earlier in
        // `start()`, so they answer a real `/api/v1/ai/...` request first.
        // Reordering these two would silently hand `/ai/*` back to the
        // capability-less producer — and a gate built on cloud#1015's contract
        // would start 403-ing platform admins again.
        const { server, routes } = makeFakeServer();
        const ctx = makeCtx(
            server,
            [{ method: 'POST', path: '/ai/tools/:toolName/execute', description: 'x', auth: true }],
            () => {},
        );
        const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
        await plugin.start?.(ctx);

        const wildcard = routes.indexOf('POST /api/v1/ai/*');
        const concrete = routes.indexOf(`POST ${TOOL_ROUTE}`);
        expect(wildcard).toBeGreaterThanOrEqual(0);
        expect(concrete).toBeGreaterThanOrEqual(0);
        expect(wildcard).toBeLessThan(concrete);
    });
});
