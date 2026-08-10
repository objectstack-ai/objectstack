import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ActionSchema, ActionParamSchema, Action, type Action as ActionType, ACTION_LOCATIONS, ActionLocationSchema, type ActionLocation } from './action.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { ObjectSchema } from '../data/object.zod';

describe('ActionParamSchema', () => {
  it('should accept minimal action parameter', () => {
    const param = {
      name: 'comment',
      label: 'Comment',
      type: 'text' as const,
    };

    const result = ActionParamSchema.parse(param);
    expect(result.required).toBe(false);
  });

  it('should accept required parameter', () => {
    const param = {
      name: 'reason',
      label: 'Reason',
      type: 'textarea' as const,
      required: true,
    };

    expect(() => ActionParamSchema.parse(param)).not.toThrow();
  });

  it('should accept parameter with options', () => {
    const param = {
      name: 'priority',
      label: 'Priority',
      type: 'select' as const,
      options: [
        { label: 'Low', value: 'low' },
        { label: 'Medium', value: 'medium' },
        { label: 'High', value: 'high' },
      ],
    };

    expect(() => ActionParamSchema.parse(param)).not.toThrow();
  });

  // objectui ADR-0059 — params render through the shared form field-widget
  // renderer, so inline params can carry the widget config the form widgets
  // consume (field-backed params inherit these from the field at runtime).
  it('accepts a file param with upload widget config (multiple/accept/maxSize)', () => {
    const result = ActionParamSchema.parse({
      name: 'attachments',
      label: 'Attachments',
      type: 'file' as const,
      multiple: true,
      accept: ['application/pdf', 'image/*'],
      maxSize: 5 * 1024 * 1024,
    });
    expect(result.multiple).toBe(true);
    expect(result.accept).toEqual(['application/pdf', 'image/*']);
    expect(result.maxSize).toBe(5 * 1024 * 1024);
  });

  it('leaves widget config undefined when not declared (runtime inherits from the field)', () => {
    const result = ActionParamSchema.parse({ field: 'avatar_file' });
    expect(result.multiple).toBeUndefined();
    expect(result.accept).toBeUndefined();
    expect(result.maxSize).toBeUndefined();
  });

  it('rejects a non-positive or fractional maxSize', () => {
    expect(() => ActionParamSchema.parse({ name: 'f', type: 'file', maxSize: 0 })).toThrow();
    expect(() => ActionParamSchema.parse({ name: 'f', type: 'file', maxSize: -1 })).toThrow();
    expect(() => ActionParamSchema.parse({ name: 'f', type: 'file', maxSize: 1.5 })).toThrow();
  });

  it('accepts rich field types for params (rendered by the shared widget renderer)', () => {
    for (const type of ['file', 'image', 'richtext', 'color', 'date', 'address', 'code'] as const) {
      expect(() => ActionParamSchema.parse({ name: 'p', label: 'P', type })).not.toThrow();
    }
  });

  // #3405 — an inline record-picker param carries its own target object.
  // Before this, `reference` was an unknown key: zod stripped it silently and
  // the param dialog degraded to a "paste the record id (UUID)" text input,
  // with no signal that the authored config had been dropped.
  describe('inline lookup reference target (#3405)', () => {
    it('keeps `reference` on an inline lookup param', () => {
      const result = ActionParamSchema.parse({
        name: 'inspector',
        label: 'Inspector',
        type: 'lookup' as const,
        reference: 'sys_user',
        required: true,
      });
      expect(result.reference).toBe('sys_user');
    });

    it('rejects an inline lookup/master_detail param with no reference target', () => {
      for (const type of ['lookup', 'master_detail'] as const) {
        const result = ActionParamSchema.safeParse({ name: 'owner', label: 'Owner', type });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(['reference']);
      }
    });

    it('allows a field-backed lookup param to omit it (inherited from the field at runtime)', () => {
      expect(() => ActionParamSchema.parse({ field: 'inspector', type: 'lookup' as const })).not.toThrow();
      expect(() => ActionParamSchema.parse({ field: 'inspector' })).not.toThrow();
    });

    it('leaves `reference` undefined for non-picker params', () => {
      expect(ActionParamSchema.parse({ name: 'note', type: 'textarea' as const }).reference).toBeUndefined();
    });
  });

  // #3405 part 3 — the root cause behind the `reference` bug was not the missing
  // key, it was that an undeclared key was dropped *silently*: the param went on
  // parsing and shipped a control that ignored the author's config. Strict mode
  // turns that class of typo into a loud, fixable parse error
  // (ADR-0078 no-silently-inert-metadata, ADR-0049 enforce-or-remove).
  describe('unknown keys are rejected, not stripped (#3405 part 3)', () => {
    const unknownKeyIssue = (param: Record<string, unknown>) => {
      const result = ActionParamSchema.safeParse(param);
      expect(result.success).toBe(false);
      return result.error!.issues.find((i) => i.code === 'unrecognized_keys');
    };

    it('rejects an undeclared key instead of silently dropping it', () => {
      const issue = unknownKeyIssue({ name: 'p', type: 'text', notAKey: 'x' });
      expect(issue).toBeDefined();
      expect(issue!.message).toContain('`notAKey`');
    });

    it('points a snake_case mis-spelling at the declared camelCase key', () => {
      // FieldSchema-adjacent metadata is snake_case, so this is the likely slip.
      expect(unknownKeyIssue({ name: 'p', type: 'text', help_text: 'hi' })!.message)
        .toContain('`help_text` → `helpText`');
      expect(unknownKeyIssue({ name: 'p', type: 'text', default_value: 1 })!.message)
        .toContain('`default_value` → `defaultValue`');
    });

    it('points the runtime lookup-target spellings at `reference` (the #3405 slip)', () => {
      for (const key of ['reference_to', 'referenceTo', 'targetObject']) {
        expect(unknownKeyIssue({ name: 'p', type: 'lookup', reference: 'sys_user', [key]: 'sys_user' })!.message)
          .toContain(`\`${key}\` → \`reference\``);
      }
    });

    it('points `visibleWhen` at `visible` so a capability gate cannot go inert', () => {
      // ADR-0089 made `visibleWhen` canonical on view/page schemas; borrowing it
      // here used to strip the gate and render the param unconditionally.
      expect(unknownKeyIssue({ name: 'p', type: 'text', visibleWhen: 'features.x == true' })!.message)
        .toContain('`visibleWhen` → `visible`');
    });

    it('still reports an unrecognisable key without a bogus suggestion', () => {
      const message = unknownKeyIssue({ name: 'p', type: 'text', wibble: 1 })!.message;
      expect(message).toContain('`wibble`');
      expect(message).not.toContain('Did you mean');
    });
  });
});

