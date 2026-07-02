import { describe, it, expect } from 'vitest';
import { ObjectSchema, ObjectCapabilities, IndexSchema, ObjectFieldGroupSchema, ObjectExternalBindingSchema, ObjectAccessConfigSchema, type ServiceObject } from './object.zod';

describe('ObjectCapabilities', () => {
  it('should apply default values correctly', () => {
    const result = ObjectCapabilities.parse({});
    
    expect(result.trackHistory).toBe(false);
    expect(result.searchable).toBe(true);
    expect(result.apiEnabled).toBe(true);
    expect(result.files).toBe(false);
    expect(result.feeds).toBe(false);
    expect(result.activities).toBe(false);
    expect(result.trash).toBe(true);
    expect(result.mru).toBe(true);
    expect(result.clone).toBe(true);
  });

  it('should accept custom capability values', () => {
    const capabilities = {
      trackHistory: true,
      searchable: false,
      apiEnabled: true,
      files: true,
      feeds: true,
      activities: false,
      trash: false,
      mru: true,
      clone: true,
    };

    const result = ObjectCapabilities.parse(capabilities);
    expect(result).toEqual(capabilities);
  });
});

describe('IndexSchema', () => {
  it('should accept basic index definition', () => {
    const index = {
      fields: ['email'],
    };

    expect(() => IndexSchema.parse(index)).not.toThrow();
  });

  it('should accept index with all properties', () => {
    const index = {
      name: 'idx_email_status',
      fields: ['email', 'status'],
      unique: true,
    };

    expect(() => IndexSchema.parse(index)).not.toThrow();
  });

  it('should accept composite index', () => {
    const index = {
      fields: ['tenant_id', 'created_at', 'status'],
      unique: false,
    };

    expect(() => IndexSchema.parse(index)).not.toThrow();
  });

  it('should reject index without fields', () => {
    expect(() => IndexSchema.parse({})).toThrow();
  });
});

