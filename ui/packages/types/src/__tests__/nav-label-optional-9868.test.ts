/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9868 — a navigation entry's `label` is OPTIONAL, matching
 * `@objectstack/spec` 17.5.0 (the cloud#2021 letter-A ruling).
 *
 * The spec's shared nav-item base declares `label: I18nLabelSchema.optional()`
 * with the semantic "absent ⇒ inherit the target's CURRENT label at render
 * time; present ⇒ verbatim". So this mirror accepts a label-less entry for
 * EXACTLY the types the spec accepts one for, and — the half that keeps the
 * ruling honest — fills nothing in: a parsed entry carries no `label` key, so
 * the renderer (not the validator) answers what it shows.
 *
 * What did NOT relax, each asserted with its own path:
 *  - `id` is still required on every entry (identity is the target);
 *  - a separator is unchanged (a bare one passes, a labelled one is refused);
 *  - an EMPTY label is refused — `''` is a present label, so it would render
 *    empty text and opt the entry out of inheritance.
 */

import { describe, it, expect } from 'vitest';
import { NavigationItemSchema as SpecNavigationItemSchema } from '@objectstack/spec/ui';
import { NavigationItemSchema, NavigationItemTypeSchema } from '../zod/app.zod.js';
import { menuItemToNavigationItem } from '../app.js';

/**
 * One minimal spec-valid entry per objectui entry type, WITHOUT a label. Keyed
 * by the mirror's own type enum, so a type added there with no fixture here
 * fails the coverage assertion below instead of going unmeasured.
 */
const UNLABELLED: Record<string, Record<string, unknown>> = {
  object: { id: 'nav_obj', type: 'object', objectName: 'account' },
  dashboard: { id: 'nav_dash', type: 'dashboard', dashboardName: 'sales_overview' },
  page: { id: 'nav_page', type: 'page', pageName: 'home' },
  report: { id: 'nav_rep', type: 'report', reportName: 'win_rate' },
  url: { id: 'nav_url', type: 'url', url: 'https://example.com/handbook' },
  component: { id: 'nav_cmp', type: 'component', componentRef: 'metadata:directory' },
  group: { id: 'nav_grp', type: 'group', children: [] },
  action: { id: 'nav_act', type: 'action', actionDef: { actionName: 'sync_now' } },
  // objectui#11197: the enum now reads the spec's discriminator, so `doc` is an
  // entry type here too — and a label-less one inherits like every sibling.
  doc: { id: 'nav_doc', type: 'doc', book: 'crm_manual' },
};

const ENTRY_TYPES = NavigationItemTypeSchema.options.filter((type) => type !== 'separator');

function issues(input: unknown) {
  const r = NavigationItemSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code }));
}

describe('objectui#9868 — `label` is optional on every navigation entry, as in the spec', () => {
  it('has an unlabelled fixture for every entry type the mirror declares', () => {
    expect(Object.keys(UNLABELLED).sort()).toEqual([...ENTRY_TYPES].sort());
  });

  it.each(ENTRY_TYPES)('%s: the spec accepts it without a label, and so does the mirror', (type) => {
    const entry = UNLABELLED[type];
    // The spec is the contract: measured, not assumed, per type.
    expect(SpecNavigationItemSchema.safeParse(entry).success).toBe(true);
    // The mirror now agrees.
    const r = NavigationItemSchema.safeParse(entry);
    expect(r.success).toBe(true);
    // ⭐ Nothing is filled in at parse time: absent stays absent, so the
    // renderer resolves it on every render instead of reading a stored copy.
    expect(r.success && r.data).not.toHaveProperty('label');
  });

  it.each(ENTRY_TYPES)('%s: a present label is still accepted and kept verbatim (control)', (type) => {
    const entry = { ...UNLABELLED[type], label: 'account' };
    expect(SpecNavigationItemSchema.safeParse(entry).success).toBe(true);
    const r = NavigationItemSchema.safeParse(entry);
    expect(r.success && r.data.label).toBe('account');
  });

  it('still requires an id — identity is the target, and only the text is inherited', () => {
    expect(issues({ type: 'object', objectName: 'account' })).toEqual([{ path: 'id', code: 'custom' }]);
    expect(issues({ id: '', type: 'object', objectName: 'account' })).toEqual([{ path: 'id', code: 'custom' }]);
  });

  it('refuses an EMPTY label: it is present, so it would render empty text instead of inheriting', () => {
    const r = NavigationItemSchema.safeParse({ id: 'nav_obj', type: 'object', objectName: 'account', label: '' });
    expect(r.success).toBe(false);
    expect(issues({ id: 'nav_obj', type: 'object', objectName: 'account', label: '' })).toEqual([
      { path: 'label', code: 'custom' },
    ]);
    // The refusal names the fix: omit the key.
    expect(!r.success && r.error.issues[0].message).toMatch(/^`label` is empty on a navigation item of type 'object': omit the key/);
  });

  it('leaves the separator unchanged: a bare one passes, a labelled one is refused (objectui#10867)', () => {
    expect(NavigationItemSchema.safeParse({ type: 'separator' }).success).toBe(true);
    expect(issues({ type: 'separator', label: 'Section' })).toEqual([{ path: 'label', code: 'custom' }]);
  });
});

describe('objectui#9868 — `menuItemToNavigationItem` writes no empty label', () => {
  it.each([
    ['a path item', { type: 'item' as const, path: '/leads' }],
    ['an href item', { type: 'item' as const, href: 'https://example.com' }],
    ['a group', { type: 'group' as const, children: [] }],
  ])('%s with no label converts to an entry with NO `label` key, which validates', (_name, menuItem) => {
    const item = menuItemToNavigationItem(menuItem, 0);
    expect(item).not.toHaveProperty('label');
    expect(NavigationItemSchema.safeParse(item).success).toBe(true);
  });

  it('keeps an authored label verbatim (control)', () => {
    expect(menuItemToNavigationItem({ type: 'item', label: 'Leads', path: '/leads' }, 0).label).toBe('Leads');
  });
});
