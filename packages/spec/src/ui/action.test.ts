import { describe, it, expect } from 'vitest';
import { ActionSchema, ActionParamSchema, Action, type Action as ActionType, ACTION_LOCATIONS, ActionLocationSchema, type ActionLocation } from './action.zod';

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
        'global_nav',
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

// ============================================================================
// Protocol Improvement Tests: execute → target migration & target validation
// ============================================================================

describe('ActionSchema - execute → target migration', () => {
  it('should auto-migrate execute to target when target is not set', () => {
    const result = ActionSchema.parse({
      name: 'legacy_action',
      label: 'Legacy',
      type: 'script',
      execute: 'legacyHandler',
    });
    expect(result.target).toBe('legacyHandler');
  });

  it('should preserve target over execute when both are set', () => {
    const result = ActionSchema.parse({
      name: 'both_fields',
      label: 'Both',
      type: 'script',
      target: 'preferredHandler',
      execute: 'legacyHandler',
    });
    expect(result.target).toBe('preferredHandler');
  });

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

  it('should accept non-script types when execute is provided (auto-migrated)', () => {
    const result = ActionSchema.parse({
      name: 'flow_legacy',
      label: 'Flow Legacy',
      type: 'flow',
      execute: 'my_flow',
    });
    expect(result.target).toBe('my_flow');
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
      'global_nav',
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

  it('ActionSchema accepts a `locations: ActionLocation[]` field', () => {
    const all: ActionLocation[] = [...ACTION_LOCATIONS];
    const action = ActionSchema.parse({
      name: 'with_locations',
      label: 'With Locations',
      type: 'script',
      execute: 'true',
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
        execute: 'true',
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
    const action = ActionSchema.parse({ name: 'mark_done', label: 'Mark Done', type: 'script', execute: 'true' });
    expect(action.requiredPermissions).toBeUndefined();
  });
});
