import { describe, it, expect } from 'vitest';
import {
  ApproverType,
  DEPRECATED_APPROVER_TYPES,
  NON_AUTHORABLE_APPROVER_TYPES,
  APPROVER_VALUE_BINDINGS,
  APPROVER_VALUE_SOURCES,
  ORG_MEMBERSHIP_LEVELS,
  canonicalApproverType,
  APPROVAL_NODE_TYPE,
  ApprovalDecision,
  APPROVAL_BRANCH_LABELS,
  ApprovalNodeApproverSchema,
  ApprovalEscalationSchema,
  ApprovalNodeConfigSchema,
  DecisionOutputDefSchema,
  getApprovalNodeConfigJsonSchema,
  normalizeDecisionOutputs,
} from './approval.zod';
import { BUILTIN_MEMBERSHIP_ROLES } from '../identity/membership-role';

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

// `ORG_MEMBERSHIP_LEVELS` once hand-spelled a three-value copy of the
// membership vocabulary while `sys_member.role` enforced four, so the enforced
// `delegated_admin` tier (ADR-0105 D8) could not be authored as an approver.
// The list is now DERIVED from `BUILTIN_MEMBERSHIP_ROLES`; these pins keep the
// derivation from ever being silently replaced by a copy again.
describe('ORG_MEMBERSHIP_LEVELS derives from BUILTIN_MEMBERSHIP_ROLES', () => {
  it('is the same list, in the same display order, as the sys_member.role vocabulary', () => {
    expect([...ORG_MEMBERSHIP_LEVELS]).toEqual([...BUILTIN_MEMBERSHIP_ROLES]);
  });

  it('admits delegated_admin — an enforced sys_member.role value — as an approver tier', () => {
    expect(ORG_MEMBERSHIP_LEVELS).toContain('delegated_admin');
  });

  it('exposes the whole vocabulary on the wire picker surface, deprecated alias included', () => {
    expect(APPROVER_VALUE_SOURCES.org_membership_level).toEqual({
      source: 'enum',
      values: [...BUILTIN_MEMBERSHIP_ROLES],
    });
    expect(APPROVER_VALUE_SOURCES.role).toEqual(APPROVER_VALUE_SOURCES.org_membership_level);
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

// #3508 follow-up: `xRef.map` names a picker KIND but never said where that
// picker's candidates live — which is how the designer came to query the
// metadata registry for data records. The data contract now ships on the wire.
describe('APPROVER_VALUE_SOURCES (#3508 follow-up)', () => {
  it('covers every ApproverType member, exactly like the bindings it projects', () => {
    for (const t of ApproverType.options) {
      expect(APPROVER_VALUE_SOURCES[t], `no source published for '${t}'`).toBeDefined();
      expect(APPROVER_VALUE_SOURCES[t].source).toBe(
        APPROVER_VALUE_BINDINGS[t].source === 'record' ? 'data' : APPROVER_VALUE_BINDINGS[t].source,
      );
    }
  });

  it('routes the directory kinds to the DATA API, naming the object and the committed column', () => {
    // `data`, not `meta`: these are rows in system objects, and the metadata
    // registry (`GET /api/v1/meta/:type`) cannot list them (#3508).
    expect(APPROVER_VALUE_SOURCES.user).toEqual({ source: 'data', object: 'sys_user', valueField: 'id' });
    expect(APPROVER_VALUE_SOURCES.team).toEqual({ source: 'data', object: 'sys_team', valueField: 'id' });
    expect(APPROVER_VALUE_SOURCES.department).toEqual({ source: 'data', object: 'sys_business_unit', valueField: 'id' });
    // The one kind that commits something other than the primary key.
    expect(APPROVER_VALUE_SOURCES.position).toEqual({ source: 'data', object: 'sys_position', valueField: 'name' });
  });

  it('keeps the non-record kinds off the lookup path and carries the closed enum inline', () => {
    expect(APPROVER_VALUE_SOURCES.org_membership_level).toEqual({ source: 'enum', values: [...ORG_MEMBERSHIP_LEVELS] });
    expect(APPROVER_VALUE_SOURCES.role).toEqual(APPROVER_VALUE_SOURCES.org_membership_level);
    expect(APPROVER_VALUE_SOURCES.manager).toEqual({ source: 'auto' });
    expect(APPROVER_VALUE_SOURCES.field).toEqual({ source: 'trigger-field' });
    expect(APPROVER_VALUE_SOURCES.expression).toEqual({ source: 'expression' });
    expect(APPROVER_VALUE_SOURCES.queue).toEqual({ source: 'unsupported' });
  });

  it('ships on the published JSON schema, where the designer reads it', () => {
    const schema = getApprovalNodeConfigJsonSchema() as any;
    const sources = schema?.properties?.approvers?.items?.properties?.value?.xRef?.sources;
    expect(sources).toBeDefined();
    expect(sources.department).toEqual({ source: 'data', object: 'sys_business_unit', valueField: 'id' });
    expect(sources.position).toEqual({ source: 'data', object: 'sys_position', valueField: 'name' });
  });
});

// objectui#2834 argued for leading with indirect bindings, but shipped the
// order in its own options array — which the Studio inspector never reads (it
// derives the picker from this enum via the published JSON schema). The intent
// only takes effect if the enum itself carries it, so pin it here.
describe('ApproverType declaration order is the authoring recommendation', () => {
  const authorable = ApproverType.options.filter((t) => !NON_AUTHORABLE_APPROVER_TYPES.includes(t));

  it('leads with indirect bindings and puts the literal `user` last', () => {
    expect(authorable).toEqual([
      'manager', 'position', 'department', 'team', 'field', 'expression', 'org_membership_level', 'user',
    ]);
  });

  it('never offers a non-authorable spelling, wherever it sits in the enum', () => {
    expect(authorable).not.toContain('role');
    expect(authorable).not.toContain('queue');
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

/**
 * `normalizeDecisionOutputs` is the ONE reader of the bare-key | typed-object
 * union — the runtime whitelists from it, and the request row surfaces its
 * output to the decision UI. Anything it drops is invisible to both sides,
 * which is how `required` has to be pinned here and not only at the service.
 */
describe('normalizeDecisionOutputs', () => {
  it('lifts bare keys into the typed form', () => {
    expect(normalizeDecisionOutputs(['next_reviewers', 'note'])).toEqual([
      { key: 'next_reviewers' },
      { key: 'note' },
    ]);
  });

  it('carries the widget hints and the required flag through (objectui#2955)', () => {
    expect(normalizeDecisionOutputs([
      { key: 'positions', label: 'Co-signers', type: 'position', multiple: true, required: true },
    ])).toEqual([
      { key: 'positions', label: 'Co-signers', type: 'position', multiple: true, required: true },
    ]);
  });

  it('omits the falsy flags rather than spelling them out', () => {
    // The normalized shape is what the request row ships to every client, so
    // an absent flag must stay absent instead of becoming `required: false`.
    expect(normalizeDecisionOutputs([{ key: 'note', multiple: false, required: false }]))
      .toEqual([{ key: 'note' }]);
  });

  it('drops entries with no usable key, and non-arrays entirely', () => {
    expect(normalizeDecisionOutputs(['', { key: '' }, { label: 'no key' }, 42])).toEqual([]);
    expect(normalizeDecisionOutputs(undefined)).toEqual([]);
    expect(normalizeDecisionOutputs('next_reviewers')).toEqual([]);
  });
});

// #4001 step 3 — the four approval authoring schemas are `.strict()`: an
// undeclared key used to be dropped by zod's default `.strip`, so an approval
// gate shipped that quietly ignored part of its declared behavior. Approval is
// a v17-new surface, tightened before stored volume exists. The published JSON
// schema now carries additionalProperties:false into the Studio form AND
// registerFlow()'s per-node config validation (#4027/#4040) — asserted below.
describe('unknown keys are rejected, not stripped (#4001)', () => {
  const unknownKeyIssue = (schema: { safeParse: (v: unknown) => any }, value: unknown) => {
    const result = schema.safeParse(value);
    expect(result.success).toBe(false);
    return result.error!.issues.find((i: { code: string }) => i.code === 'unrecognized_keys');
  };
  const minimalConfig = { approvers: [{ type: 'manager' as const }] };

  describe('ApprovalNodeConfigSchema', () => {
    it('rejects an undeclared key instead of silently dropping it', () => {
      expect(unknownKeyIssue(ApprovalNodeConfigSchema, { ...minimalConfig, notAKey: 1 })!.message)
        .toContain('`notAKey`');
    });

    it('carries the ADR-0019 re-home guidance for process-era keys', () => {
      for (const key of ['steps', 'entryCriteria', 'onApprove', 'onReject', 'rejectionBehavior']) {
        const message = unknownKeyIssue(ApprovalNodeConfigSchema, { ...minimalConfig, [key]: [] })!.message;
        expect(message, `\`${key}\` should carry ADR-0019 guidance`).toContain('ADR-00');
        expect(message).toContain(`\`${key}\``);
      }
    });

    it('points behavior/threshold synonyms at the canonical keys', () => {
      expect(unknownKeyIssue(ApprovalNodeConfigSchema, { ...minimalConfig, mode: 'unanimous' })!.message)
        .toContain('`mode` → `behavior`');
      expect(unknownKeyIssue(ApprovalNodeConfigSchema, { ...minimalConfig, quorum: 2 })!.message)
        .toContain('`quorum` → `minApprovals`');
    });
  });

  describe('ApprovalNodeApproverSchema', () => {
    it('points org/resolveAs synonyms at the canonical keys', () => {
      expect(unknownKeyIssue(ApprovalNodeApproverSchema, { type: 'position', value: 'cfo', org: '$root' })!.message)
        .toContain('`org` → `organization`');
      expect(unknownKeyIssue(ApprovalNodeApproverSchema, { type: 'expression', value: 'vars.x', expandAs: 'user' })!.message)
        .toContain('`expandAs` → `resolveAs`');
    });
  });

  describe('ApprovalEscalationSchema', () => {
    it('points timeout/target synonyms at the canonical keys', () => {
      expect(unknownKeyIssue(ApprovalEscalationSchema, { timeoutHours: 4, timeout: 4 })!.message)
        .toContain('`timeout` → `timeoutHours`');
      expect(unknownKeyIssue(ApprovalEscalationSchema, { timeoutHours: 4, target: 'ops' })!.message)
        .toContain('`target` → `escalateTo`');
    });
  });

  describe('DecisionOutputDefSchema', () => {
    it('points name/widget synonyms at the canonical keys', () => {
      expect(unknownKeyIssue(DecisionOutputDefSchema, { key: 'k', name: 'k' })!.message)
        .toContain('`name` → `key`');
      expect(unknownKeyIssue(DecisionOutputDefSchema, { key: 'k', widget: 'user' })!.message)
        .toContain('`widget` → `type`');
    });

    /**
     * #4525: `required` is the one decision-output key the RUNTIME enforces —
     * `ApprovalService.decide()` refuses an approve whose required outputs are
     * blank. The spec has declared it since objectui#2955, but nothing at the
     * schema level pinned it: the schema is `.strict()`, so dropping the key
     * would turn every author's `required: true` into an unknown-key rejection,
     * and the only guard against that was `authorable-surface.json` — a
     * REGENERATED baseline, which a `gen:schema` run silently rewrites. These
     * cases fail loudly instead, which is what "declared = enforced" needs on
     * the declaring side.
     */
    it('accepts `required` — the key the runtime enforces (#4525)', () => {
      expect(DecisionOutputDefSchema.parse({ key: 'next_reviewers', required: true }))
        .toEqual({ key: 'next_reviewers', required: true });
      expect(DecisionOutputDefSchema.parse({ key: 'note', required: false }))
        .toEqual({ key: 'note', required: false });
    });

    it('leaves `required` optional — an unflagged output stays unflagged', () => {
      // Absent must stay absent rather than defaulting to `false`: the parsed
      // shape is what `normalizeDecisionOutputs` ships to every decision UI.
      expect(DecisionOutputDefSchema.parse({ key: 'note' })).toEqual({ key: 'note' });
    });

    it('rejects a non-boolean `required` instead of coercing it', () => {
      // A truthy string is exactly how an AI-authored flow would spell it; the
      // runtime compares `d.required === true`, so a coerced 'true' would
      // declare a constraint the server then never enforces.
      expect(() => DecisionOutputDefSchema.parse({ key: 'note', required: 'true' })).toThrow();
      expect(() => DecisionOutputDefSchema.parse({ key: 'note', required: 1 })).toThrow();
    });
  });

  it('publishes additionalProperties:false through the JSON schema (Studio + registerFlow)', () => {
    const js = getApprovalNodeConfigJsonSchema() as {
      additionalProperties?: boolean;
      properties?: { approvers?: { items?: { additionalProperties?: boolean } } };
    };
    expect(js.additionalProperties).toBe(false);
    expect(js.properties?.approvers?.items?.additionalProperties).toBe(false);
  });
});
