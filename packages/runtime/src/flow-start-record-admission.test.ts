// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Flow start admission's third question, the row a start addresses
 * (`flow-start-admission.ts`, `refuseUnreadableFlowStartRecords`): every door
 * that starts a flow by name loads each record key it hands the run in a row
 * slot, in the CALLER's own scope, and refuses a key that scope does not
 * deliver with the action door's own `404 RECORD_NOT_FOUND`, before the run
 * exists.
 *
 * What is pinned, door by door:
 *
 *  1. **The trigger routes**, both spellings, driven through `dispatch()` so
 *     the answer is the wire envelope: a key the caller cannot read and an id
 *     that names nothing are ONE refusal, the action door's, and the engine is
 *     never asked (no run). Every row slot the built context carries is
 *     judged, the caller's own `params` value included.
 *  2. **A declared `type: 'flow'` endpoint**, which shares the trigger
 *     route's context builder: the same refusal, no run.
 *  3. **The action door's flow branch**, REST and MCP: the routed row is
 *     judged by the door's subject load as before; a row slot the caller's own
 *     `params` fill is judged here too.
 *  4. **What stays as it was**: a readable key starts the run (the firing
 *     control for every zero above), the system principal, a start with no
 *     record key, a user run that names no object.
 *
 * The data double is ROW-SCOPED, the one point it must be faithful on: each
 * row is visible to its owner and to nobody else, and no other id exists, so
 * the real `callData('get', …)` answers the real `RECORD_NOT_FOUND` a
 * row-level rule produces.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from './http-dispatcher.js';
import type { HttpProtocolContext } from './http-dispatcher.js';
import { callData, invokeBusinessAction } from './action-execution.js';
import { buildEndpointExecutionContext, executeEndpointTarget } from './endpoint-executor.js';
import { ApiEndpointSchema } from '@objectstack/spec/api';
import type { ApiEndpointMatch } from '@objectstack/spec/contracts';

const OBJECT = 'crm_case';
const MEMBER = 'usr_member';
const OTHER = 'usr_other';
/** A row the member owns, and so reads. */
const READABLE = 'case_member';
/** A row only the other user reads. */
const UNREADABLE = 'case_other';
/** An id that names nothing. */
const GHOST = 'case_ghost';

const ELEVATED_SCREEN = 'case_elevated_screen';
const ELEVATED_API = 'case_elevated_api';
const USER_SCREEN = 'case_user_screen';
const FLOWS: Record<string, { name: string; type: string; runAs?: string }> = {
    [ELEVATED_SCREEN]: { name: ELEVATED_SCREEN, type: 'screen', runAs: 'system' },
    [ELEVATED_API]: { name: ELEVATED_API, type: 'api', runAs: 'system' },
    [USER_SCREEN]: { name: USER_SCREEN, type: 'screen', runAs: 'user' },
};

const FLOW_ACTION = {
    name: 'escalate_case',
    label: 'Escalate',
    objectName: OBJECT,
    type: 'flow',
    target: ELEVATED_SCREEN,
    ai: { exposed: true, description: 'Escalate a case.' },
};
/** The same flow behind an action whose row slots carry a field value, not an id. */
const TOKEN_ACTION = {
    ...FLOW_ACTION,
    name: 'rotate_case_token',
    recordIdField: 'token',
    recordIdParam: 'caseToken',
};
const OBJECT_DEF = { name: OBJECT, actions: [FLOW_ACTION, TOKEN_ACTION] };

/** The acting principal, as `resolveExecutionContext` builds one. */
function ec(userId: string) {
    return { userId, tenantId: 'org_1', positions: [], permissions: [], systemPermissions: [] };
}

/** Row-scoped reads: each row to its owner, nothing else exists. */
function makeQl() {
    const rows: Record<string, { id: string; owner_id: string; token: string }> = {
        [READABLE]: { id: READABLE, owner_id: MEMBER, token: 'tok_member' },
        [UNREADABLE]: { id: UNREADABLE, owner_id: OTHER, token: 'tok_other' },
    };
    const schemaOf = (n: string) => (n === OBJECT ? OBJECT_DEF : undefined);
    return {
        executeAction: vi.fn(async () => ({ ok: true })),
        getSchema: schemaOf,
        registry: { getObject: schemaOf, getItem: () => undefined },
        find: vi.fn(async (object: string, options?: any) => {
            if (object !== OBJECT) return [];
            const caller = options?.context?.isSystem ? '*' : options?.context?.userId;
            const wanted = options?.where?.id;
            return Object.values(rows).filter((r) => (wanted === undefined || r.id === wanted)
                && (caller === '*' || r.owner_id === caller));
        }),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    } as any;
}

