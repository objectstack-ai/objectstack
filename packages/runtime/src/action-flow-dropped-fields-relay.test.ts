// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #32861 — the action door relays the run's `droppedFields` to whoever pressed
 * the button, through BOTH entrances to `dispatchFlowAction`: REST
 * `POST /actions/:object/:action` (`HttpDispatcher.handleActions`, whose
 * `data` is the run's `AutomationResult`) and the MCP `run_action` bridge
 * (`invokeBusinessAction`, whose `result` is the same value).
 *
 * The door adds nothing and strips nothing — measured before this card: it
 * relays the result whole, so the run's answer is the one place the drop
 * could go missing, and that is where #32861 put it
 * (`service-automation`'s `run-dropped-fields.ts`). These pins hold the
 * door's half of the bargain with a scripted automation service, so a later
 * re-shaping of the door's answer (a projection, an allow-list) cannot drop
 * the member without going red. The wire half — the real engine, a real
 * read-only strip — is `@objectstack/verify`'s
 * `action-flow-dropped-fields.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from './http-dispatcher.js';
import { callData, invokeBusinessAction } from './action-execution.js';

const OBJECT = 'afr_report';
const FLOW = 'afr_submit';
const ACTION = 'submit_for_approval';
const MEMBER_EC = { userId: 'user_1', systemPermissions: [] as string[] };

const DROPPED = [{ object: OBJECT, fields: ['status'], reason: 'readonly' }];

function makeDoor(result: Record<string, unknown>) {
    const execute = vi.fn(async () => result);
    const getFlow = vi.fn(async (name: string) => (name === FLOW ? { name, type: 'autolaunched', runAs: 'user' } : null));
    const automation = { execute, getFlow };

    const action = {
        name: ACTION, label: 'Submit for approval', objectName: OBJECT, type: 'flow', target: FLOW,
        ai: { exposed: true, description: 'Submits the report for approval for this test.' },
    };
    const objectDef = { name: OBJECT, actions: [action] };
    const schemaOf = (n: string) => (n === OBJECT ? objectDef : undefined);
    const ql: any = {
        executeAction: vi.fn(async () => ({ ran: 'script' })),
        getSchema: schemaOf,
        registry: { getObject: schemaOf, getItem: () => undefined },
        find: vi.fn(async () => []),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async (n: string) => schemaOf(n)),
    };
    const resolve = (n: string) =>
        n === 'objectql' || n === 'data' ? ql : n === 'metadata' ? metadata : n === 'automation' ? automation : null;
    const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };

    const viaRest = async (): Promise<any> => {
        const res: any = await new HttpDispatcher(kernel).handleActions(`/${OBJECT}/${ACTION}`, 'POST', {}, {
            request: {}, environmentId: 'platform', executionContext: MEMBER_EC,
        } as any);
        expect(res.response?.status).toBe(200);
        return res.response?.body?.data;
    };

    const viaMcp = async (): Promise<any> => {
        const request: any = { request: {}, environmentId: 'platform', executionContext: MEMBER_EC };
        const deps: any = {
            resolveService: async (_ctx: any, name: string) => (name === 'automation' ? automation : undefined),
            getObjectQL: async () => ql,
        };
        const answered: any = await invokeBusinessAction(deps, request, ACTION, { objectName: OBJECT } as any, {
            driver: undefined,
            envId: 'platform',
            ec: MEMBER_EC,
            getMeta: () => ({ listObjects: async () => [objectDef] }),
            callData: (a, params, dataDriver, scopeId, execCtx) =>
                callData(deps, request, a, params, dataDriver, scopeId, execCtx),
        });
        return answered.result;
    };

    return { viaRest, viaMcp, execute };
}

const ENTRANCES = ['REST /actions', 'MCP run_action'] as const;

describe('the action door relays the run\'s droppedFields (#32861)', () => {
    for (const entrance of ENTRANCES) {
        it(`${entrance}: a run that dropped a read-only field answers it to the caller, beside an unchanged success`, async () => {
            const door = makeDoor({ success: true, output: {}, droppedFields: DROPPED });

            const answer = entrance === 'REST /actions' ? await door.viaRest() : await door.viaMcp();

            expect(door.execute).toHaveBeenCalledTimes(1);
            expect(answer.success).toBe(true);
            expect(answer.droppedFields).toEqual(DROPPED);
        });

        it(`${entrance}: a run that dropped nothing answers without the member`, async () => {
            const door = makeDoor({ success: true, output: {} });

            const answer = entrance === 'REST /actions' ? await door.viaRest() : await door.viaMcp();

            expect(answer.success).toBe(true);
            expect('droppedFields' in answer).toBe(false);
        });
    }
});
