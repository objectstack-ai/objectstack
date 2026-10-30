// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two flow doors forward the caller's posture rung —
 * `AutomationContext.posture` (#28099, the door half of #28070).
 *
 * A request carries the rung its user resolves to (`ExecutionContext.posture`,
 * ADR-0095 D2/D3), derived once by `resolveAuthzContext`. The doors already
 * hold it beside the caller's positions and permission sets, which they
 * forward; a run that carries those grants is not re-resolved, so a rung the
 * door drops is a rung the run never has. The door forwards the caller's OWN
 * rung as-is — ⛔ never derived from the flow's author, never raised, never
 * filled in when the request carries none.
 *
 * What this file pins — the PRODUCER half. The consumer half, on the real
 * automation engine, is `runas-user-posture-rung.integration.test.ts` in
 * `@objectstack/service-automation`, which runs a door-shaped context (carried
 * grants plus a carried rung) to a data node.
 *
 *  1. The trigger door (`buildAutomationContext`) forwards `ec.posture`, and
 *     both of its routes hand it to the engine.
 *  2. The action door (`dispatchFlowAction`) forwards it.
 *  3. A request with no rung (anonymous, or a principal the resolver gave
 *     none) adds no key — absent, never a default rung.
 *  4. The request body cannot name one: `buildAutomationContext` reads the
 *     rung off the execution context only, and a body key named `posture`
 *     stays a flow param.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from './http-dispatcher.js';
import { dispatchFlowAction, loadActionSubjectRecord } from './action-execution.js';
import { buildAutomationContext } from './domains/automation.js';

const FLOW_NAME = 'quote_generation';

const QUOTE = {
    name: 'generate_quote',
    label: 'Generate quote',
    objectName: 'crm_opportunity',
    type: 'flow',
    target: FLOW_NAME,
};

function ec(posture?: string) {
    return {
        userId: 'usr_1', tenantId: 'org_1', positions: ['platform_admin'], permissions: ['admin_full_access'], systemPermissions: [],
        ...(posture !== undefined ? { posture } : {}),
    };
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

describe('[#28099] the trigger door forwards the caller\'s posture rung', () => {
    it('`buildAutomationContext` carries `executionContext.posture` as `posture`, beside the grants it carries', () => {
        const ctx: any = buildAutomationContext(
            { recordId: 'opp_1', objectName: 'crm_opportunity', params: {} },
            { request: {}, executionContext: ec('PLATFORM_ADMIN') } as any,
        );
        expect(ctx).toMatchObject({ permissions: ['admin_full_access'], posture: 'PLATFORM_ADMIN' });
    });

    it('a request with no rung adds no key: absent, never a default rung', () => {
        const ctx: any = buildAutomationContext(
            { recordId: 'opp_1', objectName: 'crm_opportunity', params: {} },
            { request: {}, executionContext: ec() } as any,
        );
        expect('posture' in ctx).toBe(false);
        const anonymous: any = buildAutomationContext({ params: {} }, { request: {} } as any);
        expect('posture' in anonymous).toBe(false);
    });

    it('the body cannot name a rung: a flat `posture` key stays a flow param, a wrapped one never leaves `params`', () => {
        const flat: any = buildAutomationContext(
            { posture: 'PLATFORM_ADMIN' },
            { request: {}, executionContext: ec('MEMBER') } as any,
        );
        expect(flat.posture).toBe('MEMBER');
        expect(flat.params.posture).toBe('PLATFORM_ADMIN');
        const noRung: any = buildAutomationContext(
            { posture: 'PLATFORM_ADMIN', params: { posture: 'PLATFORM_ADMIN' } },
            { request: {}, executionContext: ec() } as any,
        );
        expect('posture' in noRung).toBe(false);
    });

    for (const route of [
        { label: 'POST /:name/trigger', path: `/${FLOW_NAME}/trigger` },
        { label: 'legacy POST /trigger/:name', path: `/trigger/${FLOW_NAME}` },
    ]) {
        it(`${route.label} hands the engine the rung`, async () => {
            const automation = makeAutomation();
            const resolve = (n: string) => (n === 'automation' ? automation : undefined);
            const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
            await new HttpDispatcher(kernel).handleAutomation(
                route.path, 'POST',
                { recordId: 'opp_1', objectName: 'crm_opportunity', params: {} },
                { request: {}, executionContext: ec('PLATFORM_ADMIN') } as any,
            );
            expect(automation.execute).toHaveBeenCalledTimes(1);
            expect(contextOf(automation).posture).toBe('PLATFORM_ADMIN');
        });
    }
});

describe('[#28099] the action door forwards the caller\'s posture rung', () => {
    it('`dispatchFlowAction` carries `ec.posture` as `posture`, beside the grants it carries', async () => {
        const automation = makeAutomation();
        const subject = await loadActionSubjectRecord('crm_opportunity', 'opp_1', async () => ({ record: { id: 'opp_1' } }));
        await dispatchFlowAction(flowDeps(automation), REQUEST, QUOTE, {
            objectName: 'crm_opportunity', subject, params: {}, recordId: 'opp_1', ec: ec('PLATFORM_ADMIN'), envId: 'platform',
        });
        expect(contextOf(automation)).toMatchObject({ permissions: ['admin_full_access'], posture: 'PLATFORM_ADMIN' });
    });

    it('a request with no rung adds no key: absent, never a default rung', async () => {
        const automation = makeAutomation();
        const subject = await loadActionSubjectRecord('crm_opportunity', 'opp_1', async () => ({ record: { id: 'opp_1' } }));
        await dispatchFlowAction(flowDeps(automation), REQUEST, QUOTE, {
            objectName: 'crm_opportunity', subject, params: {}, recordId: 'opp_1', ec: ec(), envId: 'platform',
        });
        expect('posture' in contextOf(automation)).toBe(false);
    });
});
