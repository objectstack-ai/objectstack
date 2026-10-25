// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { jsonSchemaToFlowFields, humanizeKey } from './json-schema-to-fields';

/**
 * The exact JSON Schema the engine publishes for the Approval node config
 * (`z.toJSONSchema(ApprovalNodeConfigSchema, { io: 'input' })`), captured from
 * `GET /api/v1/automation/actions`. Drives the server-driven property form.
 */
const APPROVAL_CONFIG_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    approvers: {
      minItems: 1,
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['user', 'org_membership_level', 'role', 'position', 'team', 'department', 'manager', 'field', 'queue'],
            // `role` (ADR-0090 D3) and `queue` (declared-but-unenforced,
            // framework #3508) still parse — stored flows must keep loading —
            // but are not offered for new authoring.
            xEnumDeprecated: ['role', 'queue'],
          },
          value: {
            description: 'User id / membership tier / position / team / department / field — per `type`',
            type: 'string',
            xRef: {
              kindFrom: 'type',
              objectSource: '$trigger',
              // Mirrors @objectstack/spec approval.zod.ts: the deprecated
              // `role` alias points at the same picker kind as its canonical
              // spelling (ADR-0090 D3); `manager` maps to the auto-resolved
              // cell; `queue` stays mapped so stored rows keep rendering
              // (framework #3508).
              map: { user: 'user', org_membership_level: 'org-membership-level', role: 'org-membership-level', position: 'position', team: 'team', department: 'department', manager: 'manager', field: 'object-field', queue: 'queue' },
            },
          },
        },
        required: ['type'],
      },
      description: 'Allowed approvers for this node',
    },
    behavior: {
      default: 'first_response',
      description: 'How to combine multiple approvers',
      type: 'string',
      enum: ['first_response', 'unanimous'],
    },
    lockRecord: { default: true, description: 'Lock the record from editing while pending', type: 'boolean' },
    approvalStatusField: {
      description: 'Business-object field to mirror request status onto',
      type: 'string',
      xRef: { kind: 'object-field', objectSource: '$trigger' },
    },
    escalation: {
      description: 'Per-node SLA escalation',
      type: 'object',
      properties: {
        enabled: { default: false, description: 'Enable SLA-based escalation for this node', type: 'boolean' },
        timeoutHours: { type: 'number', minimum: 1, description: 'Hours before escalation triggers' },
        action: { default: 'notify', description: 'Action on escalation timeout', type: 'string', enum: ['reassign', 'auto_approve', 'auto_reject', 'notify'] },
        escalateTo: { description: 'User id or position machine name to escalate to', type: 'string', xRef: { kind: 'position' } },
        notifySubmitter: { default: true, description: 'Notify the original submitter on escalation', type: 'boolean' },
      },
      required: ['timeoutHours'],
    },
  },
  required: ['approvers'],
};

describe('humanizeKey', () => {
  it('title-cases camelCase and snake_case', () => {
    expect(humanizeKey('approvalStatusField')).toBe('Approval Status Field');
    expect(humanizeKey('first_response')).toBe('First Response');
    expect(humanizeKey('lockRecord')).toBe('Lock Record');
  });
});

