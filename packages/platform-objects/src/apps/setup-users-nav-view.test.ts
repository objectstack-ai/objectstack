// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Setup → Users opens on the tenant-wide user list, and the Account app's
// profile entry is not that list (#21960).
//
// The defect: `nav_users` named no view, and the console opens the FIRST
// declared list view of an object when the route names none (objectui
// `ObjectView`: URL view id, then `?view=`, then a view marked `isDefault`,
// then `views[0]`). `sys_user` declares `me` first — `id = {current_user_id}`,
// page size 1 — so an administrator's Users page showed one row, themselves.
//
// The repair uses the key the spec already declares on an object navigation
// item, `viewName` ("Default list view to open"). The console honours it: its
// `NavigationRenderer.resolveHref` emits `<object>/view/<viewName>`, and
// `resolveViewId` matches the short name against the qualified view ids. Read
// at the objectui commit `.objectui-sha` pins
// (0abd4f9f8769fc4c19ad2f96707684876f74c09f). The same function gives
// `recordId` and then `filters` precedence over `viewName`, which is why the
// entry must carry neither.
//
// The profile half: the Account app's profile entry is the
// `account:profile_card` component, which reads the signed-in user from the
// session (objectui `ProfilePage`, `useAuth()`), not a `sys_user` list view.
// No Account entry routes to `sys_user`, so the view order on `sys_user` is not
// what puts a user on their own profile.
import { describe, it, expect } from 'vitest';
import { NavigationContributionSchema } from '@objectstack/spec/ui';

import { SETUP_NAV_CONTRIBUTIONS } from './setup-nav.contributions.js';
import { ACCOUNT_APP } from './account.app.js';
import { SysUser } from '../identity/sys-user.object.js';

type NavItem = {
  id?: string;
  type?: string;
  objectName?: string;
  viewName?: string;
  recordId?: string;
  filters?: Record<string, unknown>;
  componentRef?: string;
  children?: NavItem[];
};

type ListView = {
  name?: string;
  filter?: unknown;
  pagination?: { pageSize?: number };
};

const usersContribution = () => {
  const found = SETUP_NAV_CONTRIBUTIONS.find((c) =>
    (c.items ?? []).some((i) => (i as NavItem).id === 'nav_users'),
  );
  expect(found, 'Setup lost its nav_users entry').toBeDefined();
  return found!;
};

const usersEntry = (): NavItem =>
  (usersContribution().items ?? []).find((i) => (i as NavItem).id === 'nav_users') as NavItem;

const userListViews = (): Record<string, ListView> =>
  ((SysUser as { listViews?: Record<string, ListView> }).listViews ?? {});

/** Every Account nav item, depth-first. */
const accountItems = (): NavItem[] => {
  const out: NavItem[] = [];
  const walk = (items: NavItem[] = []) => {
    for (const item of items) {
      if (!item) continue;
      out.push(item);
      if (Array.isArray(item.children)) walk(item.children);
    }
  };
  walk((ACCOUNT_APP.navigation ?? []) as NavItem[]);
  return out;
};

describe('Setup → Users opens on the tenant-wide user list (#21960)', () => {
  it('names the `all_users` list view of `sys_user`', () => {
    expect(usersContribution().group).toBe('group_people_org');
    expect(usersEntry()).toMatchObject({
      type: 'object',
      objectName: 'sys_user',
      viewName: 'all_users',
    });
  });

  it('carries neither `recordId` nor `filters`, which the console honours ahead of `viewName`', () => {
    expect(usersEntry().recordId).toBeUndefined();
    expect(usersEntry().filters).toBeUndefined();
  });

  it('names a view `sys_user` declares, under that same name', () => {
    const view = userListViews()[usersEntry().viewName ?? ''];
    expect(view, `sys_user declares no list view "${usersEntry().viewName}"`).toBeDefined();
    expect(view.name).toBe(usersEntry().viewName);
  });

  it('names a view that is not scoped to the caller', () => {
    const view = userListViews()[usersEntry().viewName ?? ''];
    expect(view.filter).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('{current_user_id}');
    expect(view.pagination?.pageSize ?? 0).toBeGreaterThan(1);
  });

  it('parses as a NavigationContribution, so the key reaches the served app', () => {
    const parsed = NavigationContributionSchema.safeParse(usersContribution());
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    const item = (parsed.data?.items ?? []).find((i) => (i as NavItem).id === 'nav_users') as NavItem;
    expect(item.viewName).toBe('all_users');
  });
});

describe('the Account app profile entry is not a `sys_user` list view (#21960)', () => {
  it('opens on the `account:profile_card` component, as its first entry', () => {
    const first = ((ACCOUNT_APP.navigation ?? []) as NavItem[])[0];
    expect(first).toMatchObject({
      id: 'nav_account_profile',
      type: 'component',
      componentRef: 'account:profile_card',
    });
  });

  it('routes no entry to `sys_user`', () => {
    const toUser = accountItems().filter((i) => i.objectName === 'sys_user').map((i) => i.id);
    expect(toUser).toEqual([]);
  });
});
