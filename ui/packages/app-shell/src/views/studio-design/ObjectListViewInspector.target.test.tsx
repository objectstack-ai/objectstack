// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11823 — which list view an `object` leaf's panel edits, and the
 * shapes it writes and hands the canvas. The pillar-level pins are in
 * `StudioDesignSurface.listViewInspector-11823.test.tsx`.
 */

import { describe, expect, it } from 'vitest';
import { ViewItemSchema } from '@objectstack/spec/ui';
import { isListViewRow, listViewTargetOf, namedListViewOf, newListViewItem } from './ObjectListViewInspector';

const VIEWS = {
  'showcase_task.default': { name: 'showcase_task.default', type: 'grid', columns: [], isDefault: true },
  'showcase_task.tabular': { name: 'showcase_task.tabular', type: 'grid', columns: [], isDefault: false },
};

describe('listViewTargetOf — the view the canvas opens (objectui#11823)', () => {
  it('an entry that lands on a named view edits that view, matched as ObjectView matches it', () => {
    expect(listViewTargetOf('showcase_task', 'tabular', VIEWS)).toEqual({
      objectName: 'showcase_task',
      viewId: 'showcase_task.tabular',
      isDefault: false,
    });
    expect(listViewTargetOf('showcase_task', 'showcase_task.tabular', VIEWS).viewId).toBe('showcase_task.tabular');
  });

  it('a named view the object does not have yet is the one the entry opens once it exists', () => {
    expect(listViewTargetOf('showcase_task', 'urgent', VIEWS)).toEqual({
      objectName: 'showcase_task',
      viewId: 'showcase_task.urgent',
      isDefault: false,
    });
  });

  it('any other entry edits the default list view: the one flagged, else `<object>.default`', () => {
    const flagged = { ...VIEWS, 'showcase_task.default': { ...VIEWS['showcase_task.default'], isDefault: false }, 'showcase_task.tabular': { ...VIEWS['showcase_task.tabular'], isDefault: true } };
    expect(listViewTargetOf('showcase_task', undefined, flagged)).toEqual({
      objectName: 'showcase_task',
      viewId: 'showcase_task.tabular',
      isDefault: true,
    });
    expect(listViewTargetOf('showcase_task', undefined, {})).toEqual({
      objectName: 'showcase_task',
      viewId: 'showcase_task.default',
      isDefault: true,
    });
  });
});

describe('newListViewItem — a view created by the first edit (objectui#11823)', () => {
  it('is a spec-valid ViewItem record, flagged default only as the default list view', () => {
    const created = newListViewItem({ objectName: 'showcase_task', viewId: 'showcase_task.default', isDefault: true }, ['title']);
    expect(ViewItemSchema.safeParse(created).success).toBe(true);
    expect(created).toMatchObject({ name: 'showcase_task.default', object: 'showcase_task', viewKind: 'list', isDefault: true });

    const named = newListViewItem({ objectName: 'showcase_task', viewId: 'showcase_task.urgent', isDefault: false }, []);
    expect(ViewItemSchema.safeParse(named).success).toBe(true);
    expect(named).not.toHaveProperty('isDefault');
  });
});

describe('namedListViewOf — the canvas copy of a view item (objectui#11823)', () => {
  it('is the record\'s list body with the item label', () => {
    expect(
      namedListViewOf({ name: 'a.b', object: 'a', viewKind: 'list', label: 'All', config: { type: 'grid', columns: ['x'] } }),
    ).toEqual({ type: 'grid', columns: ['x'], label: 'All' });
  });

  it('lifts nothing out of an `options` bag: the server folds a stored bag before the row arrives (objectstack#25923)', () => {
    // The Studio view preview folded the bag here until the spec retired it;
    // the D2 conversion `list-view-options-bag-folded` now folds a stored bag
    // onto the top-level blocks on read, so neither door does it again.
    const view = namedListViewOf({ name: 'a.b', config: { type: 'kanban', columns: [], options: { kanban: { groupByField: 's' } } } });
    expect(view).not.toHaveProperty('kanban');
    expect(view).toMatchObject({ type: 'kanban', columns: [] });
  });
});

describe('isListViewRow — only a list view is edited (objectui#11823)', () => {
  it('reads the spec\'s family discriminant, and a list body\'s required `columns` on a row with none', () => {
    expect(isListViewRow({ name: 'a.b', object: 'a', viewKind: 'list', config: { type: 'grid', columns: [] } })).toBe(true);
    expect(isListViewRow({ name: 'a.b', object: 'a', type: 'grid', columns: ['x'] })).toBe(true);
  });

  it('a form view, or a body that is no list, is never taken for one', () => {
    expect(isListViewRow({ name: 'a.b', object: 'a', viewKind: 'form', config: { type: 'simple', sections: [] } })).toBe(false);
    expect(isListViewRow({ name: 'a.b', label: 'a.b' })).toBe(false);
  });
});
