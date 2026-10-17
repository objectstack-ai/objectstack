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
 * or `options.grid` is flagged naming the key; one with contract keys only
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

    it('`options.grid` is flagged, naming the key on the `options` bag', () => {
      expect(issuesOf({ options: { grid: { pageSize: 10 } } })).toEqual([
        { code: 'unrecognized_keys', path: 'options', keys: ['grid'] },
      ]);
    });

    it('`options.KIND` is judged by the kind\'s own block: an unknown key under it is flagged by name', () => {
      expect(issuesOf({ options: { kanban: { groupField: 'owner' } } })).toEqual([
        { code: 'unrecognized_keys', path: 'options.kanban', keys: ['groupField'] },
      ]);
    });

    it.each([
      ['an object-bound kanban', { data: { provider: 'object', object: 'deal' }, type: 'kanban', columns: ['name'], kanban: { groupByField: 'stage', columns: ['name'] } }],
      ['a column-less node (bound by a saved view, or drawing the object\'s fields)', { data: { provider: 'object', object: 'deal' } }],
      ['an empty bag (the node binds through `dataSource`)', {}],
      ['the legacy per-kind underlay, partial', { type: 'kanban', options: { kanban: { titleField: 'name' } } }],
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

    it('the two overlay-member differences: `columns` optional, `options` the overlay member\'s own judged bag', () => {
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
