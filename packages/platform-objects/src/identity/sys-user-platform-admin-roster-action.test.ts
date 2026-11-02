// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0095 D3] The Users list's one entry to the platform-admin roster.
 *
 * Platform-admin standing is derived per user (`hasPlatformAdminStanding`),
 * never stored on `sys_user`, so the list carries no column for it: a column
 * would evaluate the predicate for every row of every page. The roster is
 * asked once instead, from the list toolbar, through
 * `POST /api/v1/auth/admin/list-platform-admins` (plugin-auth), which
 * enumerates the candidates with the last-admin guard's enumerator and
 * confirms each through the predicate.
 *
 * Pinned here, because each is the decision rather than the code:
 *
 *  1. **No `sys_user` field carries standing**, so the Users list page still
 *     reads one page per request (the list's columns are pinned in
 *     `sys-user-list-columns.test.ts`).
 *  2. **One toolbar entry posting to the roster route**, offered on the
 *     platform-admin rung like every platform-admin action on this object,
 *     and not reloading the list behind its dialog.
 *  3. **The answer renders with no ui change**: the console's result dialog
 *     draws a `code-list` field as one row per string, and the route answers
 *     `entries` as one line per administrator.
 *  4. **No `ai` block**: the action postdates the ADR-0011 identity-actions
 *     assessment, and an unassessed identity action stays human-only.
 */

import { describe, expect, it } from 'vitest';
import { SysUser } from './sys-user.object.js';

const action = () => (SysUser.actions ?? []).find((a) => a.name === 'list_platform_admins');

describe('[ADR-0095 D3] sys_user list_platform_admins', () => {
  it('no sys_user field carries platform-admin standing', () => {
    // `role` is better-auth's legacy scalar, kept and never written for a
    // platform administrator (ADR-0068 D2); nothing else may name standing.
    const names = Object.keys(SysUser.fields ?? {});
    expect(names.filter((n) => /platform|admin/.test(n))).toEqual([]);
  });

  it('is one list-toolbar entry posting to the roster route, on the platform-admin rung', () => {
    const roster = (SysUser.actions ?? []).filter((a) => a.target === '/api/v1/auth/admin/list-platform-admins');
    expect(roster.map((a) => a.name)).toEqual(['list_platform_admins']);
    expect(action()).toMatchObject({
      type: 'api',
      locations: ['list_toolbar'],
      visible: { dialect: 'cel', source: 'current_user.isPlatformAdmin == true' },
      refreshAfter: false,
    });
    expect(action()?.method ?? 'POST').toBe('POST');
    expect(action()?.params ?? []).toEqual([]);
  });

  it('renders the route\'s entries as a list in the result dialog', () => {
    expect(action()?.resultDialog?.fields).toEqual([
      { path: 'entries', label: 'Platform administrators', format: 'code-list' },
    ]);
  });

  it('declares no ai block (unassessed, human-only)', () => {
    expect(action()?.ai).toBeUndefined();
  });
});