function makeAutomation() {
    return {
        handlerReady: true,
        execute: vi.fn(async (_flow: string, _context?: any) => ({
            success: true, status: 'paused', runId: 'run_test', durationMs: 1,
        })),
        getFlow: vi.fn(async (name: string) => FLOWS[name] ?? null),
    };
}

function makeMetadata() {
    return {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        loadMany: vi.fn(async () => []),
        listObjects: vi.fn(async () => [OBJECT_DEF]),
        getObject: vi.fn(async (n: string) => (n === OBJECT ? OBJECT_DEF : undefined)),
    };
}

function boot(principal: Record<string, unknown>) {
    const ql = makeQl();
    const automation = makeAutomation();
    const metadata = makeMetadata();
    const resolve = (n: string): unknown =>
        n === 'objectql' || n === 'data' ? ql
        : n === 'metadata' ? metadata
        : n === 'automation' ? automation
        : undefined;
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (n: string) => resolve(n),
        context: { getService: resolve },
    };
    const dispatcher = new HttpDispatcher(kernel);
    // The seam `dispatch` writes `context.executionContext` from.
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...principal });
    const context = (): HttpProtocolContext =>
        ({ request: {}, environmentId: 'platform', executionContext: { ...principal } }) as any;
    return {
        ql,
        automation,
        dispatcher,
        /** The wire answer through the registered route. */
        dispatch: (method: string, path: string, body?: unknown) =>
            dispatcher.dispatch(method, path, body, {}, { request: {}, environmentId: 'platform' } as HttpProtocolContext),
        /** The REST action door, as its own suite drives it. */
        actions: (path: string, body?: unknown) => (dispatcher as any).handleActions(path, 'POST', body ?? {}, context()),
        /** The MCP `run_action` bridge, on the REAL `callData`. */
        runAction: (name: string, input: Record<string, unknown>) => {
            const deps: any = {
                resolveService: async (_ctx: any, service: string) => (service === 'automation' ? automation : undefined),
                getObjectQL: async () => ql,
            };
            const requestContext: any = { request: {}, environmentId: 'platform' };
            return invokeBusinessAction(deps, requestContext, name, input as any, {
                driver: undefined,
                envId: 'platform',
                ec: { ...principal },
                getMeta: () => metadata,
                callData: (action, params, dataDriver, scopeId, execCtx) =>
                    callData(deps, requestContext, action, params, dataDriver, scopeId, execCtx),
            });
        },
    };
}

const statusOf = (r: any): unknown => r?.response?.status;
/** The reads of the object's rows — the caller-scope loads under test. */
const rowReads = (h: { ql: any }): unknown[][] => h.ql.find.mock.calls.filter((c: unknown[]) => c[0] === OBJECT);
const errorOf = (r: any): any => r?.response?.body?.error ?? {};
/** The refusal envelope with the id normalised out, so two ids compare equal. */
const envelopeOf = (r: any, id: string) => ({
    status: statusOf(r),
    code: errorOf(r).code,
    message: String(errorOf(r).message ?? '').split(id).join('<ID>'),
});

const ROUTES: Array<{ label: string; path: (flow: string) => string }> = [
    { label: 'POST /automation/:name/trigger', path: (f) => `/automation/${f}/trigger` },
    { label: 'legacy POST /automation/trigger/:name', path: (f) => `/automation/trigger/${f}` },
];

// ───────────────────────────────────────────────────────────────────────────
// 1. The trigger routes
// ───────────────────────────────────────────────────────────────────────────

