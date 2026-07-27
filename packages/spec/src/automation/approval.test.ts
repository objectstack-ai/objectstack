import { describe, it, expect } from 'vitest';
import {
  ApproverType,
  DEPRECATED_APPROVER_TYPES,
  NON_AUTHORABLE_APPROVER_TYPES,
  APPROVER_VALUE_BINDINGS,
  ORG_MEMBERSHIP_LEVELS,
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
  // exact trap ADR-0090 D3 retires — and `queue`, which the runtime never
  // resolves (#3508). Renderers read this to omit these members from pickers
  // while still rendering a stored value.
  it('publishes xEnumDeprecated on the approver type so pickers drop `role` and `queue`', () => {
    const schema = getApprovalNodeConfigJsonSchema() as any;
    const typeNode = schema?.properties?.approvers?.items?.properties?.type;
    expect(typeNode?.enum).toContain('role');            // still parses (back-compat)
    expect(typeNode?.enum).toContain('queue');           // still parses (stored rows render)
    expect(typeNode?.enum).toContain('org_membership_level');
    expect(typeNode?.xEnumDeprecated).toEqual([...NON_AUTHORABLE_APPROVER_TYPES]);
    expect(typeNode?.xEnumDeprecated).toContain('role');
    expect(typeNode?.xEnumDeprecated).toContain('queue');
  });

  // #3508: queue is declared-but-unenforced. It stays parseable (stored flows
  // keep loading) but is not authorable, and every deprecated spelling is
  // non-authorable too.
  it('marks queue non-authorable while keeping it parseable', () => {
    expect(() => ApproverType.parse('queue')).not.toThrow();
    expect(NON_AUTHORABLE_APPROVER_TYPES).toContain('queue');
    for (const spelling of Object.keys(DEPRECATED_APPROVER_TYPES)) {
      expect(NON_AUTHORABLE_APPROVER_TYPES).toContain(spelling);
    }
  });
});

// #3508: the designer contract for sourcing each approver row's `value`. The
// record-backed kinds MUST match the engine's resolution semantics
// (`plugin-approvals` resolveApproverSpec / expand*Users) — these assertions
// pin the object names and stored fields the engine actually queries.
describe('APPROVER_VALUE_BINDINGS (#3508)', () => {
  it('covers every ApproverType member', () => {
    for (const t of ApproverType.options) {
      expect(APPROVER_VALUE_BINDINGS[t]).toBeDefined();
    }
  });

  it('binds record-backed kinds to the objects and fields the engine queries', () => {
    // applyOooDelegation(String(value)) — a sys_user id.
    expect(APPROVER_VALUE_BINDINGS.user).toEqual({ source: 'record', object: 'sys_user', valueField: 'id' });
    // find('sys_team_member', { team_id: value }) — a sys_team id.
    expect(APPROVER_VALUE_BINDINGS.team).toEqual({ source: 'record', object: 'sys_team', valueField: 'id' });
    // find('sys_business_unit', { id: value }) — a sys_business_unit id
    // (deliberately NOT a `sys_department`).
    expect(APPROVER_VALUE_BINDINGS.department).toEqual({ source: 'record', object: 'sys_business_unit', valueField: 'id' });
    // find('sys_user_position', { position: value }) — the position machine
    // NAME, not an id (portable across environments).
    expect(APPROVER_VALUE_BINDINGS.position).toEqual({ source: 'record', object: 'sys_position', valueField: 'name' });
  });

  it('keeps the non-record kinds off the record-lookup path', () => {
    expect(APPROVER_VALUE_BINDINGS.org_membership_level).toEqual({ source: 'enum', values: ORG_MEMBERSHIP_LEVELS });
    // The deprecated alias renders with the same control as its replacement.
    expect(APPROVER_VALUE_BINDINGS.role).toEqual(APPROVER_VALUE_BINDINGS.org_membership_level);
    expect(APPROVER_VALUE_BINDINGS.manager.source).toBe('auto');
    expect(APPROVER_VALUE_BINDINGS.field.source).toBe('trigger-field');
    expect(APPROVER_VALUE_BINDINGS.queue.source).toBe('unsupported');
  });

  it('publishes a manager mapping in the value xRef so designers can render auto-resolution', () => {
    const schema = getApprovalNodeConfigJsonSchema() as any;
    const valueNode = schema?.properties?.approvers?.items?.properties?.value;
    expect(valueNode?.xRef?.map?.manager).toBe('manager');
    // queue stays mapped so stored rows keep rendering during the window.
    expect(valueNode?.xRef?.map?.queue).toBe('queue');
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
    expect(() => ApprovalNodeConfigSchema.parse({ ...minimal, behavior: 'weighted' })).toThrow();
  });

  it('accepts quorum / per_group behaviors with minApprovals and grouped approvers (#3266)', () => {
    const quorum = ApprovalNodeConfigSchema.parse({ ...minimal, behavior: 'quorum', minApprovals: 2 });
    expect(quorum.behavior).toBe('quorum');
    expect(quorum.minApprovals).toBe(2);
    const perGroup = ApprovalNodeConfigSchema.parse({
      approvers: [
        { type: 'position', value: 'legal_counsel', group: 'legal' },
        { type: 'position', value: 'controller', group: 'finance' },
      ],
      behavior: 'per_group',
    });
    expect(perGroup.behavior).toBe('per_group');
    expect(perGroup.approvers[0].group).toBe('legal');
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
