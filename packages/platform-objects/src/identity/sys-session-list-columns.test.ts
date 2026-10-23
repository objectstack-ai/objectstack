// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `sys_session`'s session-listing views must let an administrator tell two
// sessions of one user apart. Without the device and the last request, two
// rows read the same user, organization and creation minute, and the admin
// who meant to end one session revokes both.
//
// Pinned here, at the declaration: both views that list live sessions carry
// `user_agent` and `last_activity_at`, every column names a declared field,
// and no column names the `internal` bearer token.

import { describe, it, expect } from 'vitest';
import { SysSession } from './sys-session.object.js';

type ViewLike = { columns?: unknown };
const views = (SysSession as any).listViews as Record<string, ViewLike>;
const fields = (SysSession as any).fields as Record<string, { internal?: boolean }>;

const columnsOf = (view: string): string[] => {
  const cols = views[view]?.columns;
  expect(Array.isArray(cols), `sys_session.listViews.${view}.columns`).toBe(true);
  return cols as string[];
};

const LIVE_SESSION_VIEWS = ['all_sessions', 'mine'] as const;

describe('sys_session list views tell one user\'s sessions apart', () => {
  it.each(LIVE_SESSION_VIEWS)('%s shows the device (user_agent) and the last request (last_activity_at)', (view) => {
    const cols = columnsOf(view);
    expect(cols).toContain('user_agent');
    expect(cols).toContain('last_activity_at');
  });

  it('both columns are declared fields of the object', () => {
    expect(fields.user_agent).toBeDefined();
    expect(fields.last_activity_at).toBeDefined();
  });

  it.each(Object.keys(views))('%s names only declared, non-internal fields', (view) => {
    for (const col of columnsOf(view)) {
      expect(fields[col], `sys_session.listViews.${view} column ${col}`).toBeDefined();
      expect(fields[col]?.internal, `sys_session.listViews.${view} column ${col}`).not.toBe(true);
    }
  });
});