describe('jsonSchemaToFlowFields', () => {
  it('returns null for non-object schemas (caller falls back to hardcoded fields)', () => {
    expect(jsonSchemaToFlowFields(undefined)).toBeNull();
    expect(jsonSchemaToFlowFields({ type: 'string' })).toBeNull();
    expect(jsonSchemaToFlowFields({ type: 'object' })).toBeNull(); // no properties
  });

  it('preserves property order from the schema', () => {
    const fields = jsonSchemaToFlowFields(APPROVAL_CONFIG_SCHEMA)!;
    expect(fields.map((f) => f.id)).toEqual([
      'approvers',
      'behavior',
      'lockRecord',
      'approvalStatusField',
      // escalation flattens into config.escalation.* sub-fields
      'escalation.enabled',
      'escalation.timeoutHours',
      'escalation.action',
      'escalation.escalateTo',
      'escalation.notifySubmitter',
    ]);
  });

  it('maps an array-of-object into an objectList with columns', () => {
    const fields = jsonSchemaToFlowFields(APPROVAL_CONFIG_SCHEMA)!;
    const approvers = fields.find((f) => f.id === 'approvers')!;
    expect(approvers.kind).toBe('objectList');
    expect(approvers.path).toEqual(['config', 'approvers']);
    expect(approvers.label).toBe('Approvers');
    expect(approvers.help).toBe('Allowed approvers for this node');
    const colKeys = approvers.columns!.map((c) => c.key);
    expect(colKeys).toEqual(['type', 'value']);
    const typeCol = approvers.columns!.find((c) => c.key === 'type')!;
    expect(typeCol.kind).toBe('select');
    // `role` and `queue` are dropped from the OPTIONS (xEnumDeprecated) while
    // staying in the enum: the designer must not hand an author a deprecated
    // spelling (ADR-0090 D3) or a type the runtime resolves to nobody
    // (framework #3508) — but stored rows keep rendering.
    expect(typeCol.options!.map((o) => o.value)).toEqual(['user', 'org_membership_level', 'position', 'team', 'department', 'manager', 'field']);
    expect(typeCol.options!.map((o) => o.value)).not.toContain('role');
    expect(typeCol.options!.map((o) => o.value)).not.toContain('queue');
    const valueCol = approvers.columns!.find((c) => c.key === 'value')!;
    // Polymorphic reference: the picker follows the row's `type`. The
    // deprecated `role` discriminator survives and resolves to the SAME picker
    // kind as the canonical spelling — a flow authored on 15.x must keep
    // rendering for the length of its deprecation window (ADR-0090 D3) — and
    // `queue`/`manager` map to their warning / auto-resolved cells (#3508).
    expect(valueCol.kind).toBe('reference');
    expect(valueCol.ref).toEqual({
      kindFrom: 'type',
      objectSource: '$trigger',
      map: { user: 'user', org_membership_level: 'org-membership-level', role: 'org-membership-level', position: 'position', team: 'team', department: 'department', manager: 'manager', field: 'object-field', queue: 'queue' },
    });
    expect(valueCol.placeholder).toBe('User id / membership tier / position / team / department / field — per `type`');
  });

  it('maps a static-kind xRef column into a reference column', () => {
    const fields = jsonSchemaToFlowFields({
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: { connector: { type: 'string', xRef: { kind: 'connector' } } },
          },
        },
      },
    })!;
    const col = fields.find((f) => f.id === 'rows')!.columns!.find((c) => c.key === 'connector')!;
    expect(col.kind).toBe('reference');
    expect(col.ref).toEqual({ kind: 'connector' });
  });

  // framework#3508 follow-up: `map` names a picker KIND but never said what
  // backs it, so this package had to guess the data source — and guessed the
  // metadata registry, which lists no directory ROWS. `sources` carries the
  // answer, and an entry the designer cannot act on is dropped rather than
  // half-trusted (a `data` source with no committed column would query
  // nothing, which is the failure the annotation exists to end).
  it('carries xRef.sources through, dropping entries that could not drive a picker', () => {
    const fields = jsonSchemaToFlowFields({
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              value: {
                type: 'string',
                xRef: {
                  kindFrom: 'type',
                  map: { user: 'user', team: 'team', manager: 'manager' },
                  sources: {
                    user: { source: 'data', object: 'sys_user', valueField: 'id' },
                    manager: { source: 'auto' },
                    org_membership_level: { source: 'enum', values: ['owner', 'admin'] },
                    // Unusable: a record source with no committed column.
                    team: { source: 'data', object: 'sys_team' },
                    // Unusable: not a source shape at all.
                    bogus: { source: 'telepathy' },
                  },
                },
              },
            },
          },
        },
      },
    })!;
    const col = fields.find((f) => f.id === 'rows')!.columns!.find((c) => c.key === 'value')!;
    expect(col.ref!.sources).toEqual({
      user: { source: 'data', object: 'sys_user', valueField: 'id' },
      manager: { source: 'auto' },
      org_membership_level: { source: 'enum', values: ['owner', 'admin'] },
    });
  });

  it('omits sources entirely for a server that predates the annotation', () => {
    const fields = jsonSchemaToFlowFields({
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: { value: { type: 'string', xRef: { kindFrom: 'type', map: { user: 'user' } } } },
          },
        },
      },
    })!;
    const col = fields.find((f) => f.id === 'rows')!.columns!.find((c) => c.key === 'value')!;
    expect(col.ref).toEqual({ kindFrom: 'type', map: { user: 'user' } });
  });

  it('drops a polymorphic xRef whose map has no known kinds (column stays text)', () => {
    const fields = jsonSchemaToFlowFields({
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: { value: { type: 'string', xRef: { kindFrom: 'type', map: { foo: 'bogus' } } } },
          },
        },
      },
    })!;
    const col = fields.find((f) => f.id === 'rows')!.columns!.find((c) => c.key === 'value')!;
    expect(col.kind).toBe('text');
    expect(col.ref).toBeUndefined();
  });

  it('maps an enum string into a select with humanized option labels + default', () => {
    const fields = jsonSchemaToFlowFields(APPROVAL_CONFIG_SCHEMA)!;
    const behavior = fields.find((f) => f.id === 'behavior')!;
    expect(behavior.kind).toBe('select');
    expect(behavior.defaultValue).toBe('first_response');
    expect(behavior.options).toEqual([
      { value: 'first_response', label: 'First Response' },
      { value: 'unanimous', label: 'Unanimous' },
    ]);
  });

  it('maps boolean scalars', () => {
    const fields = jsonSchemaToFlowFields(APPROVAL_CONFIG_SCHEMA)!;
    const lock = fields.find((f) => f.id === 'lockRecord')!;
    expect(lock.kind).toBe('boolean');
    expect(lock.defaultValue).toBe('true');
  });

  it('maps an xRef string into a reference field (picker, not free text)', () => {
    const fields = jsonSchemaToFlowFields(APPROVAL_CONFIG_SCHEMA)!;
    const statusField = fields.find((f) => f.id === 'approvalStatusField')!;
    expect(statusField.kind).toBe('reference');
    expect(statusField.path).toEqual(['config', 'approvalStatusField']);
    expect(statusField.ref).toEqual({ kind: 'object-field', objectSource: '$trigger' });
    // Description still flows through as help.
    expect(statusField.help).toBe('Business-object field to mirror request status onto');
  });

  it('falls back to plain text for a string with no xRef', () => {
    const fields = jsonSchemaToFlowFields({
      type: 'object',
      properties: { note: { type: 'string', description: 'free text' } },
    })!;
    const note = fields.find((f) => f.id === 'note')!;
    expect(note.kind).toBe('text');
    expect(note.ref).toBeUndefined();
  });

  it('ignores an xRef with an unknown kind (treats as plain text)', () => {
    const fields = jsonSchemaToFlowFields({
      type: 'object',
      properties: { weird: { type: 'string', xRef: { kind: 'bogus' } } },
    })!;
    const weird = fields.find((f) => f.id === 'weird')!;
    expect(weird.kind).toBe('text');
    expect(weird.ref).toBeUndefined();
  });

  it('recognizes the position kind (ADR-0090 D3) — static and polymorphic', () => {
    const fields = jsonSchemaToFlowFields({
      type: 'object',
      properties: {
        approver: { type: 'string', xRef: { kind: 'position' } },
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: { value: { type: 'string', xRef: { kindFrom: 'type', map: { position: 'position' } } } },
          },
        },
      },
    })!;
    const approver = fields.find((f) => f.id === 'approver')!;
    expect(approver.kind).toBe('reference');
    expect(approver.ref).toEqual({ kind: 'position' });
    const rows = fields.find((f) => f.id === 'rows')!;
    const valueCol = rows.columns!.find((c) => c.key === 'value')!;
    expect(valueCol.kind).toBe('reference');
    expect(valueCol.ref).toEqual({ kindFrom: 'type', map: { position: 'position' } });
  });

  it('flattens a nested object and gates siblings behind its enabled toggle', () => {
    const fields = jsonSchemaToFlowFields(APPROVAL_CONFIG_SCHEMA)!;
    const enabled = fields.find((f) => f.id === 'escalation.enabled')!;
    expect(enabled.kind).toBe('boolean');
    expect(enabled.path).toEqual(['config', 'escalation', 'enabled']);
    // The gate adopts the parent group's label, not "Enabled".
    expect(enabled.label).toBe('Escalation');
    expect(enabled.showWhen).toBeUndefined();

    const timeout = fields.find((f) => f.id === 'escalation.timeoutHours')!;
    expect(timeout.kind).toBe('number');
    expect(timeout.showWhen).toEqual({ field: 'escalation.enabled', equals: ['true'] });

    const action = fields.find((f) => f.id === 'escalation.action')!;
    expect(action.kind).toBe('select');
    expect(action.defaultValue).toBe('notify');
    expect(action.options!.map((o) => o.value)).toEqual(['reassign', 'auto_approve', 'auto_reject', 'notify']);
    expect(action.showWhen).toEqual({ field: 'escalation.enabled', equals: ['true'] });

    // A nested xRef string flattens into a reference field, still gated.
    const escalateTo = fields.find((f) => f.id === 'escalation.escalateTo')!;
    expect(escalateTo.kind).toBe('reference');
    expect(escalateTo.ref).toEqual({ kind: 'position' });
    expect(escalateTo.showWhen).toEqual({ field: 'escalation.enabled', equals: ['true'] });
  });
});

