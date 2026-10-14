// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23287 — ruling C′ items 1, 3 and 4] The ONE judgment at the shared
 * key-admission seam: a key whose OWNER holds an `account`-scope ADR-0069
 * posture answers as the owner's session does.
 *
 * What these pin, at the seam every face shares (`resolveApiKeyAdmission`,
 * reached through `resolveAuthzContext`):
 *
 *  - an owner held by `MFA_REQUIRED` (scope `account`) → the key resolves as a
 *    HELD principal: `credential: 'api_key'`, the owner's id, and the posture
 *    on `authGate` — the field every door refuses on;
 *  - an owner held only by `PASSWORD_EXPIRED` / `PASSWORD_RESET_REQUIRED`
 *    (scope `credential`) → the key is admitted with no posture;
 *  - an owner held by both → the account-scope one answers, wherever it sits;
 *  - the refusal is not a revocation: the same key, nothing rewritten, is
 *    admitted again the moment the posture clears;
 *  - a cookie sent beside an admitted key never answers for the key;
 *  - a posture computation that rejects is the branded outage, never an
 *    admission;
 *  - the tenancy refusal still answers first, as the generic 401;
 *  - the key's own organization is what the owner is asked about.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveAuthzContext } from './resolve-authz-context.js';
import { hashApiKey, resolveApiKeyAdmission } from './api-key.js';
import {
  accountScopeAuthGate,
  authGateScope,
  normalizeAuthGate,
  userAuthGateSourceOf,
  evaluateAuthGate,
  type AuthGate,
} from './auth-gate.js';
import { isAuthzStoreUnavailableError } from './authz-store-unavailable.js';

const KEY = 'osk_account_posture_pin_key';
const OWNER = 'u_key_owner';
const COOKIE_USER = 'u_cookie_holder';

const MFA_REQUIRED: AuthGate = {
  code: 'MFA_REQUIRED',
  message: 'Multi-factor authentication is required. Please set up an authenticator app to continue.',
};
const PASSWORD_EXPIRED: AuthGate = {
  code: 'PASSWORD_EXPIRED',
  message: 'Your password has expired. Please change it to continue.',
};
const PASSWORD_RESET_REQUIRED: AuthGate = {
  code: 'PASSWORD_RESET_REQUIRED',
  message: 'You must change your password before continuing.',
};

/**
 * A read-only engine: `find` alone, so nothing on this path CAN write — the
 * "not a revocation" case below also compares the key row before and after.
 * The caller's `limit` is held by presence, after the filter.
 */
function makeQl(keyRow: Record<string, unknown> = {}) {
  const tables: Record<string, any[]> = {
    sys_api_key: [{ id: 'key_1', key: hashApiKey(KEY), user_id: OWNER, revoked: false, scopes: '[]', ...keyRow }],
    sys_member: [],
    sys_user: [{ id: OWNER }, { id: COOKIE_USER }],
  };
  return {
    tables,
    ql: {
      async find(object: string, opts: any) {
        const where = opts?.where ?? {};
        const rows = (tables[object] ?? []).filter((r) =>
          Object.entries(where).every(([k, v]) =>
            v && typeof v === 'object' && '$in' in (v as any) ? (v as any).$in.includes(r[k]) : r[k] === v),
        );
        return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
      },
    },
  };
}

/** A posture source over a mutable per-user table — what `AuthManager.resolveUserAuthGates` answers. */
function postureSource(initial: Record<string, AuthGate[]>) {
  const table = { ...initial };
  const calls: Array<{ userId: string; organizationId?: string }> = [];
  const source = vi.fn(async (userId: string, options: { organizationId?: string }) => {
    calls.push({ userId, organizationId: options.organizationId });
    return table[userId] ?? [];
  });
  return { table, calls, source };
}

const keyHeaders = () => new Headers({ 'x-api-key': KEY });

