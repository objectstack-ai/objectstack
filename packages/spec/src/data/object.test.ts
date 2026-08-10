import { describe, it, expect, vi, afterEach } from 'vitest';
// Fixtures below are AUTHORED objects — what a developer writes before the
// schema applies its defaults — so they are annotated with `ServiceObject`
// (`z.input`), not `ServiceObject` (`z.infer`, defaults already materialised).
// Under `z.infer` every fixture owes `isSystem`, `datasource`, `searchable`,
// `activities`, … and the annotation stops being a contract check at all. This
// only became visible when tsconfig.test.json put these files in front of tsc
// (#5286).
import { ObjectSchema, ObjectCapabilities, IndexSchema, ObjectFieldGroupSchema, ObjectExternalBindingSchema, ObjectAccessConfigSchema, LifecycleSchema, TenancyConfigSchema, isTenancyDisabled, resolveCrudAffordances, type ServiceObject } from './object.zod';
import { resolveInjectedSystemColumns } from './injected-system-columns';
import type { StateMachineValidation } from './validation.zod';

describe('ObjectCapabilities', () => {
  it('should apply default values correctly', () => {
    const result = ObjectCapabilities.parse({});
    
    expect(result.trackHistory).toBe(false);
    expect(result.searchable).toBe(true);
    expect(result.apiEnabled).toBe(true);
    expect(result.files).toBe(false);
    // feeds/activities are opt-OUT capabilities (#2707): default on, consumers
    // gate on explicit `false` only — same posture as clone.
    expect(result.feeds).toBe(true);
    expect(result.activities).toBe(true);
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
      clone: true,
    };

    const result = ObjectCapabilities.parse(capabilities);
    expect(result).toEqual(capabilities);
  });

  // #2377/#3207 (ADR-0049): `trash`/`mru` parsed-but-did-nothing for years —
  // the retired keys must fail loudly with the upgrade prescription, not strip
  // silently (#1535; pattern of the tenancy tombstones, #2763).
  it('rejects the retired trash/mru flags with upgrade guidance', () => {
    for (const key of ['trash', 'mru'] as const) {
      const result = ObjectCapabilities.safeParse({ [key]: true });
      expect(result.success).toBe(false);
      const message = result.success ? '' : result.error.issues.map((i) => i.message).join('\n');
      expect(message).toContain(`\`${key}\``);
      expect(message).toContain('#2377');
      // The prescription names the source rewrite (the #3207 conversion).
      expect(message).toContain('os migrate meta --from 16');
    }
    // `trash` additionally points at the parked soft-delete issue — the
    // parking spot the 2026-08-02 #3207 ruling designates (#1893, the old
    // pointer, closed 2026-07-24).
    const trash = ObjectCapabilities.safeParse({ trash: false });
    expect(trash.success).toBe(false);
    const trashMsg = trash.success ? '' : trash.error.issues.map((i) => i.message).join('\n');
    expect(trashMsg).toContain('#3146');
    expect(trashMsg).not.toContain('#1893');
  });

  it('rejects unknown capability keys instead of stripping them', () => {
    const result = ObjectCapabilities.safeParse({ feedEnabled: true });
    expect(result.success).toBe(false);
  });

  // ── #6805 — the map folded into the shared `strictObject` template ────────
  // `strictCapabilitiesError` was a hand-written `$ZodErrorMap`, so
  // `CAPABILITIES_RETIRED_KEY_GUIDANCE` registered in no registry and nothing
  // judged it. Acceptance did not move (every case above is unchanged); these
  // pin the assembly the template brings.

  const capabilityRejection = (body: Record<string, unknown>): string => {
    const result = ObjectCapabilities.safeParse(body);
    expect(result.success).toBe(false);
    return result.success ? '' : result.error.issues.map((i) => i.message).join('\n');
  };

  it.each([
    ['searchible', 'searchable'],
    ['trackHistroy', 'trackHistory'],
    ['clon', 'clone'],
    ['feed', 'feeds'],
  ])('a near-miss `%s` now gets the rename channel, not just "not an `enable` capability flag"', (written, canonical) => {
    const message = capabilityRejection({ [written]: true });
    expect(message).toContain(`\`${written}\` → \`${canonical}\``);
    expect(message).not.toContain('is not an `enable` capability flag');
  });

  it('a key beyond edit distance is still named, with no misleading suggestion', () => {
    const message = capabilityRejection({ feedEnabled: true });
    expect(message).toContain('`feedEnabled`');
    expect(message).not.toContain('Did you mean');
  });

  it('emission order: which key is wrong → the fix → the history, last (#5955)', () => {
    const message = capabilityRejection({ trash: false, searchible: true });
    const preamble = 'Unrecognized key(s) on `enable`:';
    const fix = 'os migrate meta --from 16';
    const history = 'every flag carries an enforcement contract (#2707)';

    expect(message.startsWith(preamble)).toBe(true);
    expect(message.indexOf(fix)).toBeGreaterThan(message.indexOf(preamble));
    expect(message.indexOf(history)).toBeGreaterThan(message.indexOf(fix));
    expect(message.trimEnd().endsWith(`${history}.`)).toBe(true);
    expect(message.split(history)).toHaveLength(2);
  });

  it('the tombstone text survives the fold byte-for-byte', () => {
    expect(capabilityRejection({ mru: true })).toContain(
      '`enable.mru` was removed from @objectstack/spec in the 16.x line (#2377/#3207, '
      + 'ADR-0049) — Most-Recently-Used tracking was never implemented; no reader '
      + 'existed, so the flag changed nothing.',
    );
  });
});

