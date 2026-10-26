// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25598] An SLA escalation's `escalateTo` that no approver could ever act
 * under is refused at registration — the contract half of the card whose
 * runtime half keeps a stranded slate from being written on timeout.
 *
 * A person acts on a slot under their user id, their email or
 * `position:<p>` (`approver-address.ts` in `plugin-approvals`), so a `team:`,
 * `department:` or `org_membership_level:` literal, or the retired `role:`
 * spelling, names nobody under any escalation action. The shape alone settles
 * it, so it is judged here; whether a user id or a position resolves is
 * directory state, so every other shape stays accepted.
 *
 * - §1 each refused prefix is refused at `escalateTo`, under every action,
 *   padded or not;
 * - §2 each accepted shape parses, and an omitted target still parses;
 * - §3 the refusal reaches the door authors meet: `FlowSchema` and the build
 *   judge `flowNodeConfigRefusals`, anchored at the key.
 */

import { describe, expect, it } from 'vitest';

import { ApprovalEscalationSchema } from './approval.zod';
import { flowNodeConfigRefusals } from './flow-node-config-refusals';
import { FlowSchema } from './flow.zod';

const REFUSED = ['team:night_shift', 'department:sales', 'org_membership_level:admin', 'role:sales_manager'];
const ACCEPTED = ['usr_7f3a', 'vp@example.com', 'vp_operations', 'position:vp_operations'];
const ACTIONS = ['reassign', 'notify', 'auto_approve', 'auto_reject'] as const;

function issues(value: unknown): { code: string; path: string }[] {
  const result = ApprovalEscalationSchema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((i) => ({ code: i.code, path: i.path.join('.') }));
}

function flowWith(escalation: Record<string, unknown>) {
  return {
    name: 'expense_approval',
    label: 'Expense approval',
    type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      {
        id: 'gate', type: 'approval', label: 'Finance',
        config: { approvers: [{ type: 'position', value: 'finance_manager' }], escalation },
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

describe('§1 a target no approver acts under is refused at escalateTo', () => {
  it.each(REFUSED)('%s is refused under every action', (escalateTo) => {
    for (const action of ACTIONS) {
      expect(issues({ timeoutHours: 24, action, escalateTo })).toEqual([{ code: 'custom', path: 'escalateTo' }]);
    }
  });

  it.each(REFUSED)('%s is refused with surrounding whitespace, as the runtime trims it', (escalateTo) => {
    expect(issues({ timeoutHours: 24, action: 'reassign', escalateTo: `  ${escalateTo} ` }))
      .toEqual([{ code: 'custom', path: 'escalateTo' }]);
  });

  it('names the value it refused and the shapes it accepts', () => {
    const result = ApprovalEscalationSchema.safeParse({ timeoutHours: 24, action: 'reassign', escalateTo: 'team:ops' });
    expect(result.success).toBe(false);
    const message = result.success ? '' : result.error.issues[0]!.message;
    expect(message).toContain("'team:ops'");
    expect(message).toContain("'position:<name>'");
  });
});

describe('§2 a user id, an email and a position stay accepted', () => {
  it.each(ACCEPTED)('%s parses, whole schema green', (escalateTo) => {
    expect(issues({ timeoutHours: 24, action: 'reassign', escalateTo })).toEqual([]);
    const parsed = ApprovalEscalationSchema.parse({ timeoutHours: 24, action: 'reassign', escalateTo });
    expect(parsed.escalateTo).toBe(escalateTo);
  });

  it('an omitted target still parses and stays absent', () => {
    expect(issues({ timeoutHours: 24 })).toEqual([]);
    expect(ApprovalEscalationSchema.parse({ timeoutHours: 24 }).escalateTo).toBeUndefined();
  });
});

describe('§3 the refusal reaches the flow door', () => {
  it.each(REFUSED)('FlowSchema refuses %s at the node config key', (escalateTo) => {
    const result = FlowSchema.safeParse(flowWith({ timeoutHours: 24, action: 'reassign', escalateTo }));
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('nodes.1.config.escalation.escalateTo');
  });

  it.each(REFUSED)('the build judge reports %s as node-config-refused-by-contract', (escalateTo) => {
    const config = {
      approvers: [{ type: 'position', value: 'finance_manager' }],
      escalation: { timeoutHours: 24, action: 'reassign', escalateTo },
    };
    expect(flowNodeConfigRefusals('approval', config).map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'node-config-refused-by-contract', path: 'escalation.escalateTo' },
    ]);
  });

  it.each(ACCEPTED)('FlowSchema accepts %s', (escalateTo) => {
    expect(FlowSchema.safeParse(flowWith({ timeoutHours: 24, action: 'reassign', escalateTo })).success).toBe(true);
  });
});