describe('ObjectSchema', () => {
  describe('Basic Object Properties', () => {
    it('should accept minimal valid object', () => {
      const validObject: ServiceObject = {
        name: 'account',
        fields: {},
      };

      const result = ObjectSchema.safeParse(validObject);
      expect(result.success).toBe(true);
    });

    it('should enforce snake_case for object name', () => {
      const validNames = ['account', 'project_task', 'user_profile', '_system'];
      validNames.forEach(name => {
        expect(() => ObjectSchema.parse({ name, fields: {} })).not.toThrow();
      });

      const invalidNames = ['Account', 'project-task', 'UserProfile', '123object'];
      invalidNames.forEach(name => {
        expect(() => ObjectSchema.parse({ name, fields: {} })).toThrow();
      });
    });

    it('should apply default values', () => {
      const object = {
        name: 'test_object',
        fields: {},
      };

      const result = ObjectSchema.parse(object);
      expect(result.datasource).toBe('default');
      expect(result.isSystem).toBe(false);
    });
  });

  describe('Object with Fields', () => {
    it('should accept object with multiple fields', () => {
      const objectWithFields: ServiceObject = {
        name: 'contact',
        label: 'Contact',
        pluralLabel: 'Contacts',
        fields: {
          first_name: {
            label: 'First Name',
            type: 'text',
            required: true,
            maxLength: 50,
          },
          last_name: {
            label: 'Last Name',
            type: 'text',
            required: true,
            maxLength: 50,
          },
          email: {
            label: 'Email',
            type: 'email',
            unique: true,
          },
          phone: {
            label: 'Phone',
            type: 'phone',
          },
        },
      };

      expect(() => ObjectSchema.parse(objectWithFields)).not.toThrow();
    });

    it('should enforce snake_case for field names', () => {
      // Valid snake_case field names
      const validFieldNames = ['first_name', 'last_name', 'email', 'company_name', 'annual_revenue', '_system_id'];
      
      validFieldNames.forEach(fieldName => {
        const obj = {
          name: 'test_object',
          fields: {
            [fieldName]: {
              type: 'text' as const,
              label: 'Test Field',
            },
          },
        };
        expect(() => ObjectSchema.parse(obj)).not.toThrow();
      });
    });

    it('should reject PascalCase field names', () => {
      const invalidObject = {
        name: 'lead',
        fields: {
          FirstName: {
            type: 'text' as const,
            label: '名',
          },
        },
      };

      expect(() => ObjectSchema.parse(invalidObject)).toThrow();
      expect(() => ObjectSchema.parse(invalidObject)).toThrow(/Field names must be lowercase snake_case/);
    });

    it('should reject camelCase field names', () => {
      const invalidObject = {
        name: 'lead',
        fields: {
          firstName: {
            type: 'text' as const,
            label: 'First Name',
          },
        },
      };

      expect(() => ObjectSchema.parse(invalidObject)).toThrow();
      expect(() => ObjectSchema.parse(invalidObject)).toThrow(/Field names must be lowercase snake_case/);
    });

    it('should reject kebab-case field names', () => {
      const invalidObject = {
        name: 'lead',
        fields: {
          'first-name': {
            type: 'text' as const,
            label: 'First Name',
          },
        },
      };

      expect(() => ObjectSchema.parse(invalidObject)).toThrow();
      expect(() => ObjectSchema.parse(invalidObject)).toThrow(/Field names must be lowercase snake_case/);
    });

    it('should reject field names with spaces', () => {
      const invalidObject = {
        name: 'lead',
        fields: {
          'first name': {
            type: 'text' as const,
            label: 'First Name',
          },
        },
      };

      expect(() => ObjectSchema.parse(invalidObject)).toThrow();
      expect(() => ObjectSchema.parse(invalidObject)).toThrow(/Field names must be lowercase snake_case/);
    });

    it('should reject field names starting with numbers', () => {
      const invalidObject = {
        name: 'lead',
        fields: {
          '123field': {
            type: 'text' as const,
            label: 'Field',
          },
        },
      };

      expect(() => ObjectSchema.parse(invalidObject)).toThrow();
      expect(() => ObjectSchema.parse(invalidObject)).toThrow(/Field names must be lowercase snake_case/);
    });

    it('should reject mixed-case field names like in AI-generated objects', () => {
      // This is the exact problem from the issue
      const aiGeneratedObject = {
        name: 'lead',
        label: '线索',
        fields: {
          FirstName: {
            type: 'text' as const,
            label: '名',
            maxLength: 40,
          },
          LastName: {
            type: 'text' as const,
            label: '姓',
            required: true,
            maxLength: 80,
          },
          Company: {
            type: 'text' as const,
            label: '公司',
            required: true,
            maxLength: 255,
          },
        },
      };

      expect(() => ObjectSchema.parse(aiGeneratedObject)).toThrow();
      expect(() => ObjectSchema.parse(aiGeneratedObject)).toThrow(/Field names must be lowercase snake_case/);
    });
  });

  describe('Object Metadata', () => {
    it('should accept object with full metadata', () => {
      const fullObject: ServiceObject = {
        name: 'opportunity',
        label: 'Opportunity',
        pluralLabel: 'Opportunities',
        description: 'Sales opportunities tracking',
        icon: 'target',
        datasource: 'salesforce',
        isSystem: false,
        nameField: 'opportunity_name',
        fields: {
          opportunity_name: {
            label: 'Opportunity Name',
            type: 'text',
          },
        },
      };

      expect(() => ObjectSchema.parse(fullObject)).not.toThrow();
    });

    it('should accept object with field-level columnName for storage decoupling', () => {
      const object = ObjectSchema.parse({
        name: 'user',
        fields: {
          email: {
            type: 'email',
            columnName: 'email_address',
          },
          created_at: {
            type: 'datetime',
            columnName: 'createdAt',
          },
        },
      });

      expect(object.name).toBe('user');
      expect(object.fields.email.columnName).toBe('email_address');
      expect(object.fields.created_at.columnName).toBe('createdAt');
    });
  });

  describe('Object with Indexes', () => {
    it('should accept object with indexes', () => {
      const objectWithIndexes: ServiceObject = {
        name: 'user',
        fields: {
          email: {
            label: 'Email',
            type: 'email',
          },
          username: {
            label: 'Username',
            type: 'text',
          },
        },
        indexes: [
          {
            name: 'idx_email',
            fields: ['email'],
            unique: true,
          },
          {
            name: 'idx_username',
            fields: ['username'],
            unique: true,
          },
          {
            fields: ['email', 'username'],
          },
        ],
      };

      expect(() => ObjectSchema.parse(objectWithIndexes)).not.toThrow();
    });
  });

  describe('Object Capabilities', () => {
    it('should accept object with custom capabilities', () => {
      const objectWithCapabilities: ServiceObject = {
        name: 'case',
        fields: {},
        enable: {
          trackHistory: true,
          searchable: true,
          apiEnabled: true,
          files: true,
          feedEnabled: true,
          trash: true,
        },
      };

      expect(() => ObjectSchema.parse(objectWithCapabilities)).not.toThrow();
    });

    it('should merge default capabilities with custom values', () => {
      const object = {
        name: 'task',
        fields: {},
        enable: {
          trackHistory: true,
          files: true,
        },
      };

      const result = ObjectSchema.parse(object);
      expect(result.enable?.trackHistory).toBe(true);
      expect(result.enable?.files).toBe(true);
      expect(result.enable?.searchable).toBe(true); // default
      expect(result.enable?.apiEnabled).toBe(true); // default
    });
  });

  describe('Complete Real-World Examples', () => {
    it('should accept CRM Account object', () => {
      const accountObject: ServiceObject = {
        name: 'account',
        label: 'Account',
        pluralLabel: 'Accounts',
        description: 'Companies and organizations',
        icon: 'building-2',
        nameField: 'account_name',
        fields: {
          account_name: {
            label: 'Account Name',
            type: 'text',
            required: true,
            maxLength: 255,
          },
          account_number: {
            label: 'Account Number',
            type: 'text',
            unique: true,
            externalId: true,
          },
          website: {
            label: 'Website',
            type: 'url',
          },
          industry: {
            label: 'Industry',
            type: 'select',
            options: [
              { label: 'Technology', value: 'tech' },
              { label: 'Finance', value: 'finance' },
              { label: 'Healthcare', value: 'healthcare' },
            ],
          },
          annual_revenue: {
            label: 'Annual Revenue',
            type: 'currency',
            precision: 18,
            scale: 2,
          },
          owner_id: {
            label: 'Account Owner',
            type: 'lookup',
            reference: 'user',
          },
        },
        indexes: [
          {
            name: 'idx_account_number',
            fields: ['account_number'],
            unique: true,
          },
        ],
        enable: {
          trackHistory: true,
          searchable: true,
          apiEnabled: true,
          files: true,
          feedEnabled: true,
          trash: true,
        },
      };

      expect(() => ObjectSchema.parse(accountObject)).not.toThrow();
    });

    it('should accept Task object with parent relationship', () => {
      const taskObject: ServiceObject = {
        name: 'task',
        label: 'Task',
        pluralLabel: 'Tasks',
        icon: 'check-square',
        nameField: 'subject',
        fields: {
          subject: {
            label: 'Subject',
            type: 'text',
            required: true,
          },
          status: {
            label: 'Status',
            type: 'select',
            options: [
              { label: 'Not Started', value: 'not_started', default: true },
              { label: 'In Progress', value: 'in_progress' },
              { label: 'Completed', value: 'completed' },
            ],
          },
          priority: {
            label: 'Priority',
            type: 'select',
            options: [
              { label: 'Low', value: 'low', color: '#00FF00' },
              { label: 'Medium', value: 'medium', color: '#FFA500', default: true },
              { label: 'High', value: 'high', color: '#FF0000' },
            ],
          },
          environment_id: {
            label: 'Project',
            type: 'master_detail',
            reference: 'project',
            deleteBehavior: 'cascade',
          },
          assigned_to: {
            label: 'Assigned To',
            type: 'lookup',
            reference: 'user',
          },
          due_date: {
            label: 'Due Date',
            type: 'date',
          },
          completed_at: {
            label: 'Completed At',
            type: 'datetime',
          },
        },
        enable: {
          trackHistory: false,
          searchable: true,
          apiEnabled: true,
          files: false,
          feedEnabled: false,
          trash: true,
        },
      };

      expect(() => ObjectSchema.parse(taskObject)).not.toThrow();
    });

    // ADR-0020: record state machines are no longer a standalone
    // `object.stateMachines` map. They converge onto a single
    // `state_machine` validation rule on the object — a flat
    // field + transitions table enforced on the write path.
    it('should validate an object with a state_machine validation rule', () => {
      const objectWithState = {
        name: 'leave_request',
        fields: {
          status: { type: 'text' },
        },
        validations: [
          {
            type: 'state_machine',
            name: 'leave_flow',
            field: 'status',
            message: 'Invalid status transition.',
            transitions: {
              draft: ['pending'],
              pending: ['approved', 'draft'],
              approved: [],
            },
          },
        ],
      };

      const result = ObjectSchema.parse(objectWithState);
      const rule = result.validations!.find((v) => v.name === 'leave_flow');
      expect(rule).toBeDefined();
      expect(rule!.type).toBe('state_machine');
      expect((rule as { field: string }).field).toBe('status');
      expect((rule as { transitions: Record<string, string[]> }).transitions.draft).toEqual([
        'pending',
      ]);
    });

    it('should allow multiple state_machine rules over distinct fields', () => {
      const order = {
        name: 'order',
        fields: {
          status: { type: 'text' },
          payment_status: { type: 'text' },
        },
        validations: [
          {
            type: 'state_machine',
            name: 'lifecycle',
            field: 'status',
            message: 'Invalid status transition.',
            transitions: {
              draft: ['submitted'],
              submitted: ['confirmed'],
              confirmed: [],
            },
          },
          {
            type: 'state_machine',
            name: 'payment',
            field: 'payment_status',
            message: 'Invalid payment_status transition.',
            transitions: {
              unpaid: ['partial', 'paid'],
              partial: ['paid'],
              paid: [],
            },
          },
        ],
      };

      const result = ObjectSchema.parse(order);
      const machines = result.validations!.filter((v) => v.type === 'state_machine');
      expect(machines.map((m) => m.name)).toEqual(['lifecycle', 'payment']);
    });
  });
});