describe('LifecycleSchema (ADR-0057)', () => {
  it('accepts the ADR §3.2 telemetry rotation shape', () => {
    const result = LifecycleSchema.safeParse({
      class: 'telemetry',
      retention: { maxAge: '14d' },
      storage: { strategy: 'rotation', shards: 14, unit: 'day' },
      reclaim: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts the ADR §3.2 audit archive-then-delete shape', () => {
    const result = LifecycleSchema.safeParse({
      class: 'audit',
      retention: { maxAge: '90d' },
      archive: { after: '90d', to: 'datalake', keep: '7y' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts the ADR §3.2 transient ttl shape', () => {
    const result = LifecycleSchema.safeParse({
      class: 'transient',
      ttl: { field: 'created_at', expireAfter: '7d' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a bare record class (permanent, no policies)', () => {
    expect(LifecycleSchema.safeParse({ class: 'record' }).success).toBe(true);
  });

  it('rejects a non-record class with no bounding policy (§3.5 enforce-or-remove)', () => {
    for (const cls of ['audit', 'telemetry', 'transient', 'event'] as const) {
      const result = LifecycleSchema.safeParse({ class: cls });
      expect(result.success).toBe(false);
    }
  });

  it('rejects retention/ttl/storage/archive on a record class', () => {
    const result = LifecycleSchema.safeParse({
      class: 'record',
      retention: { maxAge: '30d' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an archive window that does not start where the hot window ends', () => {
    const result = LifecycleSchema.safeParse({
      class: 'audit',
      retention: { maxAge: '90d' },
      archive: { after: '30d', to: 'datalake' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects malformed duration literals', () => {
    for (const bad of ['14', 'd14', '14 days', '2mo', '-3d', '1.5d']) {
      const result = LifecycleSchema.safeParse({
        class: 'telemetry',
        retention: { maxAge: bad },
      });
      expect(result.success).toBe(false);
    }
  });

  it('accepts retention.onlyWhen with scalar and $in predicates (#2834 mixed tables)', () => {
    const result = LifecycleSchema.safeParse({
      class: 'telemetry',
      retention: {
        maxAge: '30d',
        onlyWhen: { status: { $in: ['completed', 'failed'] }, archived: true },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects onlyWhen operators other than $in and empty $in lists', () => {
    for (const bad of [
      { status: { $nin: ['paused'] } }, // unsupported operator
      { status: { $in: [] } }, // empty list matches nothing — surely a mistake
      { status: { $in: ['a'], extra: 1 } }, // strict object: no extra keys
    ]) {
      const result = LifecycleSchema.safeParse({
        class: 'telemetry',
        retention: { maxAge: '30d', onlyWhen: bad },
      });
      expect(result.success).toBe(false);
    }
  });

  it('rejects onlyWhen combined with rotation storage (shard DROPs ignore filters)', () => {
    const result = LifecycleSchema.safeParse({
      class: 'telemetry',
      retention: { maxAge: '14d', onlyWhen: { status: 'done' } },
      storage: { strategy: 'rotation', shards: 14, unit: 'day' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects onlyWhen combined with archive (the Archiver moves rows by age alone)', () => {
    const result = LifecycleSchema.safeParse({
      class: 'audit',
      retention: { maxAge: '90d', onlyWhen: { status: 'done' } },
      archive: { after: '90d', to: 'datalake' },
    });
    expect(result.success).toBe(false);
  });

  it('is accepted as an object-level property by ObjectSchema.create', () => {
    const obj = ObjectSchema.create({
      name: 'my_trace',
      fields: {},
      lifecycle: {
        class: 'telemetry',
        retention: { maxAge: '14d' },
      },
    });
    expect(obj.lifecycle?.class).toBe('telemetry');
    expect(obj.lifecycle?.retention?.maxAge).toBe('14d');
  });

  it('objects without a lifecycle block stay back-compatible (undefined = record semantics)', () => {
    const obj = ObjectSchema.create({ name: 'plain_object', fields: {} });
    expect(obj.lifecycle).toBeUndefined();
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

/**
 * `indexes[].type` / `indexes[].partial` retirement (#5248, #4943, ADR-0049).
 *
 * Both were authorable with zero DDL consumers. `IndexSchema` is not
 * `.strict()`, so a plain delete would have Zod strip an authored value in
 * silence — swapping one no-op for another (#3726 / #3733, the ADR-0104
 * class). The tombstone is what makes the removal audible, so these tests pin
 * the PRESCRIPTION, not merely the rejection.
 */
describe('IndexSchema retired keys (#5248 / #4943)', () => {
  it('REJECTS `type`, with the fix and the reason in the message', () => {
    expect(() => IndexSchema.parse({ fields: ['tags'], type: 'gin' }))
      .toThrow(/`indexes\[\]\.type` was removed.*no driver ever read it.*Delete the key/s);
  });

  it('REJECTS `partial`, naming the database-layer replacement', () => {
    expect(() => IndexSchema.parse({ fields: ['name'], partial: "state = 'active'" }))
      .toThrow(/`indexes\[\]\.partial` was removed.*Delete the key.*CREATE \[UNIQUE\] INDEX/s);
  });

  it('points at the CLI conversion rather than naming the conversion id', () => {
    for (const bad of [{ fields: ['a'], type: 'btree' }, { fields: ['a'], partial: 'x' }]) {
      expect(() => IndexSchema.parse(bad)).toThrow(/os migrate meta --from 16/);
    }
  });

  it('the live keys are untouched — the retirement is surgical', () => {
    const parsed = IndexSchema.parse({
      name: 'idx_invoice_no',
      fields: ['invoice_no'],
      unique: 'organization',
    });
    expect(parsed).toEqual({ name: 'idx_invoice_no', fields: ['invoice_no'], unique: 'organization' });
  });

  it('no longer materializes a phantom `btree` into every parsed index', () => {
    // The louder half of the defect: `type` carried `.default('btree')`, so an
    // access-method knob nothing has ever read appeared in the parse output of
    // every index of every object (it was pinned in service-realtime's
    // sys_presence test, on an object that never declared it).
    const parsed = IndexSchema.parse({ fields: ['email'] });
    expect(parsed).not.toHaveProperty('type');
    expect(parsed).not.toHaveProperty('partial');
    expect(parsed).toEqual({ fields: ['email'], unique: false });
  });

  it('rejects the retired keys through a whole object too, not just the sub-schema', () => {
    expect(() => ObjectSchema.parse({
      name: 'crm_invoice',
      label: 'Invoice',
      fields: { name: { type: 'text', label: 'Name' } },
      indexes: [{ fields: ['name'], partial: "state = 'active'" }],
    })).toThrow(/`indexes\[\]\.partial` was removed/s);
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
          feeds: true,
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
          feeds: true,
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
          feeds: false,
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
      // `validations` is typed as the open `BaseValidationRuleShape` (index
      // signature, see validation.zod.ts) — the discriminated union does the
      // real rejecting at parse time. Narrow to the member this test is about
      // instead of asserting through a shape that does not overlap it.
      const rule = result.validations!.find((v) => v.name === 'leave_flow') as
        | StateMachineValidation
        | undefined;
      expect(rule).toBeDefined();
      expect(rule!.type).toBe('state_machine');
      expect(rule!.field).toBe('status');
      expect(rule!.transitions.draft).toEqual(['pending']);
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
// Protocol Improvement Tests: displayNameField / nameField
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
    expect(result.isSystem).toBe(false);
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

  // #3175 — `ownership` (record-ownership model) is now a declared field.
  // Before, the registry read it via `(schema as any).ownership` while
  // ObjectSchema.create() rejected it as an unknown key; these lock the two ends
  // together.
  describe('ownership record-model field (#3175)', () => {
    it('accepts the record-ownership opt-out values the registry reads', () => {
      for (const ownership of ['user', 'business_unit', 'org', 'none'] as const) {
        const obj = ObjectSchema.create({ name: 'catalog', ownership, fields: { title: { type: 'text' } } });
        expect(obj.ownership).toBe(ownership);
      }
    });

    it('leaves ownership undefined when omitted (registry defaults to user-owned)', () => {
      const obj = ObjectSchema.create({ name: 'lead', fields: { title: { type: 'text' } } });
      expect(obj.ownership).toBeUndefined();
    });

    it('rejects the retired `own`/`extend` contribution-kind value with guidance', () => {
      expect(() => ObjectSchema.create({
        name: 'demo',
        // @ts-expect-error — 'own' is the package-contribution kind, not a record-ownership value
        ownership: 'own',
        fields: { title: { type: 'text' } },
      })).toThrow(/record-ownership model|registerObject/);
    });

    // [#4611 → #5678 / ADR-0117 D1] The REWRITTEN #4611 pin — direction flipped.
    //
    // History, because the flip is the point and a reader who only sees the
    // current assertions will re-derive the wrong rule. #4611 pinned the
    // OPPOSITE: `ownership: 'business_unit'` REJECTED, and the rejection message
    // enumerating exactly three legal values. That pin was correct for its
    // window and it named its own expiry — "when #5678 arrives, this test
    // failing is the intended signal to REWRITE it (not to delete the guard)".
    // This is that rewrite.
    //
    // The ordering the two pins encode, end to end:
    //   #4611  — enum has 3 values; `applySystemFields` used a DENY-list
    //            (`ownership !== 'org' && ownership !== 'none'`), so a fourth
    //            value would have been stamped `owner_id` — the exact INVERSE of
    //            D1's table. Rejecting it was the honest answer.
    //   #5677  — flipped the judgement to an ALLOW-list in
    //            `packages/objectql/src/registry.ts` and the shared derivation
    //            `resolveInjectedSystemColumns` (`./injected-system-columns.ts`).
    //            The engine now implements D1's `business_unit` row correctly.
    //   #5678  — THIS change: the acceptance surface catches up. Strictly after
    //            #5677, never before — a tier the schema emits before the engine
    //            honours it gets the inverse result on its first appearance.
    //
    // What this pin now guards, and why each half is here:
    //   • the fourth value is ACCEPTED — the D1 declaration surface exists;
    //   • it resolves to D1's row (`owner_id` ❌ / `owning_business_unit_id` ✅)
    //     asserted against the injection AUTHORITY, not against prose, so the
    //     enum member cannot drift away from what the engine does with it;
    //   • a FIFTH value is still rejected, and the rejection enumerates all four
    //     legal values — that enumeration is what tells an author (or an AI)
    //     what to write instead, and it is the half that silently rots when a
    //     later tier is added to the enum without updating the message.
    //
    // Still deliberately ABSENT: anything about the D2 stamping policy, the D4
    // transfer guard, D5 legal-entity resolution or the D8 enablement gate.
    // Those four remain undecided in ADR-0117 (Accepted D1/D3 scoped only); the
    // column stays provisioned-but-inert, so an object declaring this tier gets
    // the COLUMN today and no value in it. Do not read acceptance here as a
    // decision on any of them.
    it('accepts `business_unit` and resolves it to D1s row — owner_id withheld, unit anchor injected (#4611 → #5678)', () => {
      const obj = ObjectSchema.create({
        name: 'inventory_item',
        ownership: 'business_unit',
        fields: { sku: { type: 'text' } },
      });
      expect(obj.ownership).toBe('business_unit');

      // The declaration must mean what D1's table says it means. Asserted
      // against `resolveInjectedSystemColumns` — the single derivation both
      // `applySystemFields` and author-time lint consume.
      const plan = resolveInjectedSystemColumns(obj);
      expect(plan.owner, 'business_unit is owned by a UNIT, not a person').toBe(false);
      expect(plan.owningBusinessUnit).toBe(true);
      expect(plan.names.has('owner_id')).toBe(false);
      expect(plan.names.has('owning_business_unit_id')).toBe(true);
    });

    it('still rejects a fifth value, and the rejection enumerates all four legal values (#4611 → #5678)', () => {
      let message = '';
      try {
        ObjectSchema.create({
          name: 'inventory_item',
          // @ts-expect-error — 'team' is not an ADR-0117 tier; the enum has exactly four members
          ownership: 'team',
          fields: { sku: { type: 'text' } },
        });
        throw new Error('expected ObjectSchema.create to reject ownership: team');
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }

      expect(message).not.toContain('expected ObjectSchema.create to reject');
      for (const legal of ['user', 'business_unit', 'org', 'none']) {
        expect(message, `rejection should enumerate the legal value '${legal}'`).toContain(legal);
      }
      expect(message).not.toBe('');
    });
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

    // #4990 note 1 asked whether this file's own `suggestKey` shares the
    // camelCase weakness that `findClosestMatches` had. It does NOT: it already
    // lowercases BOTH sides (`editDistance(unknown.toLowerCase(),
    // key.toLowerCase())`), so a declared key's capitals were never charged to
    // the author here. Pinning it means the two suggesters cannot drift apart
    // again — this is the property #4990 fixed in the other one.
    it('suggestKey judges a typo identically in either case (#4990 note 1)', () => {
      const bullet = (key: string): string => {
        try {
          ObjectSchema.create({
            name: 'demo',
            fields: {},
            [key]: 1,
          } as Record<string, unknown> as Parameters<typeof ObjectSchema.create>[0]);
        } catch (e) {
          return ((e as Error).message.split('\n').find((l) => l.trim().startsWith('•')) ?? '').trim();
        }
        throw new Error(`expected ObjectSchema.create to reject \`${key}\``);
      };
      // A camelCase key the fallback CAN reach, and its all-lowercase twin:
      // both must land on the same canonical key.
      expect(bullet('nameFeild')).toContain('did you mean `nameField`');
      expect(bullet('namefeild')).toContain('did you mean `nameField`');
      // And one it cannot reach — the verdict must again not depend on case.
      expect(bullet('primaryFeild')).not.toContain('did you mean');
      expect(bullet('primaryfeild')).not.toContain('did you mean');
    });

    // Tombstones: a RETIRED key's rejection must carry the upgrade
    // prescription — the compile/validation error is the one channel every
    // upgrading consumer (human or agent) is guaranteed to hit.
    it('tombstone: retired compactLayout names its replacement and versions', () => {
      let message = '';
      try {
        ObjectSchema.create({
          name: 'demo',
          fields: {},
          // @ts-expect-error — compactLayout was retired (#2536)
          compactLayout: ['name'],
        });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toContain('highlightFields');
      expect(message).toContain('11.7.0');
      expect(message).toContain('#2536');
    });

    it('tombstone: dead metadata keys removed in 16.0 (#2377) carry upgrade guidance', () => {
      const cases: Array<[string, unknown, string]> = [
        ['versioning', { enabled: true }, 'trackHistory'],
        ['softDelete', { enabled: true }, 'hard deletes'],
        ['search', { fields: ['name'] }, 'searchableFields'],
        ['recordName', { type: 'autonumber' }, 'autonumber'],
        ['keyPrefix', 'ACC', 'no effect'],
      ];
      for (const [key, value, needle] of cases) {
        let message = '';
        try {
          ObjectSchema.create({
            name: 'demo',
            fields: { status: { type: 'text' } },
            [key]: value,
          } as Record<string, unknown> as Parameters<typeof ObjectSchema.create>[0]);
        } catch (e) {
          message = (e as Error).message;
        }
        expect(message, `${key} should be rejected`).toContain(key);
        expect(message, `${key} should cite #2377`).toContain('#2377');
        expect(message, `${key} should hint at the replacement`).toContain(needle);
      }
    });

    it('tombstone: removed detail block routes each job to its semantic role', () => {
      let message = '';
      try {
        ObjectSchema.create({
          name: 'demo',
          fields: {},
          // @ts-expect-error — the detail block was removed (ADR-0085)
          detail: { stageField: 'status' },
        });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toContain('stageField');
      expect(message).toContain('highlightFields');
      expect(message).toContain('fieldGroups');
      expect(message).toContain('ADR-0085');
    });

    it('tombstone: object-level views dialect points at semantic roles + listViews', () => {
      let message = '';
      try {
        ObjectSchema.create({
          name: 'demo',
          fields: {},
          // @ts-expect-error — object-level views.* was never a spec key
          views: { form: { sections: [] } },
        });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toContain('listViews');
      expect(message).toContain('ADR-0085');
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

  it('REJECTS legacy `namespace` with the prefix-embedding fix (ADR-0006 D4)', () => {
    // Until #4001 closed this shape on the parse path, this key was stripped in
    // silence — so an object written as `{ namespace: 'sys', name: 'user' }`
    // shipped as plain `user`, under a name its author never intended. The test
    // that stood here asserted that strip as correct behaviour.
    const result = ObjectSchema.safeParse({
      namespace: 'sys',
      name: 'user',
      fields: {},
    } as Record<string, unknown>);
    expect(result.success).toBe(false);
    const message = result.success ? '' : result.error.issues[0].message;
    expect(message).toContain('`namespace`');
    expect(message).toContain('name: "sys_user"');
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

  it('accepts highlightFields; the retired compactLayout alias no longer parses through (framework#2536)', () => {
    const direct = ObjectSchema.parse({
      name: 'account', fields: {}, highlightFields: ['name', 'industry'],
    });
    expect(direct.highlightFields).toEqual(['name', 'industry']);
    // The transition mirror is gone: output carries the canonical key only.
    expect((direct as Record<string, unknown>).compactLayout).toBeUndefined();

    // The parse path REJECTS the retired key and carries the rename (#4001).
    // It used to strip it, so an old-key author got no highlightFields and no
    // diagnostic — the outcome this test previously pinned as correct.
    const legacy = ObjectSchema.safeParse({
      name: 'account', fields: {}, compactLayout: ['name', 'industry'],
    });
    expect(legacy.success).toBe(false);
    expect(legacy.success ? '' : legacy.error.issues[0].message)
      .toContain('`compactLayout` was renamed to `highlightFields`');

    // Authoring path: create() REJECTS the retired key like any unknown key.
    expect(() =>
      ObjectSchema.create({
        name: 'account',
        fields: {},
        // @ts-expect-error — compactLayout was retired by framework#2536
        compactLayout: ['name'],
      }),
    ).toThrow(/compactLayout/);
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

  it('REJECTS the removed detail block, carrying the ADR-0085 re-home map', () => {
    const result = ObjectSchema.safeParse({
      name: 'product', fields: {}, detail: { renderViaSchema: false },
    });
    expect(result.success).toBe(false);
    expect(result.success ? '' : result.error.issues[0].message)
      .toContain('`detail` UI-hints block was removed by ADR-0085');
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
      tenancy: { enabled: false },
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

describe('TenancyConfigSchema — #2763 strategy/crossTenantAccess removal', () => {
  it('accepts the two live knobs and materializes NO tenantField default (#5315)', () => {
    // An undeclared tenant column stays undeclared. The old `.default('tenant_id')`
    // invented a column name the platform does not use and no consumer could act
    // on — the effective column is resolved by the driver, which falls back to
    // `organization_id`. Parsing must not put words in the author's mouth.
    const result = TenancyConfigSchema.parse({ enabled: true });
    expect(result.enabled).toBe(true);
    expect(result.tenantField).toBeUndefined();
    expect(result).toEqual({ enabled: true });
    expect('tenantField' in result).toBe(false);

    // An explicitly declared column still round-trips untouched.
    expect(TenancyConfigSchema.parse({ enabled: false, tenantField: 'workspace_id' }))
      .toEqual({ enabled: false, tenantField: 'workspace_id' });
  });

  it('rejects the retired `strategy` with a tombstone pointing at the two real modes', () => {
    const result = TenancyConfigSchema.safeParse({ enabled: true, strategy: 'isolated' });
    expect(result.success).toBe(false);
    const message = result.error!.issues.map((i) => i.message).join('\n');
    expect(message).toContain('removed from @objectstack/spec after v15.0 (#2763)');
    expect(message).toContain('environment/deployment');
    expect(message).toContain('`tenancy.enabled` + `tenancy.tenantField`');
  });

  it('rejects the retired `crossTenantAccess` with a tombstone pointing at sharing/OWD', () => {
    const result = TenancyConfigSchema.safeParse({ enabled: true, crossTenantAccess: true });
    expect(result.success).toBe(false);
    const message = result.error!.issues.map((i) => i.message).join('\n');
    expect(message).toContain('crossTenantAccess');
    expect(message).toContain('ADR-0056');
    expect(message).toContain('externalSharingModel');
  });

  it('rejects arbitrary unknown tenancy keys instead of silently stripping them (#1535)', () => {
    // Truly arbitrary — no tombstone, no near-declared-key. Rejected with the
    // surface named; there is nothing more the message can honestly offer.
    const result = TenancyConfigSchema.safeParse({ enabled: true, zzNotAKey: 1 });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.message).join('\n'))
      .toContain('Unrecognized key(s) on `tenancy`: `zzNotAKey`');
  });

  it('a near-miss of a live key gets the template rename, not a dead-end verdict (#6619)', () => {
    // While the map was hand-written, `tenantfield` was answered with
    // "`tenantfield` is not a `tenancy` key." — a verdict that names the
    // problem and never the fix. The fold onto `strictObject` brought the
    // edit-distance channel with it: the same input now points at the key the
    // author meant. A deliberate byte change, recorded as such.
    const result = TenancyConfigSchema.safeParse({ enabled: true, tenantfield: 'org_id' });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.message).join('\n'))
      .toContain('Did you mean `tenantfield` → `tenantField`?');
  });

  it('rejects a retired key on ObjectSchema.create() (the authoring entrypoint)', () => {
    expect(() =>
      ObjectSchema.create({
        name: 'sys_license',
        tenancy: { enabled: false, strategy: 'shared' } as never,
        fields: { name: { type: 'text' } },
      }),
    ).toThrow(/removed from @objectstack\/spec after v15\.0/);
  });
});

/**
 * Message ORDER on the `tenancy` unknown-key rejection (#6416, applying
 * #5955's ruling; #6619 folded the map into the shared template).
 *
 * Written against `strictTenancyError`, the hand-written `$ZodErrorMap` that
 * neither #5955 nor #5593 could reach; #6416 direction 1 reordered it in place
 * with these pins as acceptance criteria, and #6619 folded it into
 * `strictObject` — the tombstones as exact `guidance` entries, the standing
 * two-modes explainer in the template's `history` slot (which is the slot for
 * "the sentence that must come LAST"). The pins migrated with the code: the
 * ORDER contract (front matter → fix channels → explainer last) is now the
 * template's own. Two byte-level changes rode the fold, pinned below:
 *
 * - a near-miss of a live key (`tenantfield`) gets the template's rename in
 *   the front matter instead of the dead-end "`x` is not a `tenancy` key."
 *   bullet the hand-written map emitted;
 * - a key with no fix at all gets NO bullet — the front matter plus the
 *   explainer carry everything the old catch-all bullet said.
 *
 * ORDER pins, not presence checks. Every `toContain` in the block above stays
 * green under either order — that is exactly why they cannot carry this fact.
 */
describe('tenancy unknown-key message order — bullets before the explainer (#6416 / #6619)', () => {
  const EXPLAINER =
    'The two supported tenancy modes are: database-per-tenant = environment-level ' +
    'deployment (no object config); row-level isolation = `tenancy.enabled` + ' +
    '`tenancy.tenantField`.';

  const messageFor = (body: Record<string, unknown>) => {
    const res = TenancyConfigSchema.safeParse({ enabled: true, ...body });
    expect(res.success).toBe(false);
    const unknown = res.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(unknown).toBeDefined();
    return unknown!.message;
  };

  it('names the wrong key first, then the tombstone bullet, then the explainer', () => {
    const m = messageFor({ strategy: 'isolated' });
    // 1. which key is wrong — and nothing before it
    expect(m.startsWith('Unrecognized key(s) on `tenancy`: `strategy`.\n')).toBe(true);
    // 2. the fix channel: the per-key bullet, on the line right after
    expect(m).toContain('\n  • `tenancy.strategy` was removed from @objectstack/spec after v15.0');
    // 3. the explainer, verbatim, last — moved, never dropped
    expect(m.indexOf('Delete the key.')).toBeLessThan(m.indexOf(EXPLAINER));
    expect(m.endsWith(` ${EXPLAINER}`)).toBe(true);
  });

  it('keeps EVERY fix channel ahead of the explainer, not just the first', () => {
    // One issue names every offending key, so the explainer is a per-MESSAGE
    // sentence: a reorder that put it after the first fix would bury the rest.
    // Three keys, all three channels at once: two tombstone bullets plus the
    // rename `tenantfield` earns since #6619 (the hand-written map answered it
    // with a dead-end "is not a `tenancy` key." bullet instead).
    const m = messageFor({ strategy: 'isolated', crossTenantAccess: true, tenantfield: 'org_id' });
    for (const fix of [
      'Did you mean `tenantfield` → `tenantField`?',
      '`tenancy.strategy` was removed',
      '`tenancy.crossTenantAccess` was removed',
    ]) {
      expect(m).toContain(fix);
      expect(m.indexOf(fix), fix).toBeLessThan(m.indexOf(EXPLAINER));
    }
    expect(m.split(EXPLAINER)).toHaveLength(2);
    expect(m.endsWith(` ${EXPLAINER}`)).toBe(true);
  });

  it('is a full-message pin for the near-miss case', () => {
    // Any stray separator, dropped newline or duplicated clause fails here.
    // Byte change vs the hand-written map, deliberate (#6619): the dead-end
    // bullet became the rename the author can act on.
    expect(messageFor({ tenantfield: 'org_id' })).toBe(
      'Unrecognized key(s) on `tenancy`: `tenantfield`. ' +
      'Did you mean `tenantfield` → `tenantField`? ' +
      EXPLAINER,
    );
  });

  it('is a full-message pin for the no-fix case', () => {
    // No tombstone, no near key: no bullet at all — the front matter and the
    // explainer carry everything the old catch-all bullet said.
    expect(messageFor({ zzNotAKey: 1 })).toBe(
      `Unrecognized key(s) on \`tenancy\`: \`zzNotAKey\`. ${EXPLAINER}`,
    );
  });
});

describe('isTenancyDisabled — platform-global posture predicate (#3249, ADR-0066)', () => {
  it('is true only for an explicit tenancy.enabled === false', () => {
    expect(isTenancyDisabled({ name: 'sys_license', tenancy: { enabled: false } })).toBe(true);
    expect(isTenancyDisabled({ name: 'task', tenancy: { enabled: true } })).toBe(false);
  });

  it('is false when tenancy is absent (tenant-scoped by default)', () => {
    expect(isTenancyDisabled({ name: 'task', fields: { organization_id: { type: 'text' } } })).toBe(false);
    expect(isTenancyDisabled({ name: 'task', tenancy: {} })).toBe(false);
  });

  it('tolerates null/undefined/non-object schemas', () => {
    expect(isTenancyDisabled(undefined)).toBe(false);
    expect(isTenancyDisabled(null)).toBe(false);
    expect(isTenancyDisabled('sys_license')).toBe(false);
  });
});

describe('userActions row predicates + resolveCrudAffordances (objectui#2614)', () => {
  it('accepts the plain boolean form unchanged (back-compat)', () => {
    const obj = ObjectSchema.parse({
      name: 'invoice',
      fields: { name: { type: 'text' } },
      userActions: { edit: false, delete: true },
    });
    const aff = resolveCrudAffordances(obj);
    expect(aff.edit).toBe(false);
    expect(aff.delete).toBe(true);
    expect(aff.editPredicates).toBeUndefined();
    expect(aff.deletePredicates).toBeUndefined();
  });

  it('accepts the object form with CEL predicate shorthand strings', () => {
    const obj = ObjectSchema.parse({
      name: 'task_version_check_item',
      fields: { name: { type: 'text' } },
      userActions: {
        edit: { disabledWhen: 'record.frozen == true' },
        delete: { visibleWhen: 'record.frozen != true' },
      },
    });
    // String shorthand normalizes to the canonical CEL envelope.
    expect((obj.userActions?.edit as any).disabledWhen).toEqual({ dialect: 'cel', source: 'record.frozen == true' });
    expect((obj.userActions?.delete as any).visibleWhen).toEqual({ dialect: 'cel', source: 'record.frozen != true' });
  });

  it('resolveCrudAffordances carries predicates through and defaults enabled from the bucket', () => {
    const aff = resolveCrudAffordances({
      managedBy: 'platform',
      userActions: {
        edit: { disabledWhen: { dialect: 'cel', source: 'record.frozen == true' } },
        delete: { enabled: false, visibleWhen: { dialect: 'cel', source: 'record.frozen != true' } },
      },
    } as never);
    // No `enabled` on edit → platform bucket default (true) applies.
    expect(aff.edit).toBe(true);
    expect(aff.editPredicates?.disabledWhen).toEqual({ dialect: 'cel', source: 'record.frozen == true' });
    expect(aff.editPredicates?.visibleWhen).toBeUndefined();
    // Explicit enabled:false wins over the bucket default; predicates still surface.
    expect(aff.delete).toBe(false);
    expect(aff.deletePredicates?.visibleWhen).toEqual({ dialect: 'cel', source: 'record.frozen != true' });
  });

  it('engine-owned bucket resolves fully locked (same matrix as append-only, ADR-0103)', () => {
    const locked = { create: false, import: false, edit: false, delete: false, exportCsv: true };
    expect(resolveCrudAffordances({ managedBy: 'engine-owned' } as never)).toEqual(locked);
    // Parity with the other engine-owned-default bucket. `system` used to sit
    // here too; #3355 renamed it to the writable-default `system-data`, which is
    // pinned against this matrix below.
    expect(resolveCrudAffordances({ managedBy: 'append-only' } as never)).toEqual(locked);
    // The enum accepts the new value.
    expect(ObjectSchema.safeParse({ name: 'sys_thing', label: 'T', fields: { id: { type: 'text' } }, managedBy: 'engine-owned' }).success).toBe(true);
  });

  it('object form without predicates behaves exactly like the boolean form', () => {
    const aff = resolveCrudAffordances({
      managedBy: 'config',
      userActions: { edit: { enabled: true }, delete: {} },
    } as never);
    expect(aff.edit).toBe(true);
    expect(aff.delete).toBe(true); // config bucket default
    expect(aff.editPredicates).toBeUndefined();
    expect(aff.deletePredicates).toBeUndefined();
  });

  it('rejects unknown keys in the object form', () => {
    const result = ObjectSchema.safeParse({
      name: 'invoice',
      fields: { name: { type: 'text' } },
      userActions: { edit: { hideWhen: 'record.frozen == true' } },
    });
    expect(result.success).toBe(false);
  });
});

// ADR-0100: a `password` field on a generic (non-better-auth) object is masked
// on read but plaintext at rest — not hashed. create() warns (non-fatally) to
// steer authors toward `secret` or the auth subsystem. The warning is deduped
// per object name via a module-level Set, so each test uses a unique name.
describe('ObjectSchema.create() password-field author warning (ADR-0100)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('warns once when a password field is declared on a generic object', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ObjectSchema.create({
      name: 'adr0100_generic_pw',
      fields: { admin_password: { type: 'password' } },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0]?.[0] as string;
    expect(msg).toContain('adr0100_generic_pw');
    expect(msg).toContain('admin_password');
    expect(msg).toContain('ADR-0100');
    expect(msg).toContain('secret');
  });

  it('is deduped: re-creating the same object name warns only once more session-wide', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const make = () => ObjectSchema.create({
      name: 'adr0100_dedup_pw',
      fields: { pw: { type: 'password' } },
    });
    make();
    make();
    make();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does NOT warn for a password field on a better-auth object', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ObjectSchema.create({
      name: 'adr0100_auth_pw',
      managedBy: 'better-auth',
      fields: { password: { type: 'password' } },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('does NOT warn for a secret field (its channel is already defined)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ObjectSchema.create({
      name: 'adr0100_secret_only',
      fields: { api_key: { type: 'secret' } },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('does NOT warn when the field affirms intent with ackPlaintextMasking (#3420)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ObjectSchema.create({
      name: 'adr0100_acked_pw',
      fields: { admin_password: { type: 'password', ackPlaintextMasking: true } },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('still warns about un-acknowledged password fields when only some opt in', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ObjectSchema.create({
      name: 'adr0100_partial_ack',
      fields: {
        acked_pw: { type: 'password', ackPlaintextMasking: true },
        raw_pw: { type: 'password' },
      },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0]?.[0] as string;
    expect(msg).toContain('raw_pw');
    expect(msg).not.toContain('acked_pw');
  });

  it('points authors at the ackPlaintextMasking opt-out in the warning text', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ObjectSchema.create({
      name: 'adr0100_hint_pw',
      fields: { pw: { type: 'password' } },
    });
    const msg = warn.mock.calls[0]?.[0] as string;
    expect(msg).toContain('ackPlaintextMasking');
  });
});

// ---------------------------------------------------------------------------
// #3543 — ApiMethod enum shrink: stripLegacyApiMethods parse-time compat layer
// Legacy values in stored metadata are stripped (canonicalize-and-warn), never
// a hard parse failure — real metadata does not upgrade in lockstep with the
// spec, so this tolerance is permanent. Unknown values (typos) still fail.
// NOTE: the strip warning dedups per distinct legacy combination for the
// process lifetime, so each test below uses a distinct combination.
// ---------------------------------------------------------------------------
describe('#3543 apiMethods legacy-value strip (ObjectCapabilities)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('strips a legacy value and keeps the declared primitives', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = ObjectCapabilities.parse({ apiMethods: ['get', 'list', 'export'] });
    expect(result.apiMethods).toEqual(['get', 'list']);
    const msg = warn.mock.calls.map((c) => c[0]).join('\n');
    expect(msg).toContain('export');
    expect(msg).toContain('#3543');
    expect(msg).toContain("declare ['list']"); // FROM → TO prescription
  });

  it('warns LOUDLY when stripping empties the whitelist (deny-all cliff)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = ObjectCapabilities.parse({ apiMethods: ['upsert'] });
    expect(result.apiMethods).toEqual([]);
    const msg = warn.mock.calls.map((c) => c[0]).join('\n');
    expect(msg).toContain('DENY-ALL');
    expect(msg).toContain("declare ['create','update']");
  });

  it('warns once per distinct legacy combination (parse is hot)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ObjectCapabilities.parse({ apiMethods: ['list', 'aggregate'] });
    ObjectCapabilities.parse({ apiMethods: ['list', 'aggregate'] });
    const hits = warn.mock.calls.filter((c) => String(c[0]).includes('aggregate'));
    expect(hits.length).toBe(1);
  });

  it('still hard-rejects unknown (non-legacy) values — typos stay loud', () => {
    const result = ObjectCapabilities.safeParse({ apiMethods: ['get', 'lst'] });
    expect(result.success).toBe(false);
  });

  it('restore/purge strip carries the retired-trash guidance', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = ObjectCapabilities.parse({ apiMethods: ['delete', 'restore', 'purge'] });
    expect(result.apiMethods).toEqual(['delete']);
    const msg = warn.mock.calls.map((c) => c[0]).join('\n');
    expect(msg).toContain('#2377');
  });

  it('the authored enum itself no longer admits legacy values', () => {
    const result = ObjectCapabilities.safeParse({ apiMethods: ['get'] });
    expect(result.success).toBe(true);
    // sanity: primitives round-trip untouched, no warning
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clean = ObjectCapabilities.parse({ apiMethods: ['get', 'list', 'bulk'] });
    expect(clean.apiMethods).toEqual(['get', 'list', 'bulk']);
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * #3355 — the v17 retirement of the residual `managedBy: 'system'` bucket.
 *
 * ADR-0103 split the overloaded value additively in v16 (the 20 engine-owned
 * objects moved out to the new `engine-owned`), which left `system` naming the
 * half that had already gone: writable platform data under a word that says the
 * engine owns it. v17 renames the residue `system-data` and retires the bare
 * value from the load path.
 *
 * These are the pin tests for that contract. Every one of them fails on the
 * pre-fix tree.
 */
describe('managedBy: retiring the overloaded `system` bucket (#3355)', () => {
  const object = (managedBy: string, extra: Record<string, unknown> = {}) => ({
    name: 'sys_thing',
    label: 'Thing',
    fields: { id: { type: 'text' } },
    managedBy,
    ...extra,
  });

  it('rejects the retired `system` value', () => {
    const result = ObjectSchema.safeParse(object('system'));
    expect(result.success).toBe(false);
  });

  it('the rejection carries the prescription, not "invalid enum value"', () => {
    const result = ObjectSchema.safeParse(object('system'));
    expect(result.success).toBe(false);
    const msg = JSON.stringify(result.error?.issues ?? []);
    // The retirement kit's contract: name the key, say it was removed, name the
    // replacement, and hand over the automated fix.
    expect(msg).toMatch(/managedBy/s);
    expect(msg).toMatch(/removed in @objectstack\/spec 17/s);
    expect(msg).toMatch(/system-data/s);
    expect(msg).toMatch(/os migrate meta --from 16/s);
  });

  it('accepts the replacement value', () => {
    expect(ObjectSchema.safeParse(object('system-data')).success).toBe(true);
  });

  it('a genuine typo still gets zod\'s own enum message, NOT the retirement prescription', () => {
    // Telling the author of `managedBy: 'sytem'` that their value "was removed
    // in v17" would misinform — they never had it. Only the value that used to
    // be legal earns the tombstone.
    const result = ObjectSchema.safeParse(object('sytem'));
    expect(result.success).toBe(false);
    const msg = JSON.stringify(result.error?.issues ?? []);
    expect(msg).not.toMatch(/removed in @objectstack\/spec 17/s);
  });

  it('`system-data` defaults to writable CRUD — the bucket says the data is yours', () => {
    expect(resolveCrudAffordances({ managedBy: 'system-data' } as never)).toEqual({
      create: true, import: false, edit: true, delete: true, exportCsv: true,
    });
  });

  /**
   * #4671 — CSV import is the ONE verb the writable default does not hand out.
   *
   * The bucket's charter members are the three RBAC link tables
   * (`sys_user_position`, `sys_user_permission_set`,
   * `sys_position_permission_set`), i.e. the grant surface of the whole
   * permission model. Authorization is untouched — the DelegatedAdminGate, RLS
   * and permission sets adjudicate every row a CSV import would write, and an
   * admin who cannot grant a permission set by hand cannot grant it by file
   * either. What moves is LEVERAGE: row-by-row, one misclick is one person; one
   * wrong CSV is one bulk grant with no natural review rhythm. So the wizard is
   * a per-object declaration rather than something eight objects inherit by
   * being filed in the right bucket — and the default result of "nobody thought
   * about import" is the safe one, which is the shape that matters most for
   * model-authored object metadata.
   */
  describe('`system-data` makes CSV import opt-IN (#4671)', () => {
    it('does not grant import by bucket default', () => {
      expect(resolveCrudAffordances({ managedBy: 'system-data' } as never).import).toBe(false);
    });

    it('grants it when the object declares `userActions: { import: true }`, and moves nothing else', () => {
      expect(resolveCrudAffordances({
        managedBy: 'system-data',
        userActions: { import: true },
      } as never)).toEqual({
        create: true, import: true, edit: true, delete: true, exportCsv: true,
      });
    });

    it('leaves `platform` — the one bucket that still grants import by default — alone', () => {
      expect(resolveCrudAffordances({} as never).import).toBe(true);
      expect(resolveCrudAffordances({ managedBy: 'platform' } as never).import).toBe(true);
    });

    it('is now the same answer every non-`platform` bucket gives', () => {
      for (const bucket of ['config', 'system-data', 'engine-owned', 'append-only', 'better-auth'] as const) {
        expect(resolveCrudAffordances({ managedBy: bucket } as never).import, bucket).toBe(false);
      }
    });
  });

  it('`userActions` on `system-data` NARROWS, and narrowing still resolves', () => {
    const aff = resolveCrudAffordances({
      managedBy: 'system-data',
      userActions: { delete: false, import: false },
    } as never);
    expect(aff).toEqual({
      create: true, import: false, edit: true, delete: false, exportCsv: true,
    });
  });

  /**
   * The mis-assignment guard. `system` defaulted LOCKED, so an engine-owned
   * object mislabelled into it inherited a harmless read-only matrix.
   * `system-data` defaults WRITABLE, so the same mistake now advertises generic
   * CRUD on a table that should never take a user write — and the engine write
   * guard does NOT cover `system-data` (a writable default has nothing to fail
   * closed on), so authoring time is the only place it can be caught.
   */
  describe('refuses a `system-data` object that grants no user write at all', () => {
    it('throws at create() naming the bucket it should have used', () => {
      expect(() => ObjectSchema.create(object('system-data', {
        userActions: { create: false, edit: false, delete: false },
      }) as never)).toThrow(/system-data.*no create, edit or delete.*engine-owned/s);
    });

    it('permits a partial narrow — only the all-writes-false shape is a contradiction', () => {
      expect(() => ObjectSchema.create(object('system-data', {
        userActions: { create: false, delete: false },
      }) as never)).not.toThrow();
    });

    it('leaves every other bucket alone (engine-owned is legitimately write-less)', () => {
      expect(() => ObjectSchema.create(object('engine-owned') as never)).not.toThrow();
      expect(() => ObjectSchema.create(object('append-only') as never)).not.toThrow();
    });
  });
});