describe('the posture scope table, read where the seam reads it', () => {
  it('MFA_REQUIRED holds the account; expiry and the forced reset hold the password sign-in', () => {
    expect(authGateScope(MFA_REQUIRED)).toBe('account');
    expect(authGateScope(PASSWORD_EXPIRED)).toBe('credential');
    expect(authGateScope(PASSWORD_RESET_REQUIRED)).toBe('credential');
  });

  it('the account-scope posture is found wherever it sits in the most-urgent-first list', () => {
    expect(accountScopeAuthGate([PASSWORD_RESET_REQUIRED, PASSWORD_EXPIRED, MFA_REQUIRED])).toEqual(MFA_REQUIRED);
    expect(accountScopeAuthGate([PASSWORD_EXPIRED, PASSWORD_RESET_REQUIRED])).toBeNull();
    expect(accountScopeAuthGate([])).toBeNull();
  });

  it('a code outside the closed vocabulary is not a posture', () => {
    expect(normalizeAuthGate({ authGate: { code: 'ACCOUNT_SUSPENDED', message: 'x' } })).toBeNull();
    expect(normalizeAuthGate({ authGate: { code: 'PASSWORD_RESET_REQUIRED', message: 'x' } }))
      .toEqual({ code: 'PASSWORD_RESET_REQUIRED', message: 'x' });
  });

  it('the bound source normalizes what the service answers, and is absent for a service with none', async () => {
    expect(userAuthGateSourceOf(undefined)).toBeUndefined();
    expect(userAuthGateSourceOf({})).toBeUndefined();
    const source = userAuthGateSourceOf({
      resolveUserAuthGates: async () => [MFA_REQUIRED, { code: 'NOT_A_POSTURE', message: 'x' }, { code: 'PASSWORD_EXPIRED' }],
    })!;
    expect(await source('u', {})).toEqual([
      MFA_REQUIRED,
      { code: 'PASSWORD_EXPIRED', message: 'Access is blocked by an authentication policy.' },
    ]);
  });
});

