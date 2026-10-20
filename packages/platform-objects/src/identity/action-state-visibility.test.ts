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

const ADMIN = { id: 'u_admin', email: 'admin@example.com', positions: [], isPlatformAdmin: true };
const MEMBER = { id: 'u_member', email: 'member@example.com', positions: ['org_owner'], isPlatformAdmin: false };
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
function offered(source: string, record: Record<string, unknown>, user = ADMIN): boolean | string {
  const r = celEngine.evaluate(
    { dialect: 'cel', source },
    { record, extra: { current_user: user, user, ctx: { user }, features: FEATURES } },
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
    // Who may restore a key a forced password reset revoked is the server's
    // (plugin-auth `api-key-restore-guard.ts`), not this predicate's.
    for (const row of [{ revoked: true }, { revoked: true, revoked_reason: 'admin_password_reset' }]) {
      expect(offered(restore, row), JSON.stringify(row)).toBe(true);
      expect(offered(revoke, row), JSON.stringify(row)).toBe(false);
    }
  });

  it('a row that does not carry `revoked` offers neither, and never both', () => {
    expect(offered(revoke, {})).toBe(false);
    expect(offered(restore, {})).toBe(false);
  });
});
