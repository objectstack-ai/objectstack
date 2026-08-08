import { describe, it, expect } from 'vitest';
import {
  SharingRuleSchema,
  SharingRuleType,
  ShareRecipientType,
  SharingLevel,
  OWDModel,
  type SharingRule,
} from './sharing.zod';

describe('SharingRuleType', () => {
  it('should accept the enforced rule type', () => {
    expect(() => SharingRuleType.parse('criteria')).not.toThrow();
  });

  it('should reject retired/invalid sharing rule types', () => {
    // `owner` was retired from the authoring surface (live-membership-dependent,
    // never enforced by the static materialiser — ADR-0078).
    expect(() => SharingRuleType.parse('owner')).toThrow();
    expect(() => SharingRuleType.parse('automatic')).toThrow();
    expect(() => SharingRuleType.parse('manual')).toThrow();
    expect(() => SharingRuleType.parse('guest')).toThrow();
    expect(() => SharingRuleType.parse('public')).toThrow();
    expect(() => SharingRuleType.parse('')).toThrow();
  });
});

describe('ShareRecipientType', () => {
  it('accepts exactly the enforced runtime recipients', () => {
    const enforced = ['user', 'team', 'position', 'unit_and_subordinates', 'business_unit'];
    enforced.forEach((t) => {
      expect(() => ShareRecipientType.parse(t)).not.toThrow();
    });
  });

  it('rejects the retired `group` (renamed → team) and `guest` recipients', () => {
    expect(() => ShareRecipientType.parse('group')).toThrow();
    expect(() => ShareRecipientType.parse('guest')).toThrow();
    // Reserved in the runtime contract but not authorable until implemented.
    expect(() => ShareRecipientType.parse('queue')).toThrow();
  });
});

describe('SharingLevel', () => {
  it('should accept valid sharing levels', () => {
    const validLevels = ['read', 'edit'];

    validLevels.forEach(level => {
      expect(() => SharingLevel.parse(level)).not.toThrow();
    });
  });

  it('should reject invalid sharing levels', () => {
    expect(() => SharingLevel.parse('write')).toThrow();
    expect(() => SharingLevel.parse('delete')).toThrow();
  });

  it("rejects the retired 'full' level", () => {
    // [#3865] `full` was declared "Full Access (Transfer, Share, Delete)" but
    // no code path granted any of those verbs — both gates matched
    // `edit`/`full` alike, so it was byte-equivalent to `edit` while telling
    // admins otherwise. Declared-but-unenforced (ADR-0078 / ADR-0049), same
    // reason `queue` and `guest` are rejected above. Stacks still authoring it
    // are rewritten at load by the `sharing-rule-access-level-full-to-edit`
    // conversion, so this rejection is reachable only via a direct parse.
    expect(() => SharingLevel.parse('full')).toThrow();
  });
});

describe('OWDModel', () => {
  it('should accept valid OWD models', () => {
    const validModels = ['private', 'public_read', 'public_read_write'];

    validModels.forEach(model => {
      expect(() => OWDModel.parse(model)).not.toThrow();
    });
  });

  it('should reject invalid OWD models', () => {
    expect(() => OWDModel.parse('public')).toThrow();
    expect(() => OWDModel.parse('public_write')).toThrow();
    expect(() => OWDModel.parse('')).toThrow();
  });
});

