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

function makeBridge(automation: any, shipped: { objectPackage?: string; registry?: Record<string, unknown> } = {}) {
    const object = {
        name: 'crm_lead', label: 'Lead', fields: {}, actions: [FLOW_ACTION],
        ...(shipped.objectPackage ? { _packageId: shipped.objectPackage } : {}),
    };
    const ql: any = {
        executeAction: vi.fn(),
        registry: { getObject: () => object, ...shipped.registry },
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

async function listed(automation: any, shipped?: Parameters<typeof makeBridge>[1]) {
    const actions = await makeBridge(automation, shipped).listActions();
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

/**
 * [ADR-0150 D3/D4, #31696] A flow name two namespaces' packages hold: the
 * engine refuses the bare read (409, naming both) and holds one slot each.
 * The listing reads the flow the action's own package names, as `run_action`
 * runs it, so P's flow action still lists its inputs.
 */
describe('list_actions reads a flow action\'s target from the action\'s own package (ADR-0150 D3)', () => {
    const CRM = 'com.crm.pkg';
    const HR = 'com.hr.pkg';
    const holders = [CRM, HR];
    const registry = {
        packageScopedHoldersOf: (type: string, name: string) => (type === 'flow' && name === FLOW.name ? holders : []),
        getPackageScopedItem: (type: string, name: string, packageId: string) =>
            (type === 'flow' && name === FLOW.name && holders.includes(packageId) ? { name, _packageId: packageId } : undefined),
        getEnvironmentScopedItem: () => undefined,
        getPackage: (id: string) => ({ manifest: { id, namespace: id === CRM ? 'crm' : 'hr' }, source: 'code' }),
        getAllPackages: () => holders.map((id) => ({ manifest: { id, namespace: id === CRM ? 'crm' : 'hr' }, source: 'code' })),
    };
    const slotted = () => ({
        execute: vi.fn(),
        getFlow: vi.fn(async () => { throw Object.assign(new Error('held by two packages'), { code: 'RESOURCE_CONFLICT', status: 409 }); }),
        flowSlotKey: vi.fn((pkg: string | null, name: string) => (name === FLOW.name && pkg && holders.includes(pkg) ? `${pkg}/${name}` : undefined)),
        getFlowSlot: vi.fn((pkg: string | null, name: string) => (name === FLOW.name && pkg === CRM ? FLOW : null)),
        executeSlot: vi.fn(),
        toggleFlowSlot: vi.fn(),
    });

    it('P\'s flow action lists the inputs of P\'s own flow, read from P\'s slot', async () => {
        const automation = slotted();
        const summary = await listed(automation, { objectPackage: CRM, registry });
        expect(summary.params).toEqual([
            { name: 'subject', type: 'string', required: true, description: 'Subject' },
            { name: 'dueDate', type: 'string', required: true, description: 'Due date' },
        ]);
        expect(automation.getFlowSlot.mock.calls.map((c: unknown[]) => c[0])).toEqual([CRM]);
        expect(automation.getFlow).not.toHaveBeenCalled();
    });

    it('CONTROL — an action with no package reads bare: refused, it lists without params, and the listing does not fail', async () => {
        const automation = slotted();
        const summary = await listed(automation, { registry });
        expect(summary).toBeDefined();
        expect(summary).not.toHaveProperty('params');
        expect(automation.getFlowSlot).not.toHaveBeenCalled();
    });
});
