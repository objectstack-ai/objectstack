// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10] `ObjectExtensionSchema.fieldGroups` / `.relatedLists` — the
 * whole arrangement the paired `.custom` package's extension writes for an
 * installed object, in the shape an object declares it in. The shape is
 * judged here; WHO wrote it is the server's (the package is not in the body).
 * Every refusal row differs from its control by one key alone.
 */
import { describe, it, expect } from 'vitest';
import {
  ObjectExtensionRelatedListEntrySchema,
  ObjectExtensionSchema,
  ObjectSchema,
  RelatedListEntrySchema,
} from './object.zod';
import { BASE_FIELD_DISPLAY_WHITELIST, CUSTOM_ARRANGEMENT_KEYS, extensionArrangementKeys } from './field-customization';
import {
  RELATED_LISTS_ARRANGEMENT_DECORATION,
  readRelatedListsArrangement,
  relatedListEntryHidden,
  relatedListNameCovers,
} from './related-list-entry';
import { METADATA_READ_DECORATIONS } from '../kernel/metadata-read-decorations';

const extension = (extra: Record<string, unknown> = {}) => ({
  extend: 'crm_lead',
  fields: { region__c: { type: 'text', label: 'Region' } },
  ...extra,
});

const issues = (input: unknown) => {
  const parsed = ObjectExtensionSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
};

describe('the arrangement keys', () => {
  it('are fieldGroups and relatedLists, frozen', () => {
    expect([...CUSTOM_ARRANGEMENT_KEYS]).toEqual(['fieldGroups', 'relatedLists']);
    expect(Object.isFrozen(CUSTOM_ARRANGEMENT_KEYS)).toBe(true);
  });

  it.each([
    [{ extend: 'a' }, []],
    [{ extend: 'a', fieldGroups: [] }, ['fieldGroups']],
    [{ extend: 'a', relatedLists: ['task'] }, ['relatedLists']],
    [{ extend: 'a', relatedLists: [], fieldGroups: [{ key: 'b', label: 'B' }] }, ['fieldGroups', 'relatedLists']],
    [{ extend: 'a', fieldGroups: undefined, relatedLists: null }, []],
    [undefined, []],
    [['fieldGroups'], []],
  ])('extensionArrangementKeys(%j) → %j', (body, keys) => {
    expect(extensionArrangementKeys(body)).toEqual(keys);
  });
});