describe('SharingRuleSchema', () => {
  it('should accept valid minimal sharing rule', () => {
    const rule: SharingRule = {
      name: 'sales_team_access',
      object: 'opportunity',
      type: 'criteria',
      condition: "stage = 'Open'",
      sharedWith: {
        type: 'team',
        value: 'team_sales',
      },
    };

    expect(() => SharingRuleSchema.parse(rule)).not.toThrow();
  });

  it('should validate rule name format (snake_case)', () => {
    expect(() => SharingRuleSchema.parse({
      name: 'valid_rule_name',
      object: 'account',
      type: 'criteria',
      condition: "status = 'Active'",
      sharedWith: {
        type: 'team',
        value: 'team_id',
      },
    })).not.toThrow();

    expect(() => SharingRuleSchema.parse({
      name: 'InvalidRule',
      object: 'account',
      type: 'criteria',
      condition: "status = 'Active'",
      sharedWith: {
        type: 'team',
        value: 'team_id',
      },
    })).toThrow();

    expect(() => SharingRuleSchema.parse({
      name: 'invalid-rule',
      object: 'account',
      type: 'criteria',
      condition: "status = 'Active'",
      sharedWith: {
        type: 'team',
        value: 'team_id',
      },
    })).toThrow();
  });

  it('should apply default values', () => {
    const rule = SharingRuleSchema.parse({
      name: 'test_rule',
      object: 'account',
      type: 'criteria',
      condition: "status = 'Active'",
      sharedWith: {
        type: 'team',
        value: 'team_id',
      },
    });

    expect(rule.active).toBe(true);
    expect(rule.type).toBe('criteria');
    expect(rule.accessLevel).toBe('read');
  });

  it('should accept sharing rule with all fields', () => {
    const rule = SharingRuleSchema.parse({
      name: 'full_sharing_rule',
      label: 'Full Sharing Rule',
      active: true,
      object: 'opportunity',
      type: 'criteria',
      condition: "stage = 'Closed Won' AND amount > 100000",
      accessLevel: 'edit',
      sharedWith: {
        type: 'team',
        value: 'team_executive',
      },
    });

    expect(rule.label).toBe('Full Sharing Rule');
    expect((rule.condition as any).source).toContain('Closed Won');
  });

  it('should accept every enforced recipient type', () => {
    const recipients: Array<SharingRule['sharedWith']> = [
      { type: 'user', value: 'user_jane' },
      { type: 'team', value: 'team_sales' },
      { type: 'position', value: 'sales_manager' },
      { type: 'unit_and_subordinates', value: 'bu_field_ops' },
      { type: 'business_unit', value: 'bu_finance' },
    ];

    recipients.forEach((sharedWith) => {
      const rule = SharingRuleSchema.parse({
        name: 'recipient_matrix_rule',
        object: 'account',
        type: 'criteria',
        condition: "status = 'Active'",
        sharedWith,
      });
      expect(rule.sharedWith.type).toBe(sharedWith.type);
    });
  });

  it('should reject the retired owner-based rule shape', () => {
    // Pre-ADR-0078 shape: validated but was silently skipped at seed time.
    // It no longer parses — a criteria rule is the enforced alternative.
    expect(() => SharingRuleSchema.parse({
      name: 'owner_hierarchy_rule',
      object: 'account',
      type: 'owner',
      ownedBy: {
        type: 'position',
        value: 'sales_rep',
      },
      accessLevel: 'read',
      sharedWith: {
        type: 'position',
        value: 'sales_manager',
      },
    })).toThrow();
  });

  it('should reject the retired guest recipient', () => {
    // Anonymous access is the public-form grant / share-link surface, not a
    // sharing-rule recipient.
    expect(() => SharingRuleSchema.parse({
      name: 'public_access',
      object: 'knowledge_article',
      type: 'criteria',
      condition: "is_published = true",
      accessLevel: 'read',
      sharedWith: {
        type: 'guest',
        value: 'guest_users',
      },
    })).toThrow();
  });

  it('should reject the retired group recipient (renamed → team)', () => {
    expect(() => SharingRuleSchema.parse({
      name: 'sales_team_access',
      object: 'opportunity',
      type: 'criteria',
      condition: "stage = 'Open'",
      sharedWith: {
        type: 'group',
        value: 'team_sales',
      },
    })).toThrow();
  });

  it('should accept different access levels', () => {
    const levels: Array<SharingRule['accessLevel']> = ['read', 'edit'];

    levels.forEach(level => {
      const rule = SharingRuleSchema.parse({
        name: 'test_rule',
        object: 'account',
        type: 'criteria',
        condition: "status = 'Active'",
        accessLevel: level,
        sharedWith: {
          type: 'team',
          value: 'team_id',
        },
      });
      expect(rule.accessLevel).toBe(level);
    });
  });

  it('should accept criteria sharing rule for manual approval workflows', () => {
    const rule = SharingRuleSchema.parse({
      name: 'manual_approval_share',
      object: 'opportunity',
      type: 'criteria',
      condition: "requires_approval = true",
      accessLevel: 'edit',
      sharedWith: {
        type: 'user',
        value: 'user_john_doe',
      },
    });

    expect(rule.type).toBe('criteria');
  });

  it('should accept inactive sharing rule', () => {
    const rule = SharingRuleSchema.parse({
      name: 'disabled_rule',
      object: 'account',
      type: 'criteria',
      condition: "status = 'Inactive'",
      active: false,
      sharedWith: {
        type: 'team',
        value: 'team_id',
      },
    });

    expect(rule.active).toBe(false);
  });

  it('should handle sales territory sharing', () => {
    const rule = SharingRuleSchema.parse({
      name: 'west_coast_territory',
      label: 'West Coast Territory Access',
      object: 'account',
      type: 'criteria',
      condition: "billing_state IN ('CA', 'OR', 'WA')",
      accessLevel: 'edit',
      sharedWith: {
        type: 'team',
        value: 'team_west_coast_sales',
      },
    });

    expect((rule.condition as any).source).toContain('CA');
  });

  it('should handle department-based sharing', () => {
    const rule = SharingRuleSchema.parse({
      name: 'finance_department_access',
      object: 'invoice',
      type: 'criteria',
      condition: "department = 'Finance'",
      accessLevel: 'edit',
      sharedWith: {
        type: 'business_unit',
        value: 'bu_finance',
      },
    });

    expect(rule.object).toBe('invoice');
  });

  it('should handle read-only sharing', () => {
    const rule = SharingRuleSchema.parse({
      name: 'readonly_access',
      object: 'contract',
      type: 'criteria',
      condition: "status = 'Executed'",
      accessLevel: 'read',
      sharedWith: {
        type: 'team',
        value: 'team_all_users',
      },
    });

    expect(rule.accessLevel).toBe('read');
  });

  it('should handle edit access sharing', () => {
    const rule = SharingRuleSchema.parse({
      name: 'edit_access',
      object: 'opportunity',
      type: 'criteria',
      condition: "stage != 'Closed Won'",
      accessLevel: 'edit',
      sharedWith: {
        type: 'team',
        value: 'team_sales_reps',
      },
    });

    expect(rule.accessLevel).toBe('edit');
  });

  it('should reject sharing rule without required fields', () => {
    expect(() => SharingRuleSchema.parse({
      object: 'account',
      type: 'criteria',
      condition: "status = 'Active'",
      sharedWith: {
        type: 'team',
        value: 'team_id',
      },
    })).toThrow(); // Missing name

    expect(() => SharingRuleSchema.parse({
      name: 'test_rule',
      type: 'criteria',
      condition: "status = 'Active'",
      sharedWith: {
        type: 'team',
        value: 'team_id',
      },
    })).toThrow(); // Missing object

    expect(() => SharingRuleSchema.parse({
      name: 'test_rule',
      object: 'account',
      type: 'criteria',
      condition: "status = 'Active'",
    })).toThrow(); // Missing sharedWith
  });

  it('should reject invalid sharing rule type', () => {
    expect(() => SharingRuleSchema.parse({
      name: 'test_rule',
      object: 'account',
      type: 'invalid_type',
      condition: "status = 'Active'",
      sharedWith: {
        type: 'team',
        value: 'team_id',
      },
    })).toThrow();
  });

  it('should reject invalid access level', () => {
    expect(() => SharingRuleSchema.parse({
      name: 'test_rule',
      object: 'account',
      type: 'criteria',
      condition: "status = 'Active'",
      accessLevel: 'delete',
      sharedWith: {
        type: 'team',
        value: 'team_id',
      },
    })).toThrow();
  });
});

