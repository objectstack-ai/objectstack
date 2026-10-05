// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The approval node declares the contract its executor parses (#21848), so the
 * engine judges an approval node's config VALUES when a flow registers rather
 * than at the first run that reaches the node.
 *
 * Before: the node published only the JSON Schema form of its contract, which
 * registration reads for key NAMES; `escalation.timeoutHours: 0.5` (the
 * contract says `>= 1`) registered, loaded `active`, and every run then failed
 * at the node with `Approval node 'gate' has invalid config: …` and no
 * approval request opened.
 */

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from '@objectstack/service-automation';
import { ApprovalNodeConfigSchema } from '@objectstack/spec/automation';
import { ApprovalService } from './approval-service.js';
import { registerApprovalNode, type ApprovalAutomationSurface } from './approval-node.js';

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };

type RegisteredExecutor = Parameters<ApprovalAutomationSurface['registerNodeExecutor']>[0];

/** Capture what `registerApprovalNode` hands the engine, by node type. */
function captureRegistrations(): { surface: ApprovalAutomationSurface; byType: Map<string, RegisteredExecutor> } {
  const byType = new Map<string, RegisteredExecutor>();
  return {
    byType,
    surface: { registerNodeExecutor: (executor) => { byType.set(executor.type, executor); } },
  };
}

function gatedFlow(name: string, escalation: Record<string, unknown>) {
  return {
    name,
    label: name,
    type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      {
        id: 'gate',
        type: 'approval',
        label: 'Gate',
        config: { approvers: [{ type: 'user', value: 'u1' }], escalation },
      },
      { id: 'approved', type: 'end', label: 'Approved' },
      { id: 'rejected', type: 'end', label: 'Rejected' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'gate' },
      { id: 'e2', source: 'gate', target: 'approved', label: 'approve' },
      { id: 'e3', source: 'gate', target: 'rejected', label: 'reject' },
    ],
  };
}

describe('the approval node declares its config contract', () => {
  it('is the very schema its executor parses — not a copy, not the JSON Schema form', async () => {
    const { surface, byType } = captureRegistrations();
    registerApprovalNode(surface, new ApprovalService({ engine: {} as any, logger: noopLogger }), noopLogger);

    const approval = byType.get('approval');
    expect(approval?.configContract).toBe(ApprovalNodeConfigSchema);

    // …and `execute` refuses exactly what the contract refuses, before it
    // reads anything else (no run id, no record: the parse comes first).
    const config = { approvers: [{ type: 'user', value: 'u1' }], escalation: { timeoutHours: 0.5 } };
    expect(ApprovalNodeConfigSchema.safeParse(config).success).toBe(false);
    const result = await approval!.execute({ id: 'gate', config }, new Map(), {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('escalation.timeoutHours');

    // The revise window parses no config, so it declares none.
    expect(byType.get('approval_revise')?.configContract).toBeUndefined();
  });

  it('on the engine: `timeoutHours: 0.5` is refused at registration, located; a valid escalation registers', async () => {
    const engine = new AutomationEngine(noopLogger as any);
    registerApprovalNode(engine, new ApprovalService({ engine: {} as any, logger: noopLogger }), noopLogger);

    let refusal: Error | undefined;
    try {
      engine.registerFlow('sub_hour', gatedFlow('sub_hour', { enabled: true, timeoutHours: 0.5, action: 'notify' }) as never);
    } catch (err) {
      refusal = err as Error;
    }
    expect(refusal, 'registered a flow whose approval escalation the contract refuses').toBeDefined();
    expect(refusal!.message).toContain("Flow 'sub_hour' rejected");
    expect(refusal!.message).toContain("node 'gate' (approval): config.escalation.timeoutHours: ");
    expect(await engine.getFlow('sub_hour')).toBeNull();

    engine.registerFlow('valid', gatedFlow('valid', { enabled: true, timeoutHours: 1, action: 'notify' }) as never);
    expect(await engine.getFlow('valid')).not.toBeNull();
  });
});
