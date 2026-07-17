// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateApprovalApprovers,
  APPROVAL_APPROVER_NOT_MEMBERSHIP_TIER,
  APPROVAL_APPROVER_TYPE_DEPRECATED,
  APPROVAL_APPROVER_TYPE_UNKNOWN,
  APPROVAL_ESCALATION_REASSIGN_NO_TARGET,
} from './validate-approval-approvers.js';

function stackWithApprovers(approvers: unknown[]): Record<string, unknown> {
  return {
    flows: [{
      name: 'expense_approval',
      nodes: [
        { id: 'start', type: 'start', config: {} },
        { id: 'step1', type: 'approval', config: { approvers } },
      ],
      edges: [],
    }],
  };
}

describe('validateApprovalApprovers', () => {
  it('is clean on an empty / flow-less stack', () => {
    expect(validateApprovalApprovers({})).toEqual([]);
    expect(validateApprovalApprovers({ flows: [] })).toEqual([]);
  });

  it('accepts membership tiers for org_membership_level (owner/admin/member/guest)', () => {
    const findings = validateApprovalApprovers(stackWithApprovers([
      { type: 'org_membership_level', value: 'admin' },
      { type: 'org_membership_level', value: 'Owner' }, // case-insensitive
      { type: 'org_membership_level', value: 'member' },
      { type: 'org_membership_level', value: 'guest' },
    ]));
    expect(findings).toEqual([]);
  });

  it("flags a position name authored as a membership tier (the ADR-0090 D3 hotcrm class)", () => {
    const findings = validateApprovalApprovers(stackWithApprovers([
      { type: 'org_membership_level', value: 'sales_manager' },
    ]));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(APPROVAL_APPROVER_NOT_MEMBERSHIP_TIER);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].where).toContain('expense_approval');
    expect(findings[0].path).toBe('flows[0].nodes[1].config.approvers[0].value');
    expect(findings[0].hint).toContain("type: 'position'");
  });

  // ── the deprecated `role` spelling (ADR-0090 D3, #3133) ──────────────────

  it('flags the deprecated `role` spelling even when its value is a valid tier', () => {
    const findings = validateApprovalApprovers(stackWithApprovers([
      { type: 'role', value: 'admin' },
    ]));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(APPROVAL_APPROVER_TYPE_DEPRECATED);
    expect(findings[0].path).toBe('flows[0].nodes[1].config.approvers[0].type');
    expect(findings[0].hint).toContain("type: 'org_membership_level'");
  });

  // The two rules must not both fire: rewriting { type: 'role', value:
  // 'sales_manager' } as `org_membership_level` is WRONG advice — the value is
  // a position, so `position` is the fix and the deprecation is beside the
  // point. Exactly one finding, and it must be the value rule.
  it('prefers the value fix over the deprecation notice for a position name', () => {
    const findings = validateApprovalApprovers(stackWithApprovers([
      { type: 'role', value: 'sales_manager' },
    ]));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(APPROVAL_APPROVER_NOT_MEMBERSHIP_TIER);
    expect(findings[0].hint).toContain("type: 'position'");
    expect(findings[0].hint).not.toContain('org_membership_level, value');
  });

  it('accepts the position approver type and the other spec types silently', () => {
    const findings = validateApprovalApprovers(stackWithApprovers([
      { type: 'position', value: 'sales_manager' },
      { type: 'user', value: 'u1' },
      { type: 'manager' },
      { type: 'department', value: 'bu_sales' },
      { type: 'field', value: 'owner_id' },
      { type: 'queue', value: 'q1' },
      { type: 'team', value: 't1' },
    ]));
    expect(findings).toEqual([]);
  });

  it('flags off-spec approver types, with a canonical fix for the business_unit dialect', () => {
    const findings = validateApprovalApprovers(stackWithApprovers([
      { type: 'business_unit', value: 'bu_sales' },
      { type: 'group', value: 'g1' },
    ]));
    expect(findings).toHaveLength(2);
    expect(findings[0].rule).toBe(APPROVAL_APPROVER_TYPE_UNKNOWN);
    expect(findings[0].hint).toContain("type: 'department'");
    expect(findings[1].rule).toBe(APPROVAL_APPROVER_TYPE_UNKNOWN);
  });

  it("flags escalation.action 'reassign' with no escalateTo (silent notify degradation)", () => {
    const stack = stackWithApprovers([{ type: 'user', value: 'u1' }]);
    const node = (stack.flows as any)[0].nodes[1];
    node.config.escalation = { enabled: true, timeoutHours: 24, action: 'reassign' };
    const findings = validateApprovalApprovers(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(APPROVAL_ESCALATION_REASSIGN_NO_TARGET);
    expect(findings[0].path).toBe('flows[0].nodes[1].config.escalation.escalateTo');
    expect(findings[0].hint).toContain('position');
  });

  it('accepts reassign escalation with a target, and non-reassign actions without one', () => {
    const stack = stackWithApprovers([{ type: 'user', value: 'u1' }]);
    const node = (stack.flows as any)[0].nodes[1];
    node.config.escalation = { enabled: true, timeoutHours: 24, action: 'reassign', escalateTo: 'approvals_supervisor' };
    expect(validateApprovalApprovers(stack)).toEqual([]);
    node.config.escalation = { enabled: true, timeoutHours: 24, action: 'notify' };
    expect(validateApprovalApprovers(stack)).toEqual([]);
  });

  it('only scans approval nodes and tolerates malformed shapes', () => {
    const findings = validateApprovalApprovers({
      flows: [{
        name: 'f',
        nodes: [
          { id: 'a', type: 'script', config: { approvers: [{ type: 'role', value: 'sales_manager' }] } },
          { id: 'b', type: 'approval' }, // no config
          { id: 'c', type: 'approval', config: { approvers: 'oops' } },
          null,
        ],
      }, null, 'garbage'],
    } as never);
    expect(findings).toEqual([]);
  });
});