describe('the trigger routes load every row slot in the caller\'s scope before the run exists', () => {
    for (const route of ROUTES) {
        describe(route.label, () => {
            for (const flow of [ELEVATED_SCREEN, ELEVATED_API]) {
                it(`an elevated '${FLOWS[flow].type}' flow given a record key the caller cannot read: 404 RECORD_NOT_FOUND, no run`, async () => {
                    const h = boot(ec(MEMBER));
                    const res = await h.dispatch('POST', route.path(flow), { recordId: UNREADABLE, objectName: OBJECT });

                    expect(statusOf(res)).toBe(404);
                    expect(errorOf(res).code).toBe('RECORD_NOT_FOUND');
                    expect(h.automation.execute).not.toHaveBeenCalled();
                });
            }

            it('an unreadable row and an id that names nothing are one refusal', async () => {
                const denied = await boot(ec(MEMBER)).dispatch('POST', route.path(ELEVATED_SCREEN), { recordId: UNREADABLE, objectName: OBJECT });
                const ghost = boot(ec(MEMBER));
                const nothing = await ghost.dispatch('POST', route.path(ELEVATED_SCREEN), { recordId: GHOST, objectName: OBJECT });

                expect(envelopeOf(nothing, GHOST)).toEqual(envelopeOf(denied, UNREADABLE));
                expect(ghost.automation.execute).not.toHaveBeenCalled();
            });

            it('a record key the caller can read starts the run, the row key in place: the firing control', async () => {
                const h = boot(ec(MEMBER));
                const res = await h.dispatch('POST', route.path(ELEVATED_SCREEN), { recordId: READABLE, objectName: OBJECT });

                expect(statusOf(res), JSON.stringify(res?.response?.body)).toBe(200);
                expect(h.automation.execute).toHaveBeenCalledTimes(1);
                expect(h.automation.execute.mock.calls[0]![1].params).toMatchObject({ recordId: READABLE, crmCaseId: READABLE });
            });

            it('the caller\'s own `params.recordId` is the value the run receives, and it is the one judged', async () => {
                const h = boot(ec(MEMBER));
                const res = await h.dispatch('POST', route.path(ELEVATED_SCREEN), {
                    recordId: READABLE, objectName: OBJECT, params: { recordId: UNREADABLE },
                });

                expect(statusOf(res)).toBe(404);
                expect(errorOf(res).code).toBe('RECORD_NOT_FOUND');
                expect(h.automation.execute).not.toHaveBeenCalled();
            });

            it('the `<object>Id` slot is judged too', async () => {
                const h = boot(ec(MEMBER));
                const res = await h.dispatch('POST', route.path(ELEVATED_SCREEN), {
                    recordId: READABLE, objectName: OBJECT, params: { crmCaseId: UNREADABLE },
                });

                expect(statusOf(res)).toBe(404);
                expect(h.automation.execute).not.toHaveBeenCalled();
            });

            it('an elevated flow given a record key and no object is refused 400 naming `objectName`, no run', async () => {
                const h = boot(ec(MEMBER));
                const res = await h.dispatch('POST', route.path(ELEVATED_SCREEN), { recordId: UNREADABLE });

                expect(statusOf(res)).toBe(400);
                expect(String(errorOf(res).message)).toContain('`objectName`');
                expect(JSON.stringify(errorOf(res).details ?? {})).toContain('objectName');
                expect(h.automation.execute).not.toHaveBeenCalled();
                expect(rowReads(h)).toHaveLength(0);
            });

            it('a record key that is not one id is refused 400 naming the key, never loaded, no run', async () => {
                const h = boot(ec(MEMBER));
                const res = await h.dispatch('POST', route.path(ELEVATED_SCREEN), {
                    objectName: OBJECT, params: { recordId: { id: READABLE } },
                });

                expect(statusOf(res)).toBe(400);
                expect(String(errorOf(res).message)).toContain('`recordId`');
                expect(rowReads(h)).toHaveLength(0);
                expect(h.automation.execute).not.toHaveBeenCalled();
            });

            it('a user-run flow is judged alike when the start names its object', async () => {
                const h = boot(ec(MEMBER));
                const res = await h.dispatch('POST', route.path(USER_SCREEN), { recordId: UNREADABLE, objectName: OBJECT });

                expect(statusOf(res)).toBe(404);
                expect(errorOf(res).code).toBe('RECORD_NOT_FOUND');
                expect(h.automation.execute).not.toHaveBeenCalled();
            });
        });
    }
});

describe('what the trigger routes keep exactly as they were', () => {
    for (const route of ROUTES) {
        it(`${route.label}: a user-run flow given a record key and no object starts as before, nothing loaded`, async () => {
            const h = boot(ec(MEMBER));
            const res = await h.dispatch('POST', route.path(USER_SCREEN), { recordId: UNREADABLE });

            expect(statusOf(res)).toBe(200);
            expect(h.automation.execute).toHaveBeenCalledTimes(1);
            expect(rowReads(h)).toHaveLength(0);
        });

        it(`${route.label}: a start that names no record key loads nothing`, async () => {
            const h = boot(ec(MEMBER));
            const res = await h.dispatch('POST', route.path(ELEVATED_SCREEN), { objectName: OBJECT, params: { note: 'x' } });

            expect(statusOf(res)).toBe(200);
            expect(h.automation.execute).toHaveBeenCalledTimes(1);
            expect(rowReads(h)).toHaveLength(0);
        });

        it(`${route.label}: the system principal starts on any row, nothing loaded`, async () => {
            const h = boot({ isSystem: true });
            const res = await h.dispatch('POST', route.path(ELEVATED_SCREEN), { recordId: UNREADABLE, objectName: OBJECT });

            expect(statusOf(res)).toBe(200);
            expect(h.automation.execute).toHaveBeenCalledTimes(1);
            expect(rowReads(h)).toHaveLength(0);
        });
    }
});

// ───────────────────────────────────────────────────────────────────────────
// 2. A declared `type: 'flow'` endpoint
// ───────────────────────────────────────────────────────────────────────────

