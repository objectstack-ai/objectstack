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
import { enObjects } from '../apps/translations/en.objects.generated.js';
import { zhCNObjects } from '../apps/translations/zh-CN.objects.generated.js';

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

// The console draws the OBJECT description as the subtitle of every list view,
// the `revoked` audit view included, so it may not claim the sessions are
// active. Pinned at the source and in the en and zh-CN bundles the subtitle is
// read from.
describe('sys_session description holds on every list view, revoked included', () => {
  const ACTIVE = { en: /\bactive\b/i, 'zh-CN': /活跃|活動|有效/ } as const;
  const descriptions = {
    source: (SysSession as any).description as string,
    en: enObjects.sys_session?.description as string,
    'zh-CN': zhCNObjects.sys_session?.description as string,
  };

  it.each(Object.entries(descriptions))('%s description is declared and does not say active', (where, text) => {
    expect(typeof text, `sys_session description (${where})`).toBe('string');
    expect(text.trim().length, `sys_session description (${where})`).toBeGreaterThan(0);
    const rule = where === 'zh-CN' ? ACTIVE['zh-CN'] : ACTIVE.en;
    expect(text, `sys_session description (${where})`).not.toMatch(rule);
  });
});
