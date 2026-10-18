// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24299] A `sys_api_key` read that THROWS is the branded store outage at the
 * shared key-admission seam (`resolveApiKeyAdmission`), never "no key".
 *
 * Before: the read sat in a bare `catch { return { outcome: 'none' }; }`. A key
 * holder got the anonymous floor's `401` where a session caller got `503`, and
 * `none` let the request fall on to the session arm, so a cookie sent beside
 * the key answered for it (measured: served as the cookie's user).
 *
 * What these pin:
 *  - a rejecting read raises `AuthzStoreUnavailableError` (`SERVICE_UNAVAILABLE`
 *    / 503) naming `sys_api_key`, with the driver's error kept as `cause`;
 *  - through `resolveAuthzContext`, a cookie beside that key never answers:
 *    the session read is never asked;
 *  - a NEVER-PROVISIONED `sys_api_key` is still "no key", the boundary the
 *    2026-08-30 ruling (option A) draws for `tryFind` — and a missing-table
 *    phrase naming another relation stays loud;
 *  - the other `none` exits are unchanged: no header, no engine, no row, a
 *    row with no `user_id`.
 */

import { describe, expect, it } from 'vitest';

import { hashApiKey, resolveApiKeyAdmission } from './api-key.js';
import {
  AUTHZ_STORE_UNAVAILABLE_CODE,
  AUTHZ_STORE_UNAVAILABLE_STATUS,
  isAuthzStoreUnavailableError,
} from './authz-store-unavailable.js';
import { resolveAuthzContext } from './resolve-authz-context.js';

const RAW = 'osk_read_outage_key';
const OWNER = 'usr_key_owner';
const KEY_ROW = { id: 'key_1', key: hashApiKey(RAW), user_id: OWNER, revoked: false, scopes: '[]' };
const headers = (extra: Record<string, string> = {}) => ({ 'x-api-key': RAW, ...extra });

/** `sys_api_key` reads throw `fault()`; every other table is empty. */
function qlWhoseKeyReadThrows(fault: () => unknown) {
  return {
    find: async (object: string) => {
      if (object === 'sys_api_key') throw fault();
      return [];
    },
  };
}

function qlWithKeyRows(rows: any[]) {
  return {
    find: async (object: string, q: any = {}) => {
      const found = object === 'sys_api_key' ? rows.filter((r) => r.key === q?.where?.key) : [];
      return typeof q?.limit === 'number' ? found.slice(0, q.limit) : found;
    },
  };
}

const settle = (p: Promise<unknown>) => p.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));

describe('[#24299] a rejecting sys_api_key read is the store outage, not "no key"', () => {
  it('raises AuthzStoreUnavailableError (SERVICE_UNAVAILABLE / 503) naming sys_api_key, the driver error kept as cause', async () => {
    const driverFault = new Error('connection terminated unexpectedly');
    const r = await settle(resolveApiKeyAdmission(qlWhoseKeyReadThrows(() => driverFault), headers(), Date.now(), undefined, undefined, undefined));
    expect(r.ok, 'the admission RESOLVED — the failed read was answered as a verdict').toBe(false);
    const e = (r as any).e;
    expect(isAuthzStoreUnavailableError(e)).toBe(true);
    expect(e.code).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
    expect(e.status).toBe(AUTHZ_STORE_UNAVAILABLE_STATUS);
    expect(e.object).toBe('sys_api_key');
    expect(e.cause).toBe(driverFault);
  });

  it('through resolveAuthzContext, a cookie beside the key never answers: the session is never read', async () => {
    let sessionReads = 0;
    const r = await settle(resolveAuthzContext({
      ql: qlWhoseKeyReadThrows(() => new Error('engine down')),
      headers: headers({ cookie: 'session=other-user' }),
      getSession: async () => { sessionReads += 1; return { user: { id: 'usr_cookie' }, session: { userId: 'usr_cookie' } } as any; },
      userAuthGates: undefined,
      apiKeyLifecycle: undefined,
    }));
    expect(r.ok, 'the context RESOLVED — the request fell on to another credential').toBe(false);
    expect(isAuthzStoreUnavailableError((r as any).e)).toBe(true);
    expect((r as any).e.object).toBe('sys_api_key');
    expect(sessionReads).toBe(0);
  });

  it('a NEVER-PROVISIONED sys_api_key is still "no key" (ruling 2026-08-30, option A)', async () => {
    for (const fault of [
      () => new Error('no such table: sys_api_key'),
      () => Object.assign(new Error('relation "sys_api_key" does not exist'), { code: '42P01' }),
    ]) {
      const a = await resolveApiKeyAdmission(qlWhoseKeyReadThrows(fault), headers(), Date.now(), undefined, undefined, undefined);
      expect(a).toEqual({ outcome: 'none' });
    }
  });

  it('a missing-table phrase naming ANOTHER relation is no evidence about sys_api_key, and stays loud', async () => {
    const r = await settle(resolveApiKeyAdmission(
      qlWhoseKeyReadThrows(() => new Error('no such table: main.some_other_base')),
      headers(), Date.now(), undefined, undefined, undefined,
    ));
    expect(r.ok).toBe(false);
    expect(isAuthzStoreUnavailableError((r as any).e)).toBe(true);
  });
});

describe('[#24299] the other "none" exits are unchanged', () => {
  it('no key header, no engine, an engine with no find, no row, and a row with no user_id each answer none', async () => {
    const args = [Date.now(), undefined, undefined, undefined] as const;
    expect(await resolveApiKeyAdmission(qlWithKeyRows([KEY_ROW]), {}, ...args)).toEqual({ outcome: 'none' });
    expect(await resolveApiKeyAdmission(undefined, headers(), ...args)).toEqual({ outcome: 'none' });
    expect(await resolveApiKeyAdmission({}, headers(), ...args)).toEqual({ outcome: 'none' });
    expect(await resolveApiKeyAdmission(qlWithKeyRows([]), headers(), ...args)).toEqual({ outcome: 'none' });
    expect(await resolveApiKeyAdmission(qlWithKeyRows([{ ...KEY_ROW, user_id: undefined }]), headers(), ...args)).toEqual({ outcome: 'none' });
  });

  it('control: the same key, read healthily, is admitted as its owner', async () => {
    const a = await resolveApiKeyAdmission(qlWithKeyRows([KEY_ROW]), headers(), Date.now(), undefined, undefined, undefined);
    expect(a.outcome).toBe('admitted');
    expect((a as any).principal.userId).toBe(OWNER);
  });
});