// #2874 P1 — declarative `requiresFeature` sugar, lowered at parse time into
// the canonical `visible` CEL predicate (semantics per the
// PUBLIC_AUTH_FEATURES registry) and stripped from the output.
describe('requiresFeature lowering', () => {
  it('lowers an opt-in flag to == true on a param', () => {
    const result = ActionParamSchema.parse({ name: 'phoneNumber', requiresFeature: 'phoneNumber' });
    expect(result.visible).toEqual({ dialect: 'cel', source: 'features.phoneNumber == true' });
    expect(result).not.toHaveProperty('requiresFeature');
  });

  it('lowers a default-on flag to != false on an action', () => {
    const result = ActionSchema.parse({
      name: 'invite_user',
      label: 'Invite',
      type: 'api',
      target: '/api/v1/auth/organization/invite-member',
      requiresFeature: 'organization',
    });
    expect(result.visible).toEqual({ dialect: 'cel', source: 'features.organization != false' });
    expect(result).not.toHaveProperty('requiresFeature');
  });

  it('AND-composes with an explicit string visible — existing first, gate last', () => {
    const result = ActionSchema.parse({
      name: 'transfer_ownership',
      label: 'Transfer Ownership',
      type: 'api',
      target: '/api/v1/auth/organization/update-member-role',
      visible: "record.role != 'owner'",
      requiresFeature: 'organization',
    });
    expect(result.visible).toEqual({
      dialect: 'cel',
      source: "(record.role != 'owner') && features.organization != false",
    });
  });

  it('AND-composes with an explicit envelope visible, preserving meta', () => {
    const result = ActionParamSchema.parse({
      name: 'x',
      visible: { dialect: 'cel', source: 'record.a == 1', meta: { rationale: 'why' } },
      requiresFeature: 'admin',
    });
    expect(result.visible).toEqual({
      dialect: 'cel',
      source: '(record.a == 1) && features.admin == true',
      meta: { rationale: 'why' },
    });
  });

  it('rejects an unknown flag name at parse time', () => {
    expect(() => ActionParamSchema.parse({ name: 'x', requiresFeature: 'phoneNumbr' })).toThrow();
  });

  it('rejects composition with an AST-only visible loudly (ADR-0078)', () => {
    const result = ActionParamSchema.safeParse({
      name: 'x',
      visible: { dialect: 'cel', ast: { kind: 'literal' } },
      requiresFeature: 'admin',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('requiresFeature'))).toBe(true);
    }
  });

  it('leaves sugar-free inputs untouched', () => {
    const result = ActionParamSchema.parse({ name: 'x', visible: 'features.phoneNumber == true' });
    expect(result.visible).toEqual({ dialect: 'cel', source: 'features.phoneNumber == true' });
    const bare = ActionParamSchema.parse({ name: 'y' });
    expect(bare.visible).toBeUndefined();
    expect(bare).not.toHaveProperty('requiresFeature');
  });

  // #5970 gave `visible` a boolean arm, so the lowering now meets two literals
  // it never could before. Boolean algebra decides both, in opposite directions.
  it('treats `visible: true` as the explicit default — lowers to the gate alone', () => {
    const result = ActionSchema.parse({
      name: 'invite_user',
      label: 'Invite',
      type: 'api',
      target: '/api/v1/auth/organization/invite-member',
      visible: true,
      requiresFeature: 'organization',
    } satisfies z.input<typeof ActionSchema>);
    // Identical to the sugar-only case above: `true && <gate>` IS `<gate>`.
    expect(result.visible).toEqual({ dialect: 'cel', source: 'features.organization != false' });
    expect(result).not.toHaveProperty('requiresFeature');
  });

  it('rejects composition with `visible: false` loudly — the gate could never fire (ADR-0078)', () => {
    const result = ActionSchema.safeParse({
      name: 'invite_user',
      label: 'Invite',
      type: 'api',
      target: '/api/v1/auth/organization/invite-member',
      visible: false,
      requiresFeature: 'organization',
    } satisfies z.input<typeof ActionSchema>);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('requiresFeature'));
      expect(issue).toBeDefined();
      // The message must name BOTH exits, not just the diagnosis.
      expect(issue!.message).toContain('`visible: false`');
      expect(issue!.message).toContain('Drop `requiresFeature`');
    }
  });
});

// ── #5970 — `visible` / `disabled` speak ONE shape ────────────────────────────
// Ruled 2026-08-06: both keys are `boolean | string(CEL) | {dialect, source}`.
// Before this, `visible` had no boolean arm while `disabled` did, so the very
// common `visible: true` was a spec-side parse error that objectui's `ActionDef`
// accepted anyway — see the `ActionConditionInputSchema` comment in
// `action.zod.ts` for why an asymmetry between two keys of the same kind is a
// dialect nursery rather than a cosmetic gap.
describe('ActionSchema — visible/disabled unified condition shape', () => {
  const base = {
    name: 'transfer_ownership',
    label: 'Transfer Ownership',
    type: 'api',
    target: '/api/v1/auth/organization/update-member-role',
  } as const satisfies Partial<z.input<typeof ActionSchema>>;

  const parse = (key: 'visible' | 'disabled', value: unknown) =>
    ActionSchema.safeParse({ ...base, [key]: value });

  for (const key of ['visible', 'disabled'] as const) {
    describe(`\`${key}\``, () => {
      it('accepts the boolean arm and keeps the literal a literal', () => {
        // NOT normalized into `{dialect:'cel', source:'true'}`: a renderer must
        // be able to branch on the constant without standing up an evaluator.
        for (const literal of [true, false]) {
          const result = parse(key, literal);
          expect(result.success, `${key}: ${literal}`).toBe(true);
          if (result.success) expect(result.data[key]).toBe(literal);
        }
      });

      it('accepts the CEL string arm and normalizes it to the envelope', () => {
        const result = parse(key, "record.status == 'open'");
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data[key]).toEqual({ dialect: 'cel', source: "record.status == 'open'" });
        }
      });

      it('accepts the full envelope arm verbatim, authorship metadata included', () => {
        const envelope = {
          dialect: 'cel' as const,
          source: "record.status == 'open'",
          meta: { rationale: 'only open records can transfer', generatedBy: 'agent:spec' },
        };
        const result = parse(key, envelope);
        expect(result.success).toBe(true);
        if (result.success) expect(result.data[key]).toEqual(envelope);
      });

      // The widening must not shrink the rejection surface by one shape. Each
      // of these was rejected before #5970 and is asserted to still be.
      it.each([
        ['an empty CEL string', ''],
        ['a number', 1],
        ['null', null],
        ['an envelope with neither `source` nor `ast`', { dialect: 'cel' }],
        ['an envelope missing `dialect`', { source: "record.status == 'open'" }],
        ['an envelope with an unknown dialect', { dialect: 'sql', source: 'SELECT 1' }],
        ['a bare empty object', {}],
        ['an array of predicates', ["record.a == 1", "record.b == 2"]],
      ])('still rejects %s', (_label, value) => {
        expect(parse(key, value).success).toBe(false);
      });
    });
  }

  it('accepts both keys on one action, each on a different arm', () => {
    const result = ActionSchema.parse({
      ...base,
      visible: true,
      disabled: "record.status == 'closed'",
    } satisfies z.input<typeof ActionSchema>);
    expect(result.visible).toBe(true);
    expect(result.disabled).toEqual({ dialect: 'cel', source: "record.status == 'closed'" });
  });

  it('reaches the same shape through the registered `action` metadata schema', () => {
    // The authoring door the Studio form and `GET /api/v1/meta` go through —
    // a widening that stopped at the bare export would not reach an author.
    const schema = getMetadataTypeSchema('action');
    expect(schema, "the 'action' metadata type must resolve to a schema").toBeDefined();
    expect(schema!.safeParse({ ...base, visible: true, disabled: false }).success).toBe(true);
  });
});

