// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23367, ruling A] The API-key lifecycle policy at the shared key-admission
 * seam (`resolveApiKeyAdmission`) and its raise through `resolveAuthzContext`.
 *
 * What these pin:
 *  - revoked, expired and inactive are three DISTINCT located refusals
 *    (`API_KEY_REVOKED`, `API_KEY_EXPIRED`, `API_KEY_INACTIVE`), raised as the
 *    branded `ApiKeyLifecycleRefusalError` (403) and never a fall-through to
 *    the session;
 *  - the inactivity judgment reads the PRE-stamp `last_used_at`, so a key's
 *    own call cannot revive it, and a refusal writes nothing (not revoked);
 *  - a key with no recorded use counts from the policy's landing, never from
 *    an earlier `created_at`, and from its signing when that is later;
 *  - a key signed with no expiry gets the one-year grace from the landing,
 *    stamped onto `expires_at` when admitted, and refused with that date after;
 *  - an admitted (or held) call stamps `last_used_at`, at most once an hour,
 *    and a stamp failure never fails the request and is said once;
 *  - each number is the source's, so a changed setting changes the verdict.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import type { ApiKeyLifecyclePolicy } from '@objectstack/spec/contracts';

import {
  API_KEY_LAST_USED_STAMP_INTERVAL_MS,
  ApiKeyLifecycleRefusalError,
  apiKeyLifecyclePolicySourceOf,
  hashApiKey,
  isApiKeyLifecycleRefusalError,
  resolveApiKeyAdmission,
} from './api-key.js';
import { isAuthzStoreUnavailableError } from './authz-store-unavailable.js';
import { resolveAuthzContext } from './resolve-authz-context.js';

const DAY = 86_400_000;
const NOW = Date.parse('2027-06-01T00:00:00.000Z');
const RAW = 'osk_lifecycle_test_key';
const KEY_ID = 'key_1';
const OWNER = 'usr_owner';

const iso = (ms: number): string => new Date(ms).toISOString();

interface Recorded { object: string; data: Record<string, unknown> }

/**
 * One `sys_api_key` row, matched by hash; records every `update` it is asked
 * for. `find` holds the caller's bound (by presence), and `update` routes
 * through the real engine's dispatch contract, so the seam's stamp is proven
 * to use a call shape `ObjectQL.update` accepts (`{ id, ...fields }`).
 */
function makeQl(row: Record<string, unknown>, opts: { failUpdate?: boolean } = {}) {
  const updates: Recorded[] = [];
  const rows: any[] = [{ id: KEY_ID, key: hashApiKey(RAW), prefix: 'osk_lifecycl', user_id: OWNER, revoked: false, ...row }];
  const ql = {
    updates,
    find: async (object: string, findOpts: any) => {
      if (object !== 'sys_api_key') return [];
      const where = findOpts?.where ?? {};
      const matched = rows.filter((r) => Object.entries(where).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        return r[k] === v;
      }));
      return typeof findOpts?.limit === 'number' ? matched.slice(0, findOpts.limit) : matched;
    },
    update: async (object: string, data: Record<string, unknown>, options?: any) => {
      assertEngineUpdateDispatch(data as any, options);
      if (opts.failUpdate) throw new Error('write refused');
      updates.push({ object, data });
      return data;
    },
  };
  return ql;
}

const headers = () => ({ 'x-api-key': RAW });

function policy(over: Partial<ApiKeyLifecyclePolicy> = {}) {
  return (): ApiKeyLifecyclePolicy => ({
    defaultExpiryDays: 90,
    maxExpiryDays: 365,
    inactivityDays: 90,
    startedAt: iso(NOW - 10 * DAY),
    ...over,
  });
}

