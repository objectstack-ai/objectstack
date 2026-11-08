// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #31085 — the user page's "AI Assistants" tab: the place an administrator
 * sees, and revokes, the AI assistants a person authorized.
 *
 * The tab's body is the console widget `mcp:authorized-assistants`, which
 * reads the page's bound `sys_user` record and calls
 * `/api/v1/auth/admin/authorized-clients`, a door that refuses every caller
 * below platform admin. So the tab item carries the ADR-0095 D3 PLATFORM_ADMIN
 * rung, in the CEL envelope, the same item-level mechanism the Security tab
 * uses: a viewer the door refuses is not shown a tab that can only draw a 403.
 *
 * Read from the shipped page metadata, so the pin fails if the tab leaves the
 * strip or moves, if its body changes, and if its gate is dropped, loses its
 * envelope, or starts reading standing from `positions`. The gate is evaluated
 * with `@objectstack/formula`'s `celEngine` under the console's binding — the
 * whole scope as `extra`, one subject under `current_user` / `user` /
 * `ctx.user` / `os.user` — and ⛔ not through `user:`, under which the engine
 * re-derives `isPlatformAdmin` from `positions`.
 */

import { describe, expect, it } from 'vitest';
import { celEngine } from '@objectstack/formula';
import { PageSchema } from '@objectstack/spec/ui';
import { SysUserDetailPage } from './sys-user.page.js';

type Rec = Record<string, unknown>;

/** The standing, spelled as the object's platform-admin actions spell it. */
const STANDING = 'current_user.isPlatformAdmin == true';

/** The strip, in order: the new tab sits beside API Keys. */
const STRIP = [
  'Details',
  'Positions',
  'Permission Sets',
  'Business Units',
  'Sessions',
  'Linked Accounts',
  'Organizations',
  'OAuth Apps',
  'Security',
  'API Keys',
  'AI Assistants',
  'Preferences',
];

type Subject = { id: string | null; email: string; isPlatformAdmin: boolean; positions: string[] };

const PLATFORM_ADMIN: Subject = { id: 'u_pa', email: 'pa@example.com', isPlatformAdmin: true, positions: [] };

/** Every viewer the door refuses, the grades first, then the position the rung must never be read from. */
const REFUSED: ReadonlyArray<[string, Subject]> = [
  ['org owner', { id: 'u_owner', email: 'owner@example.com', isPlatformAdmin: false, positions: ['org_owner'] }],
  ['org admin', { id: 'u_admin', email: 'admin@example.com', isPlatformAdmin: false, positions: ['org_admin'] }],
  ['plain member', { id: 'u_member', email: 'member@example.com', isPlatformAdmin: false, positions: ['member'] }],
  [
    "a tenant-written 'platform_admin' position without the rung",
    { id: 'u_pos', email: 'pos@example.com', isPlatformAdmin: false, positions: ['platform_admin', 'org_owner'] },
  ],
  // The console's signed-out identity (`buildExpressionUser(null)`).
  ['signed out', { id: null, email: '', isPlatformAdmin: false, positions: [] }],
];

/** The record the tab is drawn on: someone else's, and the viewer's own. */
const records = (subject: Subject): Array<Record<string, unknown>> => [
  { id: 'u_someone_else', email: 'else@example.com' },
  { id: subject.id, email: subject.email },
];

function shown(source: string, subject: Subject, record: Record<string, unknown>): boolean {
  const r = celEngine.evaluate(
    { dialect: 'cel', source },
    { record, extra: { current_user: subject, user: subject, ctx: { user: subject }, os: { user: subject } } },
  );
  return r.ok && r.value === true;
}

describe('sys_user_detail — the AI Assistants tab', () => {
  const tabs = (SysUserDetailPage.regions![0]!.components as Rec[]).find((c) => c.type === 'page:tabs') as Rec;
  const items = (tabs.properties as Rec).items as Rec[];
  const tab = items.find((it) => (it.label as Rec).en === 'AI Assistants')!;

  it('parses through PageSchema', () => {
    const parsed = PageSchema.safeParse(SysUserDetailPage);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
  });

  it('sits in the strip beside API Keys', () => {
    expect(items.map((it) => (it.label as Rec).en)).toEqual(STRIP);
  });

  it('carries the label in every locale the sibling tabs spell', () => {
    expect(tab.label).toEqual({
      en: 'AI Assistants',
      'zh-CN': 'AI 助手',
      'ja-JP': 'AI アシスタント',
      'es-ES': 'Asistentes de IA',
      'zh-Hant': 'AI 助理',
      ar: 'مساعدو الذكاء الاصطناعي',
      fr: 'Assistants IA',
      'pt-BR': 'Assistentes de IA',
    });
    for (const sibling of items) {
      expect(Object.keys(sibling.label as Rec).sort(), String((sibling.label as Rec).en)).toEqual(
        Object.keys(tab.label as Rec).sort(),
      );
    }
  });

  it('mounts the `mcp:authorized-assistants` widget, with no props, as its only child', () => {
    expect(tab.children).toEqual([{ type: 'mcp:authorized-assistants', properties: {} }]);
  });

  it('carries the platform-admin gate on the tab item, in the CEL envelope', () => {
    expect(tab.visibleWhen).toEqual({ dialect: 'cel', source: STANDING });
  });

  it('is shown to a platform administrator, on any user record', () => {
    const source = (tab.visibleWhen as { source: string }).source;
    for (const record of records(PLATFORM_ADMIN)) {
      expect(shown(source, PLATFORM_ADMIN, record), JSON.stringify(record)).toBe(true);
    }
  });

  it.each(REFUSED)('is not shown to %s, on any user record — own record included', (_name, subject) => {
    const source = (tab.visibleWhen as { source: string }).source;
    for (const record of records(subject)) {
      expect(shown(source, subject, record), JSON.stringify(record)).toBe(false);
    }
  });
});
