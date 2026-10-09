// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two flow doors forward the caller's language — `AutomationContext.locale`
 * (#22450).
 *
 * A refusing `end` node's message is rendered once, by the engine, and stored
 * rendered, so the engine has to know the run's language when it renders. The
 * doors already hold it: `ExecutionContext.locale`, resolved once per request
 * by the shared assembler (the request's `Accept-Language` first, then the
 * `localization` settings). They forward it as-is — ⛔ never re-derived here.
 *
 * What this file pins — the PRODUCER half. The consumer half, on the real
 * automation engine, is `end-node-refusal-translation.test.ts` in
 * `@objectstack/service-automation`, which runs the context these doors build
 * through a refusal on the start leg and on a resumed leg.
 *
 *  1. The trigger door (`buildAutomationContext`) forwards `ec.locale`, and
 *     both of its routes hand it to the engine.
 *  2. The action door (`dispatchFlowAction`) forwards it, for REST `/actions`
 *     and MCP `run_action` alike.
 *  3. A request with no resolved locale (anonymous, or no header and no
 *     settings) adds no key — absent, never an empty string.
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

function ec(locale?: string) {
    return {
        userId: 'usr_1', tenantId: 'org_1', positions: [], permissions: [], systemPermissions: [],
        ...(locale !== undefined ? { locale } : {}),
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

describe('[#22450] the trigger door forwards the caller\'s locale', () => {
    it('`buildAutomationContext` carries `executionContext.locale` as `locale`', () => {
        const ctx: any = buildAutomationContext(
            { recordId: 'opp_1', objectName: 'crm_opportunity', params: {} },
            { request: {}, executionContext: ec('zh-CN') } as any,
        );
        expect(ctx.locale).toBe('zh-CN');
    });

    it('a request with no resolved locale adds no key', () => {
        const ctx: any = buildAutomationContext(
            { recordId: 'opp_1', objectName: 'crm_opportunity', params: {} },
            { request: {}, executionContext: ec() } as any,
        );
        expect('locale' in ctx).toBe(false);
        const empty: any = buildAutomationContext({ params: {} }, { request: {}, executionContext: ec('') } as any);
        expect('locale' in empty).toBe(false);
    });

    for (const route of [
        { label: 'POST /:name/trigger', path: `/${FLOW_NAME}/trigger` },
        { label: 'legacy POST /trigger/:name', path: `/trigger/${FLOW_NAME}` },
    ]) {
        it(`${route.label} hands the engine the locale`, async () => {
            const automation = makeAutomation();
            const resolve = (n: string) => (n === 'automation' ? automation : undefined);
            const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
            await new HttpDispatcher(kernel).handleAutomation(
                route.path, 'POST',
                { recordId: 'opp_1', objectName: 'crm_opportunity', params: {} },
                { request: {}, executionContext: ec('zh-CN') } as any,
            );
            expect(automation.execute).toHaveBeenCalledTimes(1);
            expect(contextOf(automation).locale).toBe('zh-CN');
        });
    }
});

describe('[#22450] the action door forwards the caller\'s locale', () => {
    it('`dispatchFlowAction` carries `ec.locale` as `locale`', async () => {
        const automation = makeAutomation();
        const subject = await loadActionSubjectRecord('crm_opportunity', 'opp_1', async () => ({ record: { id: 'opp_1' } }));
        await dispatchFlowAction(flowDeps(automation), REQUEST, QUOTE, {
            objectName: 'crm_opportunity', subject, params: {}, recordId: 'opp_1', ec: ec('zh-CN'), envId: 'platform',
        });
        expect(contextOf(automation).locale).toBe('zh-CN');
    });

    it('a request with no resolved locale adds no key', async () => {
        const automation = makeAutomation();
        const subject = await loadActionSubjectRecord('crm_opportunity', 'opp_1', async () => ({ record: { id: 'opp_1' } }));
        await dispatchFlowAction(flowDeps(automation), REQUEST, QUOTE, {
            objectName: 'crm_opportunity', subject, params: {}, recordId: 'opp_1', ec: ec(), envId: 'platform',
        });
        expect('locale' in contextOf(automation)).toBe(false);
    });
});
