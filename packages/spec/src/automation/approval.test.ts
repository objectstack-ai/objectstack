import { describe, it, expect } from 'vitest';
import {
  ApproverType,
  DEPRECATED_APPROVER_TYPES,
  canonicalApproverType,
  APPROVAL_NODE_TYPE,
  ApprovalDecision,
  APPROVAL_BRANCH_LABELS,
  ApprovalNodeApproverSchema,
  ApprovalEscalationSchema,
  ApprovalNodeConfigSchema,
  getApprovalNodeConfigJsonSchema,
} from './approval.zod';

describe('ApproverType', () => {
  it('should accept all valid approver types', () => {
    ['user', 'org_membership_level', 'position', 'team', 'department', 'manager', 'field', 'queue'].forEach(t => {
      expect(() => ApproverType.parse(t)).not.toThrow();
    });
  });

  it('should reject invalid approver type', () => {
    expect(() => ApproverType.parse('group')).toThrow();
  });

  // ADR-0090 D3: `role` is the pre-relabel spelling of `org_membership_level`.
  // It stays parseable for one deprecation window so a stored 15.x flow keeps
  // loading; the runtime warns and `os lint` prescribes the rewrite.
  it('still accepts the deprecated `role` spelling during its window', () => {
    expect(() => ApproverType.parse('role')).not.toThrow();
  });

  it('canonicalises the deprecated spelling, passes others through', () => {
    expect(DEPRECATED_APPROVER_TYPES.role).toBe('org_membership_level');
    expect(canonicalApproverType('role')).toBe('org_membership_level');
    expect(canonicalApproverType('position')).toBe('position');
    expect(canonicalApproverType('user')).toBe('user');
    // Every canonical target must itself be a member of the enum, or the
    // rewrite the lint prescribes would not parse.
    for (const target of Object.values(DEPRECATED_APPROVER_TYPES)) {
      expect(() => ApproverType.parse(target)).not.toThrow();
    }
  });

  // Cross-repo contract: the published node configSchema must carry
  // `xEnumDeprecated` on the approver type, or the Studio designer (objectui)
  // derives its dropdown straight from `enum` and keeps offering `role` — the
  // exact trap ADR-0090 D3 retires. Renderers read this to omit deprecated
  // members from pickers while still rendering a stored value.
  it('publishes xEnumDeprecated on the approver type so pickers can drop `role`', () => {
    const schema = getApprovalNodeConfigJsonSchema() as any;
    const typeNode = schema?.properties?.approvers?.items?.properties?.type;
    expect(typeNode?.enum).toContain('role');            // still parses (back-compat)
    expect(typeNode?.enum).toContain('org_membership_level');
    expect(typeNode?.xEnumDeprecated).toEqual(Object.keys(DEPRECATED_APPROVER_TYPES));
    expect(typeNode?.xEnumDeprecated).toContain('role');
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
    // ADR-0090 D3: positions route by machine name (sys_user_position)
    expect(() => ApprovalNodeApproverSchema.parse({ type: 'position', value: 'sales_manager' })).not.toThrow();
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
