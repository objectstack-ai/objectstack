// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Users: the default list shows whether a user is banned and what role
 * they hold, so a banned user or an admin is spotted without opening each
 * record (#27863).
 *
 * `all_users` is the view Setup's Users entry opens (`viewName: 'all_users'`,
 * pinned in `setup-users-nav-view.test.ts`). Its columns used to be name,
 * email, phone, email verified, identity source and created: nothing on the
 * list said a user was banned. The `banned` view keeps its own filter; this
 * pin is about the default list.
 */

import { describe, expect, it } from 'vitest';
import { SysUser } from './sys-user.object.js';

type ListView = { columns?: unknown[] };

const view = (name: string): ListView =>
  ((SysUser as { listViews?: Record<string, ListView> }).listViews ?? {})[name] ?? {};

describe('sys_user all_users — Status and Role columns (#27863)', () => {
  it('pins the default list columns', () => {
    expect(view('all_users').columns).toEqual([
      'name', 'email', 'phone_number', 'email_verified', 'banned', 'role', 'source', 'created_at',
    ]);
  });

  it('every column is a declared sys_user field', () => {
    const fields = Object.keys(SysUser.fields ?? {});
    for (const c of view('all_users').columns ?? []) expect(fields, String(c)).toContain(c);
  });
});
