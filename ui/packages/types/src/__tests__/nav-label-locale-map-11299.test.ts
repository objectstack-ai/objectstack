/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11299 (Q3) — a navigation entry's `label` takes the spec's
 * `I18nLabel`: a plain string, or an inline locale map.
 *
 * `@objectstack/spec`'s shared nav-item base declares
 * `label: I18nLabelSchema.optional()`, so `{ en: 'Accounts', 'zh-CN': '客户' }`
 * is a spec-valid entry label and the platform's save door (`os validate`)
 * accepts it. This mirror declared `z.string()`, so `safeValidateSchema` —
 * then the function `objectui validate` called — refused the same document with
 * "expected string, received object". The mirror now takes the spec's
 * `I18nLabelSchema` by reference, so the two doors judge a label alike.
 *
 * Pinned as a PARITY TABLE, not as one happy row: every input below is asked of
 * the spec's own `NavigationItemSchema` and of this mirror, and the two answers
 * must agree — a map the spec accepts passes here, and a map the spec refuses
 * (a keyed reference, a non-string entry, a key that is not a locale tag) is
 * refused here too. The plain-string label is the control.
 *
 * The one stated divergence is unchanged and still asserted: an EMPTY string is
 * refused here (`refuseEmptyNavLabel`), where the spec's base accepts it.
 */

import { describe, it, expect } from 'vitest';
import { NavigationItemSchema as SpecNavigationItemSchema } from '@objectstack/spec/ui';
import { NavigationItemSchema } from '../zod/app.zod';
import { safeValidateSchema, StrictAnyComponentSchema } from '../zod/index.zod';

type Issue = { code: string; path: string };
const issuesOf = (r: { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[] }> } }): Issue[] | null =>
  r.success ? null : r.error!.issues.map((i) => ({ code: i.code, path: i.path.map(String).join('.') }));

const app = (navigation: unknown[]) => ({ type: 'app', name: 'acme_crm', label: 'Acme CRM', navigation });

const ACCOUNTS_MAP = { en: 'Accounts', 'zh-CN': '客户' };

/** One entry per label shape, on an `object` entry. */
const entry = (label: unknown) => ({ id: 'nav_accounts', type: 'object', objectName: 'account', label });

describe('objectui#11299 — a nav entry label that is an inline locale map passes the door the spec passes', () => {
  it('`safeValidateSchema` accepts `navigation[0].label` as a locale map, as the spec does', () => {
    expect(SpecNavigationItemSchema.safeParse(entry(ACCOUNTS_MAP)).success).toBe(true);
    expect(issuesOf(safeValidateSchema(app([entry(ACCOUNTS_MAP)])))).toBeNull();
  });

  it('CONTROL — a plain-string label passes both doors', () => {
    expect(SpecNavigationItemSchema.safeParse(entry('Accounts')).success).toBe(true);
    expect(issuesOf(safeValidateSchema(app([entry('Accounts')])))).toBeNull();
  });

  it('the strict authoring face accepts the map too', () => {
    expect(issuesOf(StrictAnyComponentSchema.safeParse(app([entry(ACCOUNTS_MAP)])))).toBeNull();
  });

  it('the parsed entry keeps the map as authored — the validator writes nothing into it', () => {
    const r = NavigationItemSchema.safeParse(entry(ACCOUNTS_MAP));
    expect(r.success && r.data.label).toEqual(ACCOUNTS_MAP);
  });

  it('a map is accepted on every arm — a group heading, a nested child, an area entry and a `doc` entry', () => {
    const group = { id: 'grp_sales', type: 'group', label: { en: 'Sales', 'zh-CN': '销售' }, children: [entry(ACCOUNTS_MAP)] };
    const doc = { id: 'nav_help', type: 'doc', book: 'crm_manual', label: { en: 'Help', 'zh-CN': '帮助' } };
    for (const item of [group, doc]) {
      expect(SpecNavigationItemSchema.safeParse(item).success).toBe(true);
      expect(issuesOf(NavigationItemSchema.safeParse(item))).toBeNull();
    }
    expect(issuesOf(safeValidateSchema(app([group, doc])))).toBeNull();
    const withArea = {
      type: 'app',
      name: 'acme_crm',
      label: 'Acme CRM',
      areas: [{ id: 'area_sales', label: 'Sales', navigation: [entry(ACCOUNTS_MAP)] }],
    };
    expect(issuesOf(safeValidateSchema(withArea))).toBeNull();
  });
});

describe('objectui#11299 — the mirror judges a nav label exactly as the spec does', () => {
  // [row name, label, does the spec accept it?] — the spec column is asserted
  // too, so a spec release that moves a row turns this table red instead of
  // leaving a stale expectation behind.
  const ROWS: Array<[string, unknown, boolean]> = [
    ['a plain string (control)', 'Accounts', true],
    ['an inline locale map', ACCOUNTS_MAP, true],
    ['a map keyed by `default`', { default: 'Accounts' }, true],
    ['a single-entry map with no `en`', { 'zh-CN': '客户' }, true],
    ['the keyed reference form `{ key, defaultValue }`', { key: 'nav.accounts', defaultValue: 'Accounts' }, false],
    ['a map with a non-string entry', { en: 42 }, false],
    ['a map keyed by something that is not a locale tag', { 'not a tag': 'Accounts' }, false],
    ['a number', 42, false],
    ['an array', ['Accounts'], false],
  ];

  it.each(ROWS)('%s', (_name, label, specAccepts) => {
    const item = entry(label);
    expect(SpecNavigationItemSchema.safeParse(item).success).toBe(specAccepts);
    expect(NavigationItemSchema.safeParse(item).success).toBe(specAccepts);
    expect(safeValidateSchema(app([item])).success).toBe(specAccepts);
    if (!specAccepts) {
      // Refused AT the label — not somewhere else in the entry.
      const issues = issuesOf(NavigationItemSchema.safeParse(item))!;
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.every((i) => i.path === 'label' || i.path.startsWith('label.'))).toBe(true);
    }
  });

  it('the stated divergence stands: an EMPTY string is refused here while the spec accepts it', () => {
    expect(SpecNavigationItemSchema.safeParse(entry('')).success).toBe(true);
    expect(issuesOf(NavigationItemSchema.safeParse(entry('')))).toEqual([{ code: 'custom', path: 'label' }]);
  });
});
