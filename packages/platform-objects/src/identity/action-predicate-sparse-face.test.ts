// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8990 — every record-scoped action predicate on a platform object survives
 * the SPARSE action face.
 *
 * The action `visible` / `disabled` binding is the one record binding that is
 * deliberately NOT made total (#4953 item 2): it is whatever record the client
 * already fetched — a record-detail read, or a LIST ROW carrying only the
 * view's `$select` projection. `materializeDeclaredFields` in
 * `@objectstack/objectql` is the canonical statement of the guard rule that
 * follows from it (#8975); this file is the executable half of it for the
 * identity objects and does not restate the rule.
 *
 * **What makes this worth pinning rather than reviewing.** The failure is
 * fail-closed AND silent: CEL aborts the whole expression at key resolution
 * (`No such key: source`), the predicate never returns, and the console simply
 * does not offer the button. To the user that is indistinguishable from the
 * gate having said no, so nothing anywhere reports it — not a log the operator
 * reads, not a test, not a type. A predicate that regresses to the unguarded
 * spelling would therefore ship green in every other sense.
 *
 * The assertions are deliberately at TWO levels, because either alone goes
 * blind in a way measured on this exact surface:
 *
 *  - a **sweep** over every action of every identity object, evaluating each
 *    predicate on the three bindings a sparse row can present (key absent, key
 *    projected holding null, key projected with a value). This is the one that
 *    catches a NEW action authored with an unguarded predicate — the sweep
 *    discovers the predicates rather than being handed a list.
 *  - **per-site verdicts** on the migrated predicates, so a guard cannot be
 *    "fixed" into something that never faults and never answers true either.
 *    A predicate wrapped in a guard that is accidentally always-false is the
 *    exact same user-visible outcome as the bug — the button is not offered —
 *    and the sweep alone cannot tell them apart.
 *
 * The `sys_oauth_application` pair carries a third assertion: it is the site
 * where the migration CHANGES what a user sees, and the old spelling is pinned
 * as faulting so the flip is recorded rather than asserted.
 */

import { describe, expect, it } from 'vitest';
import { celEngine } from '@objectstack/formula';
import { SysUser } from './sys-user.object.js';
import { SysInvitation } from './sys-invitation.object.js';
import { SysMember } from './sys-member.object.js';
import { SysOauthApplication } from './sys-oauth-application.object.js';
import { SysOrganization } from './sys-organization.object.js';
import { SysTeam } from './sys-team.object.js';
import { SysTeamMember } from './sys-team-member.object.js';
import { SysApiKey } from './sys-api-key.object.js';
import { SysSsoProvider } from './sys-sso-provider.object.js';
import { SysScimProvider } from './sys-scim-provider.object.js';
import { SysTwoFactor } from './sys-two-factor.object.js';
import { SysAccount } from './sys-account.object.js';
import { SysSession } from './sys-session.object.js';
import { SysUserPreference } from './sys-user-preference.object.js';
import { SysBusinessUnit } from './sys-business-unit.object.js';
import { SysBusinessUnitMember } from './sys-business-unit-member.object.js';

const USER = { id: 'u1', email: 'me@example.com' };

/**
 * `defineObject` normalizes a CEL shorthand string into a `{dialect, source}`
 * envelope at parse time, and the `requiresFeature` lowering AND-composes its
 * own term onto the authored predicate — so the stored value is an envelope
 * whose source is not byte-identical to what the file spells. Read through
 * this rather than the raw key, or the assertions run against `undefined` and
 * pass for the wrong reason.
 */
function sourceOf(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && typeof (raw as { source?: unknown }).source === 'string') {
    return (raw as { source: string }).source;
  }
  return undefined;
}

/**
 * Every capability flag ON. Several of these actions carry `requiresFeature`,
 * whose lowering AND-composes a `features.*` term onto the authored predicate,
 * so the stored source reads a namespace the record binding does not carry —
 * without it the sweep reports `Unknown variable: features` for every gated
 * action and never reaches the record guard it exists to test. All-on is the
 * right setting here: a flag that is off short-circuits the composed `&&` and
 * hides the record half from the sweep entirely.
 */
const FEATURES = {
  organization: true, multiOrgEnabled: true, twoFactor: true,
  oidcProvider: true, admin: true, phoneNumber: true, apiKey: true, sso: true,
};

/** Evaluate through the canonical engine; a fault is reported, never thrown. */
function evaluate(source: string, record: Record<string, unknown>): boolean | string {
  const r = celEngine.evaluate({ dialect: 'cel', source }, { record, user: USER, extra: { features: FEATURES } });
  if (!r.ok) return `FAULT ${r.error.message.split('\n')[0].trim()}`;
  return typeof r.value === 'boolean' ? r.value : `NON-BOOLEAN ${JSON.stringify(r.value)}`;
}

/** Every `record.<key>` path the predicate reads, deepest-first. */
function recordPaths(source: string): string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(/record((?:\.[a-z_][a-z0-9_]*)+)/gi)) out.add(m[1].slice(1));
  return [...out];
}