describe('jsonSchemaToFlowFields — xExpression authoring-mode marker', () => {
  const field = (schema: unknown, id: string) => jsonSchemaToFlowFields(schema)!.find((f) => f.id === id)!;

  it("maps xExpression:'expression' to a CEL expression field (predicate-validated, no refMode)", () => {
    const f = field(
      { type: 'object', properties: { condition: { type: 'string', xExpression: 'expression' } } },
      'condition',
    );
    expect(f.kind).toBe('expression');
    expect(f.refMode).toBeUndefined();
  });

  // objectui#12329 — the single-brace dialect is deleted (objectstack#19939
  // S7) and the installed spec publishes the mark nowhere. Mapped to a picker
  // it would offer a token no flow string reads, so it degrades like any other
  // unknown mark: a literal text field. So does `'value'`, which the spec now
  // publishes on a loop / map `collection` (the ledger renders that slot).
  for (const marker of ['template', 'value']) {
    it(`degrades xExpression:'${marker}' to plain text (no refMode)`, () => {
      const f = field({ type: 'object', properties: { collection: { type: 'string', xExpression: marker } } }, 'collection');
      expect(f.kind).toBe('text');
      expect(f.refMode).toBeUndefined();
    });
  }

  it("maps a multiline xExpression:'expression' to a textarea in bare-ref (script-body) mode", () => {
    const f = field(
      { type: 'object', properties: { script: { type: 'string', format: 'multiline', xExpression: 'expression' } } },
      'script',
    );
    expect(f.kind).toBe('textarea');
    expect(f.refMode).toBe('expression');
  });

  it("degrades a multiline xExpression:'template' to a plain textarea (objectui#12329)", () => {
    const f = field(
      { type: 'object', properties: { body: { type: 'string', format: 'multiline', xExpression: 'template' } } },
      'body',
    );
    expect(f.kind).toBe('textarea');
    expect(f.refMode).toBeUndefined();
  });

  it('degrades an unknown xExpression value to plain text (no refMode)', () => {
    const f = field(
      { type: 'object', properties: { note: { type: 'string', xExpression: 'bogus' } } },
      'note',
    );
    expect(f.kind).toBe('text');
    expect(f.refMode).toBeUndefined();
  });

  it('gives precedence to xRef and enum over xExpression', () => {
    // enum wins → select (a marked string that is also an enum is still a picker).
    const withEnum = field(
      { type: 'object', properties: { mode: { type: 'string', enum: ['a', 'b'], xExpression: 'expression' } } },
      'mode',
    );
    expect(withEnum.kind).toBe('select');
    expect(withEnum.refMode).toBeUndefined();
    // xRef wins → reference.
    const withRef = field(
      { type: 'object', properties: { obj: { type: 'string', xRef: { kind: 'object' }, xExpression: 'expression' } } },
      'obj',
    );
    expect(withRef.kind).toBe('reference');
    expect(withRef.refMode).toBeUndefined();
  });

  it('flattens a nested xExpression string, carrying its refMode', () => {
    const f = field(
      {
        type: 'object',
        properties: {
          group: { type: 'object', properties: { where: { type: 'string', format: 'multiline', xExpression: 'expression' } } },
        },
      },
      'group.where',
    );
    expect(f.kind).toBe('textarea');
    expect(f.refMode).toBe('expression');
  });

  it('maps xExpression columns: expression → CEL column, template → text (columns carry no refMode)', () => {
    const cols = jsonSchemaToFlowFields({
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              guard: { type: 'string', xExpression: 'expression' },
              label: { type: 'string', xExpression: 'template' },
              plain: { type: 'string' },
            },
          },
        },
      },
    })!.find((f) => f.id === 'rows')!.columns!;
    expect(cols.find((c) => c.key === 'guard')!.kind).toBe('expression');
    expect(cols.find((c) => c.key === 'label')!.kind).toBe('text');
    expect(cols.find((c) => c.key === 'plain')!.kind).toBe('text');
  });
});

