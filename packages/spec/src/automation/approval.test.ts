import { describe, it, expect } from 'vitest';
import {
  ApproverType,
  APPROVAL_NODE_TYPE,
  ApprovalDecision,
  APPROVAL_BRANCH_LABELS,
  ApprovalNodeApproverSchema,
  ApprovalEscalationSchema,
  ApprovalNodeConfigSchema,
} from './approval.zod';

describe('ApproverType', () => {
  it('should accept all valid approver types', () => {
    ['user', 'role', 'team', 'department', 'manager', 'field', 'queue'].forEach(t => {
      expect(() => ApproverType.parse(t)).not.toThrow();
    });
  });

  it('should reject invalid approver type', () => {
    expect(() => ApproverType.parse('group')).toThrow();
  });
});

describe('Approval node constants (ADR-0019)', () => {
  it('exposes the canonical node type and decision branch labels', () => {
    expect(APPROVAL_NODE_TYPE).toBe('approval');
    // The decision surface stays approve|reject — send-back (ADR-0044) is a
    // separate service verb, not a third decision.
    expect(ApprovalDecision.options).toEqual(['approve', 'reject']);
    expect(APPROVAL_BRANCH_LABELS).toEqual({
      approve: 'approve',
      reject: 'reject',
      revise: 'revise',
      resubmit: 'resubmit',
    });
  });
});

describe('ApprovalNodeApproverSchema', () => {
  it('accepts a typed approver with an optional value', () => {
    expect(() => ApprovalNodeApproverSchema.parse({ type: 'user', value: 'u1' })).not.toThrow();
    // manager resolves from the submitter, so value is optional
    expect(() => ApprovalNodeApproverSchema.parse({ type: 'manager' })).not.toThrow();
  });

  it('rejects an unknown approver type', () => {
    expect(() => ApprovalNodeApproverSchema.parse({ type: 'group', value: 'x' })).toThrow();
  });
});

describe('ApprovalNodeConfigSchema', () => {
  const minimal = { approvers: [{ type: 'user', value: 'u1' }] };

  it('applies node-level defaults', () => {
    const result = ApprovalNodeConfigSchema.parse(minimal);
    expect(result.behavior).toBe('first_response');
    expect(result.lockRecord).toBe(true);
    expect(result.escalation).toBeUndefined();
    // ADR-0044: revision budget defaults to 3 send-backs.
    expect(result.maxRevisions).toBe(3);
  });

  it('accepts an explicit maxRevisions and rejects negatives (ADR-0044)', () => {
    expect(ApprovalNodeConfigSchema.parse({ ...minimal, maxRevisions: 0 }).maxRevisions).toBe(0);
    expect(ApprovalNodeConfigSchema.parse({ ...minimal, maxRevisions: 5 }).maxRevisions).toBe(5);
    expect(() => ApprovalNodeConfigSchema.parse({ ...minimal, maxRevisions: -1 })).toThrow();
    expect(() => ApprovalNodeConfigSchema.parse({ ...minimal, maxRevisions: 1.5 })).toThrow();
  });

  it('accepts a full node config with escalation', () => {
    const result = ApprovalNodeConfigSchema.parse({
      approvers: [
        { type: 'manager' },
        { type: 'role', value: 'finance_team' },
      ],
      behavior: 'unanimous',
      lockRecord: false,
      approvalStatusField: 'approval_status',
      escalation: {
        enabled: true,
        timeoutHours: 48,
        action: 'reassign',
        escalateTo: 'vp_operations',
        notifySubmitter: true,
      },
    });
    expect(result.behavior).toBe('unanimous');
    expect(result.lockRecord).toBe(false);
    expect(result.approvalStatusField).toBe('approval_status');
    expect(result.escalation?.action).toBe('reassign');
  });

  it('rejects an empty approvers array', () => {
    expect(() => ApprovalNodeConfigSchema.parse({ approvers: [] })).toThrow();
  });

  it('rejects an unknown behavior', () => {
    expect(() => ApprovalNodeConfigSchema.parse({ ...minimal, behavior: 'quorum' })).toThrow();
  });
});

describe('ApprovalEscalationSchema', () => {
  it('defaults action to notify and requires a positive timeout', () => {
    const result = ApprovalEscalationSchema.parse({ enabled: true, timeoutHours: 24 });
    expect(result.action).toBe('notify');
    expect(result.notifySubmitter).toBe(true);
    expect(() => ApprovalEscalationSchema.parse({ enabled: true, timeoutHours: 0 })).toThrow();
  });
});