describe('ObjectExtensionSchema.fieldGroups — an object\'s field groups, in the same shape', () => {
  const groups = [
    { key: 'contact', label: 'Contact', fields: ['email', 'phone', 'region__c'] },
    { key: 'basic', label: 'Basics', collapse: 'collapsed', fields: ['name', 'company'] },
    { key: 'lines', label: 'Lines', relatedList: 'crm_lead_line' },
  ];

  it('accepts groups listing base fields, the extension\'s own field and a body table (control)', () => {
    const parsed = ObjectExtensionSchema.safeParse(extension({ fieldGroups: groups }));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.fieldGroups?.map((group) => group.key)).toEqual(['contact', 'basic', 'lines']);
  });

  it('accepts exactly what an object accepts: the same groups parse on ObjectSchema', () => {
    const parsed = ObjectSchema.safeParse({
      name: 'crm_lead',
      fields: { name: { type: 'text' }, company: { type: 'text' }, email: { type: 'text' }, phone: { type: 'text' }, region__c: { type: 'text' } },
      fieldGroups: groups,
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts an empty list: an arrangement with no group', () => {
    expect(ObjectExtensionSchema.safeParse(extension({ fieldGroups: [] })).success).toBe(true);
  });

  it('a group whose `visibleWhen` is false parses: the written way to keep a base field off the page', () => {
    const parsed = ObjectExtensionSchema.safeParse(extension({
      fieldGroups: [
        { key: 'basic', label: 'Basics', fields: ['name'] },
        { key: 'off_page', label: 'Not shown', fields: ['fax'], visibleWhen: 'false' },
      ],
    }));
    expect(parsed.success).toBe(true);
  });

  it.each([
    ['a repeated group key', [{ key: 'basic', label: 'A' }, { key: 'basic', label: 'B' }], 'fieldGroups'],
    ['an unknown group key', [{ key: 'basic', label: 'A', hidden: true }], 'fieldGroups.0'],
    ['a field two groups list', [{ key: 'a', label: 'A', fields: ['name'] }, { key: 'b', label: 'B', fields: ['name'] }], 'fieldGroups.1.fields.0'],
    ['a name one list repeats', [{ key: 'a', label: 'A', fields: ['name', 'name'] }], 'fieldGroups.0.fields.1'],
    ['`fields` on a group that places a body table', [{ key: 'a', label: 'A', relatedList: 'task', fields: ['name'] }], 'fieldGroups.0.fields'],
  ])('refuses %s, at the entry', (_label, value, path) => {
    expect(issues(extension({ fieldGroups: value })).map((issue) => issue.path)).toContain(path);
  });

  it('refuses a field of its own whose `group` names another declared group than the one listing it', () => {
    const found = issues({
      extend: 'crm_lead',
      fields: { region__c: { type: 'text', label: 'Region', group: 'basic' } },
      fieldGroups: [{ key: 'contact', label: 'Contact', fields: ['region__c'] }, { key: 'basic', label: 'Basics' }],
    });
    expect(found.map((issue) => issue.path)).toEqual(expect.arrayContaining(['fieldGroups.0.fields.0', 'fields.region__c.group']));
  });

  it('refuses a field of its own whose `group` names a group that places a body table', () => {
    const found = issues({
      extend: 'crm_lead',
      fields: { region__c: { type: 'text', label: 'Region', group: 'lines' } },
      fieldGroups: [{ key: 'lines', label: 'Lines', relatedList: 'crm_lead_line' }],
    });
    expect(found.map((issue) => issue.path)).toContain('fields.region__c.group');
  });
});

describe('ObjectExtensionSchema.relatedLists — an object\'s tab list, plus `hidden`', () => {
  it('accepts bare names, the object form, a built-in tab and a hidden entry (control)', () => {
    const parsed = ObjectExtensionSchema.safeParse(extension({
      relatedLists: [
        'crm_opportunity',
        { list: 'crm_contact', label: 'People', columns: ['name', 'email'] },
        'sys_attachment',
        { list: 'crm_task', hidden: true },
        { list: 'crm_event.related_to', hidden: false },
      ],
    }));
    expect(parsed.success).toBe(true);
  });

  it('accepts an empty list: every tab is unlisted, so every tab still shows', () => {
    expect(ObjectExtensionSchema.safeParse(extension({ relatedLists: [] })).success).toBe(true);
  });

  it('`hidden` is accepted on the extension\'s entry and refused on an object\'s, by name', () => {
    const entry = { list: 'crm_task', hidden: true };
    expect(ObjectExtensionRelatedListEntrySchema.safeParse(entry).success).toBe(true);
    const onObject = RelatedListEntrySchema.safeParse(entry);
    expect(onObject.success).toBe(false);
    expect(JSON.stringify(onObject.success ? [] : onObject.error.issues)).toContain('.custom');
  });

  it.each([
    ['a built-in tab in the object form', [{ list: 'sys_attachment', hidden: true }]],
    ['a name that is no entry name', ['Task']],
    ['an unknown entry key', [{ list: 'crm_task', visible: false }]],
    ['a non-boolean `hidden`', [{ list: 'crm_task', hidden: 'yes' }]],
  ])('refuses %s', (_label, value) => {
    expect(ObjectExtensionSchema.safeParse(extension({ relatedLists: value })).success).toBe(false);
  });

  it.each([
    ['the same list shown and hidden', ['crm_task', { list: 'crm_task', hidden: true }], 'relatedLists.1.hidden'],
    ['a list hidden, then shown', [{ list: 'crm_task', hidden: true }, 'crm_task'], 'relatedLists.1'],
    ['one relationship shown of a child hidden whole', [{ list: 'crm_task', hidden: true }, { list: 'crm_task.lead', label: 'Tasks' }], 'relatedLists.1'],
  ])('refuses %s, at the later entry', (_label, value, path) => {
    const found = issues(extension({ relatedLists: value }));
    expect(found).toHaveLength(1);
    expect(found[0].path).toBe(path);
    expect(found[0].message).toContain('hidden');
  });

  it('a child shown with one of its relationships hidden is no contradiction', () => {
    expect(ObjectExtensionSchema.safeParse(extension({
      relatedLists: ['crm_task', { list: 'crm_task.converted_lead', hidden: true }],
    })).success).toBe(true);
  });
});

describe('ObjectExtensionSchema — `place` beside the arrangement that replaces it', () => {
  const place = [
    { field: 'region__c', group: 'basic', after: 'company' },
    { group: { key: 'extra', label: 'Extra' }, after: 'basic' },
    { list: 'crm_visit', after: 'crm_task' },
  ];

  it('control: the three placements parse with neither key written', () => {
    expect(ObjectExtensionSchema.safeParse(extension({ place })).success).toBe(true);
  });

  it('`fieldGroups` written: the field and group placements are refused, the list placement stays', () => {
    const found = issues(extension({ place, fieldGroups: [{ key: 'basic', label: 'Basics' }] }));
    expect(found.map((issue) => issue.path)).toEqual(['place.0', 'place.1']);
    expect(found[0].message).toContain('`fieldGroups`');
  });

  it('`relatedLists` written: the list placement is refused, the field and group placements stay', () => {
    const found = issues(extension({ place, relatedLists: ['crm_task'] }));
    expect(found.map((issue) => issue.path)).toEqual(['place.2']);
    expect(found[0].message).toContain('`relatedLists`');
  });
});

describe('the display whitelist is not widened', () => {
  it('`hidden` is not a patchable base-field property', () => {
    expect([...BASE_FIELD_DISPLAY_WHITELIST.field]).not.toContain('hidden');
    const parsed = ObjectExtensionSchema.safeParse(extension({ fieldPatches: { fax: { hidden: true } } }));
    expect(parsed.success).toBe(false);
  });
});

describe('the served decoration', () => {
  it('is a read decoration, so every write strips it', () => {
    expect(RELATED_LISTS_ARRANGEMENT_DECORATION).toBe('_relatedListsArrangement');
    expect(METADATA_READ_DECORATIONS).toContain(RELATED_LISTS_ARRANGEMENT_DECORATION);
  });

  it.each([
    [{ name: 'a' }, undefined],
    [{ _relatedListsArrangement: null }, undefined],
    [{ _relatedListsArrangement: { hidden: ['task'] } }, undefined],
    [{ _relatedListsArrangement: { packageId: 'crm.custom' } }, { packageId: 'crm.custom', hidden: [], unlisted: 'hidden' }],
    [
      { _relatedListsArrangement: { packageId: 'crm.custom', hidden: ['task', 7, ''], unlisted: 'shown' } },
      { packageId: 'crm.custom', hidden: ['task'], unlisted: 'shown' },
    ],
    [undefined, undefined],
  ])('readRelatedListsArrangement(%j) → %j', (object, arrangement) => {
    expect(readRelatedListsArrangement(object)).toEqual(arrangement);
  });

  it.each([
    ['task', false],
    [{ list: 'task' }, false],
    [{ list: 'task', hidden: false }, false],
    [{ list: 'task', hidden: true }, true],
    [{ hidden: true }, false],
  ])('relatedListEntryHidden(%j) → %s', (entry, verdict) => {
    expect(relatedListEntryHidden(entry)).toBe(verdict);
  });

  it.each([
    ['task', 'task', true],
    ['task', 'task.account', true],
    ['task.account', 'task.account', true],
    ['task.account', 'task', false],
    ['task.account', 'task.owner', false],
    ['task', 'task_note', false],
    ['task', 'event.task', false],
  ])('relatedListNameCovers(%j, %j) → %s', (entry, name, verdict) => {
    expect(relatedListNameCovers(entry, name)).toBe(verdict);
  });
});
