// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The design mode's menu model (objectstack#36538): id-less twins are matched
 * to their own served copies (review N7), and an own entry put in or past
 * another package's closing entries is drawn where the save puts it (N10).
 */

import { describe, expect, it } from 'vitest';
import {
  rebaseMenuEdits,
  removeEntry,
  storedEntriesById,
  withEntryIds,
  withOwnBeforeForeignRuns,
  type Menu,
} from '../designModeMenuModel';

const ids = (menu: Menu): unknown[] => menu.map((e) => (Array.isArray(e.children) ? [e.id ?? e.type, ids(e.children as Menu)] : e.id ?? e.type));

describe('id-less twins are matched to their own served copy (objectstack#36538, review N7)', () => {
  // Two id-less entries of one group, the same type and target; the earlier
  // one needs a permission this reader lacks, so the server prunes it.
  const HIDDEN = { type: 'object', objectName: 'crm_lead', requiredPermissions: ['hr.admin'] };
  const SHOWN = { type: 'object', objectName: 'crm_lead' };
  const STORED: Menu = [{ id: 'sales', type: 'group', label: 'Sales', children: [HIDDEN, SHOWN] }];
  const SERVED = withEntryIds([{ id: 'sales', type: 'group', label: 'Sales', children: [SHOWN] }]);

  it('removing the shown twin removes it, and keeps the twin the reader was not shown', () => {
    const shownId = String((SERVED[0].children as Menu)[0].id);
    const rebased = rebaseMenuEdits(SERVED, removeEntry(SERVED, shownId), STORED);
    expect(rebased[0].children).toEqual([HIDDEN]);
  });

  it('the stored entry behind the shown twin is the shown one', () => {
    const shownId = String((SERVED[0].children as Menu)[0].id);
    expect(storedEntriesById(SERVED, STORED).get(shownId)).toBe(SHOWN);
  });

  it('two separators, the earlier one pruned: removing the shown one keeps the pruned one', () => {
    const pruned = { type: 'separator', requiredPermissions: ['hr.admin'] };
    const stored: Menu = [pruned, { id: 'leads', type: 'object', objectName: 'crm_lead' }, { type: 'separator' }];
    const served = withEntryIds([{ id: 'leads', type: 'object', objectName: 'crm_lead' }, { type: 'separator' }]);
    const sepId = String(served[1].id);
    expect(rebaseMenuEdits(served, removeEntry(served, sepId), stored)).toEqual([pruned, stored[1]]);
  });

  it('CONTROL: twins equal in every key are matched by their place: removing the second removes the second', () => {
    const sep = () => ({ type: 'separator' });
    const stored: Menu = [sep(), { id: 'a', type: 'page', pageName: 'a' }, sep(), { id: 'b', type: 'page', pageName: 'b' }, sep()];
    const served = withEntryIds(stored.map((e) => ({ ...e })));
    const second = String(served[2].id);
    const rebased = rebaseMenuEdits(served, removeEntry(served, second), stored);
    expect(rebased).toHaveLength(4);
    expect(rebased[0]).toBe(stored[0]);
    expect(rebased[2]).toBe(stored[3]);
    expect(rebased[3]).toBe(stored[4]);
  });

  it('CONTROL: an id-less entry whose served copy differs in a key is still matched by its type and target', () => {
    const stored: Menu = [{ type: 'object', objectName: 'crm_lead', label: { en: 'Leads' } }];
    const served = withEntryIds([{ type: 'object', objectName: 'crm_lead', label: 'Leads' }]);
    expect(storedEntriesById(served, stored).get(String(served[0].id))).toBe(stored[0]);
  });
});

describe("an own entry in or past another package's closing entries is drawn before them (objectstack#36538, review N10)", () => {
  const SERVED: Menu = [
    { id: 'home', type: 'page', pageName: 'home' },
    {
      id: 'sales',
      type: 'group',
      children: [
        { id: 'leads', type: 'object', objectName: 'crm_lead' },
        { id: 'partner_a', type: 'page', pageName: 'partner_a' },
        { id: 'partner_b', type: 'page', pageName: 'partner_b' },
      ],
    },
    { id: 'partner_top', type: 'page', pageName: 'partner_top' },
  ];
  const foreign = (id: string) => id.startsWith('partner_');

  it('an entry added after the run, or inside it, is put just before it; the run keeps its order', () => {
    const added = { id: 'new', type: 'page', pageName: 'new' };
    const inside = { id: 'mid', type: 'page', pageName: 'mid' };
    const menu: Menu = [
      SERVED[0],
      { ...SERVED[1], children: [...(SERVED[1].children as Menu).slice(0, 2), inside, (SERVED[1].children as Menu)[2], added] },
      SERVED[2],
      { id: 'top_new', type: 'page', pageName: 'top_new' },
    ];
    expect(ids(withOwnBeforeForeignRuns(menu, SERVED, foreign))).toEqual([
      'home',
      ['sales', ['leads', 'mid', 'new', 'partner_a', 'partner_b']],
      'top_new',
      'partner_top',
    ]);
  });

  it('CONTROL: a menu with no own entry past a run is the same menu', () => {
    const menu: Menu = [SERVED[0], { ...SERVED[1] }, SERVED[2]];
    expect(withOwnBeforeForeignRuns(menu, SERVED, foreign)).toBe(menu);
  });

  it('CONTROL: with no entry another package\'s, nothing moves', () => {
    const menu: Menu = [...SERVED, { id: 'top_new', type: 'page', pageName: 'top_new' }];
    expect(withOwnBeforeForeignRuns(menu, SERVED, () => false)).toBe(menu);
  });
});