// ============================================================================
// Protocol Improvement Tests: displayNameField and recordName
// ============================================================================

describe('ObjectSchema - displayNameField', () => {
  it('should accept displayNameField', () => {
    const result = ObjectSchema.parse({
      name: 'ticket',
      fields: {
        title: { type: 'text' },
      },
      displayNameField: 'title',
    });
    expect(result.displayNameField).toBe('title');
  });

  it('should accept object without displayNameField (optional)', () => {
    const result = ObjectSchema.parse({
      name: 'ticket',
      fields: {
        name: { type: 'text' },
      },
    });
    expect(result.displayNameField).toBeUndefined();
  });

  // ADR-0079: `nameField` is the canonical pointer; `displayNameField` is a
  // deprecated alias that the schema maps onto `nameField` on parse.
  it('should accept the canonical nameField pointer', () => {
    const result = ObjectSchema.parse({
      name: 'ticket',
      fields: { title: { type: 'text' } },
      nameField: 'title',
    });
    expect(result.nameField).toBe('title');
  });

  it('should map deprecated displayNameField onto nameField (back-compat alias)', () => {
    const result = ObjectSchema.parse({
      name: 'ticket',
      fields: { title: { type: 'text' } },
      displayNameField: 'title',
    });
    expect(result.nameField).toBe('title');
    expect(result.displayNameField).toBe('title'); // preserved for cross-repo consumers
  });

  it('should map the alias through ObjectSchema.create() as well', () => {
    const result = ObjectSchema.create({
      name: 'ticket',
      fields: { title: { type: 'text' } },
      displayNameField: 'title',
    });
    expect(result.nameField).toBe('title');
  });

  it('explicit nameField takes precedence over displayNameField alias', () => {
    const result = ObjectSchema.parse({
      name: 'ticket',
      fields: { a: { type: 'text' }, b: { type: 'text' } },
      nameField: 'a',
      displayNameField: 'b',
    });
    expect(result.nameField).toBe('a');
  });
});

