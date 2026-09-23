// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two flow doors state which `params` keys the CALLER supplied —
 * `AutomationContext.callerParamKeys` (#19846).
 *
 * The params bag a flow reaches the engine with is not the caller's bag: the
 * action door spreads the subject row in and seeds the row id under `recordId`,
 * the `<object>Id` alias and the action's `recordIdParam`; the trigger door
 * seeds `recordId` and the alias. The screen node's headless verdict used to
 * infer the caller's keys back out of that merged bag, and could not finish the
 * job. Maintainer ruling on #15705 (「15705同意」): the doors say it instead.
 *
 * What this file pins — the PRODUCER half. The consumer half, on the real
 * automation engine, is `screen-headless-caller-signal.test.ts` in
 * `@objectstack/service-automation`; the two boundary contexts it runs are the
 * literals asserted here against the real `dispatchFlowAction`.
 *
 *  1. The action door lists the caller's own keys, none of the seeds, for the
 *     two boundary constructions the inference could not close.
 *  2. The row-id keys stay out even when the caller's bag names them.
 *  3. REST `/actions` and MCP `run_action` agree, because both reach the one
 *     `dispatchFlowAction`.
 *  4. The trigger door lists the caller's keys from either body shape, leaves
 *     `recordId` / the alias out (the console mirrors the row id into
 *     `params.recordId`), and both of its routes hand that context to the
 *     engine.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from './http-dispatcher.js';
import {
    callData,
    dispatchFlowAction,
    invokeBusinessAction,
    loadActionSubjectRecord,
    GLOBAL_ACTION_OBJECT_KEY,
} from './action-execution.js';
import { buildAutomationContext } from './domains/automation.js';

const FLOW_NAME = 'ask_session';

/** `recordIdField: 'token'` + a `recordIdParam` naming a key the record lacks — the shape both boundaries share. */
const ROTATE = {
    name: 'rotate_session',
    label: 'Rotate session',
    objectName: 'crm_lead',
    type: 'flow',
    target: FLOW_NAME,
    recordIdField: 'token',
    recordIdParam: 'sessionToken',
    ai: { exposed: true, description: 'Rotate a session.' },
};
const OBJECT_DEF = { name: 'crm_lead', actions: [ROTATE] };

/** Boundary 2's row: it shadows BOTH `recordId` and the `crmLeadId` alias. */
const OBJECT_BOUND_RECORD = { id: 'sess_1', token: 'tok_9', recordId: 'shadow_1', crmLeadId: 'shadow_2' };
/** Boundary 1's row: object-less, so no alias; it shadows `recordId`. */
const OBJECT_LESS_RECORD = { id: 'sess_1', token: 'tok_9', recordId: 'shadow_1' };

function ec(userId = 'usr_1') {
    return { userId, tenantId: 'org_1', positions: [], permissions: [], systemPermissions: [] };
}

/** An automation double that records the context it is handed. */
function makeAutomation() {
    const execute = vi.fn(async (_flow: string, _context?: any) => ({ success: true, output: {} }));
    const getFlow = vi.fn(async (name: string) => (name === FLOW_NAME ? { name } : null));
    return { execute, getFlow };
}
const contextOf = (automation: { execute: any }) => automation.execute.mock.calls[0]?.[1];
const flowDeps = (automation: any): any => ({
    resolveService: async (_ctx: any, name: string) => (name === 'automation' ? automation : undefined),
});
const REQUEST: any = { request: {}, environmentId: 'platform' };

describe('[#19846] the action door states callerParamKeys', () => {
    it('BOUNDARY 2 — object-bound, record shadows `recordId` and the alias: the caller\'s list is empty', async () => {
        const automation = makeAutomation();
        const subject = await loadActionSubjectRecord('crm_lead', 'sess_1', async () => ({ record: { ...OBJECT_BOUND_RECORD } }));
        await dispatchFlowAction(flowDeps(automation), REQUEST, ROTATE, {
            objectName: 'crm_lead', subject, params: {}, recordId: 'sess_1', ec: ec(), envId: 'platform',
        });
        const flowCtx = contextOf(automation);
        // The merged bag, byte for byte what the engine-side boundary pin runs.
        expect(flowCtx.params).toEqual({
            id: 'sess_1', token: 'tok_9', recordId: 'shadow_1', crmLeadId: 'shadow_2', sessionToken: 'tok_9',
        });
        expect(flowCtx.object).toBe('crm_lead');
        // The seeded row id sits under `sessionToken`; the caller named nothing.
        expect(flowCtx.callerParamKeys).toEqual([]);
    });

    it('BOUNDARY 1 — object-less, record shadows `recordId`: the caller\'s list is empty', async () => {
        const automation = makeAutomation();
        // An object-less action never loads a subject (`loadActionSubjectRecord`
        // stamps `{ id }` only), so this row is handed straight to the dispatcher
        // — the one way a context of this shape reaches the engine.
        const subject = { record: { ...OBJECT_LESS_RECORD }, recordLoadDenied: false };
        await dispatchFlowAction(flowDeps(automation), REQUEST, { ...ROTATE, objectName: undefined }, {
            objectName: GLOBAL_ACTION_OBJECT_KEY, subject, params: {}, recordId: 'sess_1', ec: ec(), envId: 'platform',
        });
        const flowCtx = contextOf(automation);
        expect(flowCtx.params).toEqual({ id: 'sess_1', token: 'tok_9', recordId: 'shadow_1', sessionToken: 'tok_9' });
        expect('object' in flowCtx).toBe(false);
        expect(flowCtx.callerParamKeys).toEqual([]);
    });

    it('lists the caller\'s keys and leaves out every row-id key, even when the caller\'s bag names it', async () => {
        const automation = makeAutomation();
        const subject = await loadActionSubjectRecord('crm_lead', 'sess_1', async () => ({ record: { ...OBJECT_BOUND_RECORD } }));
        await dispatchFlowAction(flowDeps(automation), REQUEST, ROTATE, {
            objectName: 'crm_lead',
            subject,
            params: { subject: 'Rotate it', recordId: 'sess_1', crmLeadId: 'sess_1', sessionToken: 'tok_9' },
            recordId: 'sess_1', ec: ec(), envId: 'platform',
        });
        const flowCtx = contextOf(automation);
        expect(flowCtx.callerParamKeys).toEqual(['subject']);
        // The caller's values still win in the bag — only the signal leaves them out.
        expect(flowCtx.params).toMatchObject({ subject: 'Rotate it', recordId: 'sess_1', crmLeadId: 'sess_1' });
    });

    it('an object-less action has no alias to leave out: a caller key shaped like one is the caller\'s', async () => {
        const automation = makeAutomation();
        const subject = await loadActionSubjectRecord(GLOBAL_ACTION_OBJECT_KEY, undefined, async () => null);
        await dispatchFlowAction(flowDeps(automation), REQUEST, { ...ROTATE, objectName: undefined, recordIdParam: undefined }, {
            objectName: GLOBAL_ACTION_OBJECT_KEY, subject, params: { crmLeadId: 'lead_7', recordId: 'lead_7' }, ec: ec(), envId: 'platform',
        });
        expect(contextOf(automation).callerParamKeys).toEqual(['crmLeadId']);
    });
});

/** A read path that returns boundary 2's row to anyone — what is under test is the context, not RLS. */
function makeQl() {
    const schemaOf = (n: string) => (n === OBJECT_DEF.name ? OBJECT_DEF : undefined);
    return {
        executeAction: vi.fn(async () => ({ ok: true })),
        getSchema: schemaOf,
        registry: { getObject: schemaOf, getItem: () => undefined },
        find: vi.fn(async (object: string) => (object === OBJECT_DEF.name ? [{ ...OBJECT_BOUND_RECORD }] : [])),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    } as any;
}

describe('[#19846] REST /actions and MCP run_action hand the engine the same callerParamKeys', () => {
    const CALLER_PARAMS = { subject: 'Rotate it', notes: 'asked twice', sessionToken: 'tok_9' };

    async function viaRest() {
        const ql = makeQl();
        const automation = makeAutomation();
        const metadata: any = {
            load: vi.fn(async () => null),
            loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
            listObjects: vi.fn(async () => [OBJECT_DEF]),
            getObject: vi.fn(async (n: string) => (n === OBJECT_DEF.name ? OBJECT_DEF : undefined)),
        };
        const resolve = (n: string) =>
            n === 'objectql' || n === 'data' ? ql : n === 'metadata' ? metadata : n === 'automation' ? automation : null;
        const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
        const res: any = await (new HttpDispatcher(kernel) as any).handleActions(
            '/crm_lead/rotate_session/sess_1', 'POST', { params: { ...CALLER_PARAMS } },
            { request: {}, environmentId: 'platform', executionContext: ec() },
        );
        return { status: res.response?.status, flowCtx: contextOf(automation) };
    }

    async function viaMcp() {
        const ql = makeQl();
        const automation = makeAutomation();
        const deps: any = {
            resolveService: async (_ctx: any, name: string) => (name === 'automation' ? automation : undefined),
            getObjectQL: async () => ql,
        };
        await invokeBusinessAction(deps, REQUEST, ROTATE.name, { recordId: 'sess_1', params: { ...CALLER_PARAMS } } as any, {
            driver: undefined,
            envId: 'platform',
            ec: ec(),
            getMeta: () => ({ listObjects: async () => [OBJECT_DEF] }),
            callData: (action, params, dataDriver, scopeId, execCtx) =>
                callData(deps, REQUEST, action, params, dataDriver, scopeId, execCtx),
        });
        return { flowCtx: contextOf(automation) };
    }

    it('both doors list the caller\'s keys minus the action\'s `recordIdParam`', async () => {
        const rest = await viaRest();
        const mcp = await viaMcp();
        expect(rest.status).toBe(200);
        expect(rest.flowCtx.callerParamKeys).toEqual(['subject', 'notes']);
        expect(mcp.flowCtx.callerParamKeys).toEqual(['subject', 'notes']);
        // And the bag they seed alongside it is the same one.
        expect(rest.flowCtx.params).toEqual(mcp.flowCtx.params);
    });
});

describe('[#19846] the trigger door states callerParamKeys', () => {
    it('the console launch shape: `params.recordId` mirrors the row id and is left out', () => {
        const ctx: any = buildAutomationContext(
            { recordId: 'lead_1', objectName: 'crm_lead', params: { recordId: 'lead_1', subject: 'Call back' } },
            { request: {} } as any,
        );
        expect(ctx.callerParamKeys).toEqual(['subject']);
        expect(ctx.params).toEqual({ recordId: 'lead_1', subject: 'Call back', crmLeadId: 'lead_1' });
    });

    it('an interactive launch that supplied nothing states an empty list, not an absent one', () => {
        const ctx: any = buildAutomationContext({ recordId: 'lead_1', objectName: 'crm_lead', params: {} }, { request: {} } as any);
        expect(ctx.callerParamKeys).toEqual([]);
        expect(ctx.params).toEqual({ recordId: 'lead_1', crmLeadId: 'lead_1' });
    });

    it('a caller-sent alias is left out too', () => {
        const ctx: any = buildAutomationContext(
            { recordId: 'lead_1', objectName: 'crm_lead', params: { crmLeadId: 'lead_1', notes: 'x' } },
            { request: {} } as any,
        );
        expect(ctx.callerParamKeys).toEqual(['notes']);
    });

    it('the flat body shape: its non-reserved top-level keys are the caller\'s', () => {
        const ctx: any = buildAutomationContext(
            { recordId: 'lead_1', objectName: 'crm_lead', subject: 'Call back', dueDate: '2026-09-30' },
            { request: {} } as any,
        );
        expect(ctx.callerParamKeys).toEqual(['subject', 'dueDate']);
    });

    it('with no object named there is no alias, so a key shaped like one stays the caller\'s', () => {
        const ctx: any = buildAutomationContext({ params: { leadId: 'lead_1', recordId: 'lead_1' } }, { request: {} } as any);
        expect(ctx.callerParamKeys).toEqual(['leadId']);
    });

    for (const route of [
        { label: 'POST /:name/trigger', path: `/${FLOW_NAME}/trigger` },
        { label: 'legacy POST /trigger/:name', path: `/trigger/${FLOW_NAME}` },
    ]) {
        it(`${route.label} hands the engine the signal`, async () => {
            const automation = makeAutomation();
            const resolve = (n: string) => (n === 'automation' ? automation : undefined);
            const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
            await new HttpDispatcher(kernel).handleAutomation(
                route.path, 'POST',
                { recordId: 'lead_1', objectName: 'crm_lead', params: { recordId: 'lead_1', subject: 'Call back' } },
                { request: {}, executionContext: { userId: 'usr_1' } } as any,
            );
            expect(automation.execute).toHaveBeenCalledTimes(1);
            expect(contextOf(automation).callerParamKeys).toEqual(['subject']);
        });
    }
});
