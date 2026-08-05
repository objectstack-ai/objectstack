// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5519 — the `/actions` and `/automation` anonymous baseline, through a REAL
 * boot and over a REAL socket.
 *
 * `domains/anonymous-gate-actions-automation.test.ts` pins the DECISION (which
 * caller the handler denies, and that nothing dispatches behind it). This file
 * pins the WIRING, and the distinction is the whole reason it exists: the gate
 * lives in the domain handler, but the routes are mounted by
 * `dispatcher-plugin.ts` straight onto the host `IHttpServer` — a separate
 * registration path from the one `@objectstack/rest` uses for `/data`, and
 * precisely the seam whose divergence #5519 is about. A unit test that calls
 * `handleActions()` directly cannot tell you that the MOUNTED route reaches the
 * gated handler; only a socket can. AGENTS.md states the rule flatly: "who
 * serves this path" is a question about the composed, provisioned runtime —
 * boot it or do not claim an answer. #3913 is the standing proof, where
 * `POST /actions//:action` was correct in the domain and unreachable on the
 * wire for exactly this reason.
 *
 * The pre-fix behaviour these replace, measured on a real showcase boot:
 *   POST /actions/showcase_task/showcase_mark_done/:id  → 200 {ok:true}
 *   POST /automation/showcase_reassign_wizard/trigger   → 200 {runId: run_…}
 *   GET  /automation                                    → 200 (full inventory)
 *   DELETE /automation/showcase_inquiry_janitor         → 200 {deleted:true}
 * …all with no credential of any kind, while `/data` on the same process
 * answered 401.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { LiteKernel, Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import type { IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

const SESSION_HEADER = 'x-test-session';

const executeAction = vi.fn(async () => ({ ok: true, wrote: 'system-elevated' }));
const automationExecute = vi.fn(async () => ({ success: true, status: 'paused', runId: 'run_1' }));
const unregisterFlow = vi.fn();
const listFlows = vi.fn(async () => ['crm_escalation_flow']);

/** One `script` action, declared on the object and carrying NO `requiredPermissions`. */
const scriptAction = {
    name: 'mark_primary',
    objectName: 'crm_contact',
    type: 'script',
    body: { language: 'js', source: 'return { ok: true };', capabilities: ['api.write'] },
};
const objectDef = { name: 'crm_contact', actions: [scriptAction] };

/**
 * `auth` slot in the shape `resolveExecutionContext` actually reads
 * (`authService.api.getSession({ headers })`). It answers a session only when
 * the request carries `x-test-session`, so ONE boot serves both the anonymous
 * and the authenticated case and the difference on the wire is a header —
 * which is exactly the difference the gate is supposed to key off.
 */
function servicesPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.services-5519',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('objectql', {
                executeAction,
                getSchema: (n: string) => (n === objectDef.name ? objectDef : undefined),
                registry: { getObject: (n: string) => (n === objectDef.name ? objectDef : undefined), getItem: () => undefined },
                find: async () => [],
                insert: async () => ({}), update: async () => ({}), delete: async () => ({}),
            });
            ctx.registerService('automation', {
                execute: automationExecute,
                unregisterFlow,
                listFlows,
                registerFlow: () => { /* unused */ },
                handlerReady: true,
            });
            ctx.registerService('auth', {
                api: {
                    getSession: async ({ headers }: any) =>
                        (headers?.get?.(SESSION_HEADER) ? { user: { id: 'u_socket' } } : undefined),
                },
            });
        },
    };
}

async function boot() {
    const kernel = new LiteKernel();
    kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
    kernel.use(servicesPlugin());
    kernel.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false }));
    await kernel.bootstrap();
    const httpServer = kernel.getService<IHttpServer>('http.server');
    return { kernel, baseUrl: `http://127.0.0.1:${httpServer.getPort!()}` };
}

