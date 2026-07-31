// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateApprovalApprovers,
  APPROVAL_APPROVER_NOT_MEMBERSHIP_TIER,
  APPROVAL_APPROVER_TYPE_DEPRECATED,
  APPROVAL_APPROVER_TYPE_UNKNOWN,
  APPROVAL_APPROVER_TYPE_UNSUPPORTED,
  APPROVAL_ESCALATION_REASSIGN_NO_TARGET,
  APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY,
  APPROVAL_EXPRESSION_INVALID,
  APPROVAL_EXPRESSION_NO_EMPTY_POLICY,
  APPROVAL_DECISION_OUTPUTS_RESERVED,
  APPROVAL_APPROVER_CROSS_ORG_UNSUPPORTED,
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

  it('accepts the closed membership vocabulary (owner/admin/delegated_admin/member)', () => {
    const findings = validateApprovalApprovers(stackWithApprovers([
      { type: 'org_membership_level', value: 'admin' },
      { type: 'org_membership_level', value: 'Owner' }, // case-insensitive
      { type: 'org_membership_level', value: 'member' },
      { type: 'org_membership_level', value: 'delegated_admin' },
    ]));
    expect(findings).toEqual([]);
  });

  it('[ADR-0108] flags `guest` — the tier list is derived, and never offered it', () => {
    // The hand-kept copy of this list carried `guest`, which the
    // `sys_member.role` select has never offered: an approver naming it
    // resolved to nobody, and the lint whose whole job is to catch that stayed
    // silent. Deriving the set from `@objectstack/spec` fixed it by
    // construction.
    const findings = validateApprovalApprovers(stackWithApprovers([
      { type: 'org_membership_level', value: 'guest' },
    ]));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(APPROVAL_APPROVER_NOT_MEMBERSHIP_TIER);
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

  // ── queue: declared-but-unenforced (#3508) ────────────────────────────────

  it('flags a queue approver as unsupported — the runtime resolves it to nobody', () => {
    const findings = validateApprovalApprovers(stackWithApprovers([
      { type: 'queue', value: 'q_west' },
      { type: 'user', value: 'u1' }, // a real route keeps the node off the empty-slate rule
    ]));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(APPROVAL_APPROVER_TYPE_UNSUPPORTED);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].path).toBe('flows[0].nodes[1].config.approvers[0].type');
    expect(findings[0].message).toContain('#3508');
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

  it('accepts the position approver type and the other RESOLVABLE spec types silently', () => {
    // `queue` is deliberately absent: it parses but the runtime never resolves
    // it, so it now draws APPROVAL_APPROVER_TYPE_UNSUPPORTED (#3508).
    const findings = validateApprovalApprovers(stackWithApprovers([
      { type: 'position', value: 'sales_manager' },
      { type: 'user', value: 'u1' },
      { type: 'manager' },
      { type: 'department', value: 'bu_sales' },
      { type: 'field', value: 'owner_id' },
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

  // ── empty-slate dead-end (#3424) ─────────────────────────────────────────

  it('flags a node routed only to a single group (unstaffed-position dead-end)', () => {
    const findings = validateApprovalApprovers(stackWithApprovers([
      { type: 'position', value: 'exec' },
    ]));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].path).toBe('flows[0].nodes[1].config.approvers');
    expect(findings[0].message).toContain('locked'); // lockRecord defaults true
    expect(findings[0].hint).toContain("org_membership_level', value: 'owner'");
  });

  it('flags a node routed only to groups (all position/team/department)', () => {
    const findings = validateApprovalApprovers(stackWithApprovers([
      { type: 'position', value: 'finance' },
      { type: 'team', value: 't1' },
      { type: 'department', value: 'bu_sales' },
    ]));
    expect(findings.filter(f => f.rule === APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY)).toHaveLength(1);
  });

  it('does NOT flag when a guaranteed-staffed or individual fallback is present', () => {
    // position + owner tier — the prescribed fallback.
    expect(validateApprovalApprovers(stackWithApprovers([
      { type: 'position', value: 'exec' },
      { type: 'org_membership_level', value: 'owner' },
    ]))).toEqual([]);
    // position + a specific user.
    expect(validateApprovalApprovers(stackWithApprovers([
      { type: 'position', value: 'exec' },
      { type: 'user', value: 'u1' },
    ]))).toEqual([]);
    // position + the submitter's manager.
    expect(validateApprovalApprovers(stackWithApprovers([
      { type: 'position', value: 'exec' },
      { type: 'manager' },
    ]))).toEqual([]);
  });

  it('drops the record-lock clause when lockRecord is false', () => {
    const stack = stackWithApprovers([{ type: 'position', value: 'exec' }]);
    (stack.flows as any)[0].nodes[1].config.lockRecord = false;
    const findings = validateApprovalApprovers(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY);
    expect(findings[0].message).not.toContain('locked');
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

// ── #3447 P2: expression approvers / decision outputs ─────────────────────

describe('expression approvers (#3447 P2)', () => {
  const stackWithConfig = (config: Record<string, unknown>): Record<string, unknown> => ({
    flows: [{
      name: 'expense_approval',
      nodes: [
        { id: 'start', type: 'start', config: {} },
        { id: 'step1', type: 'approval', config },
      ],
      edges: [],
    }],
  });

  it('accepts the three legal roots (current/trigger/vars) with an explicit empty policy', () => {
    const findings = validateApprovalApprovers(stackWithConfig({
      approvers: [
        { type: 'expression', value: 'current.approvers_dynamic' },
        { type: 'expression', value: 'trigger.owner_id' },
        { type: 'expression', value: 'vars.approval_lead.next_reviewers', resolveAs: 'department' },
      ],
      onEmptyApprovers: 'fail',
    }));
    expect(findings).toEqual([]);
  });

  it('errors on a `record` root and prescribes current/trigger', () => {
    const findings = validateApprovalApprovers(stackWithConfig({
      approvers: [{ type: 'expression', value: 'record.approvers_dynamic' }],
      onEmptyApprovers: 'admin_rescue',
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(APPROVAL_EXPRESSION_INVALID);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('record');
    expect(findings[0].hint).toContain('current.<field>');
    expect(findings[0].hint).toContain('trigger.<field>');
  });

  it('errors on a bare field reference with the closed-root hint', () => {
    const findings = validateApprovalApprovers(stackWithConfig({
      approvers: [{ type: 'expression', value: 'approvers_dynamic' }],
      onEmptyApprovers: 'admin_rescue',
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(APPROVAL_EXPRESSION_INVALID);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].hint).toContain('current.<field>');
  });

  it('errors on a non-parsing expression and an empty one', () => {
    const bad = validateApprovalApprovers(stackWithConfig({
      approvers: [{ type: 'expression', value: 'current..' }],
      onEmptyApprovers: 'admin_rescue',
    }));
    expect(bad).toHaveLength(1);
    expect(bad[0].rule).toBe(APPROVAL_EXPRESSION_INVALID);
    expect(bad[0].message).toContain('does not parse');

    const empty = validateApprovalApprovers(stackWithConfig({
      approvers: [{ type: 'expression', value: '' }],
      onEmptyApprovers: 'admin_rescue',
    }));
    expect(empty).toHaveLength(1);
    expect(empty[0].rule).toBe(APPROVAL_EXPRESSION_INVALID);
    expect(empty[0].message).toContain('empty expression');
  });

  it('flags resolveAs on a non-expression approver as dead config', () => {
    const findings = validateApprovalApprovers(stackWithConfig({
      approvers: [{ type: 'field', value: 'reviewer', resolveAs: 'department' }],
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(APPROVAL_EXPRESSION_INVALID);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].path).toContain('resolveAs');
  });

  it('nudges an expression node to declare onEmptyApprovers explicitly', () => {
    const findings = validateApprovalApprovers(stackWithConfig({
      approvers: [{ type: 'expression', value: 'vars.picked' }],
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(APPROVAL_EXPRESSION_NO_EMPTY_POLICY);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].hint).toContain('admin_rescue');
  });

  it('errors on reserved decisionOutputs keys', () => {
    const findings = validateApprovalApprovers(stackWithConfig({
      approvers: [{ type: 'user', value: 'u1' }],
      decisionOutputs: ['decision', 'next_reviewers'],
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(APPROVAL_DECISION_OUTPUTS_RESERVED);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('decision');
  });

  it('errors on reserved keys inside TYPED decisionOutputs declarations too', () => {
    const findings = validateApprovalApprovers(stackWithConfig({
      approvers: [{ type: 'user', value: 'u1' }],
      decisionOutputs: [{ key: 'decision', type: 'user' }, { key: 'ok' }],
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(APPROVAL_DECISION_OUTPUTS_RESERVED);
  });

  it('accepts declared non-reserved decisionOutputs', () => {
    expect(validateApprovalApprovers(stackWithConfig({
      approvers: [{ type: 'user', value: 'u1' }],
      decisionOutputs: ['next_reviewers', 'note'],
    }))).toEqual([]);
  });
});

describe('cross-organization targeting (ADR-0105 D9)', () => {
  it('is clean when `organization` sits on an org-scoped approver type', () => {
    // The whole point of D9: a group CFO resolved against the group directory.
    const findings = validateApprovalApprovers(
      stackWithApprovers([{ type: 'position', value: 'cfo', organization: '$root' }]),
    );
    expect(findings.filter(f => f.rule === APPROVAL_APPROVER_CROSS_ORG_UNSUPPORTED)).toEqual([]);
  });

  it('errors when `organization` sits on a type with no organization directory', () => {
    // `user` names a person outright — the declaration cannot narrow anything,
    // and the runtime refuses it. Catch it at author time instead.
    const findings = validateApprovalApprovers(
      stackWithApprovers([{ type: 'user', value: 'u1', organization: '$root' }]),
    );
    const f = findings.find(x => x.rule === APPROVAL_APPROVER_CROSS_ORG_UNSUPPORTED);
    expect(f?.severity).toBe('error');
    expect(f?.path).toBe('flows[0].nodes[1].config.approvers[0].organization');
    expect(f?.hint).toMatch(/position.*org_membership_level.*department.*expression/);
  });

  it('errors for `team` too — team membership carries no organization', () => {
    const findings = validateApprovalApprovers(
      stackWithApprovers([{ type: 'team', value: 't1', organization: 'acme-ssc' }]),
    );
    expect(findings.some(f => f.rule === APPROVAL_APPROVER_CROSS_ORG_UNSUPPORTED)).toBe(true);
  });

  it('stays silent when no organization is declared — the default path', () => {
    const findings = validateApprovalApprovers(
      stackWithApprovers([{ type: 'user', value: 'u1' }]),
    );
    expect(findings.filter(f => f.rule === APPROVAL_APPROVER_CROSS_ORG_UNSUPPORTED)).toEqual([]);
  });
});

// #4380 — an approval inside a loop body or a try/catch branch is still an
// approval. Before the shared flow walk, every rule here stopped at the top
// level and a nested node was checked by nothing.
describe('nested regions', () => {
  const nestedApproval = (containerType: string, config: Record<string, unknown>) => ({
    flows: [
      {
        name: 'expense_approval',
        nodes: [
          { id: 'start', type: 'start', config: {} },
          { id: 'guard', type: containerType, label: 'Guard', config },
        ],
        edges: [],
      },
    ],
  });
  const badApproval = {
    id: 'step1',
    type: 'approval',
    label: 'Approve',
    config: { approvers: [{ type: 'bogus_type', value: 'x' }] },
  };

  it('checks an approval nested in a loop body', () => {
    const findings = validateApprovalApprovers(
      nestedApproval('loop', { collection: '{items}', body: { nodes: [badApproval], edges: [] } }),
    );
    expect(findings.some((f) => f.rule === APPROVAL_APPROVER_TYPE_UNKNOWN)).toBe(true);
    expect(findings.find((f) => f.rule === APPROVAL_APPROVER_TYPE_UNKNOWN)?.path).toBe(
      'flows[0].nodes[1].config.body.nodes[0].config.approvers[0].type',
    );
  });

  it('checks an approval nested in a try_catch branch', () => {
    const findings = validateApprovalApprovers(
      nestedApproval('try_catch', { try: { nodes: [badApproval], edges: [] } }),
    );
    expect(findings.some((f) => f.rule === APPROVAL_APPROVER_TYPE_UNKNOWN)).toBe(true);
  });
});