describe('ActionSchema', () => {
  describe('Basic Action Properties', () => {
    it('should accept minimal action', () => {
      // A `script` action (the default type) must be bound to something
      // runnable — here a `target` naming a registered handler.
      const action: ActionType = {
        name: 'approve',
        label: 'Approve',
        target: 'approve_handler',
      };

      const result = ActionSchema.parse(action);
      expect(result.type).toBe('script');
      expect(result.refreshAfter).toBe(false);
    });

    it('should enforce snake_case for action name', () => {
      const validNames = ['approve_record', 'send_email', 'close_case'];
      validNames.forEach(name => {
        expect(() => ActionSchema.parse({ name, label: 'Test', target: 'h' })).not.toThrow();
      });

      const invalidNames = ['approveRecord', 'Approve-Record', '123action', '_internal'];
      invalidNames.forEach(name => {
        expect(() => ActionSchema.parse({ name, label: 'Test', target: 'h' })).toThrow();
      });
    });

    it('should accept action with icon', () => {
      const action: ActionType = {
        name: 'delete_record',
        label: 'Delete',
        icon: 'trash-2',
        target: 'delete_handler',
      };

      expect(() => ActionSchema.parse(action)).not.toThrow();
    });
  });

  describe('Action Types', () => {
    it('should accept all action types with target', () => {
      const types = ['script', 'url', 'modal', 'flow', 'api'] as const;
      
      types.forEach(type => {
        const action: ActionType = {
          name: 'test_action',
          label: 'Test',
          type,
          target: 'test_handler',
        };
        expect(() => ActionSchema.parse(action)).not.toThrow();
      });
    });

    it('should accept a script action bound by inline body (no target)', () => {
      expect(() => ActionSchema.parse({
        name: 'test_action',
        label: 'Test',
        type: 'script',
        body: { language: 'expression', source: 'true' },
      })).not.toThrow();
    });

    it('should reject a script action with neither body nor target', () => {
      // Regression guard for #2169: a body-less, target-less script action
      // registers no runtime handler and fails on invocation.
      expect(() => ActionSchema.parse({
        name: 'test_action',
        label: 'Test',
        type: 'script',
      })).toThrow(/body|target/);
    });

    it('should reject url/flow/modal/api types without target', () => {
      const targetRequiredTypes = ['url', 'flow', 'modal', 'api'] as const;
      targetRequiredTypes.forEach(type => {
        expect(() => ActionSchema.parse({
          name: 'test_action',
          label: 'Test',
          type,
        })).toThrow(/target/);
      });
    });

    it('should default to script type', () => {
      const action = {
        name: 'custom_action',
        label: 'Custom',
        target: 'custom_handler',
      };

      const result = ActionSchema.parse(action);
      expect(result.type).toBe('script');
    });
  });

  describe('Action Locations', () => {
    it('should accept valid locations', () => {
      const locations = [
        'list_toolbar',
        'list_item',
        'record_header',
        'record_more',
        'record_related',
        'record_section',
      ] as const;

      const action: ActionType = {
        name: 'multi_location',
        label: 'Multi Location',
        target: 'noop',
        locations,
      };

      expect(() => ActionSchema.parse(action)).not.toThrow();
    });

    it('should accept single location', () => {
      const action: ActionType = {
        name: 'toolbar_action',
        label: 'Toolbar Action',
        target: 'noop',
        locations: ['list_toolbar'],
      };

      expect(() => ActionSchema.parse(action)).not.toThrow();
    });
  });

  describe('objectName', () => {
    it('should accept action with objectName', () => {
      const action = {
        name: 'approve_task',
        label: 'Approve Task',
        target: 'noop',
        objectName: 'task',
      };

      const result = ActionSchema.parse(action);
      expect(result.objectName).toBe('task');
    });

    it('should accept action without objectName (global action)', () => {
      const action = {
        name: 'global_search',
        label: 'Global Search',
        target: 'noop',
      };

      const result = ActionSchema.parse(action);
      expect(result.objectName).toBeUndefined();
    });

    it('should enforce snake_case for objectName', () => {
      expect(() => ActionSchema.parse({
        name: 'test_action',
        label: 'Test',
        objectName: 'myObject',
      })).toThrow();

      expect(() => ActionSchema.parse({
        name: 'test_action',
        label: 'Test',
        objectName: 'my_object',
        target: 'noop',
      })).not.toThrow();
    });
  });

  describe('Action Targets', () => {
    it('should accept URL action with target', () => {
      const action: ActionType = {
        name: 'open_external',
        label: 'Open External',
        type: 'url',
        target: 'https://example.com/api',
      };

      expect(() => ActionSchema.parse(action)).not.toThrow();
    });

    it('should accept flow action with target', () => {
      const action: ActionType = {
        name: 'run_approval_flow',
        label: 'Run Approval',
        type: 'flow',
        target: 'approval_workflow',
      };

      expect(() => ActionSchema.parse(action)).not.toThrow();
    });

    it('should accept API action with target', () => {
      const action: ActionType = {
        name: 'call_api',
        label: 'Call API',
        type: 'api',
        target: '/api/custom-endpoint',
      };

      expect(() => ActionSchema.parse(action)).not.toThrow();
    });
  });

  describe('Action Parameters', () => {
    it('should accept action with parameters', () => {
      const action: ActionType = {
        name: 'transfer_ownership',
        label: 'Transfer Ownership',
        target: 'noop',
        type: 'script',
        params: [
          {
            name: 'new_owner',
            label: 'New Owner',
            type: 'lookup',
            reference: 'sys_user',
            required: true,
          },
          {
            name: 'notify',
            label: 'Notify Old Owner',
            type: 'boolean',
            required: false,
          },
        ],
      };

      expect(() => ActionSchema.parse(action)).not.toThrow();
    });

    it('should accept action with select parameter', () => {
      const action: ActionType = {
        name: 'change_status',
        label: 'Change Status',
        target: 'noop',
        params: [
          {
            name: 'status',
            label: 'New Status',
            type: 'select',
            required: true,
            options: [
              { label: 'Active', value: 'active' },
              { label: 'Inactive', value: 'inactive' },
            ],
          },
        ],
      };

      expect(() => ActionSchema.parse(action)).not.toThrow();
    });
  });

  describe('UX Behavior', () => {
    it('should accept action with confirmation', () => {
      const action: ActionType = {
        name: 'delete_all',
        label: 'Delete All',
        target: 'noop',
        confirmText: 'Are you sure you want to delete all records? This cannot be undone.',
      };

      expect(() => ActionSchema.parse(action)).not.toThrow();
    });

    it('should accept action with success message', () => {
      const action: ActionType = {
        name: 'send_notification',
        label: 'Send Notification',
        target: 'noop',
        successMessage: 'Notification sent successfully!',
      };

      expect(() => ActionSchema.parse(action)).not.toThrow();
    });

    it('should accept action that refreshes view', () => {
      const action: ActionType = {
        name: 'update_status',
        label: 'Update Status',
        target: 'noop',
        refreshAfter: true,
      };

      expect(() => ActionSchema.parse(action)).not.toThrow();
    });

    it('should accept action with all UX properties', () => {
      const action: ActionType = {
        name: 'complete_task',
        label: 'Complete Task',
        target: 'noop',
        confirmText: 'Mark this task as complete?',
        successMessage: 'Task completed successfully!',
        refreshAfter: true,
      };

      expect(() => ActionSchema.parse(action)).not.toThrow();
    });
  });

  describe('Visibility Control', () => {
    it('should accept action with visibility formula', () => {
      const action: ActionType = {
        name: 'approve',
        label: 'Approve',
        target: 'approve_handler',
        visible: 'status == "pending" && user.can_approve',
      };

      expect(() => ActionSchema.parse(action)).not.toThrow();
    });
  });

  describe('Real-World Action Examples', () => {
    it('should accept approve opportunity action', () => {
      const approveAction: ActionType = {
        name: 'approve_opportunity',
        label: 'Approve',
        icon: 'check-circle',
        type: 'script',
        locations: ['record_header', 'record_more'],
        target: 'approveOpportunity',
        confirmText: 'Are you sure you want to approve this opportunity?',
        successMessage: 'Opportunity approved successfully!',
        refreshAfter: true,
        visible: 'status == "pending_approval" && user.has_permission("approve_opportunities")',
      };

      expect(() => ActionSchema.parse(approveAction)).not.toThrow();
    });

    it('should accept transfer case action with parameters', () => {
      const transferAction: ActionType = {
        name: 'transfer_case',
        label: 'Transfer Case',
        icon: 'arrow-right',
        type: 'modal',
        target: 'transfer_case_modal',
        locations: ['record_more'],
        params: [
          {
            name: 'new_owner',
            label: 'New Owner',
            type: 'lookup',
            reference: 'sys_user',
            required: true,
          },
          {
            name: 'reason',
            label: 'Transfer Reason',
            type: 'textarea',
            required: false,
          },
          {
            name: 'notify_customer',
            label: 'Notify Customer',
            type: 'boolean',
            required: false,
          },
        ],
        successMessage: 'Case transferred successfully!',
        refreshAfter: true,
      };

      expect(() => ActionSchema.parse(transferAction)).not.toThrow();
    });

    it('should accept send email action', () => {
      const emailAction: ActionType = {
        name: 'send_quote',
        label: 'Send Quote',
        icon: 'mail',
        type: 'flow',
        target: 'send_quote_flow',
        locations: ['record_header', 'list_item'],
        params: [
          {
            name: 'recipient',
            label: 'Send To',
            type: 'email',
            required: true,
          },
          {
            name: 'template',
            label: 'Email Template',
            type: 'select',
            required: true,
            options: [
              { label: 'Standard Quote', value: 'standard_quote' },
              { label: 'Premium Quote', value: 'premium_quote' },
            ],
          },
        ],
        successMessage: 'Quote sent!',
      };

      expect(() => ActionSchema.parse(emailAction)).not.toThrow();
    });

    it('should accept export to Excel action', () => {
      const exportAction: ActionType = {
        name: 'export_excel',
        label: 'Export to Excel',
        icon: 'file-spreadsheet',
        type: 'api',
        target: '/api/export/excel',
        locations: ['list_toolbar'],
        successMessage: 'Export started. You will receive an email when ready.',
      };

      expect(() => ActionSchema.parse(exportAction)).not.toThrow();
    });

    it('should accept delete action with confirmation', () => {
      const deleteAction: ActionType = {
        name: 'delete_record',
        label: 'Delete',
        icon: 'trash-2',
        type: 'script',
        locations: ['record_more'],
        target: 'deleteRecord',
        confirmText: 'Are you sure you want to delete this record? This action cannot be undone.',
        successMessage: 'Record deleted successfully!',
        refreshAfter: true,
        visible: 'user.has_permission("delete_records")',
      };

      expect(() => ActionSchema.parse(deleteAction)).not.toThrow();
    });

    it('should accept clone record action', () => {
      const cloneAction: ActionType = {
        name: 'clone_record',
        label: 'Clone',
        icon: 'copy',
        type: 'script',
        locations: ['record_more', 'list_item'],
        target: 'cloneRecord',
        params: [
          {
            name: 'include_children',
            label: 'Include Related Records',
            type: 'boolean',
            required: false,
          },
        ],
        successMessage: 'Record cloned successfully!',
        refreshAfter: true,
      };

      expect(() => ActionSchema.parse(cloneAction)).not.toThrow();
    });

    it('should accept open external link action', () => {
      const linkAction: ActionType = {
        name: 'view_on_map',
        label: 'View on Map',
        icon: 'map-pin',
        type: 'url',
        target: 'https://maps.google.com/?q={address}',
        locations: ['record_related'],
        visible: 'address != null',
      };

      expect(() => ActionSchema.parse(linkAction)).not.toThrow();
    });
  });
});

