// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup's Users and API Keys offer an action only in the record state it
 * changes: Ban on a user who is not banned and Unban on one who is, Revoke on
 * a live key and Restore on a revoked one, Unlock on an account that can hold
 * a lock. Each pair used to judge the caller's standing alone, so both halves
 * were offered on every row.
 *
 * The predicates are EVALUATED through the canonical engine the console
 * delegates to (`@objectstack/formula`), on the parsed object, so the stored
 * envelope with its `requiresFeature` lowering is what is judged. A string
 * match would stay green on a predicate that faults or never answers true.
 * The bindings are the rows a list or record header can present: the field
 * projected with each value, projected as null, and not projected at all.
 */

import { describe, expect, it } from 'vitest';
import { celEngine } from '@objectstack/formula';
import { SysUser } from './sys-user.object.js';
import { SysApiKey } from './sys-api-key.object.js';

type Principal = { id: string; email: string; positions: string[]; isPlatformAdmin: boolean };

const ADMIN: Principal = { id: 'u_admin', email: 'admin@example.com', positions: [], isPlatformAdmin: true };
const MEMBER: Principal = { id: 'u_member', email: 'member@example.com', positions: ['org_owner'], isPlatformAdmin: false };
const FEATURES = { admin: true, apiKey: true };

function visibleOf(def: { actions?: unknown }, name: string): string {
  const action = ((def.actions ?? []) as Array<Record<string, unknown>>).find((a) => a.name === name);
  if (!action) throw new Error(`no action ${name}`);
  const raw = action.visible;
  const source = typeof raw === 'string' ? raw : (raw as { source?: unknown } | undefined)?.source;
  if (typeof source !== 'string') throw new Error(`action ${name} has no CEL source`);
  return source;
}

/** The verdict, or the fault spelled out so a faulting predicate fails loudly. */
function offered(
  source: string,
  record: Record<string, unknown>,
  user: Principal = ADMIN,
  features: Record<string, unknown> = FEATURES,
): boolean | string {
  const r = celEngine.evaluate(
    { dialect: 'cel', source },
    { record, extra: { current_user: user, user, ctx: { user }, features } },
  );
  if (!r.ok) return `FAULT ${r.error.message.split('\n')[0].trim()}`;
  return typeof r.value === 'boolean' ? r.value : `NON-BOOLEAN ${JSON.stringify(r.value)}`;
}

describe('sys_user Ban / Unban switch with `banned`', () => {
  const ban = visibleOf(SysUser, 'ban_user');
  const unban = visibleOf(SysUser, 'unban_user');

  it('a user who is not banned is offered Ban and not Unban', () => {
    for (const banned of [false, null]) {
      expect(offered(ban, { banned }), `banned: ${banned}`).toBe(true);
      expect(offered(unban, { banned }), `banned: ${banned}`).toBe(false);
    }
  });

  it('a banned user is offered Unban and not Ban, a timed ban past its expiry included', () => {
    // better-auth clears `banned` only at the user's next sign-in, so a row
    // past `ban_expires` still says banned and Unban must stay offered.
    for (const row of [{ banned: true }, { banned: true, ban_expires: '2020-01-01T00:00:00.000Z' }]) {
      expect(offered(unban, row), JSON.stringify(row)).toBe(true);
      expect(offered(ban, row), JSON.stringify(row)).toBe(false);
    }
  });

  it('a row that does not carry `banned` offers neither, and never both', () => {
    expect(offered(ban, {})).toBe(false);
    expect(offered(unban, {})).toBe(false);
  });

  it('the standing leg stays: a caller without it is offered neither on any row', () => {
    for (const banned of [true, false, null]) {
      expect(offered(ban, { banned }, MEMBER)).toBe(false);
      expect(offered(unban, { banned }, MEMBER)).toBe(false);
    }
  });
});

/**
 * Ban / Unban / Unlock / Set Password are offered on a kernel WITHOUT the
 * better-auth admin plugin: their doors (plugin-auth `admin/ban-user` /
 * `admin/unban-user` / `admin/unlock-user` / `admin/set-user-password`) are
 * mounted and work there too, so `features.admin` off, the flag every such
 * kernel serves, managed or not, hides none of them (Set Password keeps its
 * own hide-when-cloud-managed rule). The actions whose doors still need the
 * plugin keep their `requiresFeature: 'admin'` gate.
 */
