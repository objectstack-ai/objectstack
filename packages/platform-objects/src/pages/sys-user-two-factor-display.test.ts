// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25287 — 2FA is either offered or not shown.
 *
 * `plugin-auth` resolves `twoFactor` to `false` unless a deployment turns it
 * on, and the platform's own `sys_user` declarations used to show a 2FA state
 * regardless: a highlights chip, two list columns, a "2FA Enabled" view tab
 * and a Security-tab heading over an empty action bar. None of those surfaces
 * has a `requiresFeature`, so each one is either dropped or gated with a node
 * `visibleWhen` over `features.twoFactor`.
 *
 * Pinned here, from the shipped metadata:
 *  - off: no list view, no highlights chip, and no Security-tab node reads or
 *    names 2FA state unless it carries the gate, and the gate answers `false`
 *    — including while the auth config has not loaded (`features` is `{}`),
 *    without faulting;
 *  - on: the gate answers `true`, and the Security tab then carries both the
 *    state (`two_factor_enabled`) and the enable action.
 */

import { describe, expect, it } from 'vitest';
import { celEngine } from '@objectstack/formula';
import { featureGatePredicate } from '@objectstack/spec/kernel';
import { PageSchema } from '@objectstack/spec/ui';
import { SysUser } from '../identity/sys-user.object.js';
import { SysUserDetailPage } from './sys-user.page.js';

type Rec = Record<string, any>;

const slots = SysUserDetailPage.slots as Rec;
const tabItems = (slots.tabs.properties as Rec).items as Rec[];
const security = tabItems.find((it) => it.label?.en === 'Security') as Rec;
const securityNodes = security.children as Rec[];

/** Does this node show 2FA state or a 2FA control? Judged on what it names, not on its position. */
function namesTwoFactor(node: Rec): boolean {
  return JSON.stringify(node.properties ?? {}).match(/two_factor|Two-Factor|TOTP/) !== null;
}

function evaluateGate(features: unknown): boolean | string {
  const gate = securityNodes.find(namesTwoFactor)?.visibleWhen as { dialect: string; source: string };
  const r = celEngine.evaluate(gate as never, { record: { id: 'u1' }, extra: { features } });
  if (!r.ok) return `FAULT ${r.error.message.split('\n')[0]}`;
  return r.value as boolean;
}

describe('sys_user — 2FA display only where 2FA is offered (#25287)', () => {
  it('the page still parses through PageSchema', () => {
    const parsed = PageSchema.safeParse(SysUserDetailPage);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
  });

  it('no list view shows a 2FA column or filters on 2FA state, and the "2FA Enabled" view is retired', () => {
    const views = SysUser.listViews as Record<string, Rec>;
    expect(Object.keys(views)).not.toContain('two_factor');
    for (const [name, view] of Object.entries(views)) {
      expect(JSON.stringify(view), name).not.toContain('two_factor_enabled');
    }
  });

  it('the highlights chip strip does not carry the 2FA state', () => {
    expect(slots.highlights.properties.fields).not.toContain('two_factor_enabled');
  });

  it('the details grid still hides the field, so dropping the chip does not move it into the body', () => {
    const details = (tabItems[0].children as Rec[]).find((c) => c.type === 'record:details') as Rec;
    expect(details.properties.hideFields).toContain('two_factor_enabled');
  });

  it('every Security-tab node that names 2FA — and the divider closing the block — carries the one gate', () => {
    const gated = securityNodes.filter((n) => n.visibleWhen !== undefined);
    const twoFactorNodes = securityNodes.filter(namesTwoFactor);
    expect(twoFactorNodes.map((n) => n.type)).toEqual([
      'element:text',
      'element:text',
      'record:highlights',
      'record:quick_actions',
    ]);
    const closingDivider = securityNodes[securityNodes.indexOf(twoFactorNodes[3]) + 1];
    expect(closingDivider.type).toBe('element:divider');
    expect(gated).toEqual([...twoFactorNodes, closingDivider]);
    const sources = new Set(gated.map((n) => JSON.stringify(n.visibleWhen)));
    expect(sources.size).toBe(1);
    const gate = gated[0].visibleWhen as { dialect: string; source: string };
    expect(gate.dialect).toBe('cel');
    // The same conjunct the object's 2FA actions carry through `requiresFeature`.
    expect(gate.source.split(' && ')).toContain(featureGatePredicate('twoFactor'));
  });

  it('off: the gate is closed — with the flag false, absent, or the config not loaded — and never faults', () => {
    expect(evaluateGate({ twoFactor: false })).toBe(false);
    expect(evaluateGate({ multiOrgEnabled: true })).toBe(false);
    expect(evaluateGate({})).toBe(false);
  });

  it('on: the gate is open, and the Security tab carries the 2FA state and the enable action', () => {
    expect(evaluateGate({ twoFactor: true })).toBe(true);
    const state = securityNodes.find((n) => n.type === 'record:highlights') as Rec;
    expect(state.properties.fields).toEqual(['two_factor_enabled']);
    const actions = securityNodes.find(
      (n) => n.type === 'record:quick_actions' && n.properties.actionNames.includes('enable_two_factor'),
    ) as Rec;
    expect(actions.visibleWhen).toEqual(state.visibleWhen);
  });
});