// #4001 step 2 — the authorable sharing rule is `.strict()` (the base shape's
// strictness and error map ride into the criteria extension): an undeclared
// key used to be dropped silently, so a share the author intended was never
// materialised — the same trap class this file's own history (#3896, #3865)
// keeps closing.
describe('unknown keys are rejected, not stripped (#4001)', () => {
  const rule = {
    name: 'r', type: 'criteria' as const, object: 'task',
    condition: 'record.status == "open"',
    sharedWith: { type: 'position' as const, value: 'manager' },
  };
  const unknownKeyIssue = (value: unknown) => {
    const result = SharingRuleSchema.safeParse(value);
    expect(result.success).toBe(false);
    return result.error!.issues.find((i) => i.code === 'unrecognized_keys');
  };

  it('rejects an undeclared key instead of silently dropping it', () => {
    expect(unknownKeyIssue({ ...rule, notAKey: 1 })!.message).toContain('`notAKey`');
  });

  it('points the persisted-row `criteria` spelling at the authored `condition`', () => {
    expect(unknownKeyIssue({ ...rule, criteria: 'x' })!.message)
      .toContain('`criteria` → `condition`');
  });

  it('points access/level at accessLevel and recipient spellings at sharedWith', () => {
    expect(unknownKeyIssue({ ...rule, access: 'read' })!.message)
      .toContain('`access` → `accessLevel`');
    expect(unknownKeyIssue({ ...rule, recipient: {} })!.message)
      .toContain('`recipient` → `sharedWith`');
  });

  it('carries the removed owner-type rule guidance for `ownedBy`', () => {
    const message = unknownKeyIssue({ ...rule, ownedBy: 'team_east' })!.message;
    expect(message).toContain('`ownedBy`');
    expect(message).toContain('criteria');
  });

  it('rejects unknown keys inside sharedWith (strict recipient)', () => {
    const result = SharingRuleSchema.safeParse({
      ...rule,
      sharedWith: { type: 'position', value: 'manager', id: 'x' },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue!.message).toContain('`id` → `value`');
  });
});
