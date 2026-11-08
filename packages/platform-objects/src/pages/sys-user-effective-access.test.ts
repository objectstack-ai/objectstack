// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user page's "Permission Sets" tab shows the person's EFFECTIVE sets, not
 * only their stored grant rows.
 *
 * A person who holds access only through the default binding or a position has
 * no `sys_user_permission_set` row, so a tab holding only the grant list reads
 * as "no records" for them. The tab's first child is the console widget
 * `security:effective-access` (`@object-ui/app-shell`), which reads the bound
 * `sys_user` record and lists every set the server resolves for the person
 * with its origins. The grant list stays below it: a direct grant keeps its
 * remove action there.
 *
 * Read from the shipped page metadata, so the pin fails if the widget leaves
 * the tab, moves below the list, or starts authoring props.
 */

import { describe, expect, it } from 'vitest';
import { PageSchema } from '@objectstack/spec/ui';
import { SysUserDetailPage } from './sys-user.page.js';

type Rec = Record<string, unknown>;

describe('sys_user_detail — the Permission Sets tab', () => {
  const tabs = (SysUserDetailPage.regions![0]!.components as Rec[]).find((c) => c.type === 'page:tabs') as Rec;
  const items = (tabs.properties as Rec).items as Rec[];
  const tab = items.find((it) => (it.label as Rec).en === 'Permission Sets')!;
  const children = tab.children as Rec[];

  it('parses through PageSchema', () => {
    const parsed = PageSchema.safeParse(SysUserDetailPage);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
  });

  it('opens with the `security:effective-access` widget, with no props', () => {
    expect(children[0]).toEqual({ type: 'security:effective-access', properties: {} });
  });

  it('keeps the stored grant list below it, where a direct grant is removed', () => {
    expect(children.map((c) => c.type)).toEqual(['security:effective-access', 'record:related_list']);
    expect((children[1]!.properties as Rec).objectName).toBe('sys_user_permission_set');
  });

  it('mounts the widget nowhere else on the page', () => {
    const found: unknown[] = [];
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== 'object') return;
      if ((n as Rec).type === 'security:effective-access') found.push(n);
      Object.values(n as Rec).forEach(walk);
    };
    walk(SysUserDetailPage);
    expect(found).toHaveLength(1);
  });

  it('carries no tab-level gate: the server refuses a viewer who may not manage the person', () => {
    expect(tab.visibleWhen).toBeUndefined();
  });
});