describe('ObjectSchema - recordName', () => {
  it('should accept recordName with autonumber config', () => {
    const result = ObjectSchema.parse({
      name: 'invoice',
      fields: {
        total: { type: 'number' },
      },
      recordName: {
        type: 'autonumber',
        displayFormat: 'INV-{YYYY}-{0000}',
        startNumber: 1,
      },
    });
    expect(result.recordName?.type).toBe('autonumber');
    expect(result.recordName?.displayFormat).toBe('INV-{YYYY}-{0000}');
    expect(result.recordName?.startNumber).toBe(1);
  });

  it('should accept recordName with text type', () => {
    const result = ObjectSchema.parse({
      name: 'account',
      fields: {
        name: { type: 'text' },
      },
      recordName: {
        type: 'text',
      },
    });
    expect(result.recordName?.type).toBe('text');
    expect(result.recordName?.displayFormat).toBeUndefined();
  });

  it('should accept object without recordName (optional)', () => {
    const result = ObjectSchema.parse({
      name: 'task',
      fields: {
        title: { type: 'text' },
      },
    });
    expect(result.recordName).toBeUndefined();
  });
});

describe('ObjectSchema.create()', () => {
  it('should auto-generate label from snake_case name', () => {
    const result = ObjectSchema.create({
      name: 'project_task',
      fields: {
        title: { type: 'text' },
      },
    });
    expect(result.label).toBe('Project Task');
  });

  it('should preserve explicitly provided label', () => {
    const result = ObjectSchema.create({
      name: 'project_task',
      label: 'My Custom Label',
      fields: {
        title: { type: 'text' },
      },
    });
    expect(result.label).toBe('My Custom Label');
  });

  it('should auto-generate label from single-word name', () => {
    const result = ObjectSchema.create({
      name: 'account',
      fields: {
        name: { type: 'text' },
      },
    });
    expect(result.label).toBe('Account');
  });

  it('should validate and apply defaults', () => {
    const result = ObjectSchema.create({
      name: 'task',
      fields: {
        title: { type: 'text' },
      },
    });
    expect(result.active).toBe(true);
    expect(result.isSystem).toBe(false);
    expect(result.abstract).toBe(false);
    expect(result.datasource).toBe('default');
  });

  it('should throw on invalid name format', () => {
    expect(() => ObjectSchema.create({
      name: 'InvalidName',
      fields: { title: { type: 'text' } },
    })).toThrow();
  });

  it('should throw on invalid field name format', () => {
    expect(() => ObjectSchema.create({
      name: 'task',
      fields: { InvalidField: { type: 'text' } },
    })).toThrow();
  });

  // ADR-0032 "no silent failure" for metadata shape (issue #1535): unknown
  // top-level keys used to be stripped silently, shipping dead metadata.
  describe('unknown-key rejection (#1535)', () => {
    it('rejects object-level `workflows` with guidance toward hooks/record_change', () => {
      expect(() => ObjectSchema.create({
        name: 'demo',
        fields: { status: { type: 'text' } },
        // @ts-expect-error — `workflows` is not an ObjectSchema field
        workflows: [{ name: 'stamp', triggerType: 'on_update', actions: [] }],
      })).toThrow(/workflows/);
    });

    it('error message points at the supported mechanism, not just "unknown key"', () => {
      let message = '';
      try {
        ObjectSchema.create({
          name: 'demo',
          fields: { status: { type: 'text' } },
          // @ts-expect-error — `workflows` is not an ObjectSchema field
          workflows: [],
        });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toContain('lifecycle hook');
      expect(message).toContain('record_change');
      expect(message).toContain('#1535');
    });

    it('suggests the intended key on a typo (`validation` → `validations`)', () => {
      expect(() => ObjectSchema.create({
        name: 'demo',
        fields: { status: { type: 'text' } },
        // @ts-expect-error — typo'd key
        validation: [],
      })).toThrow(/did you mean `validations`/);
    });

    it('does not strip — a supported key like `validations` still parses', () => {
      const obj = ObjectSchema.create({
        name: 'demo',
        fields: { status: { type: 'text' } },
        validations: [],
      });
      expect(obj.validations).toEqual([]);
    });
  });
});

// ============================================================================
// Namespace removal (D4) — Object identity is single-sourced on `name`.
// ============================================================================

describe('ObjectSchema name-as-identity', () => {
  it('does not surface a namespace property on parsed objects', () => {
    const result = ObjectSchema.safeParse({
      name: 'sys_user',
      fields: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).namespace).toBeUndefined();
    }
  });

  it('strips legacy `namespace` keys from input (deprecated, dropped in D4)', () => {
    const result = ObjectSchema.safeParse({
      namespace: 'sys',
      name: 'user',
      fields: {},
    } as Record<string, unknown>);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).namespace).toBeUndefined();
    }
  });

  it('accepts prefix-embedded names without any tableName field', () => {
    const obj = ObjectSchema.create({
      name: 'sys_user',
      fields: {},
    });
    expect(obj.name).toBe('sys_user');
    expect((obj as Record<string, unknown>).tableName).toBeUndefined();
    expect((obj as Record<string, unknown>).namespace).toBeUndefined();
  });
});

