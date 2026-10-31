// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27908 — maintainer ruling 6513869839 on #27681, parameter 3] "The audit
 * row of an action run through MCP records the surface, so an administrator
 * can tell an agent's call from a click without a second log."
 *
 * The DOOR-side pins: every branch an action dispatches to (script, api,
 * flow, declarative update) × both doors that invoke one — REST
 * `POST /actions/:object/:action` (`HttpDispatcher.handleActions`) and the
 * real `/mcp` bridge (`buildMcpBridge` → `runAction` / `resumeRun`) — hands
 * the `audit` slot exactly ONE invocation event, naming the door on the
 * invocation's `ExecutionContext.surface`, whether the branch answered or
 * refused. A call an admission gate refused ran nothing and hands none.
 *
 * The `audit` slot is a spy here so each case asserts the event the door
 * built; the row the plugin-audit writer turns it into, read back through a
 * real engine, is `plugin-audit/src/action-invocation-audit.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';

import { HttpDispatcher } from './http-dispatcher.js';
import { API_FORWARD_MARK_HEADER } from './action-execution.js';
import {
    withActionSurface,
    actionInvocationBranch,
    actionInvocationFailure,
    actionInvocationForwardedFrom,
    actionInvocationTarget,
} from './action-invocation-audit.js';

const OBJECT = 'aud_lead';
const RECORD = 'lead_1';
const ai = (description: string) => ({ exposed: true, description });

const SCRIPT = { name: 'nudge_lead', label: 'Nudge', objectName: OBJECT, type: 'script', target: 'nudge_lead', ai: ai('Nudge the lead.') };
const API = {
    name: 'ban_lead', label: 'Ban', objectName: OBJECT, type: 'api',
    target: '/api/v1/aud/ban', recordIdParam: 'userId', ai: ai('Ban the lead.'),
};
const FLOW = { name: 'escalate_lead', label: 'Escalate', objectName: OBJECT, type: 'flow', target: 'escalate_flow', ai: ai('Escalate the lead.') };
/** An api action whose target is ANOTHER action route on this server — the forward #28281 joins. */
const FORWARD = {
    name: 'forward_lead', label: 'Forward', objectName: OBJECT, type: 'api',
    target: `/api/v1/actions/${OBJECT}/${SCRIPT.name}`, ai: ai('Forward the lead to the nudge.'),
};
const UPDATE = { name: 'close_lead', label: 'Close', objectName: OBJECT, operation: 'update', patch: { status: 'closed' }, ai: ai('Close the lead.') };
/** Gated on a capability no caller below holds — the pre-dispatch refusal. */
const GATED = { ...SCRIPT, name: 'purge_lead', target: 'purge_lead', requiredPermissions: ['aud.purge'] };

type Branch = 'script' | 'api' | 'flow' | 'update';
const ACTION_OF: Record<Branch, any> = { script: SCRIPT, api: API, flow: FLOW, update: UPDATE };
const BRANCHES: Branch[] = ['script', 'api', 'flow', 'update'];

/** How each branch is made to refuse AFTER dispatch, and the status that refusal answers. */
interface Failing { script?: boolean; api?: boolean; flow?: boolean; update?: boolean }

function makeRig(fail: Failing = {}) {
    const events: any[] = [];
    const audit = { recordActionInvocation: vi.fn(async (e: any) => { events.push(e); }) };
    const row = { id: RECORD, status: 'open', owner: 'u_member' };

    const objectDef = {
        name: OBJECT,
        fields: { status: { type: 'text' }, owner: { type: 'text' } },
        actions: [SCRIPT, API, FLOW, UPDATE, GATED, FORWARD],
    };
    const schemaOf = (n: string) => (n === OBJECT ? objectDef : undefined);
    const ql: any = {
        executeAction: vi.fn(async (_object: string, key: string) => {
            if (fail.script && key === SCRIPT.target) {
                throw Object.assign(new Error('The lead cannot be nudged now.'), { status: 409, code: 'CONFLICT' });
            }
            return { ran: key };
        }),
        getSchema: schemaOf,
        registry: { getObject: schemaOf, getItem: () => undefined },
        find: vi.fn(async (_object: string, q: any) => (q?.where?.id === RECORD ? [{ ...row }] : [])),
        update: vi.fn(async (object: string, data: any, options?: any) => {
            assertEngineUpdateDispatch(data, options);
            if (fail.update) {
                throw Object.assign(new Error(`You do not have permission to update ${object}`), { code: 'PERMISSION_DENIED', status: 403 });
            }
            Object.assign(row, data);
            return { id: row.id };
        }),
        insert: vi.fn(),
        delete: vi.fn(),
    };
    const request = vi.fn(async () => new Response(
        JSON.stringify(fail.api
            ? { success: false, error: { code: 'FORBIDDEN', message: 'The target refused.' } }
            : { success: true, data: { banned: true } }),
        { status: fail.api ? 403 : 200, headers: { 'content-type': 'application/json' } },
    ));
    const automation = {
        execute: vi.fn(async () => (fail.flow
            ? { success: false, error: 'The escalation flow failed.' }
            : { success: true, status: 'completed', output: {} })),
        getFlow: vi.fn(async (name: string) => ({ name, type: 'screen' })),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        loadMany: vi.fn(async () => []),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async (n: string) => schemaOf(n)),
    };
    const services: Record<string, unknown> = {
        objectql: ql, data: ql, metadata, automation, audit,
        'http.server': { getRawApp: () => ({ request }) },
    };
    const resolve = (n: string) => services[n] ?? null;
    const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
    const dispatcher = new HttpDispatcher(kernel);

    const ctx = (ec: Record<string, unknown>, headers: Record<string, string> = {}): any => ({
        request: { headers: { host: 'app.example.test', authorization: 'Bearer tok', ...headers } },
        environmentId: 'platform',
        executionContext: { tenantId: 'org_1', systemPermissions: [], ...ec },
    });

    /** REST `POST /actions/:object/:action` — the console's click, the SDK's call. */
    const viaRest = async (action: any, ec: Record<string, unknown> = { userId: 'u_member' }, headers?: Record<string, string>) => {
        const res: any = await dispatcher.handleActions(`/${OBJECT}/${action.name}`, 'POST', { recordId: RECORD }, ctx(ec, headers));
        return res.response;
    };
    /** The real `/mcp` bridge's `run_action` tool — an agent's call. */
    const viaMcp = async (action: any, ec: Record<string, unknown> = { userId: 'u_member' }, headers?: Record<string, string>) => {
        const bridge = (dispatcher as any).buildMcpBridge(ctx(ec, headers));
        try {
            return { ok: true, value: await bridge.runAction(action.name, { objectName: OBJECT, recordId: RECORD }) };
        } catch (err: any) {
            return { ok: false, status: err?.status, code: err?.code };
        }
    };
    return { events, audit, viaRest, viaMcp, ql, request, automation, dispatcher, ctx };
}

describe('[#27908] every branch × both doors writes ONE invocation row naming its door', () => {
    it.each(BRANCHES)('%s — REST /actions: one event, surface rest, succeeded', async (branch) => {
        const rig = makeRig();
        const res = await rig.viaRest(ACTION_OF[branch]);

        expect(res.status).toBe(200);
        expect(rig.events).toHaveLength(1);
        const [event] = rig.events;
        expect(event.context.surface).toBe('rest');
        expect(event).toMatchObject({
            actionName: ACTION_OF[branch].name, objectName: OBJECT, recordId: RECORD, branch, outcome: 'succeeded',
        });
        expect(event.context.userId).toBe('u_member');
        expect(event.status).toBeUndefined();
    });

    it.each(BRANCHES)('%s — MCP run_action: one event, surface mcp, succeeded', async (branch) => {
        const rig = makeRig();
        const out = await rig.viaMcp(ACTION_OF[branch]);

        expect(out.ok).toBe(true);
        expect(rig.events).toHaveLength(1);
        const [event] = rig.events;
        expect(event.context.surface).toBe('mcp');
        expect(event).toMatchObject({
            actionName: ACTION_OF[branch].name, objectName: OBJECT, recordId: RECORD, branch, outcome: 'succeeded',
        });
    });

    it.each(BRANCHES)('%s — a refusal AFTER dispatch still writes the row, on both doors, with status and code', async (branch) => {
        const rest = makeRig({ [branch]: true });
        const res = await rest.viaRest(ACTION_OF[branch]);
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(rest.events).toHaveLength(1);
        expect(rest.events[0]).toMatchObject({ branch, outcome: 'failed', status: res.status });
        expect(rest.events[0].context.surface).toBe('rest');
        expect(rest.events[0].errorCode).toBe(res.body?.error?.code);

        const mcp = makeRig({ [branch]: true });
        const out = await mcp.viaMcp(ACTION_OF[branch]);
        expect(out.ok).toBe(false);
        expect(mcp.events).toHaveLength(1);
        expect(mcp.events[0]).toMatchObject({ branch, outcome: 'failed', status: out.status });
        expect(mcp.events[0].context.surface).toBe('mcp');
        expect(mcp.events[0].errorCode).toBe(out.code);
    });

    it('the subject-record verdict (a record the caller cannot read) is a refusal after admission: one failed row per door', async () => {
        for (const door of ['rest', 'mcp'] as const) {
            const rig = makeRig();
            rig.ql.find.mockImplementation(async () => []);
            if (door === 'rest') {
                const res = await rig.viaRest(SCRIPT);
                expect(res.status).toBe(404);
            } else {
                const out = await rig.viaMcp(SCRIPT);
                expect(out.status).toBe(404);
            }
            expect(rig.events).toHaveLength(1);
            expect(rig.events[0]).toMatchObject({ outcome: 'failed', status: 404 });
            expect(rig.events[0].context.surface).toBe(door);
            expect(rig.ql.executeAction).not.toHaveBeenCalled();
        }
    });

    it('a call an admission gate refused (ADR-0066 D4) ran nothing and writes NO row, on either door', async () => {
        const rig = makeRig();
        const res = await rig.viaRest(GATED);
        expect(res.status).toBe(403);
        const out = await rig.viaMcp(GATED);
        expect(out.ok).toBe(false);
        expect(rig.ql.executeAction).not.toHaveBeenCalled();
        expect(rig.events).toEqual([]);
    });
});

describe('[#27908] the surface is the DOOR\'s — nothing on the request moves it', () => {
    it('an outside REST request that forges the forward mark, a surface header and an upstream `surface: mcp` still records `rest`', async () => {
        const rig = makeRig();
        // The forward mark carries no trust: any caller can send it. On an api
        // action it buys the loop refusal, and the row still names the door
        // the request actually came through.
        const res = await rig.viaRest(API, { userId: 'u_member', surface: 'mcp' }, {
            [API_FORWARD_MARK_HEADER]: 'aud_lead/other_action',
            'x-objectstack-action-surface': 'mcp',
        });
        expect(res.status).toBe(400);
        expect(rig.request).not.toHaveBeenCalled();
        expect(rig.events).toHaveLength(1);
        expect(rig.events[0].context.surface).toBe('rest');
        expect(rig.events[0]).toMatchObject({ branch: 'api', outcome: 'failed', status: 400 });
    });

    it('an MCP call whose envelope arrives saying `surface: rest` (an agent posing as a click) still records `mcp`', async () => {
        const rig = makeRig();
        const out = await rig.viaMcp(SCRIPT, { userId: 'u_member', surface: 'rest' }, { 'x-objectstack-action-surface': 'rest' });
        expect(out.ok).toBe(true);
        expect(rig.events).toHaveLength(1);
        expect(rig.events[0].context.surface).toBe('mcp');
    });

    it('the api branch\'s row names the true door after the in-process forward re-authenticates at the target', async () => {
        const rig = makeRig();
        await rig.viaMcp(API);
        // The forward reached the target and carried no surface: the row is
        // written by the door from its own envelope, after the target answered.
        expect(rig.request).toHaveBeenCalledTimes(1);
        const forwarded = (rig.request.mock.calls[0] as any[])[1] as RequestInit;
        expect(Object.keys(forwarded.headers as Record<string, string>).some((h) => h.includes('surface'))).toBe(false);
        expect(rig.events).toHaveLength(1);
        expect(rig.events[0].context.surface).toBe('mcp');
        expect(rig.events[0]).toMatchObject({ branch: 'api', outcome: 'succeeded' });
    });

    it('the request\'s own envelope is left as identity resolution built it (the door stamps a copy)', async () => {
        const rig = makeRig();
        const context = rig.ctx({ userId: 'u_member' });
        await rig.dispatcher.handleActions(`/${OBJECT}/${SCRIPT.name}`, 'POST', { recordId: RECORD }, context);
        expect(context.executionContext.surface).toBeUndefined();
        expect(rig.events[0].context.surface).toBe('rest');
    });

    it('an agent\'s MCP call carries the ADR-0090 D10 performer beside the surface', async () => {
        const rig = makeRig();
        await rig.viaMcp(SCRIPT, {
            userId: 'u_member', principalKind: 'agent', performedBy: { clientId: 'cli_agent' },
            onBehalfOf: { userId: 'u_member', principalKind: 'human' },
        });
        expect(rig.events[0].context.surface).toBe('mcp');
        expect(rig.events[0].context.performedBy).toEqual({ clientId: 'cli_agent' });
    });
});

describe('[#28281] an api forward to another action route: the two rows name each other', () => {
    /**
     * The in-process injector routes the forward into the REAL REST action
     * door, with the headers `forwardApiAction` actually sent — so the inner
     * row is written by the same door, reading the same mark, as in a server.
     */
    function forwardingRig() {
        const rig = makeRig();
        const prefix = '/api/v1/actions';
        rig.request.mockImplementation(async (url: string, init: RequestInit) => {
            const path = new URL(url).pathname;
            if (!path.startsWith(`${prefix}/`)) return new Response('{}', { status: 404 });
            const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
            const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
            const res: any = await rig.dispatcher.handleActions(path.slice(prefix.length), String(init.method ?? 'POST'), body, {
                request: { headers },
                environmentId: 'platform',
                executionContext: { tenantId: 'org_1', systemPermissions: [], userId: 'u_member' },
            });
            return new Response(JSON.stringify(res.response.body), {
                status: res.response.status, headers: { 'content-type': 'application/json' },
            });
        });
        return rig;
    }

    it('MCP → api → action route: the outer mcp row names the target, the inner rest row names the forward', async () => {
        const rig = forwardingRig();
        const out = await rig.viaMcp(FORWARD);

        expect(out.ok).toBe(true);
        expect(rig.request).toHaveBeenCalledTimes(1);
        expect(rig.ql.executeAction).toHaveBeenCalledWith(OBJECT, SCRIPT.target, expect.anything());
        // The inner door answers before the outer door writes, so the inner row lands first.
        expect(rig.events).toHaveLength(2);
        const [inner, outer] = rig.events;

        expect(outer.context.surface).toBe('mcp');
        expect(outer).toMatchObject({
            actionName: FORWARD.name, objectName: OBJECT, branch: 'api', outcome: 'succeeded', target: FORWARD.target,
        });
        expect(outer.forwardedFrom).toBeUndefined();

        expect(inner.context.surface).toBe('rest');
        expect(inner).toMatchObject({
            actionName: SCRIPT.name, objectName: OBJECT, branch: 'script', outcome: 'succeeded',
            forwardedFrom: `${OBJECT}/${FORWARD.name}`,
        });
        expect(inner.target).toBeUndefined();
    });

    it('REST → api → action route names the same pair; a direct call names neither', async () => {
        const rig = forwardingRig();
        const res = await rig.viaRest(FORWARD);
        expect(res.status).toBe(200);
        const [inner, outer] = rig.events;
        expect(outer).toMatchObject({ branch: 'api', target: FORWARD.target });
        expect(outer.context.surface).toBe('rest');
        expect(inner).toMatchObject({ actionName: SCRIPT.name, forwardedFrom: `${OBJECT}/${FORWARD.name}` });

        const direct = makeRig();
        await direct.viaRest(SCRIPT);
        expect(direct.events).toHaveLength(1);
        expect(direct.events[0].target).toBeUndefined();
        expect(direct.events[0].forwardedFrom).toBeUndefined();
    });

    it('the outer row records the DECLARED target, never the path interpolated from the caller\'s params', async () => {
        const rig = makeRig();
        await rig.viaMcp(API);
        const sent = String((rig.request.mock.calls[0] as any[])[0]);
        expect(sent).toContain('/api/v1/aud/ban');
        expect(rig.events[0].target).toBe(API.target);
    });

    it('a forged mark is recorded as the hint it is, and moves nothing else on the row', async () => {
        const rig = makeRig();
        const res = await rig.viaRest(SCRIPT, { userId: 'u_member' }, { [API_FORWARD_MARK_HEADER]: 'aud_lead/forged' });
        expect(res.status).toBe(200);
        expect(rig.events).toHaveLength(1);
        expect(rig.events[0]).toMatchObject({ forwardedFrom: 'aud_lead/forged', outcome: 'succeeded', branch: 'script' });
        expect(rig.events[0].context.surface).toBe('rest');
    });
});

describe('[#27908] MCP resume_run continues a run and writes its own row', () => {
    function resumeRig(resumeAnswer: any) {
        const rig = makeRig();
        const automation: any = rig.automation;
        automation.getRun = vi.fn(async (runId: string) => ({
            id: runId, flowName: FLOW.target, status: 'paused',
            trigger: { type: 'manual', userId: 'u_member', object: OBJECT, recordId: RECORD }, steps: [],
        }));
        automation.getSuspendedScreen = vi.fn(async () => ({ nodeId: 'screen_1', fields: [] }));
        automation.resume = vi.fn(async () => resumeAnswer);
        const bridge = (rig.dispatcher as any).buildMcpBridge(rig.ctx({ userId: 'u_member' }));
        return { rig, bridge };
    }

    it('a resumed run records surface mcp, the admitting flow action, the run id, succeeded', async () => {
        const { rig, bridge } = resumeRig({ success: true, status: 'completed', output: {} });
        await bridge.resumeRun('run_7', { values: {} });
        expect(rig.events).toHaveLength(1);
        expect(rig.events[0].context.surface).toBe('mcp');
        expect(rig.events[0]).toMatchObject({
            actionName: FLOW.name, objectName: OBJECT, recordId: RECORD, branch: 'flow', outcome: 'succeeded', runId: 'run_7',
        });
    });

    it('a resume the engine refuses records a failed row with the refusal\'s status', async () => {
        const { rig, bridge } = resumeRig({ success: false, code: 'INVALID_SCREEN_INPUT', error: 'missing' });
        const thrown: any = await bridge.resumeRun('run_7', { values: {} }).catch((e: unknown) => e);
        expect(thrown).toBeInstanceOf(Error);
        expect(rig.events).toHaveLength(1);
        expect(rig.events[0]).toMatchObject({ outcome: 'failed', status: thrown.status, errorCode: thrown.code, runId: 'run_7' });
    });
});

describe('[#27908] the helpers', () => {
    it('withActionSurface copies and overwrites, never mutates', () => {
        const ec = { userId: 'u', surface: 'rest' as const };
        const out = withActionSurface(ec, 'mcp');
        expect(out.surface).toBe('mcp');
        expect(ec.surface).toBe('rest');
        expect(withActionSurface(undefined, 'rest')).toEqual({ surface: 'rest' });
    });

    it('actionInvocationBranch reads operation before type', () => {
        expect(actionInvocationBranch({ type: 'flow', operation: 'update' }, true)).toBe('update');
        expect(actionInvocationBranch({ type: 'api' }, false)).toBe('api');
        expect(actionInvocationBranch({ type: 'flow' }, false)).toBe('flow');
        expect(actionInvocationBranch(undefined, false)).toBe('script');
    });

    it('actionInvocationTarget names only an api branch\'s declared target', () => {
        expect(actionInvocationTarget({ type: 'api', target: '/api/v1/x' }, false)).toBe('/api/v1/x');
        expect(actionInvocationTarget({ type: 'api', target: '/api/v1/x', operation: 'update' }, true)).toBeUndefined();
        expect(actionInvocationTarget({ type: 'flow', target: 'some_flow' }, false)).toBeUndefined();
        expect(actionInvocationTarget({ type: 'api', target: '  ' }, false)).toBeUndefined();
    });

    it('actionInvocationForwardedFrom reads a non-empty string mark and nothing else', () => {
        const at = (headers: Record<string, unknown>) => ({ request: { headers } }) as any;
        expect(actionInvocationForwardedFrom(at({ [API_FORWARD_MARK_HEADER]: 'o/a' }), API_FORWARD_MARK_HEADER)).toBe('o/a');
        expect(actionInvocationForwardedFrom(at({ [API_FORWARD_MARK_HEADER]: '' }), API_FORWARD_MARK_HEADER)).toBeUndefined();
        expect(actionInvocationForwardedFrom(at({ [API_FORWARD_MARK_HEADER]: ['o/a'] }), API_FORWARD_MARK_HEADER)).toBeUndefined();
        expect(actionInvocationForwardedFrom(undefined, API_FORWARD_MARK_HEADER)).toBeUndefined();
    });

    it('actionInvocationFailure reads a declared status and code, and a bare throw as 500', () => {
        expect(actionInvocationFailure(Object.assign(new Error('x'), { status: 409, code: 'CONFLICT' }))).toEqual({ status: 409, errorCode: 'CONFLICT' });
        expect(actionInvocationFailure(new Error('x')).status).toBe(500);
    });
});
