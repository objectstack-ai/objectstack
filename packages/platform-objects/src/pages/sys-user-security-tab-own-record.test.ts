// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24938 — the user page's Security tab shows only on the viewer's own record.
 *
 * Every action the tab names is gated to the viewer's own record on the
 * object, so on another user's record each `record:quick_actions` draws
 * nothing and only the "your account" headings and captions remain. The tab
 * item therefore carries the own-record gate itself, in the CEL envelope: a
 * bare string on this raw `Page` literal would reach the console's legacy
 * evaluator, which has no `has()`, and fail soft by showing the tab to every
 * viewer.
 *
 * Read from the shipped page metadata and the shipped object metadata, so the
 * pin fails if the gate leaves the tab, loses its envelope, or if the tab
 * starts naming an action that is NOT own-record — at which point gating the
 * whole tab would hide that action from an administrator.
 */

import { describe, expect, it } from 'vitest';
import { PageSchema } from '@objectstack/spec/ui';
import { SysUserDetailPage } from './sys-user.page.js';
import { SysUser } from '../identity/sys-user.object.js';

type Rec = Record<string, unknown>;

const OWN_RECORD = 'has(record.id) && record.id == ctx.user.id';

describe('sys_user_detail — the Security tab is gated to the viewer\'s own record', () => {
  const tabs = (SysUserDetailPage.regions![0]!.components as Rec[]).find((c) => c.type === 'page:tabs') as Rec;
  const items = (tabs.properties as Rec).items as Rec[];
  const security = items.find((it) => (it.label as Rec).en === 'Security')!;

  it('parses through PageSchema', () => {
    const parsed = PageSchema.safeParse(SysUserDetailPage);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
  });

  it('carries the own-record gate on the tab item, in the CEL envelope', () => {
    expect(security).toBeDefined();
    expect(security.visibleWhen).toEqual({ dialect: 'cel', source: OWN_RECORD });
  });

  it('gates only the Security tab — every other tab item carries no item-level gate', () => {
    const gated = items.filter((it) => it.visibleWhen !== undefined).map((it) => (it.label as Rec).en);
    expect(gated).toEqual(['Security']);
  });

  it('names only actions that are themselves own-record on the object', () => {
    const names = (security.children as Rec[])
      .filter((c) => c.type === 'record:quick_actions')
      .flatMap((c) => (c.properties as Rec).actionNames as string[]);
    expect(names.length).toBeGreaterThan(0);
    const actions = (SysUser.actions ?? []) as Rec[];
    for (const name of names) {
      const action = actions.find((a) => a.name === name);
      expect(action, name).toBeDefined();
      // `ObjectSchema.create` parses the bare string into its envelope.
      const visible = action!.visible as { source?: string } | string | undefined;
      const source = typeof visible === 'string' ? visible : visible?.source;
      // A pure conjunction led by the own-record guard — the 2FA actions wrap
      // it in a parenthesised group `(…) && features.twoFactor == true`.
      expect(source, name).toMatch(/^\(?has\(record\.id\) && record\.id == ctx\.user\.id(?: && |\)|$)/);
      expect(source, name).not.toContain('||');
    }
  });
});