describe('[#23367] three distinct, located lifecycle refusals', () => {
  it('revoked, expired and inactive each answer their own code', async () => {
    const revoked = await resolveApiKeyAdmission(makeQl({ revoked: true }), headers(), NOW, undefined, undefined, policy());
    const expired = await resolveApiKeyAdmission(
      makeQl({ expires_at: iso(NOW - DAY) }), headers(), NOW, undefined, undefined, policy());
    const inactive = await resolveApiKeyAdmission(
      makeQl({ expires_at: iso(NOW + DAY), last_used_at: iso(NOW - 91 * DAY) }), headers(), NOW, undefined, undefined, policy());

    const codes = [revoked, expired, inactive].map((a) => (a.outcome === 'lifecycle' ? a.refusal.code : a.outcome));
    expect(codes).toEqual(['API_KEY_REVOKED', 'API_KEY_EXPIRED', 'API_KEY_INACTIVE']);
  });

  it('an expired key names its date', async () => {
    const at = iso(NOW - DAY);
    const a = await resolveApiKeyAdmission(makeQl({ expires_at: at }), headers(), NOW, undefined, undefined, undefined);
    expect(a.outcome === 'lifecycle' && a.refusal.at).toBe(at);
    expect(a.outcome === 'lifecycle' && a.refusal.message).toContain(at);
  });

  it('an unknown key is still `none` — a prober holding no real key learns nothing', async () => {
    const a = await resolveApiKeyAdmission(makeQl({}), { 'x-api-key': 'osk_not_a_key' }, NOW, undefined, undefined, policy());
    expect(a.outcome).toBe('none');
  });

  it('without a policy source the row facts still refuse, and no inactivity is judged', async () => {
    const revoked = await resolveApiKeyAdmission(makeQl({ revoked: true }), headers(), NOW, undefined, undefined, undefined);
    expect(revoked.outcome === 'lifecycle' && revoked.refusal.code).toBe('API_KEY_REVOKED');
    const idle = await resolveApiKeyAdmission(
      makeQl({ last_used_at: iso(NOW - 400 * DAY) }), headers(), NOW, undefined, undefined, undefined);
    expect(idle.outcome).toBe('admitted');
  });
});

describe('[#23367] inactivity reads the PRE-stamp value, and a refusal writes nothing', () => {
  it('a key idle more than 90 days is refused although this call would have stamped it', async () => {
    const ql = makeQl({ last_used_at: iso(NOW - 91 * DAY) });
    const a = await resolveApiKeyAdmission(ql, headers(), NOW, undefined, undefined, policy());
    expect(a.outcome === 'lifecycle' && a.refusal.code).toBe('API_KEY_INACTIVE');
    // Not revoked, not stamped: the row is exactly as it was.
    expect(ql.updates).toEqual([]);
    // …so the next call is refused the same way — its own use did not revive it.
    const again = await resolveApiKeyAdmission(ql, headers(), NOW + 1000, undefined, undefined, policy());
    expect(again.outcome === 'lifecycle' && again.refusal.code).toBe('API_KEY_INACTIVE');
  });

  it('a key used 89 days ago is admitted', async () => {
    const a = await resolveApiKeyAdmission(
      makeQl({ last_used_at: iso(NOW - 89 * DAY) }), headers(), NOW, undefined, undefined, policy());
    expect(a.outcome).toBe('admitted');
  });
});

describe('[#23367] a key with no recorded use counts from the landing', () => {
  it('counts from the landing, never from an EARLIER created_at', async () => {
    // Signed two years ago; the policy landed 10 days ago: idle for 10 days.
    const recent = await resolveApiKeyAdmission(
      makeQl({ expires_at: iso(NOW + DAY), created_at: iso(NOW - 730 * DAY) }),
      headers(), NOW, undefined, undefined, policy({ startedAt: iso(NOW - 10 * DAY) }));
    expect(recent.outcome).toBe('admitted');

    // Same row, the policy landed 100 days ago: refused, naming the landing.
    const landedAt = iso(NOW - 100 * DAY);
    const old = await resolveApiKeyAdmission(
      makeQl({ expires_at: iso(NOW + DAY), created_at: iso(NOW - 730 * DAY) }),
      headers(), NOW, undefined, undefined, policy({ startedAt: landedAt }));
    expect(old.outcome === 'lifecycle' && old.refusal.code).toBe('API_KEY_INACTIVE');
    expect(old.outcome === 'lifecycle' && old.refusal.at).toBe(landedAt);
  });

  it('counts from the signing when the key was signed after the landing', async () => {
    const landedAt = iso(NOW - 300 * DAY);
    const fresh = await resolveApiKeyAdmission(
      makeQl({ expires_at: iso(NOW + DAY), created_at: iso(NOW - 10 * DAY) }),
      headers(), NOW, undefined, undefined, policy({ startedAt: landedAt }));
    expect(fresh.outcome).toBe('admitted');

    const signedAt = iso(NOW - 100 * DAY);
    const stale = await resolveApiKeyAdmission(
      makeQl({ expires_at: iso(NOW + DAY), created_at: signedAt }),
      headers(), NOW, undefined, undefined, policy({ startedAt: landedAt }));
    expect(stale.outcome === 'lifecycle' && stale.refusal.at).toBe(signedAt);
  });

  it('with no landing recorded, a key with no recorded use is not judged idle', async () => {
    const a = await resolveApiKeyAdmission(
      makeQl({ expires_at: iso(NOW + DAY), created_at: iso(NOW - 730 * DAY) }),
      headers(), NOW, undefined, undefined, policy({ startedAt: undefined }));
    expect(a.outcome).toBe('admitted');
  });
});