describe('jsonSchemaToFlowFields — free-form object maps → keyValue (#3304)', () => {
  const field = (schema: unknown, id: string) => jsonSchemaToFlowFields(schema)!.find((f) => f.id === id);

  it('maps an object with a value schema (additionalProperties) to a keyValue field', () => {
    const f = field(
      {
        type: 'object',
        properties: {
          fields: { type: 'object', additionalProperties: { type: 'string' }, title: 'Field values', description: 'Values to write.' },
        },
      },
      'fields',
    )!;
    expect(f.kind).toBe('keyValue');
    expect(f.path).toEqual(['config', 'fields']);
    expect(f.label).toBe('Field values');
    expect(f.help).toBe('Values to write.');
  });

  it('maps `additionalProperties: true` (any value) to keyValue too', () => {
    expect(field({ type: 'object', properties: { filter: { type: 'object', additionalProperties: true } } }, 'filter')!.kind).toBe('keyValue');
  });

  it('prefers flattening when the object has fixed `properties` (not keyValue)', () => {
    // An object with real properties is a structured group → flattened sub-fields,
    // never the keyValue map editor.
    const fields = jsonSchemaToFlowFields({
      type: 'object',
      properties: { grp: { type: 'object', properties: { host: { type: 'string' }, port: { type: 'number' } } } },
    })!;
    expect(fields.some((f) => f.kind === 'keyValue')).toBe(false);
    expect(fields.find((f) => f.id === 'grp.host')!.kind).toBe('text');
    expect(fields.find((f) => f.id === 'grp.port')!.kind).toBe('number');
  });

  it('leaves an opaque object (no properties, no additionalProperties) to the Advanced block', () => {
    // Not representable → omitted from the form (falls through to Advanced JSON).
    expect(field({ type: 'object', properties: { blob: { type: 'object' } } }, 'blob')).toBeUndefined();
    // `additionalProperties: false` is a closed object, also not a keyValue map.
    expect(field({ type: 'object', properties: { closed: { type: 'object', additionalProperties: false } } }, 'closed')).toBeUndefined();
  });
});