// =================================================================
// Field Groups (MVP) — metadata-layer protocol
// =================================================================

describe('ObjectFieldGroupSchema', () => {
  it('should accept a minimal group (key + label)', () => {
    const group = { key: 'contact_info', label: 'Contact Information' };
    const result = ObjectFieldGroupSchema.parse(group);
    expect(result.key).toBe('contact_info');
    expect(result.label).toBe('Contact Information');
    // collapse defaults to 'none' (ADR-0085)
    expect(result.collapse).toBe('none');
    expect(result.icon).toBeUndefined();
    expect(result.description).toBeUndefined();
  });

  it('should accept a fully-specified group', () => {
    const group = {
      key: 'billing',
      label: 'Billing',
      icon: 'credit-card',
      description: 'Billing and payment details',
      collapse: 'collapsed' as const,
    };
    const result = ObjectFieldGroupSchema.parse(group);
    expect(result).toEqual(group);
  });

  it('should reject an invalid collapse value', () => {
    expect(() =>
      ObjectFieldGroupSchema.parse({ key: 'billing', label: 'Billing', collapse: 'maybe' }),
    ).toThrow();
  });

  it('should reject missing key or label', () => {
    expect(() => ObjectFieldGroupSchema.parse({})).toThrow();
    expect(() => ObjectFieldGroupSchema.parse({ key: 'billing' })).toThrow();
    expect(() => ObjectFieldGroupSchema.parse({ label: 'Billing' })).toThrow();
  });

  it('should reject non-snake_case keys', () => {
    expect(() => ObjectFieldGroupSchema.parse({ key: 'Contact Info', label: 'x' })).toThrow();
    expect(() => ObjectFieldGroupSchema.parse({ key: 'contact-info', label: 'x' })).toThrow();
    expect(() => ObjectFieldGroupSchema.parse({ key: 'ContactInfo',  label: 'x' })).toThrow();
  });
});