// ============================================================================
// openIn — declarative new-tab control for static type:'url' targets (#2043)
// ============================================================================

describe('ActionSchema - openIn', () => {
  it('should accept openIn: "new-tab" on a static url action', () => {
    const result = ActionSchema.parse({
      name: 'print_a3',
      label: 'Print A3',
      type: 'url',
      target: '/print/a3?id=${record.id}',
      openIn: 'new-tab',
    });
    expect(result.openIn).toBe('new-tab');
  });

  it('should accept openIn: "self"', () => {
    const result = ActionSchema.parse({
      name: 'open_inline',
      label: 'Open Inline',
      type: 'url',
      target: '/somewhere',
      openIn: 'self',
    });
    expect(result.openIn).toBe('self');
  });

  it('should leave openIn undefined when omitted', () => {
    const result = ActionSchema.parse({
      name: 'plain_url',
      label: 'Plain URL',
      type: 'url',
      target: 'https://example.com',
    });
    expect(result.openIn).toBeUndefined();
  });

  it('should preserve openIn through defineAction (not stripped at build)', () => {
    // Regression guard for #2043 counterpart: a plain z.object() stripped
    // unknown keys, so openIn never reached objectui. It must survive parse.
    const result = ActionSchema.parse({
      name: 'print_a3',
      label: '打印总表(A3)',
      type: 'url',
      target: '/print/a3?id=${record.id}',
      openIn: 'new-tab',
    });
    expect(result.openIn).toBe('new-tab');
  });

  it('should reject an invalid openIn value', () => {
    expect(() => ActionSchema.parse({
      name: 'bad_openin',
      label: 'Bad',
      type: 'url',
      target: '/x',
      openIn: 'newtab',
    })).toThrow();
  });
});

describe('Action Factory', () => {
  it('should create action with default values via factory', () => {
    const action = Action.create({
      name: 'test_action',
      label: 'Test Action',
      target: 'noop',
    });
    
    expect(action.name).toBe('test_action');
    expect(action.label).toBe('Test Action');
    expect(action.type).toBe('script');
    expect(action.refreshAfter).toBe(false);
  });

  it('should create action without refreshAfter property (uses default)', () => {
    const action = Action.create({
      name: 'send_email',
      label: 'Send Email',
      type: 'flow',
      target: 'email_flow',
    });
    
    expect(action.refreshAfter).toBe(false);
  });

  it('should create action with explicit refreshAfter', () => {
    const action = Action.create({
      name: 'update_record',
      label: 'Update',
      target: 'noop',
      refreshAfter: true,
    });
    
    expect(action.refreshAfter).toBe(true);
  });

  it('should validate snake_case name in factory', () => {
    expect(() => Action.create({
      name: 'invalidName',
      label: 'Invalid',
    })).toThrow();

    expect(() => Action.create({
      name: 'valid_name',
      label: 'Valid',
      target: 'noop',
    })).not.toThrow();
  });
});

