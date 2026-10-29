// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27053 — the two platform record pages name the header actions the
 * synthesizer used to read live from the object.
 *
 * Both pages were `kind: 'slotted'` until the `tabs` slot retired; the
 * synthesized header they rendered carried every object action declared at
 * `record_header` or `record_more`, in declaration order. As `kind: 'full'`
 * pages they name those action ids themselves, so the list is a copy. This
 * pin holds the copy equal to the object's declarations, so an action added
 * to either object at a header location cannot silently miss its page.
 *
 * Read from the shipped page and object metadata.
 */

import { describe, expect, it } from 'vitest';
import { SysOrganization } from '../identity/sys-organization.object.js';
import { SysUser } from '../identity/sys-user.object.js';
import { SysOrganizationDetailPage } from './sys-organization.page.js';
import { SysUserDetailPage } from './sys-user.page.js';

type Rec = Record<string, unknown>;

/** The ids the synthesized header drew: header-located actions, declaration order, first of a name. */
function headerLocatedIds(object: { actions?: unknown }): string[] {
  const ids: string[] = [];
  for (const action of (object.actions ?? []) as Rec[]) {
    const locations = (action.locations ?? []) as string[];
    const name = action.name as string;
    if (!locations.includes('record_header') && !locations.includes('record_more')) continue;
    if (!ids.includes(name)) ids.push(name);
  }
  return ids;
}

/** The `page:header` node's authored action ids. */
function pageHeaderIds(page: { regions?: unknown }): unknown {
  const components = ((page.regions as Rec[])[0]!.components ?? []) as Rec[];
  const header = components.find((c) => c.type === 'page:header');
  return (header?.properties as Rec | undefined)?.actions;
}

describe.each([
  ['sys_organization_detail', SysOrganizationDetailPage, SysOrganization],
  ['sys_user_detail', SysUserDetailPage, SysUser],
] as const)('%s — the header names the object\'s header-located actions', (_name, page, object) => {
  it('is non-vacuous: the object declares header-located actions', () => {
    expect(headerLocatedIds(object).length).toBeGreaterThan(0);
  });

  it('names exactly those ids, in declaration order', () => {
    expect(pageHeaderIds(page)).toEqual(headerLocatedIds(object));
  });
});