describe('#5519 — the mounted /actions and /automation routes deny anonymous callers on the wire', () => {
    let kernel: LiteKernel;
    let baseUrl: string;

    beforeAll(async () => { ({ kernel, baseUrl } = await boot()); }, 60_000);
    afterAll(async () => {
        await Promise.race([kernel?.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }, 30_000);

    const post = (path: string, body: unknown, session = false) =>
        fetch(`${baseUrl}/api/v1${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(session ? { [SESSION_HEADER]: '1' } : {}) },
            body: JSON.stringify(body),
        });

    // ── /actions ────────────────────────────────────────────────────────────

    it('anonymous POST /api/v1/actions/:object/:action/:recordId → 401, body never runs', async () => {
        executeAction.mockClear();
        const res = await post('/actions/crm_contact/mark_primary/c1', { params: {} });

        expect(res.status).toBe(401);
        const body: any = await res.json();
        expect(body?.error?.code ?? body?.error?.details?.code).toBe('UNAUTHENTICATED');
        expect(body?.error?.message).toBe('Authentication is required to access this endpoint.');
        // The script body would have run system-elevated. It did not.
        expect(executeAction).not.toHaveBeenCalled();
    }, 60_000);

    it('anonymous POST /api/v1/actions/:object/:action (no recordId) → 401', async () => {
        executeAction.mockClear();
        const res = await post('/actions/crm_contact/mark_primary', {});

        expect(res.status).toBe(401);
        expect(executeAction).not.toHaveBeenCalled();
    }, 60_000);

    it('the SAME request with a session is served — the deny targets anonymity, not the route', async () => {
        executeAction.mockClear();
        const res = await post('/actions/crm_contact/mark_primary/c1', { params: {} }, true);

        expect(res.status).toBe(200);
        expect((await res.json())?.data).toMatchObject({ ok: true });
        expect(executeAction).toHaveBeenCalledTimes(1);
    }, 60_000);

    // ── /automation ─────────────────────────────────────────────────────────

    it('anonymous POST /api/v1/automation/:name/trigger → 401, no run started', async () => {
        automationExecute.mockClear();
        const res = await post('/automation/crm_escalation_flow/trigger', { recordId: 'c1' });

        expect(res.status).toBe(401);
        expect(automationExecute).not.toHaveBeenCalled();
    }, 60_000);

    it('anonymous POST /api/v1/automation/trigger/:name (the legacy SDK shape) → 401', async () => {
        automationExecute.mockClear();
        const res = await post('/automation/trigger/crm_escalation_flow', { recordId: 'c1' });

        expect(res.status).toBe(401);
        expect(automationExecute).not.toHaveBeenCalled();
    }, 60_000);

    it('anonymous GET /api/v1/automation → 401, the flow inventory stays private', async () => {
        listFlows.mockClear();
        const res = await fetch(`${baseUrl}/api/v1/automation`);

        expect(res.status).toBe(401);
        expect(listFlows).not.toHaveBeenCalled();
    }, 60_000);

    it('anonymous DELETE /api/v1/automation/:name → 401 — the destructive one', async () => {
        unregisterFlow.mockClear();
        const res = await fetch(`${baseUrl}/api/v1/automation/crm_escalation_flow`, { method: 'DELETE' });

        expect(res.status).toBe(401);
        expect(unregisterFlow).not.toHaveBeenCalled();
    }, 60_000);

    it('the same trigger with a session is served', async () => {
        automationExecute.mockClear();
        const res = await post('/automation/crm_escalation_flow/trigger', { recordId: 'c1' }, true);

        expect(res.status).toBe(200);
        expect(automationExecute).toHaveBeenCalledTimes(1);
        // Identity forwarding survives the gate — a `runAs: 'user'` flow still
        // learns who triggered it (#4127).
        expect(automationExecute.mock.calls[0]?.[1]).toMatchObject({ userId: 'u_socket' });
    }, 60_000);

    // ── one answer, one shape ───────────────────────────────────────────────

    it('both newly-gated domains answer in the IDENTICAL envelope, byte for byte', async () => {
        // The cross-surface contrast that made this a p0 — `/data` answering
        // 401 while `/actions` answered 200 in the SAME process — is not
        // provable on this boot: `@objectstack/rest` owns `/data` and `/meta`
        // and the dispatcher plugin mounts neither, so there is no second
        // surface here to compare against. It was measured instead on a real
        // showcase boot (recorded in the PR body), and asserting a lookalike
        // here would be a weaker claim wearing the stronger one's clothes.
        //
        // What THIS boot can prove is the half that would actually regress
        // unnoticed: the two domains gated by this change share one envelope
        // and cannot drift into two dialects of "unauthenticated".
        const fromActions = await (await post('/actions/crm_contact/mark_primary/c1', {})).json();
        const fromAutomation = await (await post('/automation/crm_escalation_flow/trigger', {})).json();

        expect(fromActions).toEqual(fromAutomation);
        expect((fromActions as any)?.error?.code ?? (fromActions as any)?.error?.details?.code).toBe('UNAUTHENTICATED');
    }, 60_000);
});
