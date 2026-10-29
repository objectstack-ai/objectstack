// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27069] `validateRelatedListRefs` — the publish door's copy of the verdict
 * `defineStack` gives a related-list name that matches no inbound
 * relationship. The rule's own cases, and the pin that holds its sentence to
 * `defineStack`'s word for word.
 */
import { describe, expect, it } from 'vitest';
import { defineStack } from '@objectstack/spec';

import { RELATED_LIST_REF_UNKNOWN, validateRelatedListRefs } from './validate-related-list-refs.js';

const lead = (extra: Record<string, unknown> = {}) => ({
  name: 'rlo_lead',
  label: 'Lead',
  fields: { name: { type: 'text', label: 'Name' } },
  ...extra,
});
const task = { name: 'rlo_task', label: 'Task', fields: { lead_id: { type: 'lookup', label: 'Lead', reference: 'rlo_lead' } } };
const event = {
  name: 'rlo_event',
  label: 'Event',
  fields: {
    who_id: { type: 'lookup', label: 'Who', reference: 'rlo_lead' },
    related_to: { type: 'lookup', label: 'Related To', reference: 'rlo_lead' },
    created_by: { type: 'lookup', label: 'Created By', reference: 'rlo_lead' },
  },
};
const note = { name: 'rlo_note', label: 'Note', fields: { title: { type: 'text', label: 'Title' } } };
const stackOf = (parent: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  objects: [parent, task, event, note],
  ...extra,
});
const rules = (stack: Record<string, unknown>, wholeCollection?: boolean) =>
  validateRelatedListRefs(stack, wholeCollection ? { wholeCollection } : undefined).map((f) => [f.rule, f.path]);

describe('validateRelatedListRefs', () => {
  it('accepts a child name, and object.field for one FK of a child with several (control)', () => {
    expect(rules(stackOf(lead({ relatedLists: ['rlo_task', 'rlo_event.related_to', 'rlo_event'] })))).toEqual([]);
  });

  it('refuses a declared child with no FK, and a field that is not an inbound FK', () => {
    expect(rules(stackOf(lead({ relatedLists: ['rlo_note', 'rlo_event.nope', 'rlo_task'] })))).toEqual([
      [RELATED_LIST_REF_UNKNOWN, 'objects[0].relatedLists[0]'],
      [RELATED_LIST_REF_UNKNOWN, 'objects[0].relatedLists[1]'],
    ]);
  });

  it('an audit FK is not an inbound relationship an entry may name', () => {
    expect(rules(stackOf(lead({ relatedLists: ['rlo_event.created_by'] })))).toEqual([
      [RELATED_LIST_REF_UNKNOWN, 'objects[0].relatedLists[0]'],
    ]);
  });

  it('a child the stack does not hold is judged on the whole collection only', () => {
    const stack = stackOf(lead({ relatedLists: ['rlo_elsewhere'] }));
    expect(rules(stack)).toEqual([]);
    expect(rules(stack, true)).toEqual([[RELATED_LIST_REF_UNKNOWN, 'objects[0].relatedLists[0]']]);
  });

  it('sees an FK an objectExtensions entry adds', () => {
    const extended = { objectExtensions: [{ extend: 'rlo_note', fields: { lead_id: { type: 'lookup', reference: 'rlo_lead' } } }] };
    expect(rules(stackOf(lead({ relatedLists: ['rlo_note'] }), extended))).toEqual([]);
    expect(rules(stackOf(lead({ relatedLists: ['rlo_note'] })))).toHaveLength(1);
  });

  it('judges a field group relatedList, and reads the map form of objects', () => {
    const groups = [{ key: 'basics', label: 'Basics' }, { key: 'lines', label: 'Lines', relatedList: 'rlo_nope' }];
    expect(rules(stackOf(lead({ fieldGroups: groups })), undefined)).toEqual([]);
    expect(rules(stackOf(lead({ fieldGroups: groups })), true)).toEqual([
      [RELATED_LIST_REF_UNKNOWN, 'objects[0].fieldGroups[1].relatedList'],
    ]);
    const mapForm = { objects: { rlo_lead: { fields: {}, relatedLists: ['rlo_note'] }, rlo_note: note } };
    expect(rules(mapForm)).toEqual([[RELATED_LIST_REF_UNKNOWN, 'objects.rlo_lead.relatedLists[0]']]);
  });

  it('skips junk without throwing', () => {
    expect(() => validateRelatedListRefs({ objects: [null, 7, 'x', lead({ relatedLists: [1, '', null] })] })).not.toThrow();
    expect(validateRelatedListRefs({})).toEqual([]);
  });

  it('writes the sentence defineStack writes for the same entry, word for word', () => {
    const manifest = { id: 'com.example.rlo', namespace: 'rlo', name: 'rlo', version: '1.0.0', type: 'module' as const };
    const stack = stackOf(lead({ relatedLists: ['rlo_task', 'rlo_task.nope'], fieldGroups: [{ key: 'lines', label: 'Lines', relatedList: 'rlo_note' }] }));
    let issues: readonly string[] = [];
    try {
      defineStack({ manifest, ...stack } as never);
    } catch (e) {
      issues = (e as { issues?: readonly string[] }).issues ?? [];
    }
    const messages = validateRelatedListRefs(stack).map((f) => f.message);
    expect(messages).toHaveLength(2);
    expect(issues).toEqual(messages);
  });
});
