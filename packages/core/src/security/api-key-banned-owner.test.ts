// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A banned user's credentials are refused while the ban holds — pinned at the
 * shared key-admission seam (`resolveApiKeyAdmission`, reached by every door
 * through `resolveAuthzContext`), where an API key becomes its owner.
 *
 *  - an owner whose ban holds → the key is `refused` (`owner_banned`): no
 *    principal, no fall-through to the session path, and the resolved context
 *    is the one a key that does not exist resolves to;
 *  - a ban with an expiry binds until it expires and not after — the one
 *    predicate (`isUserBanInForce`) the session refusal shares;
 *  - not a revocation: nothing is written while the ban holds, and the same
 *    key is admitted again once it is lifted;
 *  - the key's own lifecycle still answers first;
 *  - an owner read that throws is the branded store outage; a store with no
 *    `sys_user` table holds no ban.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveAuthzContext } from './resolve-authz-context.js';
import { hashApiKey, resolveApiKeyAdmission, resolveApiKeyPrincipal } from './api-key.js';
import { isAuthzStoreUnavailableError } from './authz-store-unavailable.js';
import { isUserBanInForce } from './user-ban.js';

const KEY = 'osk_banned_owner_pin_key';
const MADE_UP_KEY = 'osk_no_row_holds_this_key';
const OWNER = 'u_key_owner';
const COOKIE_USER = 'u_cookie_holder';
const NOW = Date.parse('2026-11-05T12:00:00.000Z');

