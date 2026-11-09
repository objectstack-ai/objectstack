// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0151 D3] A flow an AI service account starts runs as the agent
 * principal it is.
 *
 * Both doors that hand the automation engine the caller's grants — the
 * trigger door (`buildAutomationContext`) and the action door
 * (`dispatchFlowAction`) — forward the account's kind beside them: the run
 * carries those grants, so its setup does not re-resolve them, and without
 * the kind the run would be evaluated as a person's (the member baseline, no
 * agent ceiling). CONTROLS: a person's request forwards no kind, and an
 * OAuth-delegated agent (`onBehalfOf`) is forwarded exactly as before.
 */

import { describe, it, expect, vi } from 'vitest';

import { dispatchFlowAction, loadActionSubjectRecord } from './action-execution.js';
import { buildAutomationContext } from './domains/automation.js';

const FLOW_NAME = 'lead_triage';
const TRIAGE = { name: 'triage', label: 'Triage', objectName: 'crm_lead', type: 'flow', target: FLOW_NAME };

const ACCOUNT = { userId: 'u_bot', tenantId: 'org_1', positions: ['org_member'], permissions: ['lead_reader'], systemPermissions: [], principalKind: 'agent', posture: 'MEMBER' };
const PERSON = { userId: 'u_mia', tenantId: 'org_1', positions: ['org_member', 'everyone'], permissions: ['lead_reader'], systemPermissions: [], principalKind: 'human', posture: 'MEMBER' };
const DELEGATED = { ...PERSON, principalKind: 'agent', permissions: ['mcp_agent_data_read'], onBehalfOf: { userId: 'u_mia', principalKind: 'human' } };

function makeAutomation() {
    const execute = vi.fn(async (_flow: string, _context?: any) => ({ success: true, output: {} }));
    const getFlow = vi.fn(async (name: string) => (name === FLOW_NAME ? { name } : null));
    return { execute, getFlow };
}
const flowDeps = (automation: any): any => ({
    resolveService: async (_ctx: any, name: string) => (name === 'automation' ? automation : undefined),
});

async function viaAction(ec: any) {
    const automation = makeAutomation();
    const subject = await loadActionSubjectRecord('crm_lead', 'lead_1', async () => ({ record: { id: 'lead_1' } }));
    await dispatchFlowAction(flowDeps(automation), { request: {}, environmentId: 'platform' } as any, TRIAGE as any, {
        objectName: 'crm_lead', subject, params: {}, recordId: 'lead_1', ec, envId: 'platform',
    });
    return automation.execute.mock.calls[0]?.[1];
}

const viaTrigger = (ec: any): any =>
    buildAutomationContext({ recordId: 'lead_1', objectName: 'crm_lead', params: {} }, { request: {}, executionContext: ec } as any);

describe('[ADR-0151 D3] a run an AI service account starts carries its kind', () => {
    it('the trigger door forwards principalKind agent beside the account\'s grants', () => {
        expect(viaTrigger(ACCOUNT)).toMatchObject({ userId: 'u_bot', permissions: ['lead_reader'], principalKind: 'agent' });
    });

    it('the action door forwards principalKind agent beside the account\'s grants', async () => {
        expect(await viaAction(ACCOUNT)).toMatchObject({ userId: 'u_bot', permissions: ['lead_reader'], principalKind: 'agent' });
    });

    it('the body cannot name a kind: a `principalKind` param stays a flow param', () => {
        const ctx = buildAutomationContext({ principalKind: 'agent', params: {} }, { request: {}, executionContext: PERSON } as any) as any;
        expect('principalKind' in ctx).toBe(false);
    });
});

describe('CONTROLS — a person and an OAuth-delegated agent forward no kind, as before', () => {
    for (const [label, ec] of [['a person', PERSON], ['an OAuth-delegated agent', DELEGATED]] as const) {
        it(`${label}: neither door adds the key`, async () => {
            expect('principalKind' in viaTrigger(ec)).toBe(false);
            expect('principalKind' in (await viaAction(ec))).toBe(false);
        });
    }
});