describe('Action I18n Integration', () => {
  it('should reject i18n object as action label', () => {
    expect(() => ActionSchema.parse({
      name: 'i18n_action',
      label: { key: 'actions.approve', defaultValue: 'Approve' },
    })).toThrow();
  });
  it('should reject i18n as confirmText and successMessage', () => {
    expect(() => ActionSchema.parse({
      name: 'i18n_confirm',
      label: 'Delete',
      confirmText: { key: 'actions.confirm_delete', defaultValue: 'Are you sure?' },
      successMessage: { key: 'actions.delete_success', defaultValue: 'Deleted!' },
    })).toThrow();
  });
  it('should reject i18n in param labels', () => {
    expect(() => ActionParamSchema.parse({
      name: 'reason',
      label: { key: 'params.reason', defaultValue: 'Reason' },
      type: 'textarea',
    })).toThrow();
  });
  it('should reject i18n in param option labels', () => {
    expect(() => ActionParamSchema.parse({
      name: 'priority',
      label: 'Priority',
      type: 'select',
      options: [
        { label: { key: 'options.high', defaultValue: 'High' }, value: 'high' },
        { label: { key: 'options.low', defaultValue: 'Low' }, value: 'low' },
      ],
    })).toThrow();
  });
});

// ============================================================================
// ADR-0011: AI exposure block (opt-in)
// ============================================================================

describe('ActionSchema - ai block (ADR-0011)', () => {
  const longDescription =
    'Classify a support case and suggest a priority, category, and queue for the agent.';

  it('defaults ai.exposed to false when an ai block is supplied without it', () => {
    const result = ActionSchema.parse({
      name: 'maybe_expose',
      label: 'Maybe',
      target: 'noop',
      ai: {},
    });
    expect(result.ai?.exposed).toBe(false);
  });

  it('accepts an action with no ai block (not exposed)', () => {
    const result = ActionSchema.parse({ name: 'plain', label: 'Plain', target: 'noop' });
    expect(result.ai).toBeUndefined();
  });

  it('requires a description when exposed is true', () => {
    expect(() =>
      ActionSchema.parse({
        name: 'expose_no_desc',
        label: 'Expose',
        ai: { exposed: true },
      }),
    ).toThrow(/ai\.description/);
  });

  it('rejects a description shorter than 40 chars', () => {
    expect(() =>
      ActionSchema.parse({
        name: 'expose_short',
        label: 'Expose',
        ai: { exposed: true, description: 'too short' },
      }),
    ).toThrow();
  });

  it('accepts a fully-specified ai block', () => {
    const result = ActionSchema.parse({
      name: 'triage_case',
      label: 'Triage Case',
      target: 'noop',
      objectName: 'crm_case',
      params: [{ name: 'priority', type: 'text' }],
      ai: {
        exposed: true,
        description: longDescription,
        category: 'analytics',
        paramHints: { priority: { description: 'P0-P3', enum: ['P0', 'P1', 'P2', 'P3'] } },
        outputSchema: { type: 'object', properties: { priority: { type: 'string' } } },
        requiresConfirmation: false,
      },
    });
    expect(result.ai?.exposed).toBe(true);
    expect(result.ai?.category).toBe('analytics');
    expect(result.ai?.requiresConfirmation).toBe(false);
  });

  it('rejects an invalid ai.category value', () => {
    expect(() =>
      ActionSchema.parse({
        name: 'bad_category',
        label: 'Bad',
        ai: { exposed: true, description: longDescription, category: 'not_a_category' },
      }),
    ).toThrow();
  });

  it('rejects paramHints keys that do not match a declared param', () => {
    expect(() =>
      ActionSchema.parse({
        name: 'bad_hint',
        label: 'Bad Hint',
        params: [{ name: 'priority', type: 'text' }],
        ai: { exposed: true, description: longDescription, paramHints: { nonexistent: { description: 'x' } } },
      }),
    ).toThrow(/paramHints/);
  });

  it('allows paramHints to reference the injected recordId', () => {
    expect(() =>
      ActionSchema.parse({
        name: 'hint_record_id',
        label: 'Hint',
        target: 'noop',
        objectName: 'task',
        locations: ['record_header'],
        ai: { exposed: true, description: longDescription, paramHints: { recordId: { description: 'The task id.' } } },
      }),
    ).not.toThrow();
  });

  it('does not require a description when exposed is false', () => {
    expect(() =>
      ActionSchema.parse({ name: 'opted_out', label: 'Out', target: 'noop', ai: { exposed: false } }),
    ).not.toThrow();
  });
});

describe('Action ARIA Integration', () => {
  it('should accept action with ARIA attributes', () => {
    expect(() => ActionSchema.parse({
      name: 'accessible_action',
      label: 'Delete',
      target: 'noop',
      aria: { ariaLabel: 'Delete this record permanently', role: 'button' },
    })).not.toThrow();
  });
});

// ============================================================================
// Protocol Improvement Tests: Action variant
// ============================================================================

describe('ActionSchema - variant', () => {
  it('should accept all valid variants', () => {
    const variants = ['primary', 'secondary', 'danger', 'ghost', 'link'] as const;
    for (const variant of variants) {
      const result = ActionSchema.parse({
        name: 'test_action',
        label: 'Test',
        target: 'noop',
        variant,
      });
      expect(result.variant).toBe(variant);
    }
  });

  it('should accept action without variant (optional)', () => {
    const result = ActionSchema.parse({
      name: 'no_variant',
      label: 'Action',
      target: 'noop',
    });
    expect(result.variant).toBeUndefined();
  });

  it('should reject invalid variant value', () => {
    expect(() => ActionSchema.parse({
      name: 'bad_variant',
      label: 'Action',
      variant: 'invalid',
    })).toThrow();
  });

  it('should combine variant with other action properties', () => {
    const result = ActionSchema.parse({
      name: 'delete_record',
      label: 'Delete',
      target: 'delete_handler',
      variant: 'danger',
      confirmText: 'Are you sure?',
      icon: 'trash',
    });
    expect(result.variant).toBe('danger');
    expect(result.confirmText).toBe('Are you sure?');
  });
});

describe('ActionSchema - order', () => {
  it('should accept a numeric order (incl. negative and zero)', () => {
    for (const order of [-100, -1, 0, 5, 999]) {
      const result = ActionSchema.parse({
        name: 'ordered_action',
        label: 'Ordered',
        target: 'noop',
        order,
      });
      expect(result.order).toBe(order);
    }
  });

  it('should accept action without order (optional)', () => {
    const result = ActionSchema.parse({
      name: 'no_order',
      label: 'Action',
      target: 'noop',
    });
    expect(result.order).toBeUndefined();
  });

  it('should reject a non-numeric order', () => {
    expect(() => ActionSchema.parse({
      name: 'bad_order',
      label: 'Action',
      target: 'noop',
      order: 'first',
    })).toThrow();
  });

  it('should combine order with variant and locations (record_header primary hint)', () => {
    const result = ActionSchema.parse({
      name: 'approve',
      label: 'Approve',
      target: 'approve_handler',
      locations: ['record_header', 'record_more'],
      variant: 'primary',
      order: -10,
    });
    expect(result.order).toBe(-10);
    expect(result.variant).toBe('primary');
    expect(result.locations).toContain('record_header');
  });
});