describe('a declared `type: flow` endpoint asks the same question', () => {
    const endpoint = ApiEndpointSchema.parse({
        name: 'case_escalate',
        path: '/api/v1/apps/cases/escalate',
        method: 'POST',
        type: 'flow',
        target: ELEVATED_SCREEN,
    });

    async function run(userId: string, body: unknown) {
        const ql = makeQl();
        const automation = makeAutomation();
        const deps: any = { resolveService: async () => undefined, getObjectQL: async () => ql };
        const protocolContext: any = { request: {}, environmentId: 'platform', executionContext: ec(userId) };
        const match: ApiEndpointMatch = { endpoint, params: {} };
        const answer = await executeEndpointTarget(
            buildEndpointExecutionContext({
                request: { method: 'POST', path: endpoint.path, query: {}, headers: {}, body },
                match,
                executionContext: ec(userId) as any,
                environmentId: 'platform',
            }),
            {
                automationService: automation,
                callData: (action, params, dataDriver, scopeId, execCtx) =>
                    callData(deps, protocolContext, action, params, dataDriver, scopeId, execCtx),
            },
        );
        return { answer, automation };
    }

    it('a record key the caller cannot read: 404 RECORD_NOT_FOUND, no run', async () => {
        const { answer, automation } = await run(MEMBER, { recordId: UNREADABLE, objectName: OBJECT });

        expect(answer.status).toBe(404);
        expect((answer.body as any)?.error?.code).toBe('RECORD_NOT_FOUND');
        expect(automation.execute).not.toHaveBeenCalled();
    });

    it('a record key the caller can read starts the run: the firing control', async () => {
        const { answer, automation } = await run(MEMBER, { recordId: READABLE, objectName: OBJECT });

        expect(answer.status).toBe(200);
        expect(automation.execute).toHaveBeenCalledTimes(1);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. The action door's flow branch
// ───────────────────────────────────────────────────────────────────────────

describe('the action door judges the row slots the caller\'s own params fill', () => {
    it('REST: a readable routed row with an unreadable `params.recordId`: 404 RECORD_NOT_FOUND, no run', async () => {
        const h = boot(ec(MEMBER));
        const res = await h.actions(`/${OBJECT}/${FLOW_ACTION.name}/${READABLE}`, { params: { recordId: UNREADABLE } });

        expect(statusOf(res)).toBe(404);
        expect(errorOf(res).code).toBe('RECORD_NOT_FOUND');
        expect(h.automation.execute).not.toHaveBeenCalled();
    });

    it('REST: no routed row and an unreadable `params.recordId`: refused alike', async () => {
        const h = boot(ec(MEMBER));
        const res = await h.actions(`/${OBJECT}/${FLOW_ACTION.name}`, { params: { recordId: UNREADABLE } });

        expect(statusOf(res)).toBe(404);
        expect(h.automation.execute).not.toHaveBeenCalled();
    });

    it('MCP: the same caller is thrown the same refusal, no run', async () => {
        const h = boot(ec(MEMBER));

        await expect(h.runAction(FLOW_ACTION.name, { objectName: OBJECT, recordId: READABLE, params: { crmCaseId: UNREADABLE } }))
            .rejects.toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
        expect(h.automation.execute).not.toHaveBeenCalled();
    });

    it('a `params` value equal to the routed row starts the run, that row loaded once', async () => {
        const h = boot(ec(MEMBER));
        const res = await h.actions(`/${OBJECT}/${FLOW_ACTION.name}/${READABLE}`, { params: { recordId: READABLE } });

        expect(statusOf(res)).toBe(200);
        expect(h.automation.execute).toHaveBeenCalledTimes(1);
        expect(rowReads(h)).toHaveLength(1);
    });

    it('an action whose row slots carry a field value, not an id, is not judged as an id', async () => {
        const h = boot(ec(MEMBER));
        const res = await h.actions(`/${OBJECT}/${TOKEN_ACTION.name}/${READABLE}`, { params: { caseToken: 'tok_other' } });

        expect(statusOf(res)).toBe(200);
        expect(h.automation.execute).toHaveBeenCalledTimes(1);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. One refusal at every door
// ───────────────────────────────────────────────────────────────────────────

describe('the trigger route and the action door answer one refusal for one row', () => {
    it('same status, code and message for the same caller and the same unreadable row', async () => {
        const viaTrigger = await boot(ec(MEMBER)).dispatch('POST', `/automation/${ELEVATED_SCREEN}/trigger`, {
            recordId: UNREADABLE, objectName: OBJECT,
        });
        const viaAction = await boot(ec(MEMBER)).actions(`/${OBJECT}/${FLOW_ACTION.name}/${UNREADABLE}`);

        expect(envelopeOf(viaTrigger, UNREADABLE)).toEqual(envelopeOf(viaAction, UNREADABLE));
        expect(envelopeOf(viaTrigger, UNREADABLE)).toMatchObject({ status: 404, code: 'RECORD_NOT_FOUND' });
    });
});