describe('resolveApiKeyAdmission — the held arm (ruling C′ item 3)', () => {
  it('holds a key whose owner holds an account-scope posture, carrying the principal and the posture', async () => {
    const { ql } = makeQl();
    const { source } = postureSource({ [OWNER]: [MFA_REQUIRED] });
    const admission = await resolveApiKeyAdmission(ql, keyHeaders(), Date.now(), undefined, source);
    expect(admission.outcome).toBe('held');
    if (admission.outcome !== 'held') return;
    expect(admission.principal.userId).toBe(OWNER);
    expect(admission.gate).toEqual(MFA_REQUIRED);
  });

  it('admits a key whose owner holds only credential-scope postures', async () => {
    const { ql } = makeQl();
    const { source } = postureSource({ [OWNER]: [PASSWORD_RESET_REQUIRED, PASSWORD_EXPIRED] });
    const admission = await resolveApiKeyAdmission(ql, keyHeaders(), Date.now(), undefined, source);
    expect(admission.outcome).toBe('admitted');
  });

  it('asks the owner about the KEY\'s own organization', async () => {
    const { ql } = makeQl({ active_organization_id: 'org_key' });
    const { source, calls } = postureSource({});
    await resolveApiKeyAdmission(ql, keyHeaders(), Date.now(), undefined, source);
    expect(calls).toEqual([{ userId: OWNER, organizationId: 'org_key' }]);
  });

  it('answers the tenancy refusal first, without asking the owner', async () => {
    const { ql } = makeQl();
    const { source, calls } = postureSource({ [OWNER]: [MFA_REQUIRED] });
    const admission = await resolveApiKeyAdmission(ql, keyHeaders(), Date.now(), 'isolated', source);
    expect(admission.outcome).toBe('refused');
    expect(calls).toEqual([]);
  });

  it('a posture computation that rejects is the branded store outage, never an admission', async () => {
    const { ql } = makeQl();
    const source = async () => { throw new Error('auth service fault'); };
    const err = await resolveApiKeyAdmission(ql, keyHeaders(), Date.now(), undefined, source).catch((e) => e);
    expect(isAuthzStoreUnavailableError(err)).toBe(true);
    expect(err.status).toBe(503);
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('without a posture source the owner is not asked (an unwired caller keeps the old answer)', async () => {
    const { ql } = makeQl();
    expect((await resolveApiKeyAdmission(ql, keyHeaders(), Date.now())).outcome).toBe('admitted');
  });
});

describe('resolveAuthzContext — a held key is a held principal, judged by the key', () => {
  it('resolves the owner, credential `api_key`, with the account posture the doors refuse on', async () => {
    const { ql } = makeQl();
    const { source } = postureSource({ [OWNER]: [PASSWORD_EXPIRED, MFA_REQUIRED] });
    const authz = await resolveAuthzContext({ ql, headers: keyHeaders(), userAuthGates: source });
    expect(authz.userId).toBe(OWNER);
    expect(authz.credential).toBe('api_key');
    // The account-scope posture answers, not the first (credential-scope) entry.
    expect(authz.authGate).toEqual(MFA_REQUIRED);
    // The shared decision every door asks refuses it, with the session's code and message.
    expect(evaluateAuthGate(authz, '')).toEqual(MFA_REQUIRED);
  });

  it('a credential-scope posture keeps the key working: no posture on the context', async () => {
    const { ql } = makeQl();
    const { source } = postureSource({ [OWNER]: [PASSWORD_RESET_REQUIRED] });
    const authz = await resolveAuthzContext({ ql, headers: keyHeaders(), userAuthGates: source });
    expect(authz.userId).toBe(OWNER);
    expect(authz.credential).toBe('api_key');
    expect(authz.authGate).toBeUndefined();
    expect(evaluateAuthGate(authz, '')).toBeNull();
  });

  it('the refusal is not a revocation: the same key is admitted again once the posture clears', async () => {
    const { ql, tables } = makeQl();
    const keyRowBefore = JSON.stringify(tables.sys_api_key);
    const { table, source } = postureSource({ [OWNER]: [MFA_REQUIRED] });
    const held = await resolveAuthzContext({ ql, headers: keyHeaders(), userAuthGates: source });
    expect(held.authGate).toEqual(MFA_REQUIRED);
    // The owner enrols; nothing about the key is rewritten or reissued.
    table[OWNER] = [];
    const again = await resolveAuthzContext({ ql, headers: keyHeaders(), userAuthGates: source });
    expect(again.userId).toBe(OWNER);
    expect(again.authGate).toBeUndefined();
    expect(JSON.stringify(tables.sys_api_key)).toBe(keyRowBefore);
  });

  it('a held cookie beside an admitted key never answers for the key', async () => {
    const { ql } = makeQl();
    const { source } = postureSource({ [OWNER]: [] });
    const getSession = vi.fn(async () => ({ user: { id: COOKIE_USER, authGate: MFA_REQUIRED } }));
    const authz = await resolveAuthzContext({
      ql,
      headers: new Headers({ 'x-api-key': KEY, cookie: 'session=held' }),
      getSession,
      userAuthGates: source,
    });
    expect(authz.userId).toBe(OWNER);
    expect(authz.credential).toBe('api_key');
    expect(authz.authGate).toBeUndefined();
    expect(getSession).not.toHaveBeenCalled();
  });

  it('a held key does not fall through to the session path', async () => {
    const { ql } = makeQl();
    const { source } = postureSource({ [OWNER]: [MFA_REQUIRED] });
    const getSession = vi.fn(async () => ({ user: { id: COOKIE_USER } }));
    const authz = await resolveAuthzContext({
      ql, headers: new Headers({ 'x-api-key': KEY, cookie: 'session=ok' }), getSession, userAuthGates: source,
    });
    expect(authz.userId).toBe(OWNER);
    expect(authz.authGate).toEqual(MFA_REQUIRED);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('the session arm carries the session\'s own posture, every scope included', async () => {
    const { ql } = makeQl();
    const authz = await resolveAuthzContext({
      ql,
      headers: new Headers({ cookie: 'session=held' }),
      getSession: async () => ({ user: { id: COOKIE_USER, authGate: PASSWORD_EXPIRED } }),
    });
    expect(authz.credential).toBe('session');
    expect(authz.authGate).toEqual(PASSWORD_EXPIRED);
  });

  it('a posture computation that rejects leaves the resolver loud', async () => {
    const { ql } = makeQl();
    const err = await resolveAuthzContext({
      ql, headers: keyHeaders(), userAuthGates: async () => { throw new Error('fault'); },
    }).catch((e) => e);
    expect(isAuthzStoreUnavailableError(err)).toBe(true);
  });
});