describe('sys_user Ban / Unban / Unlock / Set Password are offered without the admin plugin', () => {
  const ban = visibleOf(SysUser, 'ban_user');
  const unban = visibleOf(SysUser, 'unban_user');
  const unlock = visibleOf(SysUser, 'unlock_user');
  const setPassword = visibleOf(SysUser, 'set_user_password');
  /** What a kernel without the plugin serves: unmanaged (self-hosted) and managed (a Free or Team environment). */
  const WITHOUT_PLUGIN = [
    { admin: false, apiKey: true, cloudManaged: false },
    { admin: false, apiKey: true, cloudManaged: true },
  ];

  it('a user who is not banned is offered Ban and a banned one Unban, managed or not', () => {
    for (const features of WITHOUT_PLUGIN) {
      const where = JSON.stringify(features);
      expect(offered(ban, { banned: false }, ADMIN, features), where).toBe(true);
      expect(offered(unban, { banned: false }, ADMIN, features), where).toBe(false);
      expect(offered(unban, { banned: true }, ADMIN, features), where).toBe(true);
      expect(offered(ban, { banned: true }, ADMIN, features), where).toBe(false);
    }
  });

  it('a locked or two-factor account is offered Unlock and one with neither is not, managed or not', () => {
    for (const features of WITHOUT_PLUGIN) {
      const where = JSON.stringify(features);
      expect(offered(unlock, { locked_until: '2999-01-01T00:00:00.000Z', two_factor_enabled: false }, ADMIN, features), where).toBe(true);
      expect(offered(unlock, { locked_until: null, two_factor_enabled: true }, ADMIN, features), where).toBe(true);
      expect(offered(unlock, { locked_until: null, two_factor_enabled: false }, ADMIN, features), where).toBe(false);
    }
  });

  it('Set Password is offered unmanaged and stays hidden managed, its own rule kept', () => {
    const [unmanaged, managed] = WITHOUT_PLUGIN;
    expect(offered(setPassword, { source: 'env_native' }, ADMIN, unmanaged!)).toBe(true);
    expect(offered(setPassword, { source: 'env_native' }, ADMIN, managed!)).toBe(false);
  });

  it('the standing leg stays: a caller without it is offered neither with the plugin off', () => {
    for (const features of WITHOUT_PLUGIN) {
      for (const banned of [true, false]) {
        expect(offered(ban, { banned }, MEMBER, features)).toBe(false);
        expect(offered(unban, { banned }, MEMBER, features)).toBe(false);
      }
      expect(offered(unlock, { locked_until: '2999-01-01T00:00:00.000Z', two_factor_enabled: true }, MEMBER, features)).toBe(false);
      expect(offered(setPassword, { source: 'env_native' }, MEMBER, features)).toBe(false);
    }
  });

  // CONTROL: the admin-plugin-only actions. Each row is one its predicate
  // otherwise offers, so the flag alone decides.
  const PLUGIN_ONLY: ReadonlyArray<[string, Record<string, unknown>]> = [
    ['create_user', {}],
    ['impersonate_user', {}],
  ];

  it('CONTROL: exactly the admin-plugin-only actions still read `features.admin`', () => {
    const gated = ((SysUser.actions ?? []) as Array<Record<string, unknown>>)
      .filter((a) => {
        const raw = a.visible;
        const source = typeof raw === 'string' ? raw : (raw as { source?: unknown } | undefined)?.source;
        return typeof source === 'string' && /\bfeatures\.admin\b/.test(source);
      })
      .map((a) => a.name);
    expect(gated).toEqual(PLUGIN_ONLY.map(([name]) => name));
  });

  it.each(PLUGIN_ONLY)('CONTROL: %s stays hidden without the plugin and is offered with it', (name, row) => {
    const source = visibleOf(SysUser, name);
    expect(offered(source, row, ADMIN, { admin: false, apiKey: true, cloudManaged: false })).toBe(false);
    expect(offered(source, row, ADMIN, { admin: true, apiKey: true, cloudManaged: false })).toBe(true);
  });
});

describe('sys_user Unlock is offered on an account that can hold a lock', () => {
  const unlock = visibleOf(SysUser, 'unlock_user');

  it('an account with no lock stamp and no second factor is not offered Unlock', () => {
    expect(offered(unlock, { locked_until: null, two_factor_enabled: false })).toBe(false);
    expect(offered(unlock, { locked_until: null, two_factor_enabled: null })).toBe(false);
  });

  it('a password-stage lock is offered Unlock, an expired stamp included', () => {
    // An expired lock leaves `failed_login_count` at the threshold, so the
    // next failure re-locks; Unlock is what resets that counter.
    for (const locked_until of ['2999-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z']) {
      expect(offered(unlock, { locked_until, two_factor_enabled: false }), locked_until).toBe(true);
    }
  });

  it('a two-factor user is offered Unlock: a second-factor lock lives on `sys_two_factor`, not this row', () => {
    expect(offered(unlock, { locked_until: null, two_factor_enabled: true })).toBe(true);
  });

  it('a row that carries neither field is not offered Unlock, and the standing leg stays', () => {
    expect(offered(unlock, {})).toBe(false);
    expect(offered(unlock, { locked_until: '2999-01-01T00:00:00.000Z' }, MEMBER)).toBe(false);
    expect(offered(unlock, { two_factor_enabled: true }, MEMBER)).toBe(false);
  });
});

describe('sys_api_key Revoke / Restore switch with `revoked`', () => {
  const revoke = visibleOf(SysApiKey, 'revoke_api_key');
  const restore = visibleOf(SysApiKey, 'restore_api_key');

  it('a live key is offered Revoke and not Restore', () => {
    for (const revoked of [false, null]) {
      expect(offered(revoke, { revoked }), `revoked: ${revoked}`).toBe(true);
      expect(offered(restore, { revoked }), `revoked: ${revoked}`).toBe(false);
    }
  });

  it('a revoked key is offered Restore and not Revoke, whatever the reason', () => {
    // Who may restore a key revoked with a reason is the server's (plugin-auth
    // `api-key-restore-guard.ts`), not this predicate's: it refuses every
    // user-context restore of a membership-ended key, with the reason.
    for (const row of [
      { revoked: true },
      { revoked: true, revoked_reason: 'admin_password_reset' },
      { revoked: true, revoked_reason: 'organization_membership_ended' },
    ]) {
      expect(offered(restore, row), JSON.stringify(row)).toBe(true);
      expect(offered(revoke, row), JSON.stringify(row)).toBe(false);
    }
  });

  it('a row that does not carry `revoked` offers neither, and never both', () => {
    expect(offered(revoke, {})).toBe(false);
    expect(offered(restore, {})).toBe(false);
  });
});