describe('[#23367] the one-year grace of a key signed with no expiry', () => {
  it('is stamped onto expires_at (landing + 365 days) when the key is admitted', async () => {
    const landedAt = NOW - 10 * DAY;
    const ql = makeQl({ last_used_at: iso(NOW - DAY) });
    const a = await resolveApiKeyAdmission(ql, headers(), NOW, undefined, undefined, policy({ startedAt: iso(landedAt) }));
    expect(a.outcome).toBe('admitted');
    expect(ql.updates).toHaveLength(1);
    expect(ql.updates[0]!.data).toMatchObject({ id: KEY_ID, expires_at: iso(landedAt + 365 * DAY) });
  });

  it('after the grace the key is refused API_KEY_EXPIRED, naming the date', async () => {
    const landedAt = NOW - 366 * DAY;
    const graceEnd = iso(landedAt + 365 * DAY);
    const a = await resolveApiKeyAdmission(
      makeQl({ last_used_at: iso(NOW - DAY) }), headers(), NOW, undefined, undefined, policy({ startedAt: iso(landedAt) }));
    expect(a.outcome === 'lifecycle' && a.refusal.code).toBe('API_KEY_EXPIRED');
    expect(a.outcome === 'lifecycle' && a.refusal.at).toBe(graceEnd);
    expect(a.outcome === 'lifecycle' && a.refusal.message).toContain(graceEnd);
  });
});

describe('[#23367] the last_used_at stamp', () => {
  it('one admitted call writes last_used_at', async () => {
    const ql = makeQl({ expires_at: iso(NOW + DAY), last_used_at: iso(NOW - 2 * DAY) });
    await resolveApiKeyAdmission(ql, headers(), NOW, undefined, undefined, policy());
    expect(ql.updates).toEqual([{ object: 'sys_api_key', data: { id: KEY_ID, last_used_at: iso(NOW) } }]);
  });

  it('the throttle holds: a use inside the interval writes nothing, one past it writes', async () => {
    const inside = makeQl({ expires_at: iso(NOW + DAY), last_used_at: iso(NOW - API_KEY_LAST_USED_STAMP_INTERVAL_MS + 1000) });
    await resolveApiKeyAdmission(inside, headers(), NOW, undefined, undefined, policy());
    expect(inside.updates).toEqual([]);

    const past = makeQl({ expires_at: iso(NOW + DAY), last_used_at: iso(NOW - API_KEY_LAST_USED_STAMP_INTERVAL_MS) });
    await resolveApiKeyAdmission(past, headers(), NOW, undefined, undefined, policy());
    expect(past.updates).toHaveLength(1);
  });

  it('a held key is stamped too (ruling C′ item 4: it resumes when the owner remediates)', async () => {
    const ql = makeQl({ expires_at: iso(NOW + DAY), last_used_at: iso(NOW - 2 * DAY) });
    const held = async () => [{ code: 'MFA_REQUIRED' as const, message: 'enrol' }];
    const a = await resolveApiKeyAdmission(ql, headers(), NOW, undefined, held, policy());
    expect(a.outcome).toBe('held');
    expect(ql.updates).toHaveLength(1);
  });

  describe('a stamp failure', () => {
    let error: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { error = vi.spyOn(console, 'error').mockImplementation(() => undefined); });
    afterEach(() => { error.mockRestore(); });

    it('never fails the request, and is said once per engine', async () => {
      const ql = makeQl({ expires_at: iso(NOW + DAY), last_used_at: iso(NOW - 2 * DAY) }, { failUpdate: true });
      const first = await resolveApiKeyAdmission(ql, headers(), NOW, undefined, undefined, policy());
      const second = await resolveApiKeyAdmission(ql, headers(), NOW, undefined, undefined, policy());
      expect([first.outcome, second.outcome]).toEqual(['admitted', 'admitted']);
      expect(error).toHaveBeenCalledTimes(1);
    });
  });
});

