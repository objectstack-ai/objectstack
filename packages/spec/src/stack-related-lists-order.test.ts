// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27069] An object declares the business order of its related lists
 * (`relatedLists`), and a field group can place one body table
 * (`fieldGroups[].relatedList`). Both name INBOUND relationships, and both are
 * strict names: the shape is judged at parse, and whether the relationship
 * exists is judged at `defineStack`, where every child's fields are known.
 *
 * Refusals assert the ADR-0112 envelope (`code` + `status`), the issue count
 * and the named subjects — the entry and the inbound relationships that exist —
 * never a bare `toThrow()`, which a refusal for any other reason would satisfy.
 * Every refusal row's CONTROL differs from it by one entry alone.
 */
import { describe, it, expect } from 'vitest';
import { defineStack } from './stack.zod';
import { ObjectSchema } from './data/object.zod';

type Refusal = Error & { code?: string; status?: number; issues?: readonly string[] };

const manifest = {
  id: 'com.example.rlo',
  namespace: 'rlo',
  name: 'rlo',
  version: '1.0.0',
  type: 'module' as const,
};

const lead = (extra: Record<string, unknown> = {}) => ({
  name: 'rlo_lead',
  label: 'Lead',
  fields: { name: { type: 'text' as const, label: 'Name' } },
  ...extra,
});
const task = {
  name: 'rlo_task',
  label: 'Task',
  fields: { lead_id: { type: 'lookup' as const, label: 'Lead', reference: 'rlo_lead' } },
};
const event = {
  name: 'rlo_event',
  label: 'Event',
  fields: {
    who_id: { type: 'lookup' as const, label: 'Who', reference: 'rlo_lead' },
    related_to: { type: 'lookup' as const, label: 'Related To', reference: 'rlo_lead' },
  },
};
const note = { name: 'rlo_note', label: 'Note', fields: { title: { type: 'text' as const, label: 'Title' } } };

const stackOf = (parent: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ manifest, objects: [parent, task, event, note], ...extra }) as any;

const refusalOf = (fn: () => unknown): Refusal | undefined => {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
};

describe('ObjectSchema.relatedLists — the shape', () => {
  it('accepts child object names and object.field entries', () => {
    expect(ObjectSchema.safeParse(lead({ relatedLists: ['task', 'event.related_to'] })).success).toBe(true);
  });

  it.each([
    ['a non-array', 'task'],
    ['a non-string entry', [1]],
    ['a non-snake entry', ['Task']],
    ['a two-dot entry', ['a.b.c']],
  ])('refuses %s', (_label, relatedLists) => {
    expect(ObjectSchema.safeParse(lead({ relatedLists })).success).toBe(false);
  });
});

describe('ObjectFieldGroupSchema.relatedList — a group that stands for a body table', () => {
  const groups = [
    { key: 'basics', label: 'Basics' },
    { key: 'lines', label: 'Lines', relatedList: 'rlo_task.lead_id' },
  ];

  it('accepts a group that names a relationship and holds no fields', () => {
    const parsed = ObjectSchema.safeParse(lead({
      fieldGroups: groups,
      fields: { name: { type: 'text', label: 'Name', group: 'basics' } },
    }));
    expect(parsed.success).toBe(true);
  });

  it('refuses a field that names such a group as its group, at the field', () => {
    const parsed = ObjectSchema.safeParse(lead({
      fieldGroups: groups,
      fields: { name: { type: 'text', label: 'Name', group: 'lines' } },
    }));
    expect(parsed.success).toBe(false);
    const issue = parsed.error!.issues.find((i) => i.path.join('.') === 'fields.name.group');
    expect(issue?.message).toContain("places the related list 'rlo_task.lead_id'");
  });
});

describe('defineStack — relatedLists names an inbound relationship', () => {
  it('accepts entries naming a child, and one FK of a child with several (control)', () => {
    expect(() => defineStack(stackOf(lead({ relatedLists: ['rlo_task', 'rlo_event.related_to', 'rlo_event'] })))).not.toThrow();
  });

  it('refuses an entry that matches no inbound relationship, naming the entry and the relationships that exist', () => {
    const refusal = refusalOf(() => defineStack(stackOf(lead({ relatedLists: ['rlo_task', 'nope'] }))));
    expect(refusal?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(typeof refusal?.status).toBe('number');
    expect(refusal?.issues).toHaveLength(1);
    expect(refusal?.issues?.[0]).toContain("Object 'rlo_lead' relatedLists[1] 'nope' matches no inbound relationship");
    expect(refusal?.issues?.[0]).toContain("'rlo_task', 'rlo_event.who_id', 'rlo_event.related_to'");
  });

  it('refuses a declared child that has no FK to this object, and a field that is not one', () => {
    const refusal = refusalOf(() => defineStack(stackOf(lead({ relatedLists: ['rlo_note', 'rlo_event.nope'] }))));
    expect(refusal?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refusal?.issues).toHaveLength(2);
    expect(refusal?.issues?.[0]).toContain("relatedLists[0] 'rlo_note'");
    expect(refusal?.issues?.[1]).toContain("relatedLists[1] 'rlo_event.nope'");
  });

  it('says so when the object has no inbound relationship at all', () => {
    const refusal = refusalOf(() => defineStack(({ manifest, objects: [lead({ relatedLists: ['rlo_task'] })] }) as any));
    expect(refusal?.issues?.[0]).toContain('it has none');
  });

  it('sees an FK an objectExtensions entry adds', () => {
    const extended = {
      objectExtensions: [{ extend: 'rlo_note', fields: { lead_id: { type: 'lookup', label: 'Lead', reference: 'rlo_lead' } } }],
    };
    expect(() => defineStack(stackOf(lead({ relatedLists: ['rlo_note'] }), extended))).not.toThrow();
  });

  it('leaves a child declared only by a sibling package unjudged', () => {
    expect(() => defineStack(stackOf(lead({ relatedLists: ['rlo_sibling'] })), { artifactObjects: ['rlo_sibling'] })).not.toThrow();
    expect(refusalOf(() => defineStack(stackOf(lead({ relatedLists: ['rlo_sibling'] }))))?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
  });

  it('judges a field group relatedList the same way', () => {
    const groups = (relatedList: string) => [{ key: 'lines', label: 'Lines', relatedList }];
    expect(() => defineStack(stackOf(lead({ fieldGroups: groups('rlo_task') })))).not.toThrow();
    const refusal = refusalOf(() => defineStack(stackOf(lead({ fieldGroups: groups('rlo_nope') }))));
    expect(refusal?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refusal?.issues?.[0]).toContain("Object 'rlo_lead' fieldGroups[0].relatedList 'rlo_nope'");
  });
});