/**
 * The bindings a sparse row can present for one predicate: the empty row, and
 * — for each path the predicate reads — that path projected holding null while
 * the rest stay absent, plus the fully-projected row with plausible values.
 */
function sparseBindings(source: string): Array<[string, Record<string, unknown>]> {
  const paths = recordPaths(source);
  const cases: Array<[string, Record<string, unknown>]> = [['{} (nothing projected)', {}]];
  const assign = (rec: Record<string, unknown>, path: string, value: unknown) => {
    const parts = path.split('.');
    let cur = rec;
    for (const p of parts.slice(0, -1)) cur = (cur[p] ??= {}) as Record<string, unknown>;
    cur[parts[parts.length - 1]] = value;
  };
  for (const path of paths) {
    const rec: Record<string, unknown> = {};
    assign(rec, path, null);
    cases.push([`${path} projected as null`, rec]);
  }
  const all: Record<string, unknown> = {};
  for (const path of paths) assign(all, path, 'x');
  cases.push(['every read projected with a value', all]);
  const allTrue: Record<string, unknown> = {};
  for (const path of paths) assign(allTrue, path, true);
  cases.push(['every read projected as true', allTrue]);
  return cases;
}

const OBJECTS: Array<[string, { actions?: unknown }]> = [
  ['sys_user', SysUser],
  ['sys_invitation', SysInvitation],
  ['sys_member', SysMember],
  ['sys_oauth_application', SysOauthApplication],
  ['sys_organization', SysOrganization],
  ['sys_team', SysTeam],
  ['sys_team_member', SysTeamMember],
  ['sys_api_key', SysApiKey],
  ['sys_sso_provider', SysSsoProvider],
  ['sys_scim_provider', SysScimProvider],
  ['sys_two_factor', SysTwoFactor],
  ['sys_account', SysAccount],
  ['sys_session', SysSession],
  ['sys_user_preference', SysUserPreference],
  ['sys_business_unit', SysBusinessUnit],
  ['sys_business_unit_member', SysBusinessUnitMember],
];

/** Every `(object, action, key, source)` whose predicate reads `record.*`. */
function recordScopedPredicates(): Array<{ object: string; action: string; key: string; source: string }> {
  const found: Array<{ object: string; action: string; key: string; source: string }> = [];
  for (const [objectName, def] of OBJECTS) {
    for (const action of (def.actions ?? []) as Array<Record<string, unknown>>) {
      for (const key of ['visible', 'disabled'] as const) {
        const source = sourceOf(action[key]);
        if (!source || !/\brecord\./.test(source)) continue;
        found.push({ object: objectName, action: String(action.name), key, source });
      }
    }
  }
  return found;
}

describe('#8990 — record-scoped action predicates on the sparse face', () => {
  const PREDICATES = recordScopedPredicates();

  it('the census is non-empty — a sweep over zero predicates proves nothing', () => {
    // Guards the sweep below against silently going vacuous if the extraction
    // ever stops matching (a renamed key, an envelope shape it does not read).
    expect(PREDICATES.length).toBeGreaterThanOrEqual(13);
  });

  it('no predicate faults on any binding a sparse row can present', () => {
    const faults: string[] = [];
    for (const p of PREDICATES) {
      for (const [label, record] of sparseBindings(p.source)) {
        const verdict = evaluate(p.source, record);
        if (typeof verdict !== 'boolean') {
          faults.push(`${p.object}.${p.action}.${p.key} on ${label}: ${verdict}\n    ${p.source}`);
        }
      }
    }
    expect(faults).toEqual([]);
  });

  it('every record read is opened by a has() guard on its own path', () => {
    // The sweep above is a behavioural check and can be satisfied by accident
    // (a predicate that reads only always-projected columns passes it today
    // and breaks the day a view narrows its `$select`). This one is structural:
    // it asks that the AUTHORED form carry the guard, so the next predicate is
    // written correctly rather than measured lucky.
    const unguarded: string[] = [];
    for (const p of PREDICATES) {
      for (const path of recordPaths(p.source)) {
        if (!p.source.includes(`has(record.${path})`)) {
          unguarded.push(`${p.object}.${p.action}.${p.key} reads record.${path} unguarded\n    ${p.source}`);
        }
      }
    }
    expect(unguarded).toEqual([]);
  });
});

