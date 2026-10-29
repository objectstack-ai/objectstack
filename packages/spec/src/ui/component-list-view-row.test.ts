// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { ComponentPropsMap } from './component.zod';
import { ListViewSchema, VIEW_METADATA_MEMBERS } from './view.zod';
import { PageSchema } from './page.zod';
import { REACT_RETIRED_OVERLAY_PROPS } from './react-blocks';
import { LIST_VIEW_RETIRED_ALIASES } from './list-view-retired-aliases';

/**
 * #22444, ruling C — `ComponentPropsMap['list-view']`: a list view embedded on
 * a page is judged as a list view.
 *
 * Pins the ruling's own list: a page `list-view` carrying `kanban.groupField`
 * is flagged naming the key, and an `options` bag is flagged whole (#25923);
 * one with contract keys only
 * passes; the old spellings `objectName` / `viewType` are flagged with the
 * react tier's prescription. Plus what the row is built from — the list view's
 * members and checks by reference, and the list overlay member's two
 * differences — and the half that does NOT move: `PageSchema`'s accept set.
 * The lint finding these issues become is pinned in `@objectstack/lint`
 * (`validate-component-props-list-view-22444.test.ts`).
 */
const row = ComponentPropsMap['list-view'];

const issuesOf = (value: unknown) => {
  const r = row.safeParse(value);
  return r.success
    ? []
    : r.error.issues.map((i) => ({ code: i.code, path: i.path.join('.'), keys: 'keys' in i ? i.keys : undefined }));
};

describe("ComponentPropsMap['list-view'] (#22444)", () => {
  describe('the ruling\'s pins', () => {
    it('`kanban.groupField` is flagged, naming the key on the kanban block', () => {
      const issues = issuesOf({ data: { provider: 'object', object: 'deal' }, kanban: { groupByField: 'stage', columns: ['name'], groupField: 'owner' } });
      expect(issues).toEqual([{ code: 'unrecognized_keys', path: 'kanban', keys: ['groupField'] }]);
    });

    // [#25923] The bag is retired on the list overlay, whose member this row
    // shares: any `options` is flagged at `options`, with the tombstone's text.
    it.each([
      ['`options.grid`', { grid: { pageSize: 10 } }],
      ['an `options.KIND` block', { kanban: { groupField: 'owner' } }],
      ['an empty bag', {}],
    ])('%s is flagged whole at `options`, with the move-to-the-top-level prescription', (_label, options) => {
      expect(issuesOf({ options })).toEqual([{ code: 'invalid_type', path: 'options', keys: undefined }]);
      const r = row.safeParse({ options });
      expect(r.success ? '' : r.error.issues[0]!.message).toMatch(/^A list view's `options` bag was removed in @objectstack\/spec 18\.3\.0/);
    });

    it.each([
      ['an object-bound kanban', { data: { provider: 'object', object: 'deal' }, type: 'kanban', columns: ['name'], kanban: { groupByField: 'stage', columns: ['name'] } }],
      ['a column-less node (bound by a saved view, or drawing the object\'s fields)', { data: { provider: 'object', object: 'deal' } }],
      ['an empty bag (the node binds through `dataSource`)', {}],
      ['the shipped page node shape in the spec spelling', {
        data: { provider: 'object', object: 'crm_lead' },
        type: 'grid',
        columns: ['full_name', 'company'],
        filter: [{ field: 'owner_id', operator: 'equals', value: '{current_user_id}' }],
        sort: [{ field: 'rating', order: 'desc' }],
      }],
    ])('contract keys only pass — %s', (_label, props) => {
      expect(issuesOf(props)).toEqual([]);
    });

    it.each(['objectName', 'viewType'] as const)('`%s` is flagged by name, with the react tier\'s prescription for the same alias', (alias) => {
      const value = alias === 'objectName' ? 'deal' : 'kanban';
      const r = row.safeParse({ [alias]: value });
      expect(r.success).toBe(false);
      const issues = r.success ? [] : r.error.issues;
      expect(issues.map((i) => ({ code: i.code, path: i.path.join('.'), keys: 'keys' in i ? i.keys : undefined }))).toEqual([
        { code: 'unrecognized_keys', path: '', keys: [alias] },
      ]);
      // One prescription, two tiers: the refusal carries the react tier's note
      // for this alias verbatim, and names the list view member that replaces it.
      expect(issues[0]!.message).toContain(LIST_VIEW_RETIRED_ALIASES[alias].note);
      expect(issues[0]!.message).toContain(`\`${LIST_VIEW_RETIRED_ALIASES[alias].replacedBy}\``);
    });
  });

  describe('built from the list view, by reference', () => {
    const shape = (row as unknown as { shape: Record<string, unknown> }).shape;

    it('every list view member is the list view\'s own schema object, except `columns`', () => {
      for (const [key, member] of Object.entries(ListViewSchema.shape)) {
        if (key === 'columns') continue;
        expect(shape[key], key).toBe(member);
      }
    });

    it('the two overlay-member differences: `columns` optional, `options` the overlay member\'s own tombstone', () => {
      expect((shape.columns as { unwrap: () => unknown }).unwrap()).toBe(ListViewSchema.shape.columns);
      expect(shape.options).toBe(VIEW_METADATA_MEMBERS.listOverlay.shape.options);
      // And nothing else: the row's keys are the list view's plus `options`.
      expect(Object.keys(shape).sort()).toEqual([...Object.keys(ListViewSchema.shape), 'options'].sort());
    });

    it('the list view\'s object-level checks are attached: a chart with no dataset binding is refused as on the authoring door', () => {
      const chart = { type: 'chart', columns: ['name'] };
      const authoring = ListViewSchema.safeParse(chart);
      expect(authoring.success).toBe(false);
      const here = row.safeParse(chart);
      expect(here.success).toBe(false);
      const codes = (r: typeof here) => (r.success ? [] : r.error.issues.map((i) => `${i.code}@${i.path.join('.')}`));
      expect(codes(here)).toEqual(codes(authoring));
    });

    it('the react tier refuses the same two aliases from the same declaration', () => {
      expect(REACT_RETIRED_OVERLAY_PROPS.ListView).toBe(LIST_VIEW_RETIRED_ALIASES);
    });
  });

  it('`PageSchema`\'s accept set does not move: the carrier stays an open record, and the row is the lint\'s judge', () => {
    const page = {
      name: 'sales_home',
      label: 'Sales Home',
      regions: [{
        name: 'main',
        components: [{ type: 'list-view', properties: { objectName: 'deal', viewType: 'kanban', kanban: { groupField: 'owner' }, options: { grid: {} } } }],
      }],
    };
    expect(PageSchema.safeParse(page).success).toBe(true);
  });
});
