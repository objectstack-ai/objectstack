// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { FieldSchema, SelectOptionSchema, type SelectOptionKind } from './field.zod';
import { ObjectSchema } from './object.zod';
import { PicklistSchema } from './picklist.zod';

// ---------------------------------------------------------------------------
// [#23809] A select option declares its lifecycle `kind` — `open` (a step on
// the way), `won` (the successful end), `lost` (the unsuccessful end):
//
//  - option half (`SelectOptionSchema`): the closed vocabulary; absent stays
//    absent (reads as `open`, never written in at parse);
//  - field half (`FieldSchema`): `kind` only on a single-value `select` /
//    `radio` field's options;
//  - object half (`ObjectSchema`): every option of the field `stageField`
//    names declares `kind`, refused per option naming the field and option.
//
// Each refusal is ONE located `custom` issue; the pins assert its path and the
// field and option names an author greps for, never the prose around them.
// ---------------------------------------------------------------------------

const KINDED_STAGES = [
  { label: 'New', value: 'new', kind: 'open' },
  { label: 'Qualified', value: 'qualified', kind: 'open' },
  { label: 'Converted', value: 'converted', kind: 'won' },
  { label: 'Unqualified', value: 'unqualified', kind: 'lost' },
];

const lead = (status: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  name: 'lead',
  fields: {
    name: { type: 'text', label: 'Name' },
    status: { label: 'Status', ...status },
  },
  stageField: 'status',
  ...extra,
});

function issuesOf(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string; code: string }> } }) {
  expect(result.success).toBe(false);
  return result.error!.issues;
}

describe('SelectOption.kind — the closed lifecycle vocabulary', () => {
  it('is exactly open | won | lost', () => {
    const kinds: SelectOptionKind[] = ['open', 'won', 'lost'];
    expect(SelectOptionSchema.shape.kind.unwrap().options).toEqual(kinds);
  });

  it('an option with a terminal kind parses, and keeps it', () => {
    expect(SelectOptionSchema.parse({ label: 'Closed Won', value: 'closed_won', kind: 'won' }).kind).toBe('won');
    expect(SelectOptionSchema.parse({ label: 'Closed Lost', value: 'closed_lost', kind: 'lost' }).kind).toBe('lost');
    const field = FieldSchema.parse({ type: 'select', label: 'Stage', options: KINDED_STAGES });
    expect(field.options?.map((o) => o.kind)).toEqual(['open', 'open', 'won', 'lost']);
  });

  it('an unknown kind is refused at the option, located', () => {
    for (const kind of ['done', 'cancelled', 'closed', 'WON', '']) {
      const issues = issuesOf(FieldSchema.safeParse({
        type: 'select',
        label: 'Stage',
        options: [{ label: 'Done', value: 'done', kind }],
      }));
      expect(issues.map((i) => i.path.join('.'))).toContain('options.0.kind');
    }
  });

  it('a plain select without kinds parses, and an absent kind stays absent (reads as open)', () => {
    const field = FieldSchema.parse({
      type: 'select',
      label: 'Priority',
      options: [{ label: 'Low', value: 'low' }, { label: 'High', value: 'high' }],
    });
    expect(field.options?.every((o) => o.kind === undefined)).toBe(true);
    expect(field.options?.every((o) => !Object.prototype.hasOwnProperty.call(o, 'kind'))).toBe(true);
    // The same plain select on an object that names no stage field.
    expect(ObjectSchema.safeParse({
      name: 'ticket',
      fields: { priority: { type: 'select', label: 'Priority', options: [{ label: 'Low', value: 'low' }] } },
    }).success).toBe(true);
  });

  it('a shared picklist reuses the option shape, kind included', () => {
    const parsed = PicklistSchema.parse({ name: 'case_status', label: 'Case Status', options: [
      { label: 'Open', value: 'open', kind: 'open' },
      { label: 'Resolved', value: 'resolved', kind: 'won' },
    ] });
    expect(parsed.options.map((o) => o.kind)).toEqual(['open', 'won']);
  });
});