// =================================================================
// Object-level semantic roles (ADR-0085)
// =================================================================

describe('ObjectSchema semantic roles (ADR-0085)', () => {
  it('accepts stageField as a string or literal false, rejects other values', () => {
    expect(ObjectSchema.parse({ name: 'lead', fields: {}, stageField: 'status' }).stageField).toBe('status');
    expect(ObjectSchema.parse({ name: 'lead', fields: {}, stageField: false }).stageField).toBe(false);
    expect(ObjectSchema.safeParse({ name: 'lead', fields: {}, stageField: true }).success).toBe(false);
    expect(ObjectSchema.safeParse({ name: 'lead', fields: {}, stageField: 3 }).success).toBe(false);
  });

  it('accepts highlightFields and aliases the deprecated compactLayout onto it', () => {
    const direct = ObjectSchema.parse({
      name: 'account', fields: {}, highlightFields: ['name', 'industry'],
    });
    expect(direct.highlightFields).toEqual(['name', 'industry']);
    // Transition mirror: old-key readers (current objectui) still see
    // compactLayout for metadata authored with the canonical name.
    expect(direct.compactLayout).toEqual(['name', 'industry']);

    const aliased = ObjectSchema.parse({
      name: 'account', fields: {}, compactLayout: ['name', 'industry'],
    });
    expect(aliased.highlightFields).toEqual(['name', 'industry']);
    // Deprecated key preserved on output (ADR-0079 alias pattern).
    expect(aliased.compactLayout).toEqual(['name', 'industry']);

    // Canonical key wins when both are present.
    const both = ObjectSchema.parse({
      name: 'account', fields: {}, highlightFields: ['a'], compactLayout: ['b'],
    });
    expect(both.highlightFields).toEqual(['a']);
  });

  it('rejects the removed detail UI-hints block at create()', () => {
    expect(() =>
      ObjectSchema.create({
        name: 'product',
        fields: {},
        // @ts-expect-error — `detail` was removed by ADR-0085
        detail: { hideReferenceRail: true },
      }),
    ).toThrow(/detail/);
  });

  it('strips the removed detail block on safeParse (no key on output)', () => {
    const result = ObjectSchema.safeParse({
      name: 'product', fields: {}, detail: { renderViaSchema: false },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).detail).toBeUndefined();
    }
  });
});

