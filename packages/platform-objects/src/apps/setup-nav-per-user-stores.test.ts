// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #23803 item 3 — "User Preferences" (`sys_user_preference`) and "Identity
// Links" (`sys_account`) are not Setup menu entries; each is reached from the
// User record page, from the user its rows belong to.
//
// Both halves are pinned together because each is only correct with the other:
// the menu entries could leave only because the User page lists the same rows,
// per user, with nothing new shown.
//
//   (1) no Setup entry this package contributes targets either object — by
//       `objectName`, or by a URL into the object's route;
//   (2) the User page carries exactly one related list over each object, keyed
//       to the page's record by `user_id`, and the block contract accepts it;
//   (3) the Preferences list shows no column the object's `all_preferences`
//       view (the grid the menu entry opened) did not show, and authors no
//       `add` picker and no `actions` — so it exposes nothing new;
//   (4) the Linked Accounts list already served "Identity links", and the one
//       row action that grid offered, `unlink_account`, is a `list_item`
//       action, which a related list's host offers on its rows.
//
// Reach, stated so a green run is not read wider than it is: (1) reads
// `SETUP_NAV_CONTRIBUTIONS` only. The other Setup contributors are capability
// plugins that depend on this package and cannot be imported from here; on the
// commit this landed on, none of them names either object (a grep of every
// `app: 'setup'` contributor for `objectName:`). Whether the console renders
// the tabs is objectui's half and is not judged here.

import { describe, it, expect } from 'vitest';
import { PageSchema, RecordRelatedListProps } from '@objectstack/spec/ui';

import { SETUP_NAV_CONTRIBUTIONS } from './setup-nav.contributions.js';
import { SysUserDetailPage } from '../pages/sys-user.page.js';
import { SysUserPreference } from '../identity/sys-user-preference.object.js';
import { SysAccount } from '../identity/sys-account.object.js';

const PER_USER_STORES = ['sys_user_preference', 'sys_account'] as const;

type NavItem = { id?: string; objectName?: string; url?: string; children?: NavItem[] };
type Rec = Record<string, unknown>;

/** Every Setup nav item this package contributes, depth-first. */
function setupNavItems(): NavItem[] {
  const out: NavItem[] = [];
  const walk = (items: unknown[] | undefined) => {
    for (const raw of items ?? []) {
      const item = raw as NavItem;
      if (!item) continue;
      out.push(item);
      if (Array.isArray(item.children)) walk(item.children);
    }
  };
  for (const contribution of SETUP_NAV_CONTRIBUTIONS) walk(contribution.items as unknown[]);
  return out;
}

/** Every `record:related_list` block's properties over `objectName`, anywhere on the page. */
function relatedListsOf(root: unknown, objectName: string): Rec[] {
  const found: Rec[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    const node = n as Rec & { type?: unknown; properties?: Rec };
    if (node.type === 'record:related_list' && node.properties?.objectName === objectName) found.push(node.properties);
    Object.values(node).forEach(walk);
  };
  walk(root);
  return found;
}

/** The `tabs` item whose body holds the related list over `objectName`. */
function tabOf(objectName: string): Rec | undefined {
  const items = (((SysUserDetailPage.slots as Rec).tabs as Rec).properties as Rec).items as Rec[];
  return items.find((item) => relatedListsOf(item.children, objectName).length > 0);
}

describe('(1) Setup has no menu entry over a per-user store (#23803)', () => {
  const items = setupNavItems();

  it('control: the walk reads the contributions (Users is an entry here)', () => {
    expect(items.some((i) => i.id === 'nav_users' && i.objectName === 'sys_user')).toBe(true);
  });

  it.each(PER_USER_STORES)('no entry targets %s', (objectName) => {
    const hits = items.filter(
      (i) => i.objectName === objectName || (typeof i.url === 'string' && i.url.includes(objectName)),
    );
    expect(hits.map((i) => i.id)).toEqual([]);
  });
});

describe('(2) the User page lists each per-user store, keyed to its record (#23803)', () => {
  it('the page parses through PageSchema', () => {
    const parsed = PageSchema.safeParse(SysUserDetailPage);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
  });

  it.each(PER_USER_STORES)('%s: one related list on user_id, accepted by the block contract', (objectName) => {
    const lists = relatedListsOf(SysUserDetailPage, objectName);
    expect(lists).toHaveLength(1);
    expect(lists[0].relationshipField).toBe('user_id');
    const parsed = RecordRelatedListProps.safeParse(lists[0]);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
  });

  it('each list is its own tab, labelled in every locale the page carries', () => {
    expect((tabOf('sys_user_preference')?.label as Rec)).toEqual({
      en: 'Preferences',
      'zh-CN': '偏好设置',
      'ja-JP': '設定',
      'es-ES': 'Preferencias',
    });
    expect((tabOf('sys_account')?.label as Rec)?.en).toBe('Linked Accounts');
    expect(Object.keys((tabOf('sys_account')?.label as Rec) ?? {}).sort()).toEqual(['en', 'es-ES', 'ja-JP', 'zh-CN']);
  });
});

describe('(3) the Preferences list exposes nothing the old grid did not (#23803)', () => {
  const list = relatedListsOf(SysUserDetailPage, 'sys_user_preference')[0] ?? {};
  const grid = SysUserPreference.listViews?.all_preferences as { columns?: unknown[] } | undefined;

  it('shows a subset of the all_preferences columns, without the page record itself', () => {
    const gridColumns = (grid?.columns ?? []) as string[];
    expect(gridColumns, 'control: the grid the menu entry opened still declares its columns').toContain('key');
    const columns = list.columns as string[];
    expect(columns.length).toBeGreaterThan(0);
    expect(columns.filter((c) => !gridColumns.includes(c)), 'columns all_preferences never showed').toEqual([]);
    expect(columns).not.toContain('user_id');
    expect(columns).not.toContain('value');
  });

  it('authors no add picker and no actions', () => {
    expect(list).not.toHaveProperty('add');
    expect(list).not.toHaveProperty('actions');
  });
});

describe('(4) Linked Accounts already serves "Identity links" (#23803)', () => {
  it('the grid\'s one row action, unlink_account, is offered on list rows', () => {
    const unlink = (SysAccount.actions ?? []).find((a) => a.name === 'unlink_account');
    expect(unlink, 'sys_account lost unlink_account').toBeDefined();
    expect(unlink?.locations).toContain('list_item');
  });
});
