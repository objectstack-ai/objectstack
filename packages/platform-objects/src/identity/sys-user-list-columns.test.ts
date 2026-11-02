// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Users: the default list shows whether a user is banned (#27863),
 * and does not show better-auth's legacy `role` scalar (#28105).
 *
 * `all_users` is the view Setup's Users entry opens (`viewName: 'all_users'`,
 * pinned in `setup-users-nav-view.test.ts`). #27863 added `banned` and `role`
 * beside the email. The `role` column is gone again (#28105, ruling D1): the
 * scalar is not the platform role. ObjectStack never writes it, and when the
 * better-auth admin plugin is on it stamps `user` on every user, the seeded
 * platform admin included. Platform-admin standing comes from ADR-0068 D2
 * (owner e-mail or an unscoped `admin_full_access` grant), not from this
 * column. The field itself stays: readonly text in its Admin group.
 */

import { describe, expect, it } from 'vitest';
import { SysUser } from './sys-user.object.js';

type ListView = { columns?: unknown[] };

const view = (name: string): ListView =>
  ((SysUser as { listViews?: Record<string, ListView> }).listViews ?? {})[name] ?? {};

describe('sys_user all_users — list columns (#27863, #28105)', () => {
  it('pins the default list columns: banned stays, role is not one of them', () => {
    expect(view('all_users').columns).toEqual([
      'name', 'email', 'phone_number', 'email_verified', 'banned', 'source', 'created_at',
    ]);
  });

  it('no list view of sys_user shows the legacy role scalar', () => {
    const views = (SysUser as { listViews?: Record<string, ListView> }).listViews ?? {};
    for (const [name, v] of Object.entries(views)) expect(v.columns ?? [], name).not.toContain('role');
  });

  it('the object highlight fields do not carry role', () => {
    expect(SysUser.highlightFields ?? []).not.toContain('role');
  });

  it('every column is a declared sys_user field', () => {
    const fields = Object.keys(SysUser.fields ?? {});
    for (const c of view('all_users').columns ?? []) expect(fields, String(c)).toContain(c);
  });
});

describe('sys_user.role — the field itself stays (#28105, ruling D1)', () => {
  it('is readonly text in its Admin group', () => {
    const role = (SysUser.fields as Record<string, Record<string, unknown>>).role;
    expect(role).toBeDefined();
    expect(role!.type).toBe('text');
    expect(role!.readonly).toBe(true);
    expect(role!.group).toBe('Admin');
    expect(role).not.toHaveProperty('options');
  });
});