describe('#8990 — per-site verdicts (a guard must not be an always-false wrapper)', () => {
  const visibleOf = (def: { actions?: unknown }, name: string): string => {
    const action = ((def.actions ?? []) as Array<Record<string, unknown>>).find((a) => a.name === name);
    if (!action) throw new Error(`no action ${name}`);
    const source = sourceOf(action.visible);
    if (!source) throw new Error(`action ${name} has no CEL source`);
    return source;
  };

  it('sys_user account-settings actions still answer TRUE for the row owner', () => {
    const own = { id: 'u1', source: 'local', email_verified: false, two_factor_enabled: false };
    expect(evaluate(visibleOf(SysUser, 'update_my_profile'), own)).toBe(true);
    expect(evaluate(visibleOf(SysUser, 'change_my_password'), own)).toBe(true);
    expect(evaluate(visibleOf(SysUser, 'resend_verification_email'), own)).toBe(true);
    expect(evaluate(visibleOf(SysUser, 'enable_two_factor'), own)).toBe(true);
    // ... and still FALSE for the cases the predicates exist to exclude.
    expect(evaluate(visibleOf(SysUser, 'change_my_password'), { ...own, source: 'idp_provisioned' })).toBe(false);
    expect(evaluate(visibleOf(SysUser, 'update_my_profile'), { ...own, id: 'someone_else' })).toBe(false);
    expect(evaluate(visibleOf(SysUser, 'enable_two_factor'), { ...own, two_factor_enabled: true })).toBe(false);
    expect(evaluate(visibleOf(SysUser, 'disable_two_factor'), { ...own, two_factor_enabled: true })).toBe(true);
  });

  it('sys_invitation accept/decline are offered to the recipient on a pending row', () => {
    const row = { email: 'me@example.com', status: 'pending' };
    expect(evaluate(visibleOf(SysInvitation, 'accept_invitation'), row)).toBe(true);
    expect(evaluate(visibleOf(SysInvitation, 'reject_invitation'), row)).toBe(true);
    expect(evaluate(visibleOf(SysInvitation, 'accept_invitation'), { ...row, email: 'other@example.com' })).toBe(false);
    expect(evaluate(visibleOf(SysInvitation, 'accept_invitation'), { ...row, status: 'accepted' })).toBe(false);
  });

  it('sys_member transfer_ownership is offered on a non-owner row only', () => {
    expect(evaluate(visibleOf(SysMember, 'transfer_ownership'), { role: 'member' })).toBe(true);
    expect(evaluate(visibleOf(SysMember, 'transfer_ownership'), { role: 'owner' })).toBe(false);
  });
});

describe('#8990 — sys_oauth_application: the binding where the migration changes what a user sees', () => {
  /**
   * `disabled` is nullable upstream — better-auth writes the column only when
   * the flag is set — so a list row can carry it PROJECTED AND NULL, which is
   * the ordinary state of every application nobody has ever toggled. Both old
   * spellings broke on exactly that row, in different ways.
   */
  const NEVER_TOGGLED = { disabled: null };

  it('the OLD spelling faulted on a projected-null row (this is the defect, pinned)', () => {
    // `!` is an operator that needs a bool, so a null operand is a fault, not
    // a falsy read — and the fault is fail-closed, so the button vanished.
    expect(evaluate('!record.disabled', NEVER_TOGGLED)).toBe('FAULT no such overload: !null');
    // The Enable side did not fault; it answered a non-boolean, which is its
    // own defect — the renderer, not the predicate, decided what that meant.
    expect(evaluate('record.disabled', NEVER_TOGGLED)).toBe('NON-BOOLEAN null');
  });

  it('the migrated spellings answer a real boolean — Disable offered, Enable not', () => {
    const find = (name: string) =>
      sourceOf(((SysOauthApplication.actions ?? []) as Array<Record<string, unknown>>)
        .find((a) => a.name === name)!.visible)!;
    // NB: both carry `requiresFeature: 'oidcProvider'`, which the lowering
    // AND-composes onto the authored predicate — so these sources also read
    // `features.oidcProvider`, and the bindings below supply it.
    const disable = find('disable_oauth_application');
    const enable = find('enable_oauth_application');

    expect(evaluate(disable, NEVER_TOGGLED)).toBe(true);
    expect(evaluate(enable, NEVER_TOGGLED)).toBe(false);

    // The rest of the truth table is unchanged by the migration.
    expect(evaluate(disable, { disabled: false })).toBe(true);
    expect(evaluate(enable, { disabled: false })).toBe(false);
    expect(evaluate(disable, { disabled: true })).toBe(false);
    expect(evaluate(enable, { disabled: true })).toBe(true);

    // And on a row that never projected the column at all, both stay closed —
    // there is nothing to decide from, so offering neither is the right answer.
    expect(evaluate(disable, {})).toBe(false);
    expect(evaluate(enable, {})).toBe(false);
  });
});
