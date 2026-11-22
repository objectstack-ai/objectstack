// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The menu edits of the design mode (objectstack#36363) as functions of the
 * app's `navigation`: each answers a new tree, the one given is untouched.
 */

import { describe, expect, it } from 'vitest';
import {
  canMoveBy,
  entryFor,
  groupsOf,
  insertEntry,
  menuTargets,
  moveBy,
  moveEntry,
  newEntryId,
  patchEntry,
  placeOf,
  removeEntry,
  targetKeyOf,
  withEntryIds,
  type Menu,
} from '../designModeMenu';

const MENU: Menu = Object.freeze([
  { id: 'home', type: 'dashboard', dashboardName: 'home' },
  {
    id: 'sales',
    type: 'group',
    label: 'Sales',
    children: [
      { id: 'leads', type: 'object', objectName: 'crm_lead' },
      { id: 'opps', type: 'object', objectName: 'crm_opportunity' },
      { id: 'mine', type: 'object', objectName: 'crm_opportunity', viewName: 'crm_opportunity.mine' },
    ],
  },
  { id: 'insights', type: 'group', label: 'Insights', children: [{ id: 'pipeline', type: 'report', reportName: 'pipeline' }] },
]);

const ids = (menu: Menu): unknown[] =>
  menu.map((e) => (Array.isArray(e.children) ? [e.id, ids(e.children as Menu)] : e.id));

describe('the menu edits (objectstack#36363)', () => {
  it('move up / move down swap within the group, and stop at its ends', () => {
    expect(ids(moveBy(MENU, 'opps', -1))).toEqual(['home', ['sales', ['opps', 'leads', 'mine']], ['insights', ['pipeline']]]);
    expect(ids(moveBy(MENU, 'opps', 1))).toEqual(['home', ['sales', ['leads', 'mine', 'opps']], ['insights', ['pipeline']]]);
    expect(moveBy(MENU, 'leads', -1)).toBe(MENU);
    expect([canMoveBy(MENU, 'leads', -1), canMoveBy(MENU, 'leads', 1), canMoveBy(MENU, 'mine', 1)]).toEqual([false, true, false]);
    expect(ids(MENU)).toEqual(['home', ['sales', ['leads', 'opps', 'mine']], ['insights', ['pipeline']]]);
  });

  it('move to a group appends there; to the top level too; never into itself', () => {
    expect(ids(moveEntry(MENU, 'leads', 'insights', Infinity))).toEqual([
      'home',
      ['sales', ['opps', 'mine']],
      ['insights', ['pipeline', 'leads']],
    ]);
    expect(ids(moveEntry(MENU, 'pipeline', null, Infinity))).toEqual(['home', ['sales', ['leads', 'opps', 'mine']], ['insights', []], 'pipeline']);
    expect(moveEntry(MENU, 'sales', 'sales', 0)).toBe(MENU);
  });

  it('a drop in the same group lands after the entry below it and before the one above it', () => {
    // `to.index` is read before the move, as the editor passes it.
    expect(ids(moveEntry(MENU, 'leads', 'sales', placeOf(MENU, 'mine')!.index))).toEqual([
      'home',
      ['sales', ['opps', 'mine', 'leads']],
      ['insights', ['pipeline']],
    ]);
    expect(ids(moveEntry(MENU, 'mine', 'sales', placeOf(MENU, 'leads')!.index))).toEqual([
      'home',
      ['sales', ['mine', 'leads', 'opps']],
      ['insights', ['pipeline']],
    ]);
  });

  it('insert puts an entry at a place, clamped to the group; remove takes it off', () => {
    const added = insertEntry(MENU, 'insights', 0, { id: 'x', type: 'page', pageName: 'x' });
    expect(ids(added)).toEqual(['home', ['sales', ['leads', 'opps', 'mine']], ['insights', ['x', 'pipeline']]]);
    expect(ids(insertEntry(MENU, null, 99, { id: 'y', type: 'url', url: 'https://e.x' }))).toEqual([
      'home',
      ['sales', ['leads', 'opps', 'mine']],
      ['insights', ['pipeline']],
      'y',
    ]);
    expect(ids(removeEntry(added, 'x'))).toEqual(ids(MENU));
  });

  it('rename and icon patch the entry; a key patched to undefined goes', () => {
    const renamed = patchEntry(MENU, 'leads', { label: 'Prospects', icon: 'user-plus' });
    expect((renamed[1].children as Menu)[0]).toEqual({ id: 'leads', type: 'object', objectName: 'crm_lead', label: 'Prospects', icon: 'user-plus' });
    expect((patchEntry(renamed, 'leads', { label: undefined }) [1].children as Menu)[0]).not.toHaveProperty('label');
  });

  it('what the menu opens, one key per thing; a picked thing makes the entry that opens it', () => {
    expect([...menuTargets(MENU)].sort()).toEqual(
      ['dashboard:home', 'object:crm_lead', 'object:crm_opportunity', 'report:pipeline', 'view:crm_opportunity.mine'].sort(),
    );
    expect(targetKeyOf({ type: 'object', objectName: 'a', recordId: '1' })).toBeNull();
    expect(entryFor('view', 'crm_lead.hot', 'n1')).toEqual({ id: 'n1', type: 'object', objectName: 'crm_lead', viewName: 'crm_lead.hot' });
    expect(entryFor('url', 'https://e.x', 'n2', { label: 'Docs', url: 'https://e.x' })).toEqual({
      id: 'n2',
      type: 'url',
      label: 'Docs',
      url: 'https://e.x',
    });
    for (const kind of ['object', 'dashboard', 'report', 'page'] as const) {
      expect(targetKeyOf(entryFor(kind, 'n', 'id'))).toBe(`${kind}:n`);
    }
  });

  it('an entry without an id gets one no entry holds; groups are listed with their depth', () => {
    const served: Menu = [{ type: 'object', objectName: 'a' }, { id: 'nav_item_1', type: 'group', children: [{ type: 'page', pageName: 'p' }] }];
    const withIds = withEntryIds(served);
    expect(ids(withIds)).toEqual(['nav_item_2', ['nav_item_1', ['nav_item_3']]]);
    expect(withEntryIds(MENU)).toBe(MENU);
    expect(newEntryId(withIds)).toBe('nav_item_4');
    expect(groupsOf(MENU).map((g) => [g.id, g.depth])).toEqual([
      ['sales', 0],
      ['insights', 0],
    ]);
  });
});
