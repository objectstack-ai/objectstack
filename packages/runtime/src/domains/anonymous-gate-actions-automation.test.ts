// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5519 — the `/actions` and `/automation` dispatch domains join the platform's
 * anonymous-deny baseline (ADR-0056 D2 → #3963).
 *
 * The gap this pins closed: in ONE process, `@objectstack/rest`'s `/data` and
 * the dispatcher's `/meta`, `/ai`, `/security` all answered an anonymous caller
 * 401 `UNAUTHENTICATED`, while the dispatcher's own `/actions/*` and
 * `/automation/*` had no anonymity check at all. `/actions` was the expensive
 * one: `buildActionExecutionContext` forces `isSystem: true` on a `script`
 * action's body, so an unauthenticated POST bought an RLS/FLS-bypassing SYSTEM
 * write. The only gate ahead of it was ADR-0066 D4's `actionPermissionError`,
 * which returns "allow" for every action that declares no
 * `requiredPermissions` — i.e. for most authored actions.
 *
 * Verified on a real showcase boot before the fix: anonymous
 * `POST /actions/showcase_task/showcase_mark_done/:id` answered 200
 * `{ok: true}` (the body's `ctx.api…update()` ran), anonymous
 * `POST /automation/showcase_reassign_wizard/trigger` answered 200 with a live
 * `runId`, anonymous `GET /automation` returned the full flow inventory, and
 * anonymous `DELETE /automation/showcase_inquiry_janitor` answered 200
 * `{deleted: true}` — an unauthenticated caller unregistering a flow, which the
 * issue had not even claimed.
 *
 * ## What is NOT gated here, and why that is correct
 *
 * The gate sits on the HTTP DOMAIN HANDLERS only. Every internal dispatch path
 * reaches the action/flow machinery WITHOUT passing through them, so none of
 * them can be broken by this change — a mapping this file pins from the other
 * side rather than asserting in prose:
 *
 *  - the MCP `run_action` bridge → `action-execution.invokeBusinessAction`
 *    (`domains/mcp.ts` wires it directly);
 *  - the declarative endpoint executor (#5040 E5) → `buildAutomationContext` +
 *    `IAutomationService.execute`, mounted in the transport's fallback seam
 *    that `dispatch()` deliberately never sees, with its OWN `authRequired`
 *    policy gate (`endpoint-policy.ts` ②) that an `authRequired: false`
 *    declaration legitimately opens;
 *  - internal engine triggers (record-change, schedule) never speak HTTP.
 *
 * And on the seam itself, a SYSTEM context (`isSystem: true`, never settable
 * from the wire) passes untouched — so a host that dispatches internally
 * through the domain handler is unaffected too.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import * as actionExec from '../action-execution.js';
import { buildAutomationContext } from './automation.js';
import { applyEndpointPolicies, createEndpointRateLimiterRegistry } from '../endpoint-policy.js';
import { ApiEndpointSchema } from '@objectstack/spec/api';

// ── contexts ────────────────────────────────────────────────────────────────
// `resolveExecutionContext` leaves `executionContext` UNDEFINED when identity
// resolution throws and writes `{ isSystem: false, positions: [], … }` with no
// `userId` for a resolved-but-sessionless caller. Both are anonymous; both must
// be denied, so both shapes are exercised.
const anonUnresolved = () => ({ request: {}, environmentId: 'platform' }) as any;
const anonResolved = () =>
    ({ request: {}, environmentId: 'platform', executionContext: { isSystem: false, positions: [], permissions: [], systemPermissions: [] } }) as any;
const authed = (systemPermissions: string[] = []) =>
    ({ request: {}, environmentId: 'platform', executionContext: { userId: 'u1', isSystem: false, positions: [], permissions: [], systemPermissions } }) as any;
const system = () =>
    ({ request: {}, environmentId: 'platform', executionContext: { isSystem: true } }) as any;

// ── fixtures ────────────────────────────────────────────────────────────────

const scriptAction = {
    name: 'mark_primary',
    objectName: 'crm_contact',
    type: 'script',
    body: { language: 'js', source: 'return { ok: true };', capabilities: ['api.write'] },
};

/** Same declaration, but ADR-0066 D4 gated — pins that the finer gate survives. */
const gatedScriptAction = { ...scriptAction, name: 'purge_contact', requiredPermissions: ['manage_contacts'] };

const flowAction = {
    name: 'escalate_case',
    objectName: 'crm_contact',
    type: 'flow',
    target: 'crm_escalation_flow',
};

/**
 * A genuinely OBJECT-LESS (`global`) declaration — a standalone `defineAction`
 * artifact carrying no `objectName`, which is what `POST /actions//:action`
 * routes at the `'global'` key (#3913).
 *
 * It has to be object-less for the test over it to mean anything. An earlier
 * draft reused `mark_primary` (declared on `crm_contact`) for that URL shape:
 * with the gate removed, the request answered 404 — ADR-0110 D3's "no
 * declaration" exit — rather than dispatching, so the case's
 * `executeAction not called` assertion was passing because NOTHING would have
 * run, not because the gate stopped it. Replaced rather than re-spelled.
 */
const globalScriptAction = {
    name: 'import_contacts',
    type: 'script',
    body: { language: 'js', source: 'return { ok: true };', capabilities: ['api.write'] },
};

function makeDispatcher() {
    const objectDef = { name: 'crm_contact', actions: [scriptAction, gatedScriptAction, flowAction] };
    const executeAction = vi.fn(async () => ({ ok: true, wrote: 'system-elevated' }));
    const execute = vi.fn(async () => ({ success: true, status: 'paused', runId: 'run_1' }));
    const registerFlow = vi.fn();
    const unregisterFlow = vi.fn();
    const listFlows = vi.fn(async () => ['crm_escalation_flow']);

    const ql: any = {
        executeAction,
        getSchema: (n: string) => (n === objectDef.name ? objectDef : undefined),
        registry: {
            getObject: (n: string) => (n === objectDef.name ? objectDef : undefined),
            getItem: (type: string, name: string) =>
                (type === 'action' && name === globalScriptAction.name ? globalScriptAction : undefined),
        },
        find: vi.fn(async () => [{ id: 'c1' }]),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async () => objectDef),
    };
    const automation: any = { execute, registerFlow, unregisterFlow, listFlows, handlerReady: true };
    const kernel: any = {
        context: {
            getService: (n: string) =>
                n === 'objectql' || n === 'data' ? ql
                    : n === 'metadata' ? metadata
                        : n === 'automation' ? automation
                            : null,
        },
    };
    return { dispatcher: new HttpDispatcher(kernel), executeAction, execute, registerFlow, unregisterFlow, listFlows };
}

const DENY_MESSAGE = 'Authentication is required to access this endpoint.';

/** The envelope every anonymous-denied seam returns — asserted, not assumed. */
function expectAnonymousDenial(response: any) {
    expect(response.status).toBe(401);
    expect(response.body?.error?.code ?? response.body?.error?.details?.code).toBe('UNAUTHENTICATED');
    expect(response.body?.error?.message).toBe(DENY_MESSAGE);
}

// ════════════════════════════════════════════════════════════════════════════
// /actions
// ════════════════════════════════════════════════════════════════════════════

describe('/actions — anonymous baseline (#5519)', () => {
    it('401s an anonymous script-action POST and dispatches NOTHING', async () => {
        const { dispatcher, executeAction } = makeDispatcher();
        const r: any = await dispatcher.handleActions('/crm_contact/mark_primary/c1', 'POST', {}, anonUnresolved());

        expectAnonymousDenial(r.response);
        // The load-bearing half: the body never ran. Before #5519 this call
        // reached `executeAction` with `isSystem: true` forced on.
        expect(executeAction).not.toHaveBeenCalled();
    }, 60_000);

    it('401s when identity RESOLVED but carries no user (the sessionless shape)', async () => {
        const { dispatcher, executeAction } = makeDispatcher();
        const r: any = await dispatcher.handleActions('/crm_contact/mark_primary/c1', 'POST', {}, anonResolved());

        expectAnonymousDenial(r.response);
        expect(executeAction).not.toHaveBeenCalled();
    }, 60_000);

    it('401s an anonymous FLOW-action POST and starts no run', async () => {
        const { dispatcher, execute } = makeDispatcher();
        const r: any = await dispatcher.handleActions('/crm_contact/escalate_case/c1', 'POST', {}, anonUnresolved());

        expectAnonymousDenial(r.response);
        expect(execute).not.toHaveBeenCalled();
    }, 60_000);

    it('401s the object-less (`global`) action shape too', async () => {
        const { dispatcher, executeAction } = makeDispatcher();
        const r: any = await dispatcher.handleActions('//import_contacts', 'POST', {}, anonUnresolved());

        expectAnonymousDenial(r.response);
        expect(executeAction).not.toHaveBeenCalled();
    }, 60_000);

    it('dispatches the object-less shape for an AUTHENTICATED caller (the case above has teeth)', async () => {
        // The counterpart that proves the 401 above prevented a REAL dispatch:
        // the same URL with a session reaches `executeAction`.
        const { dispatcher, executeAction } = makeDispatcher();
        const r: any = await dispatcher.handleActions('//import_contacts', 'POST', {}, authed());

        expect(r.response.status).toBe(200);
        expect(executeAction).toHaveBeenCalled();
    }, 60_000);

    it('lets an AUTHENTICATED caller through — the deny targets anonymity, not the route', async () => {
        const { dispatcher, executeAction } = makeDispatcher();
        const r: any = await dispatcher.handleActions('/crm_contact/mark_primary/c1', 'POST', {}, authed());

        expect(r.response.status).toBe(200);
        expect(r.response.body?.data).toMatchObject({ ok: true });
        expect(executeAction).toHaveBeenCalled();
    }, 60_000);

    it('lets an internal SYSTEM context through (`isSystem` is never settable from the wire)', async () => {
        const { dispatcher, executeAction } = makeDispatcher();
        const r: any = await dispatcher.handleActions('/crm_contact/mark_primary/c1', 'POST', {}, system());

        expect(r.response.status).toBe(200);
        expect(executeAction).toHaveBeenCalled();
    }, 60_000);

    it('dispatches an authenticated FLOW action exactly as before', async () => {
        const { dispatcher, execute } = makeDispatcher();
        const r: any = await dispatcher.handleActions('/crm_contact/escalate_case/c1', 'POST', {}, authed());

        expect(r.response.status).toBe(200);
        expect(r.response.body?.data).toMatchObject({ runId: 'run_1' });
        expect(execute).toHaveBeenCalled();
    }, 60_000);

    it('answers the anonymous floor BEFORE the 405, so a non-POST leaks no route shape', async () => {
        // Deliberate: the gate is the first statement in the handler. `/data`
        // answers an anonymous GET 401 rather than describing its verbs, and
        // this surface now matches.
        const { dispatcher } = makeDispatcher();
        const r: any = await dispatcher.handleActions('/crm_contact/mark_primary/c1', 'GET', {}, anonUnresolved());

        expectAnonymousDenial(r.response);
    }, 60_000);

    it('does not turn a CORS preflight into a 401 (OPTIONS passes the gate, then 405s)', async () => {
        // `shouldDenyAnonymous` exempts OPTIONS by contract; passing `method`
        // through is what keeps that true here. A preflight answered 401 would
        // break every browser client of this route.
        const { dispatcher } = makeDispatcher();
        const r: any = await dispatcher.handleActions('/crm_contact/mark_primary/c1', 'OPTIONS', {}, anonUnresolved());

        expect(r.response.status).toBe(405);
    }, 60_000);
});

describe('/actions — `requiredPermissions` semantics are UNCHANGED below the floor (ADR-0066 D4)', () => {
    it('an authenticated caller missing the capability still gets 403, not 401', async () => {
        const { dispatcher, executeAction } = makeDispatcher();
        const r: any = await dispatcher.handleActions('/crm_contact/purge_contact/c1', 'POST', {}, authed([]));

        expect(r.response.status).toBe(403);
        expect(r.response.body?.error?.message).toContain('manage_contacts');
        expect(executeAction).not.toHaveBeenCalled();
    }, 60_000);

    it('an authenticated caller HOLDING the capability is dispatched', async () => {
        const { dispatcher, executeAction } = makeDispatcher();
        const r: any = await dispatcher.handleActions('/crm_contact/purge_contact/c1', 'POST', {}, authed(['manage_contacts']));

        expect(r.response.status).toBe(200);
        expect(executeAction).toHaveBeenCalled();
    }, 60_000);

    it('an ANONYMOUS caller on a gated action is denied by the floor (401), not by the capability gate (403)', async () => {
        // The one place the two gates visibly reorder. Before #5519 an
        // anonymous caller on a `requiredPermissions` action got 403 —
        // "you lack a capability" — which described the wrong problem and
        // implied a session existed. The floor answers first now.
        const { dispatcher } = makeDispatcher();
        const r: any = await dispatcher.handleActions('/crm_contact/purge_contact/c1', 'POST', {}, anonUnresolved());

        expectAnonymousDenial(r.response);
    }, 60_000);
});

// ════════════════════════════════════════════════════════════════════════════
// /automation
// ════════════════════════════════════════════════════════════════════════════

describe('/automation — anonymous baseline covers the WHOLE domain (#5519)', () => {
    it('401s an anonymous `POST /:name/trigger` and starts no run', async () => {
        const { dispatcher, execute } = makeDispatcher();
        const r: any = await dispatcher.handleAutomation('/crm_escalation_flow/trigger', 'POST', { recordId: 'c1' }, anonUnresolved());

        expectAnonymousDenial(r.response);
        expect(execute).not.toHaveBeenCalled();
    }, 60_000);

    it('401s the LEGACY `POST /trigger/:name` shape too (the SDK route)', async () => {
        const { dispatcher, execute } = makeDispatcher();
        const r: any = await dispatcher.handleAutomation('/trigger/crm_escalation_flow', 'POST', { recordId: 'c1' }, anonUnresolved());

        expectAnonymousDenial(r.response);
        expect(execute).not.toHaveBeenCalled();
    }, 60_000);

    it('401s an anonymous `GET /` — the flow inventory is not public', async () => {
        const { dispatcher, listFlows } = makeDispatcher();
        const r: any = await dispatcher.handleAutomation('/', 'GET', undefined, anonUnresolved());

        expectAnonymousDenial(r.response);
        expect(listFlows).not.toHaveBeenCalled();
    }, 60_000);

    it('401s an anonymous `DELETE /:name` — proven reachable on a real boot', async () => {
        const { dispatcher, unregisterFlow } = makeDispatcher();
        const r: any = await dispatcher.handleAutomation('/crm_escalation_flow', 'DELETE', undefined, anonUnresolved());

        expectAnonymousDenial(r.response);
        expect(unregisterFlow).not.toHaveBeenCalled();
    }, 60_000);

    it('401s an anonymous `POST /` (flow registration)', async () => {
        const { dispatcher, registerFlow } = makeDispatcher();
        const r: any = await dispatcher.handleAutomation('/', 'POST', { name: 'injected_flow' }, anonUnresolved());

        expectAnonymousDenial(r.response);
        expect(registerFlow).not.toHaveBeenCalled();
    }, 60_000);

    it('denies BEFORE the service-availability probe — a 501 would leak the deployment shape', async () => {
        // No `automation` slot at all: an anonymous caller must still see 401,
        // not `capabilityUnavailable`'s 501.
        const kernel: any = { context: { getService: () => null } };
        const d = new HttpDispatcher(kernel);
        const r: any = await d.handleAutomation('/crm_escalation_flow/trigger', 'POST', {}, anonUnresolved());

        expectAnonymousDenial(r.response);
    }, 60_000);

    it('lets an AUTHENTICATED caller trigger, with identity forwarding intact', async () => {
        const { dispatcher, execute } = makeDispatcher();
        const r: any = await dispatcher.handleAutomation('/crm_escalation_flow/trigger', 'POST', { recordId: 'c1' }, authed());

        expect(r.response.status).toBe(200);
        expect(execute).toHaveBeenCalledWith('crm_escalation_flow', expect.objectContaining({ userId: 'u1' }));
    }, 60_000);

    it('lets an internal SYSTEM context through', async () => {
        const { dispatcher, execute } = makeDispatcher();
        const r: any = await dispatcher.handleAutomation('/crm_escalation_flow/trigger', 'POST', {}, system());

        expect(r.response.status).toBe(200);
        expect(execute).toHaveBeenCalled();
    }, 60_000);

    it('lets an authenticated caller list flows', async () => {
        const { dispatcher, listFlows } = makeDispatcher();
        const r: any = await dispatcher.handleAutomation('/', 'GET', undefined, authed());

        expect(r.response.status).toBe(200);
        expect(listFlows).toHaveBeenCalled();
    }, 60_000);
});

// ════════════════════════════════════════════════════════════════════════════
// The internal dispatch paths the gate must NOT touch
// ════════════════════════════════════════════════════════════════════════════

describe('#5519 — internal dispatch paths are untouched (the gate is HTTP-seam only)', () => {
    it('the MCP bridge (`invokeBusinessAction`) still runs its OWN gates, not the HTTP floor', async () => {
        // `domains/mcp.ts` wires `runAction` straight to this function; it never
        // enters `handleActionsRequest`. Its boundary is `ai.exposed` +
        // `requiredPermissions`, which is why an action that is NOT AI-exposed
        // is refused here for that reason — an unchanged message, and proof the
        // 401 envelope did not leak into the shared execution layer.
        const objectDef = { name: 'crm_contact', actions: [scriptAction] };
        const deps: any = {
            resolveService: async () => null,
            getObjectQL: async () => undefined,
        };
        await expect(
            actionExec.invokeBusinessAction(deps, anonUnresolved(), 'mark_primary', {}, {
                driver: undefined,
                ec: undefined,
                getMeta: () => ({ listObjects: async () => [objectDef], getObject: async () => objectDef }),
                callData: async () => ({}),
            }),
        ).rejects.toThrow(/not exposed to AI/);
    }, 60_000);

    it('`buildAutomationContext` — the seam the declarative endpoint executor shares — is not gated', async () => {
        // #5040 E5 exports this so a `type: 'flow'` endpoint sends the SAME
        // context the trigger route sends. It runs in the transport fallback
        // seam, outside `dispatch()`, so it must stay callable with any context.
        const ctx = buildAutomationContext({ recordId: 'c1', objectName: 'crm_contact' }, anonUnresolved());
        expect(ctx).toMatchObject({ object: 'crm_contact', event: 'manual' });
        expect((ctx.params as any).recordId).toBe('c1');
        expect(ctx.userId).toBeUndefined();
    }, 60_000);

    it('a declared `authRequired: false` endpoint still passes anonymously (its own gate, ②)', async () => {
        // The declarative endpoint executor owns the ONLY sanctioned way a
        // flow runs for a session-less caller: an explicit `authRequired:
        // false` in the endpoint declaration. Gating `/automation` must not
        // (and does not) close it — different seam entirely.
        const endpoint = ApiEndpointSchema.parse({
            name: 'public_intake', path: '/api/v1/apps/demo/intake', method: 'POST',
            type: 'flow', target: 'demo_intake_flow', authRequired: false,
        });
        const verdict = await applyEndpointPolicies({
            endpoint,
            method: 'POST',
            limiters: createEndpointRateLimiterRegistry({ resolveCache: async () => undefined }),
            resolvePrincipalId: async () => undefined, // anonymous
        });

        expect(verdict.verdict).toBe('pass');
    }, 60_000);
});