describe('[#23367] each number is the source\'s', () => {
  it('a shorter inactivity window refuses what the default admits, and 0 turns it off', async () => {
    const row = { expires_at: iso(NOW + DAY), last_used_at: iso(NOW - 40 * DAY) };
    expect((await resolveApiKeyAdmission(makeQl(row), headers(), NOW, undefined, undefined, policy())).outcome).toBe('admitted');
    const short = await resolveApiKeyAdmission(makeQl(row), headers(), NOW, undefined, undefined, policy({ inactivityDays: 30 }));
    expect(short.outcome === 'lifecycle' && short.refusal.code).toBe('API_KEY_INACTIVE');

    const ancient = { expires_at: iso(NOW + DAY), last_used_at: iso(NOW - 900 * DAY) };
    expect((await resolveApiKeyAdmission(makeQl(ancient), headers(), NOW, undefined, undefined, policy({ inactivityDays: 0 }))).outcome)
      .toBe('admitted');
  });

  it('a policy source that rejects is the branded store outage, never an admission', async () => {
    const failing = () => { throw new Error('auth service fault'); };
    const err = await resolveApiKeyAdmission(makeQl({}), headers(), NOW, undefined, undefined, failing).catch((e) => e);
    expect(isAuthzStoreUnavailableError(err)).toBe(true);
  });

  it('apiKeyLifecyclePolicySourceOf binds the service, and answers undefined for one with no policy', () => {
    expect(apiKeyLifecyclePolicySourceOf(undefined)).toBeUndefined();
    expect(apiKeyLifecyclePolicySourceOf({})).toBeUndefined();
    const p = policy()();
    expect(apiKeyLifecyclePolicySourceOf({ resolveApiKeyLifecyclePolicy: () => p })?.()).toBe(p);
  });
});

describe('[#23367] resolveAuthzContext raises the refusal, branded, and never falls through to the session', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
  afterEach(() => { warn.mockRestore(); });

  it('a revoked key beside a valid session cookie is refused 403 API_KEY_REVOKED', async () => {
    const getSession = vi.fn(async () => ({ user: { id: 'usr_cookie' } }));
    const err = await resolveAuthzContext({
      ql: makeQl({ revoked: true }),
      headers: headers(),
      getSession,
      nowMs: NOW,
      userAuthGates: undefined,
      apiKeyLifecycle: policy(),
    }).catch((e) => e);
    expect(isApiKeyLifecycleRefusalError(err)).toBe(true);
    expect(err).toBeInstanceOf(ApiKeyLifecycleRefusalError);
    expect({ code: err.code, status: err.status }).toEqual({ code: 'API_KEY_REVOKED', status: 403 });
    expect(getSession).not.toHaveBeenCalled();
  });

  it('a live key resolves its owner exactly as before', async () => {
    const ctx = await resolveAuthzContext({
      ql: makeQl({ expires_at: iso(NOW + DAY), last_used_at: iso(NOW - DAY) }),
      headers: headers(),
      nowMs: NOW,
      userAuthGates: undefined,
      apiKeyLifecycle: policy(),
    });
    expect({ userId: ctx.userId, credential: ctx.credential }).toEqual({ userId: OWNER, credential: 'api_key' });
  });
});