describe('SelectOption.kind on a field that is not a single-value select', () => {
  const kinded = [{ label: 'A', value: 'a', kind: 'open' }, { label: 'B', value: 'b' }];

  it.each([
    ['multiselect', {}],
    ['checkboxes', {}],
    ['tags', {}],
    ['select', { multiple: true }],
    ['radio', { multiple: true }],
    ['lookup', { reference: 'account' }],
    ['text', {}],
  ])('is refused on a `%s` field %j, at the option that carries it', (type, extra) => {
    const issues = issuesOf(FieldSchema.safeParse({ type, label: 'X', options: kinded, ...extra }));
    const kindIssues = issues.filter((i) => i.path.join('.') === 'options.0.kind');
    expect(kindIssues).toHaveLength(1);
    expect(kindIssues[0].code).toBe('custom');
    expect(kindIssues[0].message).toContain("Option 'a'");
    expect(kindIssues[0].message).toContain(`\`${type}\``);
    // The option WITHOUT kind is not flagged.
    expect(issues.some((i) => i.path.join('.') === 'options.1.kind')).toBe(false);
  });

  it('is accepted on a single-value `radio`', () => {
    expect(FieldSchema.safeParse({ type: 'radio', label: 'X', options: KINDED_STAGES }).success).toBe(true);
  });
});

describe('ObjectSchema — every option of the stageField declares kind', () => {
  it('a stage field whose every option declares kind parses', () => {
    const parsed = ObjectSchema.parse(lead({ type: 'select', options: KINDED_STAGES }));
    expect(parsed.stageField).toBe('status');
    expect((parsed.fields.status as { options: Array<{ kind?: string }> }).options.map((o) => o.kind))
      .toEqual(['open', 'open', 'won', 'lost']);
  });

  it('one option lacking kind is refused at publish, naming the field and the option', () => {
    const options = KINDED_STAGES.map((o) => (o.value === 'unqualified' ? { label: o.label, value: o.value } : o));
    const issues = issuesOf(ObjectSchema.safeParse(lead({ type: 'select', options })));
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('custom');
    expect(issues[0].path).toEqual(['fields', 'status', 'options', 3, 'kind']);
    expect(issues[0].message).toContain("Option 'unqualified'");
    expect(issues[0].message).toContain('field `status`');
  });

  it('each option lacking kind is its own located issue (no default fills them)', () => {
    const options = [{ label: 'New', value: 'new' }, { label: 'Done', value: 'done', kind: 'won' }, { label: 'Gone', value: 'gone' }];
    const issues = issuesOf(ObjectSchema.safeParse(lead({ type: 'radio', options })));
    expect(issues.map((i) => i.path.join('.'))).toEqual(['fields.status.options.0.kind', 'fields.status.options.2.kind']);
  });

  it('a picklist-backed stage field is refused at stageField: its options cannot be judged here', () => {
    const issues = issuesOf(ObjectSchema.safeParse(lead({ type: 'select', picklist: 'lead_status' })));
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['stageField']);
    expect(issues[0].message).toContain("picklist: 'lead_status'");
  });

  it.each([
    ['multiselect', {}],
    ['select', { multiple: true }],
  ])('a `%s` %j stage field carrying options is refused at stageField', (type, extra) => {
    const options = [{ label: 'A', value: 'a' }];
    const issues = issuesOf(ObjectSchema.safeParse(lead({ type, options, ...extra })));
    expect(issues.filter((i) => i.path.join('.') === 'stageField')).toHaveLength(1);
  });

  it('leaves the existing postures alone: false, a missing field, a field with no options', () => {
    const plain = { type: 'select', options: [{ label: 'Active', value: 'active' }] };
    expect(ObjectSchema.safeParse(lead(plain, { stageField: false })).success).toBe(true);
    expect(ObjectSchema.safeParse(lead(plain, { stageField: 'nope' })).success).toBe(true);
    expect(ObjectSchema.safeParse(lead({ type: 'text' })).success).toBe(true);
    expect(ObjectSchema.safeParse(lead(plain, { stageField: undefined })).success).toBe(true);
  });

  it('create() refuses the same object (the authoring door)', () => {
    expect(() => ObjectSchema.create(lead({
      type: 'select',
      options: [{ label: 'New', value: 'new' }],
    }) as unknown as Parameters<typeof ObjectSchema.create>[0])).toThrow(/Option 'new'/);
  });
});