describe('ObjectSchema.fieldGroups', () => {
  it('should accept an object without fieldGroups (fully optional)', () => {
    const result = ObjectSchema.safeParse({
      name: 'account',
      fields: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fieldGroups).toBeUndefined();
    }
  });

  it('should preserve declaration order of fieldGroups (array order = display order)', () => {
    const result = ObjectSchema.parse({
      name: 'account',
      fields: {},
      fieldGroups: [
        { key: 'contact_info', label: 'Contact' },
        { key: 'billing',      label: 'Billing' },
        { key: 'system',       label: 'System'  },
      ],
    });
    expect(result.fieldGroups?.map(g => g.key)).toEqual([
      'contact_info', 'billing', 'system',
    ]);
  });

  it('should reject duplicate fieldGroup keys', () => {
    const result = ObjectSchema.safeParse({
      name: 'account',
      fields: {},
      fieldGroups: [
        { key: 'billing', label: 'Billing' },
        { key: 'billing', label: 'Billing Details' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('should allow Field.group to reference a declared group key', () => {
    const result = ObjectSchema.safeParse({
      name: 'account',
      fields: {
        email:   { type: 'email', group: 'contact_info' },
        phone:   { type: 'phone', group: 'contact_info' },
        vat_id:  { type: 'text',  group: 'billing'       },
        created: { type: 'datetime', group: 'system'     },
      },
      fieldGroups: [
        { key: 'contact_info', label: 'Contact Information' },
        { key: 'billing',      label: 'Billing'             },
        { key: 'system',       label: 'System'              },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('ObjectSchema.create() should accept fieldGroups and preserve them', () => {
    const obj = ObjectSchema.create({
      name: 'project_task',
      fields: {
        title:  { type: 'text' },
        status: { type: 'text', group: 'workflow' },
      },
      fieldGroups: [
        { key: 'workflow', label: 'Workflow', icon: 'workflow' },
      ],
    });
    expect(obj.fieldGroups).toEqual([
      { key: 'workflow', label: 'Workflow', icon: 'workflow', collapse: 'none' },
    ]);
  });

  // ADR-0085: deprecated collapse aliases normalize onto the enum at parse.
  it('maps deprecated defaultExpanded / collapsible+collapsed onto collapse', () => {
    const parsed = ObjectSchema.parse({
      name: 'account',
      fields: { a: { type: 'text', group: 'g1' } },
      fieldGroups: [
        { key: 'g1', label: 'G1', defaultExpanded: false },
        { key: 'g2', label: 'G2', collapsible: true, collapsed: true },
        { key: 'g3', label: 'G3', collapsible: true },
        { key: 'g4', label: 'G4', collapse: 'none', collapsed: true }, // canonical wins
      ],
    });
    expect(parsed.fieldGroups?.map((g) => g.collapse)).toEqual([
      'collapsed', 'collapsed', 'expanded', 'none',
    ]);
    // Deprecated keys are preserved on output (cross-repo back-compat).
    expect(parsed.fieldGroups?.[0].defaultExpanded).toBe(false);
  });

  describe('External Binding (ADR-0015)', () => {
    it('should leave external undefined by default', () => {
      const obj = ObjectSchema.parse({ name: 'account', fields: {} });
      expect(obj.external).toBeUndefined();
    });

    it('should accept a minimal external binding and default writable to false', () => {
      const obj = ObjectSchema.parse({
        name: 'wh_order',
        datasource: 'warehouse',
        external: { remoteSchema: 'mart', remoteName: 'fact_orders' },
        fields: { order_id: { type: 'text' } },
      });
      expect(obj.external?.remoteSchema).toBe('mart');
      expect(obj.external?.remoteName).toBe('fact_orders');
      expect(obj.external?.writable).toBe(false);
    });

    it('should accept a full external binding with column map and opt-in write', () => {
      const binding = ObjectExternalBindingSchema.parse({
        remoteName: 'fact_orders',
        remoteSchema: 'mart',
        writable: true,
        columnMap: { ORDER_ID: 'order_id', CUST_ID: 'customer_id' },
        introspectedAt: '2026-05-30T00:00:00.000Z',
        ignoreColumns: ['_etl_loaded_at'],
      });
      expect(binding.writable).toBe(true);
      expect(binding.columnMap?.ORDER_ID).toBe('order_id');
      expect(binding.ignoreColumns).toEqual(['_etl_loaded_at']);
    });

    it('should reject a non-datetime introspectedAt', () => {
      expect(() =>
        ObjectExternalBindingSchema.parse({ introspectedAt: 'yesterday' }),
      ).toThrow();
    });
  });
});


describe('ADR-0066 — object access posture (D2) + requiredPermissions (D3)', () => {
  it('ObjectAccessConfigSchema defaults to public', () => {
    expect(ObjectAccessConfigSchema.parse({}).default).toBe('public');
  });

  it('accepts an explicit private posture', () => {
    expect(ObjectAccessConfigSchema.parse({ default: 'private' }).default).toBe('private');
  });

  it('rejects an unknown posture value', () => {
    expect(() => ObjectAccessConfigSchema.parse({ default: 'secret' })).toThrow();
  });

  it('round-trips access + requiredPermissions on an object', () => {
    const obj = ObjectSchema.create({
      name: 'sys_license',
      tenancy: { enabled: false, strategy: 'shared' },
      access: { default: 'private' },
      requiredPermissions: ['manage_licenses'],
      fields: { signed_token: { type: 'text' } },
    });
    expect(obj.access?.default).toBe('private');
    expect(obj.requiredPermissions).toEqual(['manage_licenses']);
  });

  it('leaves access undefined (public by convention) when omitted', () => {
    const obj = ObjectSchema.create({
      name: 'crm_account',
      fields: { name: { type: 'text' } },
    });
    expect(obj.access).toBeUndefined();
    expect(obj.requiredPermissions).toBeUndefined();
  });
});
