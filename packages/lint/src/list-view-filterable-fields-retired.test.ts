// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os lint` reports the list view's retired `filterableFields` BY NAME.
 *
 * @objectstack/spec 18 retired the key with a `retiredKey()` tombstone, so
 * `os validate` and `os build` refuse it at the parse. `os lint` never parses:
 * it judges the `normalizeStackInput` output, and the D2 conversion that
 * strips the key is retired from the load path, so on a non-`defineStack`
 * source the key reaches the list-view field-reference rule as written. That
 * rule used to walk it as a field position — a valid name passed `os lint`,
 * and a stale one was named as an unknown FIELD. Now it reports the
 * retirement, once per list view, with the tombstone's own prescription.
 *
 * This file authors the retired key as a key on purpose, so the spec's
 * tree-scoped absence walk (`view-list-filterable-fields-retirement.test.ts`)
 * excludes it by name, as a member of the retirement kit.
 */

import { describe, expect, it } from 'vitest';

import { runAuthoringRules } from './authoring-rules.js';
import {
  LIST_VIEW_FIELD_DOTTED,
  LIST_VIEW_FIELD_UNKNOWN,
  LIST_VIEW_KEY_RETIRED,
  LIST_VIEW_RETIRED_KEYS_REPORTED,
  listViewRetiredKeyPrescription,
  validateListViewFieldRefs,
} from './validate-list-view-field-refs.js';
import { retiredKeyRemedy } from './validate-retired-permission-residue.js';

type AnyRec = Record<string, unknown>;

const task = {
  name: 'duly_task',
  fields: {
    title: { type: 'text' },
    status: { type: 'select', options: [{ label: 'Open', value: 'open' }] },
    owner: { type: 'lookup', reference: 'duly_person' },
  },
};
const person = { name: 'duly_person', fields: { name: { type: 'text' } } };

const listWith = (extra: AnyRec): AnyRec => ({
  type: 'grid',
  data: { provider: 'object', object: 'duly_task' },
  columns: ['title'],
  ...extra,
});

const stackWithList = (list: AnyRec, objects: unknown[] = [task, person]): AnyRec => ({
  objects,
  views: [{ name: 'task', objectName: 'duly_task', list }],
});

const retiredOf = (findings: Array<{ rule: string }>) => findings.filter((f) => f.rule === LIST_VIEW_KEY_RETIRED);

describe('the list view\'s retired `filterableFields` is reported by name, never as a field position', () => {
  const prescription = listViewRetiredKeyPrescription('filterableFields');

  it('the tombstone publishes its prescription, and the rule reports exactly the retired key it used to walk', () => {
    expect(prescription).not.toBeNull();
    expect(LIST_VIEW_RETIRED_KEYS_REPORTED).toEqual(['filterableFields']);
    // A key that is not a tombstone has no prescription to read.
    expect(listViewRetiredKeyPrescription('columns')).toBeNull();
    expect(listViewRetiredKeyPrescription('no_such_key')).toBeNull();
  });

  it('a VALID field name is reported as the retirement, where it used to pass in silence', () => {
    const findings = validateListViewFieldRefs(stackWithList(listWith({ filterableFields: ['status'] })));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: LIST_VIEW_KEY_RETIRED,
      severity: 'error',
      path: 'views[0].list.filterableFields',
    });
    expect(findings[0]!.message).toContain('`filterableFields`');
    // Read from the tombstone, never retyped.
    expect(findings[0]!.hint).toBe(retiredKeyRemedy(prescription!));
  });

  it('a stale or dotted name is reported as the retirement, never as a field reference', () => {
    const findings = validateListViewFieldRefs(
      stackWithList(listWith({ filterableFields: ['nope_field', 'owner.name'] })),
    );
    expect(findings.map((f) => f.rule)).toEqual([LIST_VIEW_KEY_RETIRED]);
    expect(findings.filter((f) => f.rule === LIST_VIEW_FIELD_UNKNOWN || f.rule === LIST_VIEW_FIELD_DOTTED)).toEqual([]);
  });

  it('is reported at every list-view rung the rule walks', () => {
    const lv = listWith({ filterableFields: [] });
    const stack: AnyRec = {
      objects: [{ ...task, listViews: { mine: lv } }, person],
      views: [
        { name: 'task', objectName: 'duly_task', list: lv, listViews: { open: lv } },
        { name: 'duly_task.flat', object: 'duly_task', viewKind: 'list', ...lv },
        { name: 'duly_task.item', object: 'duly_task', viewKind: 'list', config: lv },
      ],
    };
    expect(retiredOf(validateListViewFieldRefs(stack)).map((f) => (f as { path: string }).path).sort()).toEqual([
      'objects[0].listViews.mine.filterableFields',
      'views[0].list.filterableFields',
      'views[0].listViews.open.filterableFields',
      'views[1].filterableFields',
      'views[2].config.filterableFields',
    ]);
  });

  it('does not depend on the binding: an unresolvable object, a non-object provider and an empty graph all report it', () => {
    const unbound = validateListViewFieldRefs(
      stackWithList(listWith({ data: { provider: 'object', object: 'no_such_object' }, filterableFields: ['x'] })),
    );
    expect(retiredOf(unbound)).toHaveLength(1);
    const api = validateListViewFieldRefs(
      stackWithList(listWith({ data: { provider: 'api', read: { url: '/x' } }, filterableFields: ['x'] })),
    );
    expect(retiredOf(api)).toHaveLength(1);
    const noObjects = validateListViewFieldRefs(stackWithList(listWith({ filterableFields: ['x'] }), []));
    expect(retiredOf(noObjects)).toHaveLength(1);
  });

  it('lit control: a list view without the key reports no retirement, and its surviving filter positions are still judged', () => {
    const findings = validateListViewFieldRefs(
      stackWithList(listWith({ userFilters: { element: 'dropdown', fields: [{ field: 'nope_field' }] } })),
    );
    expect(retiredOf(findings)).toEqual([]);
    expect(findings.map((f) => f.rule)).toEqual([LIST_VIEW_FIELD_UNKNOWN]);
  });

  it('reaches `os lint`\'s registry run on the normalized (unparsed) stack, as an error', () => {
    const stack = stackWithList(listWith({ filterableFields: ['status'] }));
    const findings = runAuthoringRules('lint', { normalized: stack });
    const retired = findings.filter((f) => f.rule === LIST_VIEW_KEY_RETIRED);
    expect(retired).toHaveLength(1);
    expect(retired[0]).toMatchObject({ severity: 'error', path: 'views[0].list.filterableFields' });
  });
});
