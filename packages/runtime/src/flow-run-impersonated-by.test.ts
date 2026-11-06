// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two flow doors forward the impersonating administrator —
 * `AutomationContext.impersonatedBy` (#30213, ruling A).
 *
 * An administrator who impersonates a user acts AS that user: the request's
 * `ExecutionContext.userId` is the user, and `ExecutionContext.impersonatedBy`
 * names the administrator (attribution only, set by `resolveAuthzContext` from
 * the session). A door that builds a run's context by picking identity keys off
 * the envelope by name drops any key it does not pick, so the run's writes
 * would read as the user's own while the same click's `action_invocation` row
 * names the administrator.
 *
 * What this file pins — the PRODUCER half, at both doors. The consumer half
 * (the run's data nodes carry `impersonatedBy` onto every write, on both
 * `runAs` arms, and a decider's segment drops it) is
 * `resume-decider-identity.integration.test.ts` in
 * `@objectstack/service-automation`; the audit writer stamping it is
 * `activity-actor-name.test.ts` in `@objectstack/plugin-audit`.
 *
 *  1. The trigger door (`buildAutomationContext`) forwards it, and both of its
 *     routes hand it to the engine; `userId` stays the impersonated user.
 *  2. The action door (`dispatchFlowAction`) forwards it.
 *  3. CONTROL: the user's own request adds no key, and a blank value adds none.
 *  4. The request body cannot name one: a body key `impersonatedBy` stays a
 *     flow param.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from './http-dispatcher.js';
import { dispatchFlowAction, loadActionSubjectRecord } from './action-execution.js';
import { buildAutomationContext } from './domains/automation.js';

const FLOW_NAME = 'quote_generation';
const ADMIN = 'usr_admin';

const QUOTE = {
    name: 'generate_quote',
    label: 'Generate quote',
    objectName: 'crm_opportunity',
    type: 'flow',
    target: FLOW_NAME,
};

function ec(impersonatedBy?: string) {
    return {
        userId: 'usr_wang', tenantId: 'org_1', positions: ['sales_rep'], permissions: ['sales_user'], systemPermissions: [],
        ...(impersonatedBy !== undefined ? { impersonatedBy } : {}),
    };
}

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

describe('[#30213] the trigger door forwards the impersonating administrator', () => {
    it('`buildAutomationContext` carries `executionContext.impersonatedBy`; `userId` stays the impersonated user', () => {
        const ctx: any = buildAutomationContext(
            { recordId: 'opp_1', objectName: 'crm_opportunity', params: {} },
            { request: {}, executionContext: ec(ADMIN) } as any,
        );
        expect(ctx).toMatchObject({ userId: 'usr_wang', permissions: ['sales_user'], impersonatedBy: ADMIN });
    });

    it('CONTROL: the user\'s own request, a blank value and an anonymous request add no key', () => {
        for (const executionContext of [ec(), ec('   '), undefined]) {
            const ctx: any = buildAutomationContext(
                { recordId: 'opp_1', objectName: 'crm_opportunity', params: {} },
                { request: {}, ...(executionContext ? { executionContext } : {}) } as any,
            );
            expect('impersonatedBy' in ctx).toBe(false);
        }
    });

    it('the body cannot name one: a flat `impersonatedBy` key stays a flow param', () => {
        const flat: any = buildAutomationContext({ impersonatedBy: 'usr_forged' }, { request: {}, executionContext: ec() } as any);
        expect('impersonatedBy' in flat).toBe(false);
        expect(flat.params.impersonatedBy).toBe('usr_forged');
    });

    for (const route of [
        { label: 'POST /:name/trigger', path: `/${FLOW_NAME}/trigger` },
        { label: 'legacy POST /trigger/:name', path: `/trigger/${FLOW_NAME}` },
    ]) {
        for (const impersonated of [true, false]) {
            it(`${route.label} ${impersonated ? 'hands the engine the administrator' : 'CONTROL: hands the engine no key on the user\'s own request'}`, async () => {
                const automation = makeAutomation();
                const protocol = { getData: async ({ object, id }: any) => ({ object, id, record: { id } }) };
                const resolve = (n: string) => (n === 'automation' ? automation : n === 'protocol' ? protocol : undefined);
                const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
                await new HttpDispatcher(kernel).handleAutomation(
                    route.path, 'POST',
                    { recordId: 'opp_1', objectName: 'crm_opportunity', params: {} },
                    { request: {}, executionContext: ec(impersonated ? ADMIN : undefined) } as any,
                );
                expect(automation.execute).toHaveBeenCalledTimes(1);
                const ctx = contextOf(automation);
                expect(ctx.userId).toBe('usr_wang');
                if (impersonated) expect(ctx.impersonatedBy).toBe(ADMIN);
                else expect('impersonatedBy' in ctx).toBe(false);
            });
        }
    }
});

describe('[#30213] the action door forwards the impersonating administrator', () => {
    it('`dispatchFlowAction` carries `ec.impersonatedBy`; `userId` stays the impersonated user', async () => {
        const automation = makeAutomation();
        const subject = await loadActionSubjectRecord('crm_opportunity', 'opp_1', async () => ({ record: { id: 'opp_1' } }));
        await dispatchFlowAction(flowDeps(automation), REQUEST, QUOTE, {
            objectName: 'crm_opportunity', subject, params: {}, recordId: 'opp_1', ec: ec(ADMIN), envId: 'platform',
        });
        expect(contextOf(automation)).toMatchObject({ userId: 'usr_wang', permissions: ['sales_user'], impersonatedBy: ADMIN });
    });

    it('CONTROL: the user\'s own click and a blank value add no key', async () => {
        for (const value of [undefined, '  ']) {
            const automation = makeAutomation();
            const subject = await loadActionSubjectRecord('crm_opportunity', 'opp_1', async () => ({ record: { id: 'opp_1' } }));
            await dispatchFlowAction(flowDeps(automation), REQUEST, QUOTE, {
                objectName: 'crm_opportunity', subject, params: {}, recordId: 'opp_1', ec: ec(value), envId: 'platform',
            });
            expect('impersonatedBy' in contextOf(automation)).toBe(false);
        }
    });
});