// ============================================================================
// Protocol Improvement Tests: execute → target migration & target validation
// ============================================================================

describe('ActionSchema — the `execute` alias is REMOVED (#3855)', () => {
  // #3713 → #3742 → #3855: `execute` was the deprecated alias of `target`. It
  // was lowered into `target` at parse time and dropped from the output; as of
  // protocol 17 it is gone from the spec entirely.
  //
  // It is TOMBSTONED rather than deleted, because `ActionSchema` is not
  // `.strict()`: a plain deletion would have silently stripped the key, leaving
  // the action with no handler bound and no diagnostic — the #2169 "Mark Done
  // does nothing" shape. The rejection is what makes the removal audible, and
  // it carries the fix so an upgrading agent does not have to find our docs.
  const parseWithExecute = () =>
    ActionSchema.parse({
      name: 'legacy_action',
      label: 'Legacy',
      type: 'script',
      execute: 'legacyHandler',
    });

  it('rejects an authored `execute` instead of silently stripping it', () => {
    expect(parseWithExecute).toThrow();
  });

  it('carries the upgrade prescription in the rejection itself', () => {
    // This string is the one upgrade channel every consumer is guaranteed to
    // hit — it must name the replacement AND the automated fix.
    let message = '';
    try {
      parseWithExecute();
    } catch (err) {
      message = String(err);
    }
    expect(message).toContain('`execute` was removed');
    expect(message).toContain('use `target`');
    expect(message).toContain('os migrate meta');
  });

  it('rejects `execute` even when the canonical `target` is also present', () => {
    // The old behaviour silently discarded the alias here. Now the author is
    // told, because one of the two handlers they wrote was going to be lost.
    expect(() => ActionSchema.parse({
      name: 'both_fields',
      label: 'Both',
      type: 'script',
      target: 'preferredHandler',
      execute: 'legacyHandler',
    })).toThrow(/`execute` was removed/);
  });

  it('accepts the canonical `target` on its own', () => {
    const parsed = ActionSchema.parse({
      name: 'canonical',
      label: 'Canonical',
      type: 'url',
      target: 'https://example.com/report',
    });
    expect(parsed.target).toBe('https://example.com/report');
    expect('execute' in parsed).toBe(false);
  });
});

describe('ActionSchema - target validation', () => {
  it('should reject a script with neither target/execute nor body', () => {
    // #2169: a script action with no handler binding registers nothing.
    expect(() => ActionSchema.parse({
      name: 'inline_script',
      label: 'Inline',
      type: 'script',
    })).toThrow(/body|target/);
  });

  it('should allow a script bound by inline body (no target/execute)', () => {
    expect(() => ActionSchema.parse({
      name: 'inline_body_script',
      label: 'Inline',
      type: 'script',
      body: { language: 'expression', source: 'true' },
    })).not.toThrow();
  });

  it('should reject a body on a non-script action (it would never run)', () => {
    // #3530: `type: 'modal'` + `params` + `body` was authored expecting the
    // body to run when the modal is submitted. A modal action dispatches on
    // `target` (the page to open), so the body is silently skipped — the modal
    // opens and nothing is ever written. Fail at author time and point at the
    // fix rather than shipping a button that does nothing.
    for (const type of ['modal', 'url', 'flow', 'api', 'form'] as const) {
      expect(() => ActionSchema.parse({
        name: `${type}_with_body`,
        label: 'Has a body',
        type,
        target: 'some_target',
        body: { language: 'js', source: 'return 1;', capabilities: ['api.write'] },
      }), `type: '${type}'`).toThrow(/script/);
    }
  });

  it('should allow a non-script action without a body', () => {
    expect(() => ActionSchema.parse({
      name: 'log_call',
      label: 'Log a Call',
      type: 'modal',
      target: 'log_call',
      params: [{ name: 'subject', label: 'Call Subject', type: 'text', required: true }],
    })).not.toThrow();
  });
});

/**
 * [#4352] The refinement above is only half the guarantee. The other half is
 * the WIRING: the publish gate does not import `ActionSchema` directly — it
 * resolves the judging schema by metadata type through
 * `getMetadataTypeSchema()` (`metadata-protocol`'s save-time validation and
 * `metadata-diagnostics` both go through it), and an object's inline actions
 * are judged by `ObjectSchema.actions`.
 *
 * So a re-point of either registration would silently reopen the hole while
 * every test above stayed green — the schema would still reject, and nothing
 * would still ask it. #4352's ruling puts the rejection ON the publish gate,
 * which is what these pin.
 */
describe('ActionSchema - the publish gate resolves to it (#4352)', () => {
  const contradictory = {
    name: 'open_docs',
    label: 'Open Docs',
    type: 'url' as const,
    target: 'https://docs.example.com',
    body: { language: 'js' as const, source: 'return 1;', capabilities: ['api.write'] },
  };

  it("rejects `body` + `type: 'url'` through getMetadataTypeSchema('action')", () => {
    const schema = getMetadataTypeSchema('action');
    expect(schema, "the 'action' metadata type must resolve to a schema").toBeDefined();
    const result = schema!.safeParse(contradictory);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/script/);
  });

  it("accepts the same action once its `body` is dropped", () => {
    const { body: _body, ...withoutBody } = contradictory;
    expect(getMetadataTypeSchema('action')!.safeParse(withoutBody).success).toBe(true);
  });

  it('rejects the same contradiction nested in `object.actions[]`', () => {
    const result = ObjectSchema.safeParse({
      name: 'crm_deal',
      label: 'Deal',
      fields: { stage: { label: 'Stage', type: 'text' } },
      actions: [contradictory],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/script/);
  });

  it("accepts a `type: 'script'` body nested in `object.actions[]` — unchanged", () => {
    const result = ObjectSchema.safeParse({
      name: 'crm_deal',
      label: 'Deal',
      fields: { stage: { label: 'Stage', type: 'text' } },
      actions: [{
        name: 'close_deal',
        label: 'Close Deal',
        type: 'script',
        body: { language: 'js', source: 'return 1;', capabilities: ['api.write'] },
      }],
    });
    expect(result.success).toBe(true);
  });
});

