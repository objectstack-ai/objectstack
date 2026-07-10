// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateApprovalApprovers,
  APPROVAL_ROLE_NOT_MEMBERSHIP_TIER,
  APPROVAL_APPROVER_TYPE_UNKNOWN,
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

  it('accepts membership tiers for type role (owner/admin/member/guest)', () => {
    const findings = validateApprovalApprovers(stackWithApprovers([
      { type: 'role', value: 'admin' },
      { type: 'role', value: 'Owner' }, // case-insensitive
      { type: 'role', value: 'member' },
      { type: 'role', value: 'guest' },
    ]));
    expect(findings).toEqual([]);
  });

  it("flags a position name authored as type 'role' (the ADR-0090 D3 hotcrm class)", () => {
    const findings = validateApprovalApprovers(stackWithApprovers([
      { type: 'role', value: 'sales_manager' },
    ]));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(APPROVAL_ROLE_NOT_MEMBERSHIP_TIER);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].where).toContain('expense_approval');
    expect(findings[0].path).toBe('flows[0].nodes[1].config.approvers[0].value');
    expect(findings[0].hint).toContain("type: 'position'");
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
