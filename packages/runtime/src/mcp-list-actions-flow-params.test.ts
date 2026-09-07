// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The WIRE half of #15705: `list_actions` asks the automation service for the
 * flow behind a flow action, so the input names actually reach the agent.
 *
 * `summarizeActionParams`' own pins (`action-flow-input-params.test.ts`) prove
 * the projection. They cannot prove anybody performs it: the bridge held only
 * `Boolean(automationService)` and passed the summary no flow at all, so the
 * projection would have sat unreachable behind a green unit suite — the exact
 * "declared but nothing calls it" shape. This file pins the call.
 *
 * `getFlow` is OPTIONAL on `IAutomationService`, so the degradation is pinned
 * too: a service that does not implement it, and a flow the registry does not
 * hold, both answer exactly as the listing answered before this change.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from './http-dispatcher.js';

/** The card's specimen, as an object-embedded declaration. */
const FLOW_ACTION = {
    name: 'schedule_followup',
    label: 'Schedule Follow-up',
    objectName: 'crm_lead',
    type: 'flow',
    target: 'schedule_followup',
    locations: ['record_header'],
    ai: { exposed: true, description: 'Schedule a follow-up task for this lead.' },
};

const FLOW = {
    name: 'schedule_followup',
    type: 'screen',
    variables: [
        { name: 'subject', type: 'text', isInput: true },
        { name: 'dueDate', type: 'text', isInput: true },
    ],
    nodes: [
        { id: 'start', type: 'start' },
        {
            id: 'screen_1', type: 'screen',
            config: {
                fields: [
                    { name: 'subject', label: 'Subject', type: 'text', required: true },
                    { name: 'dueDate', label: 'Due date', type: 'date', required: true },
                ],
            },
        },
    ],
};

function makeBridge(automation: any) {
    const object = { name: 'crm_lead', label: 'Lead', fields: {}, actions: [FLOW_ACTION] };
    const ql: any = {
        executeAction: vi.fn(),
        registry: { getObject: () => object },
        find: vi.fn(async () => []),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
        listObjects: vi.fn(async () => [object]),
        getObject: vi.fn(async () => object),
    };
    const kernel: any = {
        context: {
            getService: (n: string) =>
                n === 'objectql' || n === 'data' ? ql : n === 'metadata' ? metadata : n === 'automation' ? automation : null,
        },
    };
    const dispatcher = new HttpDispatcher(kernel);
    const ctx: any = {
        request: {}, environmentId: 'platform',
        executionContext: { userId: 'u1', systemPermissions: [] },
    };
    return (dispatcher as any).buildMcpBridge(ctx);
}

async function listed(automation: any) {
    const actions = await makeBridge(automation).listActions();
    return actions.find((a: any) => a.name === 'schedule_followup');
}

describe('list_actions surfaces a flow action’s inputs (#15705)', () => {
    it('asks getFlow for the action’s target and publishes the flow’s inputs as params', async () => {
        const getFlow = vi.fn(async () => FLOW);
        const summary = await listed({ execute: vi.fn(), getFlow });
        expect(getFlow).toHaveBeenCalledWith('schedule_followup');
        expect(summary.params).toEqual([
            { name: 'subject', type: 'string', required: true, description: 'Subject' },
            { name: 'dueDate', type: 'string', required: true, description: 'Due date' },
        ]);
    });

    it('CONTROL — the reported shape: a service with no getFlow lists exactly as before', async () => {
        const summary = await listed({ execute: vi.fn() });
        expect(summary).toBeDefined();
        expect(summary).not.toHaveProperty('params');
        expect(summary).toMatchObject({ name: 'schedule_followup', type: 'flow', requiresRecord: true });
    });

    it('CONTROL — a target the registry does not hold degrades to the same shape', async () => {
        const summary = await listed({ execute: vi.fn(), getFlow: vi.fn(async () => null) });
        expect(summary).not.toHaveProperty('params');
    });

    it('CONTROL — a getFlow that THROWS does not fail the listing', async () => {
        const summary = await listed({
            execute: vi.fn(),
            getFlow: vi.fn(async () => { throw new Error('registry unavailable'); }),
        });
        expect(summary).toBeDefined();
        expect(summary).not.toHaveProperty('params');
    });
});