describe('ActionSchema - target required for non-script types', () => {
  it('should require target for url type', () => {
    expect(() => ActionSchema.parse({
      name: 'url_action',
      label: 'Open URL',
      type: 'url',
    })).toThrow(/target/);
  });

  it('should require target for flow type', () => {
    expect(() => ActionSchema.parse({
      name: 'flow_action',
      label: 'Run Flow',
      type: 'flow',
    })).toThrow(/target/);
  });

  it('should require target for modal type', () => {
    expect(() => ActionSchema.parse({
      name: 'modal_action',
      label: 'Open Modal',
      type: 'modal',
    })).toThrow(/target/);
  });

  it('should require target for api type', () => {
    expect(() => ActionSchema.parse({
      name: 'api_action',
      label: 'Call API',
      type: 'api',
    })).toThrow(/target/);
  });

  it('should accept non-script types when target is provided', () => {
    expect(() => ActionSchema.parse({ name: 'url_ok', label: 'URL', type: 'url', target: 'https://example.com' })).not.toThrow();
    expect(() => ActionSchema.parse({ name: 'flow_ok', label: 'Flow', type: 'flow', target: 'my_flow' })).not.toThrow();
    expect(() => ActionSchema.parse({ name: 'modal_ok', label: 'Modal', type: 'modal', target: 'my_modal' })).not.toThrow();
    expect(() => ActionSchema.parse({ name: 'api_ok', label: 'API', type: 'api', target: '/api/endpoint' })).not.toThrow();
  });

  it('rejects a non-script type bound through the removed `execute` alias (#3855)', () => {
    // Before protocol 17 this parsed: `execute` was lowered into `target`, so a
    // flow action bound through the alias worked. The alias is gone, so the
    // action now fails BOTH on the removed key and on its missing `target` —
    // and the first message tells the author which key to rename.
    expect(() => ActionSchema.parse({
      name: 'flow_legacy',
      label: 'Flow Legacy',
      type: 'flow',
      execute: 'my_flow',
    })).toThrow(/`execute` was removed/);

    expect(ActionSchema.parse({
      name: 'flow_canonical',
      label: 'Flow Canonical',
      type: 'flow',
      target: 'my_flow',
    }).target).toBe('my_flow');
  });
});

