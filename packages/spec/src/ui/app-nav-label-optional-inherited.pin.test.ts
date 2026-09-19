// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A navigation entry's `label` is OPTIONAL, and its absence is INHERITANCE —
 * not a hole and not a stored value.
 *
 * ## The two directions, and why each needs its own pin
 *
 * The maintainer's ruling (cloud#2021, executed as objectui#9868 letter A)
 * bought exactly one thing: an `app.navigation` entry may omit `label`, and the
 * shell then renders the CURRENT label of whatever the entry opens — the view's
 * label when it names a labelled view, else the object's / dashboard's label.
 * Nothing is stored for that case: no `inherited` flag, no materialised copy.
 * That is what makes a renamed target show its new name on the next render
 * instead of a snapshot taken when the entry was authored.
 *
 * Both halves fail silently if only one is pinned:
 *
 * - **ABSENT parses.** A `label` that drifts back to required does not look
 *   like a spec regression downstream; it looks like objectui's nav writer
 *   producing invalid metadata, one repo over, after the relaxation it was
 *   sequenced behind has already shipped.
 * - **PRESENT is verbatim.** The inheritance is a RENDER-TIME resolution, so
 *   the tempting implementation — fill the label in during parse — would keep
 *   direction one green while destroying the ruling: an entry whose target is
 *   later renamed would then be frozen at whatever the parse wrote, and an
 *   author's own wording would be overwritten by their target's. This half
 *   asserts the parse ADDS nothing: no key appears that the author did not
 *   write, and a label the author did write comes back byte-for-byte.
 *
 * ## Why the three sibling `label` sites are pinned here too
 *
 * `app.zod.ts` carries four `label: I18nLabelSchema` declarations. The ruling
 * covers ONE of them — the nav-item base, which is spread into eight branch
 * declarations, so relaxing it there moves all eight at once. The Area, the
 * context-selector Dropdown and the App label are a different surface and were
 * never ruled on: each names a container the author is creating, not a target
 * it could inherit from, so there is nothing for an absent label to resolve
 * against. They are asserted here because "make the nav label optional" is an
 * edit one character away from "make every label in this file optional", and
 * that over-reach would leave every other gate in the repo green.
 */

import { describe, it, expect } from 'vitest';
import {
  NavigationItemSchema,
  ObjectNavItemSchema,
  DashboardNavItemSchema,
  PageNavItemSchema,
  UrlNavItemSchema,
  ReportNavItemSchema,
  ActionNavItemSchema,
  ComponentNavItemSchema,
  GroupNavItemSchema,
  NavigationAreaSchema,
  AppContextSelectorSchema,
  AppSchema,
} from './app.zod';

/**
 * The eight branch declarations that spread `...BaseNavItemSchema.shape`, with
 * the rest of the payload each one needs to be otherwise-valid. The ninth nav
 * branch, `separator`, spreads nothing and has never had a `label` — it is
 * absent from this table on purpose, and its own guidance table already
 * prescribes `group` for a titled divider.
 */
const SPREAD_BRANCHES = [
  ['object', ObjectNavItemSchema, { id: 'nav_a', type: 'object', objectName: 'sys_user' }],
  ['dashboard', DashboardNavItemSchema, { id: 'nav_b', type: 'dashboard', dashboardName: 'sales' }],
  ['page', PageNavItemSchema, { id: 'nav_c', type: 'page', pageName: 'welcome' }],
  ['url', UrlNavItemSchema, { id: 'nav_d', type: 'url', url: 'https://example.com' }],
  ['report', ReportNavItemSchema, { id: 'nav_e', type: 'report', reportName: 'quarterly' }],
  ['action', ActionNavItemSchema, { id: 'nav_f', type: 'action', actionDef: { actionName: 'do_it' } }],
  ['component', ComponentNavItemSchema, { id: 'nav_g', type: 'component', componentRef: 'metadata:resource' }],
  ['group', GroupNavItemSchema, { id: 'nav_h', type: 'group' }],
] as const;

describe('nav item label — ABSENT parses and inherits at render time', () => {
  it('accepts an object nav item with no label through the union', () => {
    const result = NavigationItemSchema.safeParse({
      id: 'nav_users',
      type: 'object',
      objectName: 'sys_user',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 'nav_users', type: 'object', objectName: 'sys_user' });
  });

  it.each(SPREAD_BRANCHES)('accepts a %s nav item with no label (branch schema)', (_kind, schema, payload) => {
    const result = schema.safeParse(payload);

    expect(result.success).toBe(true);
    // The relaxation propagates through the spread — it is not a union-level
    // tolerance that the branch itself would still refuse.
    expect(result.error).toBeUndefined();
  });

  it('accepts a label-less entry nested under a group', () => {
    const result = NavigationItemSchema.safeParse({
      id: 'nav_sales',
      label: 'Sales',
      type: 'group',
      children: [{ id: 'nav_accounts', type: 'object', objectName: 'account' }],
    });

    expect(result.success).toBe(true);
  });

  it('is a WIDENING only — an unknown key is still refused on a label-less entry', () => {
    const result = NavigationItemSchema.safeParse({
      id: 'nav_users',
      type: 'object',
      objectName: 'sys_user',
      labl: 'Users',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true);
  });
});

describe('nav item label — PRESENT is verbatim, and ABSENT materialises nothing', () => {
  it('keeps a string label byte-for-byte', () => {
    const result = NavigationItemSchema.safeParse({
      id: 'nav_users',
      label: 'Team directory',
      type: 'object',
      objectName: 'sys_user',
    });

    expect(result.success).toBe(true);
    expect((result.data as { label?: unknown }).label).toBe('Team directory');
  });

  it('keeps an inline locale map byte-for-byte', () => {
    const label = { en: 'Users', 'zh-CN': '用户' };
    const result = NavigationItemSchema.safeParse({
      id: 'nav_users',
      label,
      type: 'object',
      objectName: 'sys_user',
    });

    expect(result.success).toBe(true);
    expect((result.data as { label?: unknown }).label).toEqual(label);
  });

  it('writes no label — and no inherited-marker key — when the author wrote none', () => {
    const result = NavigationItemSchema.safeParse({
      id: 'nav_users',
      type: 'object',
      objectName: 'sys_user',
    });

    expect(result.success).toBe(true);
    // Resolution is the renderer's job at render time. A parse that filled this
    // in would freeze the entry at the target's name as of authoring.
    expect(Object.keys(result.data as object)).not.toContain('label');
    expect(Object.keys(result.data as object)).toEqual(['id', 'type', 'objectName']);
  });
});

describe('the three sibling label sites this ruling does NOT cover stay required', () => {
  it('NavigationArea.label is still required', () => {
    const result = NavigationAreaSchema.safeParse({ id: 'area_sales', navigation: [] });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'label')).toBe(true);
    // Control: the same payload WITH a label parses, so the leg above is a
    // verdict about `label` and not about the rest of the packet.
    expect(NavigationAreaSchema.safeParse({ id: 'area_sales', label: 'Sales', navigation: [] }).success).toBe(true);
  });

  it('AppContextSelector.label is still required', () => {
    const payload = { id: 'active_package', optionsSource: { endpoint: '/api/v1/packages' } };
    const result = AppContextSelectorSchema.safeParse(payload);

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'label')).toBe(true);
    expect(AppContextSelectorSchema.safeParse({ ...payload, label: 'Package' }).success).toBe(true);
  });

  it('App.label is still required', () => {
    const result = AppSchema.safeParse({ name: 'crm' });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'label')).toBe(true);
    expect(AppSchema.safeParse({ name: 'crm', label: 'CRM' }).success).toBe(true);
  });
});