describe('jsonSchemaToFlowFields — numeric arrays → numberList (#3304)', () => {
  const field = (schema: unknown, id: string) => jsonSchemaToFlowFields(schema)!.find((f) => f.id === id)!;

  it('maps an array of number / integer to numberList (sibling of stringList)', () => {
    expect(field({ type: 'object', properties: { offsets: { type: 'array', items: { type: 'number' } } } }, 'offsets').kind).toBe('numberList');
    expect(field({ type: 'object', properties: { days: { type: 'array', items: { type: 'integer' } } } }, 'days').kind).toBe('numberList');
    // string arrays still map to stringList.
    expect(field({ type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } } }, 'tags').kind).toBe('stringList');
  });
});

describe('jsonSchemaToFlowFields — nested-array columns (#2678 P2-5)', () => {
  const cols = (schema: unknown, id: string) =>
    jsonSchemaToFlowFields(schema)!.find((f) => f.id === id)!.columns!;

  // A realistic array-in-objectList: a per-node rule list where each rule owns a
  // string[] (recipients) and an integer[] (retry offsets). Before this branch
  // both nested arrays fell through to a `text` cell that `String()`-joined and
  // corrupted the array on save.
  const RULES_SCHEMA = {
    type: 'object',
    properties: {
      rules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            recipients: { type: 'array', items: { type: 'string' }, title: 'Recipients' },
            offsets: { type: 'array', items: { type: 'integer' } },
          },
        },
      },
    },
  };

  it('maps a string[] item property to a nested stringList column (not text)', () => {
    const recipients = cols(RULES_SCHEMA, 'rules').find((c) => c.key === 'recipients')!;
    expect(recipients.kind).toBe('stringList');
    expect(recipients.label).toBe('Recipients'); // schema `title` wins
  });

  it('maps a number/integer[] item property to a nested numberList column', () => {
    expect(cols(RULES_SCHEMA, 'rules').find((c) => c.key === 'offsets')!.kind).toBe('numberList');
    // scalar siblings are unaffected.
    expect(cols(RULES_SCHEMA, 'rules').find((c) => c.key === 'name')!.kind).toBe('text');
  });

  it('maps an object[] item property to a nested objectList column with recursive columns', () => {
    const columns = cols(
      {
        type: 'object',
        properties: {
          groups: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                members: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      user: { type: 'string', xRef: { kind: 'user' } },
                      lead: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      'groups',
    );
    const members = columns.find((c) => c.key === 'members')!;
    expect(members.kind).toBe('objectList');
    // The nested columns are derived recursively — including the xRef picker.
    expect(members.columns!.map((c) => c.key)).toEqual(['user', 'lead']);
    expect(members.columns!.find((c) => c.key === 'user')!.kind).toBe('reference');
    expect(members.columns!.find((c) => c.key === 'user')!.ref).toEqual({ kind: 'user' });
    expect(members.columns!.find((c) => c.key === 'lead')!.kind).toBe('boolean');
  });

  it('stops recursing past the nesting cap, leaving the deepest array to Advanced JSON', () => {
    // Build object-array nesting deeper than MAX_COLUMN_NEST_DEPTH (4). The
    // outer levels render as objectList columns; the level past the cap is not
    // emitted as an objectList column (falls through to the scalar `text` map).
    let items: Record<string, unknown> = { type: 'object', properties: { leaf: { type: 'string' } } };
    for (let i = 0; i < 7; i++) {
      items = { type: 'object', properties: { child: { type: 'array', items } } };
    }
    const top = jsonSchemaToFlowFields({ type: 'object', properties: { root: { type: 'array', items } } })!.find(
      (f) => f.id === 'root',
    )!;
    // Walk down the objectList `child` columns until one is no longer objectList.
    let node = top;
    let depth = 0;
    while (node?.columns) {
      const child = node.columns.find((c) => c.key === 'child');
      if (!child || child.kind !== 'objectList') break;
      node = child as unknown as typeof top;
      depth++;
    }
    // Bounded — never recurses without limit.
    expect(depth).toBeLessThanOrEqual(4);
    expect(depth).toBeGreaterThan(0);
  });
});