describe('ACTION_LOCATIONS — canonical source of truth', () => {
  // The platform has ONE definition of the supported action locations,
  // and every consumer (`@object-ui/types`, `@object-ui/core/ActionEngine`,
  // designer enums, platform-objects, …) re-exports it. Lock down the
  // exact set so a typo or accidental removal here breaks loudly instead
  // of producing a silent runtime mismatch.
  it('exposes the full set of supported locations', () => {
    expect([...ACTION_LOCATIONS]).toEqual([
      'list_toolbar',
      'list_item',
      'record_header',
      'record_more',
      'record_related',
      'record_section',
    ]);
  });

  it('ActionLocationSchema accepts every value in ACTION_LOCATIONS', () => {
    for (const loc of ACTION_LOCATIONS) {
      expect(() => ActionLocationSchema.parse(loc)).not.toThrow();
    }
  });

  it('ActionLocationSchema rejects unknown values', () => {
    expect(() => ActionLocationSchema.parse('record_quick_actions')).toThrow();
    expect(() => ActionLocationSchema.parse('detail_header')).toThrow();
    expect(() => ActionLocationSchema.parse('')).toThrow();
  });

  // ─── [#6888] `global_nav` retirement — the enum-VALUE tombstone ────────────
  //
  // The value is gone from the vocabulary and there is no `retiredKey()` to
  // hang the prescription on (a value is not a key), so the enum's own error
  // map carries it, keyed on `issue.input`. These pin the two halves that make
  // the retirement audible instead of silent: the value is REFUSED, and the
  // refusal SAYS WHY and what to do instead. A bare `.toThrow()` would pass on
  // zod's generic "invalid option" message and would not notice the error map
  // being dropped, which is the whole mechanism here.
  describe('[#6888] `global_nav` is retired', () => {
    it('is no longer a member of the vocabulary', () => {
      expect([...ACTION_LOCATIONS]).not.toContain('global_nav');
      // Anti-vacuity: the constant we just probed is the real one and still
      // carries the surviving members, so `not.toContain` cannot pass by
      // resolving an empty list.
      expect(ACTION_LOCATIONS).toHaveLength(6);
      expect([...ACTION_LOCATIONS]).toContain('record_section');
    });

    it('refuses the value WITH the prescription — bare enum and whole action alike', () => {
      // The prescription: names the value, says it was removed, points at the
      // live alternatives (a served location, or the headless `locations: []`),
      // and closes with the house `os migrate meta` sentence (#6856 route D).
      const prescribes = (fn: () => unknown) => {
        expect(fn).toThrow(/`global_nav` was removed from `ACTION_LOCATIONS`/s);
        expect(fn).toThrow(/#6888/s);
        expect(fn).toThrow(/locations: \[\]/s);
        expect(fn).toThrow(/os migrate meta --from 16/s);
      };

      prescribes(() => ActionLocationSchema.parse('global_nav'));
      // The path an author actually travels — the value inside a real action.
      prescribes(() =>
        ActionSchema.parse({
          name: 'palette_action',
          label: 'Palette Action',
          type: 'script',
          target: 'true',
          locations: ['global_nav'],
        }),
      );
    });

    it('tells ONLY the retired spelling that it "was removed"', () => {
      // The error map is keyed on `issue.input` precisely so a typo is not
      // misinformed that its value used to exist. `globalnav` never did.
      expect(() => ActionLocationSchema.parse('globalnav')).toThrow();
      expect(() => ActionLocationSchema.parse('globalnav')).not.toThrow(/was removed/s);
      expect(() => ActionLocationSchema.parse('global_navigation')).not.toThrow(/was removed/s);
    });

    it('accepts the migrated shape: an action with no UI surface says so with `[]`', () => {
      // What the D2 conversion rewrites `locations: ['global_nav']` INTO — the
      // documented headless declaration, still a legal action.
      const action = ActionSchema.parse({
        name: 'portfolio_snapshot',
        label: 'Portfolio Snapshot',
        type: 'script',
        target: 'true',
        locations: [],
      });
      expect(action.locations).toEqual([]);
    });
  });

  it('ActionSchema accepts a `locations: ActionLocation[]` field', () => {
    const all: ActionLocation[] = [...ACTION_LOCATIONS];
    const action = ActionSchema.parse({
      name: 'with_locations',
      label: 'With Locations',
      type: 'script',
      target: 'true',
      locations: all,
    });
    expect(action.locations).toEqual(all);
  });

  it('ActionSchema rejects an unknown location string', () => {
    expect(() =>
      ActionSchema.parse({
        name: 'bad_location',
        label: 'Bad',
        type: 'script',
        target: 'true',
        locations: ['record_section', 'not_a_real_location'],
      })
    ).toThrow();
  });


  it('[ADR-0066 D4] ActionSchema accepts requiredPermissions', () => {
    const action = ActionSchema.parse({
      name: 'issue_and_sign',
      label: 'Issue & Sign',
      type: 'api',
      target: '/api/v1/cloud/licenses/issue',
      requiredPermissions: ['manage_platform_settings'],
    });
    expect(action.requiredPermissions).toEqual(['manage_platform_settings']);
  });

  it('[ADR-0066 D4] requiredPermissions is optional (absent ⇒ undefined)', () => {
    const action = ActionSchema.parse({ name: 'mark_done', label: 'Mark Done', type: 'script', target: 'true' });
    expect(action.requiredPermissions).toBeUndefined();
  });
});

describe('#3896 close-out — retired shortcut/bulkEnabled', () => {
  it('REJECTS the retired `shortcut` and names the real keyboard stack', () => {
    let message = '';
    try {
      ActionSchema.parse({ name: 'save_now', label: 'Save', type: 'script', target: 'h', shortcut: 'Ctrl+S' });
    } catch (e) { message = String((e as Error).message); }
    expect(message).toMatch(/keyboard stack/);
    expect(message).toMatch(/#3896/);
  });
  it('REJECTS the retired `bulkEnabled` and points at the view bulkActions', () => {
    let message = '';
    try {
      ActionSchema.parse({ name: 'close_all', label: 'Close', type: 'script', target: 'h', bulkEnabled: true });
    } catch (e) { message = String((e as Error).message); }
    expect(message).toMatch(/bulkActions/);
    expect(message).toMatch(/#3896/);
  });
});

// ---------------------------------------------------------------------------
// #5016 — per-option `visibleWhen` on an action param's option list
// ---------------------------------------------------------------------------

/**
 * #4001 批 14 closed this option entry at `{ label, value }` and filed the
 * capability question as #5016. #5016 answered it PER KEY, on measurement of
 * what an action param's option list can actually reach in objectui:
 *
 *  - `visibleWhen` has a reader on this exact path, so it is declared.
 *  - `color` / `default` / `icon` / `disabled` do not, so they stay rejected —
 *    with the guidance that says where each vocabulary IS real.
 *
 * Every assertion below goes through a REAL door — `getMetadataTypeSchema('action')`
 * (what `MetadataManager.validate` / `GET /api/v1/meta` / the Studio form use)
 * or `ObjectSchema.actions[]` — rather than through `ActionParamSchema`
 * directly, because the defect #5016 records was not "the sub-schema strips it"
 * but "the key never survives the door an author's metadata actually crosses".
 */
describe('#5016 — action param option vocabulary', () => {
  const gatedAction = {
    name: 'escalate',
    label: 'Escalate',
    type: 'script' as const,
    target: 'escalate_handler',
    params: [{
      name: 'severity',
      label: 'Severity',
      type: 'select' as const,
      options: [
        { label: 'Normal', value: 'normal' },
        { label: 'Overload', value: 'overload', visibleWhen: "record.status == 'open'" },
      ],
    }],
  };

  it('SURVIVES the metadata door — declared AND delivered, not declared-then-stripped', () => {
    const schema = getMetadataTypeSchema('action');
    expect(schema, "the 'action' metadata type must resolve to a schema").toBeDefined();
    const result = schema!.safeParse(gatedAction);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);

    // The load-bearing half. Batch 14 measured this same payload coming back as
    // `{"label":"Overload","value":"overload"}` — parsed clean, key gone before
    // any renderer saw it. Asserting only `success` would still pass in that
    // world, which is exactly the ADR-0078 shape this change exists to end.
    const options = (result.data as any).params[0].options;
    expect(options[1]).toMatchObject({
      label: 'Overload',
      value: 'overload',
      // `ExpressionInputSchema` normalises the authored string into the wire
      // envelope objectui's `evalFieldPredicate` accepts (`FieldRulePredicate =
      // string | { dialect?, source }`).
      visibleWhen: { dialect: 'cel', source: "record.status == 'open'" },
    });
    // An option that declares no predicate stays predicate-free — `visibleWhen`
    // is optional, not defaulted to an always-true expression.
    expect(options[0].visibleWhen).toBeUndefined();
  });

  it('survives the other real door too — nested in `object.actions[]`', () => {
    const result = ObjectSchema.safeParse({
      name: 'crm_case',
      label: 'Case',
      fields: { status: { label: 'Status', type: 'text' } },
      actions: [gatedAction],
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect((result.data as any).actions[0].params[0].options[1].visibleWhen)
      .toEqual({ dialect: 'cel', source: "record.status == 'open'" });
  });

  it('accepts the canonical `{ dialect, source }` envelope as authored', () => {
    const result = getMetadataTypeSchema('action')!.safeParse({
      ...gatedAction,
      params: [{
        name: 'severity',
        type: 'select' as const,
        options: [{
          label: 'Overload',
          value: 'overload',
          visibleWhen: { dialect: 'cel', source: "'admin' in current_user.positions" },
        }],
      }],
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('does NOT open the keys whose readers this surface cannot reach', () => {
    // `color` / `default` are declared one layer down on `SelectOptionSchema`;
    // `icon` / `disabled` are declared nowhere in the spec. Neither group has a
    // consumer an action param's option list reaches — the dialog builds an
    // INPUT from the list and discards it — so both stay rejected. Opening them
    // for vocabulary symmetry would be the parses-clean-changes-nothing key.
    for (const key of ['color', 'default', 'icon', 'disabled']) {
      const result = getMetadataTypeSchema('action')!.safeParse({
        ...gatedAction,
        params: [{
          name: 'severity',
          type: 'select' as const,
          options: [{ label: 'Overload', value: 'overload', [key]: key === 'disabled' || key === 'default' ? true : 'x' }],
        }],
      });
      expect(result.success, `\`${key}\` must stay rejected on an action param option`).toBe(false);
    }
  });

  it('keeps each rejection pointing at where that vocabulary IS real', () => {
    const messageFor = (option: Record<string, unknown>): string => {
      const r = getMetadataTypeSchema('action')!.safeParse({
        ...gatedAction,
        params: [{ name: 'severity', type: 'select' as const, options: [option] }],
      });
      return JSON.stringify(r.error?.issues ?? []);
    };

    // `color`: real one layer down, on the STORED-value display path. The
    // sentence must no longer defer to #5016 as an open question — it is
    // decided — and must not promise the field-backed inheritance route, which
    // `normaliseOptions` still drops (ledger finding 18).
    const color = messageFor({ label: 'A', value: 'a', color: 'red' });
    expect(color).toContain('SelectOptionSchema');
    expect(color).not.toContain('do not rely on it today');

    // `default`: a wrong-LAYER key, not a missing capability. The prescription
    // is the param's own `defaultValue`, one level up.
    expect(messageFor({ label: 'A', value: 'a', default: true })).toContain('defaultValue');

    // `icon`: declared nowhere — claiming it lives on `SelectOptionSchema`
    // would be the false-prescription class.
    const icon = messageFor({ label: 'A', value: 'a', icon: 'x' });
    expect(icon).toContain('no option shape in the spec declares');
    expect(icon).not.toContain('is a per-option key of a FIELD');
  });

  it('points the two rival spellings at the newly declared key', () => {
    for (const alias of ['visible', 'showWhen']) {
      const r = getMetadataTypeSchema('action')!.safeParse({
        ...gatedAction,
        params: [{
          name: 'severity',
          type: 'select' as const,
          options: [{ label: 'A', value: 'a', [alias]: "record.status == 'open'" }],
        }],
      });
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues)).toContain(`\`${alias}\` → \`visibleWhen\``);
    }
  });

  it('leaves the PARAM-level canonical spelling alone — `visibleWhen` there still means `visible`', () => {
    // The two surfaces have opposite canonical spellings on purpose (a param
    // gates itself with `visible`; an option gates itself with `visibleWhen`),
    // so opening the option key must not blur the one level up.
    const r = getMetadataTypeSchema('action')!.safeParse({
      ...gatedAction,
      params: [{ name: 'severity', type: 'text' as const, visibleWhen: 'features.x == true' }],
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('`visibleWhen` → `visible`');
  });
});
