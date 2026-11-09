// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29951 — the two platform record pages draw the object's placed header
 * actions LIVE, through `page:header.placedActions: true` (#30018, ruling
 * record 6624172200, letter A), never a copied id list.
 *
 * Both pages were `kind: 'slotted'` until the `tabs` slot retired (#27053);
 * the synthesized header they rendered read every object action placed at
 * `record_header` or `record_more` at render time, an action another package
 * places on the object included. Rebuilt as `kind: 'full'` pages they named
 * the platform's own ids instead, and an authored id list is the whole set
 * (#11592), so an installed package's header action on `sys_user` stopped
 * drawing in the 18.3 Console (#29951). This pin holds the opt-in on each page
 * and no list beside it (the two are refused together), so the header cannot
 * freeze again.
 *
 * Read from the shipped page and object metadata, and parsed through the
 * `page:header` row the props door judges (`ComponentPropsMap`).
 */

import { describe, expect, it } from 'vitest';
import { ComponentPropsMap } from '@objectstack/spec/ui';
import { SysOrganization } from '../identity/sys-organization.object.js';
import { SysUser } from '../identity/sys-user.object.js';
import { SysOrganizationDetailPage } from './sys-organization.page.js';
import { SysUserDetailPage } from './sys-user.page.js';

type Rec = Record<string, unknown>;

/** The object's actions placed at the header, declaration order, first of a name. */
function headerPlacedIds(object: { actions?: unknown }): string[] {
  const ids: string[] = [];
  for (const action of (object.actions ?? []) as Rec[]) {
    const locations = (action.locations ?? []) as string[];
    const name = action.name as string;
    if (!locations.includes('record_header') && !locations.includes('record_more')) continue;
    if (!ids.includes(name)) ids.push(name);
  }
  return ids;
}

/** The page's `page:header` node properties. */
function headerProps(page: { regions?: unknown }): Rec | undefined {
  const components = ((page.regions as Rec[])[0]!.components ?? []) as Rec[];
  const header = components.find((c) => c.type === 'page:header');
  return header?.properties as Rec | undefined;
}

describe.each([
  ['sys_organization_detail', SysOrganizationDetailPage, SysOrganization],
  ['sys_user_detail', SysUserDetailPage, SysUser],
] as const)('%s — the header draws the object\'s placed actions live', (_name, page, object) => {
  it('is non-vacuous: the object places actions at the header', () => {
    expect(headerPlacedIds(object).length).toBeGreaterThan(0);
  });

  it('opts in with placedActions: true and names no id list', () => {
    expect(headerProps(page)).toEqual({ placedActions: true });
  });

  it('is a header the props door accepts', () => {
    const parsed = ComponentPropsMap['page:header'].safeParse(headerProps(page));
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
  });
});
