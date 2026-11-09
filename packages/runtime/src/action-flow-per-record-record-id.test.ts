// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29881] A `type: 'flow'` action declared `execution: 'perRecord'` called
 * with no record id is refused at the door — `400 VALIDATION_ERROR` naming
 * `recordId` — before the flow starts, on both doors (REST `/actions` and MCP
 * `run_action`; both reach `dispatchFlowAction`). Before, the flow ran and the
 * caller got the first node's diagnostic (`400 FLOW_FAILED`, naming the node).
 *
 * The controls: the same action with a real id runs; one that declares no
 * `execution`, or `aggregate`, runs record-less as before; an unknown id keeps
 * the door's `404 RECORD_NOT_FOUND` (#16370). The api-arm half of the card is
 * in `domains/api-action-forward.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from './http-dispatcher.js';
import { callData, invokeBusinessAction, perRecordActionRecordIdRefusal } from './action-execution.js';

const OBJECT = 'crm_case';
const RECORD_ID = 'case_1';
const GHOST_ID = 'case_none';
const FLOW_NAME = 'crm_case_recalc';

const flowAction = (name: string, extra: Record<string, unknown> = {}) => ({
    name, label: name, objectName: OBJECT, type: 'flow', target: FLOW_NAME,
    ai: { exposed: true, description: `Run ${name}.` }, ...extra,
});
const PER_RECORD = flowAction('recalc_case', { execution: 'perRecord' });
const AGGREGATE = flowAction('recalc_cases', { execution: 'aggregate' });
const UNDECLARED = flowAction('recalc_any');
const OBJECT_DEF = { name: OBJECT, actions: [PER_RECORD, AGGREGATE, UNDECLARED] };

function harness() {
    const schemaOf = (n: string) => (n === OBJECT ? OBJECT_DEF : undefined);
    const ql: any = {
        executeAction: vi.fn(),
        getSchema: schemaOf,
        registry: { getObject: schemaOf, getItem: () => undefined },
        find: vi.fn(async (_object: string, options?: any) => {
            const wanted = options?.filters?.[0]?.[2] ?? options?.where?.id;
            return wanted === RECORD_ID ? [{ id: RECORD_ID }] : [];
        }),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const automation = {
        execute: vi.fn(async () => ({ success: true, status: 'completed', runId: 'run_1', durationMs: 1 })),
        getFlow: vi.fn(async (name: string) => (name === FLOW_NAME ? { name } : null)),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        loadMany: vi.fn(async () => []),
        listObjects: vi.fn(async () => [OBJECT_DEF]),
        getObject: vi.fn(async (n: string) => (n === OBJECT ? OBJECT_DEF : undefined)),
    };
    return { ql, automation, metadata };
}

const EC = { userId: 'usr_1', tenantId: 'org_1', positions: [], permissions: [], systemPermissions: [] };

async function rest(name: string, body: Record<string, unknown>) {
    const h = harness();
    const resolve = (n: string) =>
        n === 'objectql' || n === 'data' ? h.ql : n === 'metadata' ? h.metadata : n === 'automation' ? h.automation : null;
    const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
    const context: any = { request: {}, environmentId: 'platform', executionContext: EC };
    const res: any = await (new HttpDispatcher(kernel) as any).handleActions(`/${OBJECT}/${name}`, 'POST', body, context);
    return { res: res.response, automation: h.automation };
}

async function mcp(name: string, input: Record<string, unknown>) {
    const h = harness();
    const deps: any = {
        resolveService: async (_ctx: any, service: string) => (service === 'automation' ? h.automation : undefined),
        getObjectQL: async () => h.ql,
    };
    const requestContext: any = { request: {}, environmentId: 'platform' };
    const outcome = await invokeBusinessAction(deps, requestContext, name, input as any, {
        driver: undefined, envId: 'platform', ec: EC, getMeta: () => h.metadata,
        callData: (a, p, d, s, e) => callData(deps, requestContext, a, p, d, s, e),
    }).catch((e) => e);
    return { outcome, automation: h.automation };
}

const bodyText = (res: any) => JSON.stringify(res?.body ?? {});

describe('[#29881] a per-record flow action with no record id is refused before the flow starts', () => {
    it('REST: no `recordId`, or an empty one, answers 400 VALIDATION_ERROR naming it, and the flow never runs', async () => {
        for (const body of [{}, { params: {} }, { recordId: '' }]) {
            const { res, automation } = await rest(PER_RECORD.name, body);
            expect(res.status, JSON.stringify(body)).toBe(400);
            expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
            expect(String(res.body?.error?.message)).toContain('`recordId`');
            expect(bodyText(res)).not.toContain('FLOW_FAILED');
            expect(automation.execute).not.toHaveBeenCalled();
        }
    });

    it('MCP `run_action`: the same refusal is thrown, and the flow never runs', async () => {
        for (const input of [{}, { recordId: '' }]) {
            const { outcome, automation } = await mcp(PER_RECORD.name, input);
            expect(outcome?.status, JSON.stringify(input)).toBe(400);
            expect(outcome?.code).toBe('VALIDATION_ERROR');
            expect(String(outcome?.message)).toContain('`recordId`');
            expect(automation.execute).not.toHaveBeenCalled();
        }
    });

    it('REST: an unknown id keeps the door\'s 404 RECORD_NOT_FOUND, and the flow never runs', async () => {
        const { res, automation } = await rest(PER_RECORD.name, { recordId: GHOST_ID });
        expect(res.status).toBe(404);
        expect(res.body?.error?.code).toBe('RECORD_NOT_FOUND');
        expect(automation.execute).not.toHaveBeenCalled();
    });

    it('the controls: a real id runs the flow; an aggregate or undeclared flow action runs with no id', async () => {
        const real = await rest(PER_RECORD.name, { recordId: RECORD_ID });
        expect(real.res.status, bodyText(real.res)).toBe(200);
        expect(real.automation.execute).toHaveBeenCalledTimes(1);

        for (const action of [AGGREGATE, UNDECLARED]) {
            const { res, automation } = await rest(action.name, {});
            expect(res.status, `${action.name} ${bodyText(res)}`).toBe(200);
            expect(automation.execute, action.name).toHaveBeenCalledTimes(1);

            const viaMcp = await mcp(action.name, {});
            expect(viaMcp.outcome?.ok, action.name).toBe(true);
            expect(viaMcp.automation.execute, action.name).toHaveBeenCalledTimes(1);
        }
    });

    it('perRecordActionRecordIdRefusal reads only the declaration and the id', () => {
        expect(perRecordActionRecordIdRefusal(PER_RECORD, undefined)?.status).toBe(400);
        expect(perRecordActionRecordIdRefusal(PER_RECORD, '')?.status).toBe(400);
        expect(perRecordActionRecordIdRefusal(PER_RECORD, null)?.status).toBe(400);
        expect(perRecordActionRecordIdRefusal(PER_RECORD, RECORD_ID)).toBeUndefined();
        expect(perRecordActionRecordIdRefusal(AGGREGATE, undefined)).toBeUndefined();
        expect(perRecordActionRecordIdRefusal(UNDECLARED, undefined)).toBeUndefined();
        expect(perRecordActionRecordIdRefusal(undefined, undefined)).toBeUndefined();
    });
});