function makeQl(owner: Record<string, unknown> | null = { id: OWNER }, keyRow: Record<string, unknown> = {}) {
  const tables: Record<string, any[]> = {
    sys_api_key: [{ id: 'key_1', key: hashApiKey(KEY), user_id: OWNER, revoked: false, scopes: '[]', ...keyRow }],
    sys_member: [],
    sys_user: [...(owner ? [owner] : []), { id: COOKIE_USER }],
  };
  const reads: Array<{ object: string; opts: any }> = [];
  const update = vi.fn(async () => ({}));
  return {
    tables,
    reads,
    update,
    ql: {
      update,
      async find(object: string, opts: any) {
        reads.push({ object, opts });
        const where = opts?.where ?? {};
        const rows = (tables[object] ?? []).filter((r) =>
          Object.entries(where).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake engine: unsupported combinator ${k}`);
            return v && typeof v === 'object' && '$in' in (v as any) ? (v as any).$in.includes(r[k]) : r[k] === v;
          }),
        );
        return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
      },
    },
  };
}

const headers = (key = KEY, extra: Record<string, string> = {}) => new Headers({ 'x-api-key': key, ...extra });
const admit = (ql: any, key = KEY, nowMs = NOW) =>
  resolveApiKeyAdmission(ql, headers(key), nowMs, undefined, undefined, undefined);

describe('isUserBanInForce — the one ban predicate', () => {
  it('a set ban flag with no expiry holds', () => {
    expect(isUserBanInForce({ banned: true }, NOW)).toBe(true);
    expect(isUserBanInForce({ banned: 1, ban_expires: null }, NOW)).toBe(true);
  });

  it('a row without the ban flag is not banned, whatever its expiry says', () => {
    expect(isUserBanInForce({ banned: false, ban_expires: new Date(NOW + 60_000) }, NOW)).toBe(false);
    expect(isUserBanInForce({ banned: null }, NOW)).toBe(false);
    expect(isUserBanInForce({}, NOW)).toBe(false);
    expect(isUserBanInForce(undefined, NOW)).toBe(false);
  });

  it('a ban with an expiry holds until the expiry has passed, in either column spelling', () => {
    expect(isUserBanInForce({ banned: true, ban_expires: new Date(NOW + 1).toISOString() }, NOW)).toBe(true);
    expect(isUserBanInForce({ banned: true, banExpires: new Date(NOW + 1) }, NOW)).toBe(true);
    // At the instant itself the ban still holds — the sign-in check lifts it only strictly after.
    expect(isUserBanInForce({ banned: true, ban_expires: new Date(NOW) }, NOW)).toBe(true);
    expect(isUserBanInForce({ banned: true, ban_expires: new Date(NOW - 1).toISOString() }, NOW)).toBe(false);
    expect(isUserBanInForce({ banned: true, banExpires: NOW - 1 }, NOW)).toBe(false);
  });

  it('an expiry that is not an instant does not lift the ban', () => {
    expect(isUserBanInForce({ banned: true, ban_expires: 'not-a-date' }, NOW)).toBe(true);
    expect(isUserBanInForce({ banned: true, ban_expires: { at: NOW - 1 } }, NOW)).toBe(true);
  });
});

describe('resolveApiKeyAdmission — a banned owner\'s key is refused while the ban holds', () => {
  it('refuses the key of an owner whose ban holds, with no principal', async () => {
    const { ql } = makeQl({ id: OWNER, banned: true });
    const admission = await admit(ql);
    expect(admission).toMatchObject({ outcome: 'refused', reason: 'owner_banned', keyId: 'key_1', userId: OWNER });
    expect(admission).not.toHaveProperty('principal');
    expect(await resolveApiKeyPrincipal(ql, headers(), NOW, undefined, undefined, undefined)).toBeUndefined();
  });

  it('admits the key of an owner who is not banned', async () => {
    const { ql } = makeQl({ id: OWNER, banned: false });
    expect((await admit(ql)).outcome).toBe('admitted');
  });

  it('reads the owner\'s ban columns by id, as the system', async () => {
    const { ql, reads } = makeQl({ id: OWNER, banned: false });
    await admit(ql);
    const ownerReads = reads.filter((r) => r.object === 'sys_user');
    expect(ownerReads).toHaveLength(1);
    expect(ownerReads[0].opts).toMatchObject({
      where: { id: OWNER },
      fields: ['id', 'banned', 'ban_expires'],
      limit: 1,
      context: { isSystem: true },
    });
  });

  it('a ban with an expiry binds until it expires, and not after', async () => {
    const expires = new Date(NOW + 60_000).toISOString();
    const { ql } = makeQl({ id: OWNER, banned: true, ban_expires: expires });
    expect((await admit(ql, KEY, NOW)).outcome).toBe('refused');
    expect((await admit(ql, KEY, NOW + 60_001)).outcome).toBe('admitted');
  });

  it('is not a revocation: nothing is written while the ban holds, and lifting it admits the same key', async () => {
    const { ql, tables, update } = makeQl({ id: OWNER, banned: true });
    const keyRowBefore = { ...tables.sys_api_key[0] };
    expect((await admit(ql)).outcome).toBe('refused');
    expect(update).not.toHaveBeenCalled();
    expect(tables.sys_api_key[0]).toEqual(keyRowBefore);

    tables.sys_user[0].banned = false;
    expect((await admit(ql)).outcome).toBe('admitted');
  });

  it('the key\'s own lifecycle answers first: a revoked key of a banned owner is refused as revoked', async () => {
    const { ql } = makeQl({ id: OWNER, banned: true }, { revoked: true });
    expect((await admit(ql)).outcome).toBe('lifecycle');
  });

  it('a key whose owner row is absent keeps today\'s answer — no row holds no ban', async () => {
    const { ql } = makeQl(null);
    expect((await admit(ql)).outcome).toBe('admitted');
  });

  it('an owner read that throws is the branded store outage, never an admission', async () => {
    const { ql } = makeQl({ id: OWNER, banned: true });
    const find = ql.find.bind(ql);
    ql.find = async (object: string, opts: any) => {
      if (object === 'sys_user') throw new Error('connection reset');
      return find(object, opts);
    };
    const err = await admit(ql).catch((e) => e);
    expect(isAuthzStoreUnavailableError(err)).toBe(true);
    expect(err.status).toBe(503);
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('a store with no sys_user table holds no ban', async () => {
    const { ql } = makeQl({ id: OWNER, banned: true });
    const find = ql.find.bind(ql);
    ql.find = async (object: string, opts: any) => {
      if (object === 'sys_user') throw new Error('no such table: sys_user');
      return find(object, opts);
    };
    expect((await admit(ql)).outcome).toBe('admitted');
  });
});

describe('resolveAuthzContext — a banned owner\'s key resolves as a key that does not exist', () => {
  const resolve = (ql: any, key: string, getSession?: (h: any) => Promise<any>) =>
    resolveAuthzContext({
      ql,
      headers: headers(key),
      nowMs: NOW,
      userAuthGates: undefined,
      apiKeyLifecycle: undefined,
      ...(getSession ? { getSession } : {}),
    });

  it('resolves no principal, and the same context a made-up key resolves', async () => {
    const { ql } = makeQl({ id: OWNER, banned: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const banned = await resolve(ql, KEY);
      const madeUp = await resolve(ql, MADE_UP_KEY);
      expect(banned.userId).toBeUndefined();
      expect(banned.credential).toBeUndefined();
      expect(banned).toEqual(madeUp);
      // The reason is said server-side only.
      expect(warn.mock.calls.flat().join('\n')).toContain('owner_banned');
    } finally {
      warn.mockRestore();
    }
  });

  it('never falls through to a session sent beside the key', async () => {
    const { ql } = makeQl({ id: OWNER, banned: true });
    const getSession = vi.fn(async () => ({ user: { id: COOKIE_USER }, session: { userId: COOKIE_USER } }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const authz = await resolve(ql, KEY, getSession);
      expect(authz.userId).toBeUndefined();
      expect(getSession).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('control: a non-banned owner\'s key resolves the owner, credential api_key', async () => {
    const { ql } = makeQl({ id: OWNER, banned: false });
    const authz = await resolve(ql, KEY);
    expect(authz.userId).toBe(OWNER);
    expect(authz.credential).toBe('api_key');
  });

  it('control: a session is not judged by this seam — a cookie with no key resolves as before', async () => {
    const { ql } = makeQl({ id: OWNER, banned: true });
    const getSession = vi.fn(async () => ({ user: { id: COOKIE_USER }, session: { userId: COOKIE_USER } }));
    const authz = await resolveAuthzContext({
      ql,
      headers: new Headers(),
      nowMs: NOW,
      userAuthGates: undefined,
      apiKeyLifecycle: undefined,
      getSession,
    });
    expect(authz.userId).toBe(COOKIE_USER);
    expect(authz.credential).toBe('session');
  });
});
