// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #7823 + #7987 + #8676 — the internal-field READBACK seams, unit-pinned from
// both directions.
//
// The engine's `internal: true` read strip removes the flagged column from
// every find/findOne result; better-auth reads those columns back OFF adapter
// results — `sys_session.token` on the session-lifecycle routes
// (revoke-other-sessions filters by it, sliding refresh and expired cleanup
// delete/update by it), and `sys_account`'s three OAuth columns on the
// token-exchange routes (`findAccounts` → `resolveUserAccount` →
// `getValidAccessToken` / `/refresh-token`). This module re-attaches the values
// through `Engine.resolveInternalField` (#8118's privileged batch accessor).
// The end-to-end proofs live in the dogfood suite; THIS file pins the seam's
// own contract:
//
//  - re-attach only for the two declared objects, only for rows the strip
//    actually hit, only when the caller's projection did not exclude the
//    column;
//  - one batched privileged read per COLUMN per page, never one per row;
//  - FAIL CLOSED and loud when a stripped row meets an engine with no
//    accessor — that state is exactly what turns a security control into a
//    silent no-op and an OAuth refresh into a 400, so it must never pass
//    quietly.
//
// [#8676] The module now owns TWO seams and this file pins both. The adapter
// seam above is reachable only from `objectql-adapter.ts`; plugin-auth's own
// raw-engine readers (the ADR-0069 D1 password-reuse ring, the dev seed-admin
// probe) bypass it entirely and are recovered by
// `recoverInternalFieldsForSystemRead` — the last describe block below.

import { describe, it, expect, vi } from 'vitest';
import {
  reattachInternalFieldsOnRead,
  recoverInternalFieldsForSystemRead,
} from './internal-field-readback.js';

const resolver = (map: Record<string, Record<string, unknown>>) =>
  vi.fn(async (_object: string, ids: readonly string[], field: string) => {
    const out = new Map<string, unknown>();
    for (const id of ids) if (id in map && field in map[id]!) out.set(id, map[id]![field]);
    return out;
  });

describe('#7823 reattachInternalFieldsOnRead — sys_session.token', () => {
  it('re-attaches the token to stripped sys_session rows — one batched call', async () => {
    const resolveInternalField = resolver({ s1: { token: 'tok-1' }, s2: { token: 'tok-2' } });
    const rows: any[] = [
      { id: 's1', user_id: 'u1' },
      { id: 's2', user_id: 'u1' },
    ];
    await reattachInternalFieldsOnRead({ resolveInternalField }, 'sys_session', rows);
    expect(rows[0].token).toBe('tok-1');
    expect(rows[1].token).toBe('tok-2');
    expect(resolveInternalField).toHaveBeenCalledTimes(1);
    expect(resolveInternalField).toHaveBeenCalledWith('sys_session', ['s1', 's2'], 'token');
  });

  it('handles the findOne shape (a single row, not an array)', async () => {
    const resolveInternalField = resolver({ s1: { token: 'tok-1' } });
    const row: any = { id: 's1', user_id: 'u1' };
    await reattachInternalFieldsOnRead({ resolveInternalField }, 'sys_session', row);
    expect(row.token).toBe('tok-1');
  });

  it('never touches an object with no readback entry, and issues no privileged read', async () => {
    // `sys_api_key.key` is flagged `internal` too — and deliberately NOT in the
    // table: its mint route returns the plaintext it generated itself and never
    // reads the stored hash back (#7728). A seam that re-attached every flagged
    // column everywhere would undo that.
    const resolveInternalField = resolver({ k1: { key: 'HASH' } });
    const row: any = { id: 'k1' };
    await reattachInternalFieldsOnRead({ resolveInternalField }, 'sys_api_key', row);
    expect(row).toEqual({ id: 'k1' });
    expect(resolveInternalField).not.toHaveBeenCalled();
  });

  it('rows still carrying `token` are left byte-identical and trigger no privileged read', async () => {
    // Fake engines in adapter tests (and any engine without the strip) return
    // the row whole — the seam must be inert there.
    const resolveInternalField = resolver({ s1: { token: 'REPLACED' } });
    const row: any = { id: 's1', token: 'original' };
    await reattachInternalFieldsOnRead({ resolveInternalField }, 'sys_session', row);
    expect(row.token).toBe('original');
    expect(resolveInternalField).not.toHaveBeenCalled();
  });

  it('a projection that deliberately excluded `token` keeps its projection', async () => {
    const resolveInternalField = resolver({ s1: { token: 'tok-1' } });
    const row: any = { id: 's1' };
    await reattachInternalFieldsOnRead({ resolveInternalField }, 'sys_session', row, ['id', 'expires_at']);
    expect('token' in row).toBe(false);
    expect(resolveInternalField).not.toHaveBeenCalled();
    // …but a projection that NAMED the column gets it back.
    await reattachInternalFieldsOnRead({ resolveInternalField }, 'sys_session', row, ['id', 'token']);
    expect(row.token).toBe('tok-1');
  });

  it('FAILS CLOSED: a stripped session row plus an engine with no accessor throws loudly', async () => {
    const row: any = { id: 's1', user_id: 'u1' };
    await expect(
      reattachInternalFieldsOnRead({}, 'sys_session', row),
    ).rejects.toThrow(/resolveInternalField/);
    // The message names the consequence and the remedy — this is the state
    // that makes revoke-other-sessions a 200 that revokes nothing.
    await expect(
      reattachInternalFieldsOnRead({}, 'sys_session', row),
    ).rejects.toThrow(/revoke-other-sessions/);
  });

  it('…but an engine with no accessor and NO stripped rows stays quiet (inert seam)', async () => {
    const row: any = { id: 's1', token: 'tok' };
    await expect(reattachInternalFieldsOnRead({}, 'sys_session', row)).resolves.toBeUndefined();
  });

  it('a row deleted between the read and the dereference stays token-less', async () => {
    const resolveInternalField = resolver({ s1: { token: 'tok-1' } }); // s2 vanished
    const rows: any[] = [{ id: 's1' }, { id: 's2' }];
    await reattachInternalFieldsOnRead({ resolveInternalField }, 'sys_session', rows);
    expect(rows[0].token).toBe('tok-1');
    expect('token' in rows[1]).toBe(false);
  });

  it('non-record members and id-less rows are skipped, not judged', async () => {
    const resolveInternalField = resolver({ s1: { token: 'tok-1' } });
    const rows: any[] = [{ id: 's1' }, null, 'noise', { user_id: 'u1' }];
    await expect(
      reattachInternalFieldsOnRead({ resolveInternalField }, 'sys_session', rows),
    ).resolves.toBeUndefined();
    expect(rows[0].token).toBe('tok-1');
    expect(resolveInternalField).toHaveBeenCalledWith('sys_session', ['s1'], 'token');
  });
});

describe('#7987 reattachInternalFieldsOnRead — sys_account OAuth columns', () => {
  const ACCOUNT_ROW = () => ({ id: 'a1', user_id: 'u1', provider_id: 'google' });

  it('re-attaches ALL THREE columns — one batched call per column, not per row', async () => {
    // This is the read `internalAdapter.findAccounts(userId)` issues (no
    // projection), which feeds `/get-access-token`, `/account-info` and
    // `/refresh-token`.
    const resolveInternalField = resolver({
      a1: { access_token: 'at-1', refresh_token: 'rt-1', id_token: 'it-1' },
      a2: { access_token: 'at-2', refresh_token: 'rt-2', id_token: 'it-2' },
    });
    const rows: any[] = [
      { id: 'a1', user_id: 'u1', provider_id: 'google' },
      { id: 'a2', user_id: 'u1', provider_id: 'github' },
    ];
    await reattachInternalFieldsOnRead({ resolveInternalField }, 'sys_account', rows);

    expect(rows[0].access_token).toBe('at-1');
    expect(rows[0].refresh_token).toBe('rt-1');
    expect(rows[0].id_token).toBe('it-1');
    expect(rows[1].refresh_token).toBe('rt-2');
    // FOUR columns (#8676 added `password`), two rows ⇒ FOUR reads, not eight.
    // The accessor resolves one field per call by contract (#8118); the
    // batching that matters is per-page.
    expect(resolveInternalField).toHaveBeenCalledTimes(4);
    expect(resolveInternalField).toHaveBeenCalledWith('sys_account', ['a1', 'a2'], 'access_token');
    expect(resolveInternalField).toHaveBeenCalledWith('sys_account', ['a1', 'a2'], 'refresh_token');
    expect(resolveInternalField).toHaveBeenCalledWith('sys_account', ['a1', 'a2'], 'id_token');
  });

  it('the refresh token specifically survives the round trip (the exchange input)', async () => {
    // `/refresh-token` answers REFRESH_TOKEN_NOT_FOUND (400) when this single
    // property is undefined, so it gets its own assertion rather than riding
    // on the batch one above.
    const resolveInternalField = resolver({ a1: { refresh_token: 'rt-live' } });
    const row: any = ACCOUNT_ROW();
    await reattachInternalFieldsOnRead({ resolveInternalField }, 'sys_account', row);
    expect(row.refresh_token).toBe('rt-live');
  });

  it('a column with no stored value comes back null, not missing', async () => {
    // A password-only account has no OAuth tokens; the accessor answers `null`
    // for an unset column. better-auth's `account.refreshToken` check reads
    // false either way, but the KEY must exist so the row is not mistaken for
    // a stripped one on a later pass.
    const resolveInternalField = resolver({
      a1: { access_token: null, refresh_token: null, id_token: null },
    });
    const row: any = ACCOUNT_ROW();
    await reattachInternalFieldsOnRead({ resolveInternalField }, 'sys_account', row);
    expect(row.access_token).toBeNull();
    expect('refresh_token' in row).toBe(true);
  });

  it('the projection guard is PER COLUMN', async () => {
    const resolveInternalField = resolver({
      a1: { access_token: 'at-1', refresh_token: 'rt-1', id_token: 'it-1' },
    });
    const row: any = ACCOUNT_ROW();
    await reattachInternalFieldsOnRead({ resolveInternalField }, 'sys_account', row, [
      'id',
      'access_token',
    ]);
    expect(row.access_token).toBe('at-1');
    // The two the caller did not name keep their projection.
    expect('refresh_token' in row).toBe(false);
    expect('id_token' in row).toBe(false);
    expect(resolveInternalField).toHaveBeenCalledTimes(1);
  });

  it('a partially stripped row only resolves the columns that are missing', async () => {
    const resolveInternalField = resolver({
      a1: { access_token: 'at-1', refresh_token: 'rt-1', id_token: 'it-1' },
    });
    const row: any = { ...ACCOUNT_ROW(), refresh_token: 'already-here' };
    await reattachInternalFieldsOnRead({ resolveInternalField }, 'sys_account', row);
    expect(row.refresh_token).toBe('already-here');
    expect(row.access_token).toBe('at-1');
    // `access_token`, `id_token` and `password` were missing; `refresh_token`
    // was not, so it costs no privileged read.
    expect(resolveInternalField).toHaveBeenCalledTimes(3);
    expect(resolveInternalField.mock.calls.map((c: any[]) => c[2])).not.toContain('refresh_token');
  });

  it('[#8676] re-attaches `password` — better-auth\'s sign-in verifier reads it off the row', async () => {
    // `internalAdapter.findCredentialAccount(userId)` returns the row whose
    // `password` the verifier compares the submitted one against. Under the
    // #8676 flag that row arrives stripped, so without this entry password
    // sign-in fails for every user.
    const resolveInternalField = resolver({ a1: { password: 'argon2:stored' } });
    const row: any = ACCOUNT_ROW();
    await reattachInternalFieldsOnRead({ resolveInternalField }, 'sys_account', row);
    expect(row.password).toBe('argon2:stored');
  });

  it('⛔ [#8676] never re-attaches `previous_password_hashes` — better-auth has ZERO readers', async () => {
    // The bound on the table, and the half of the old scope guard that
    // SURVIVES #8676. The reuse ring is an ObjectStack-only column read solely
    // by `auth-manager.ts` off the RAW engine, which never passes through this
    // adapter seam — so a row here would be dead code, and re-attaching it
    // would hand better-auth a credential column nothing asked for. Pinned so a
    // future widening of the table has to walk past a red test.
    const resolveInternalField = resolver({ a1: { previous_password_hashes: '["h1"]' } });
    const row: any = ACCOUNT_ROW();
    await reattachInternalFieldsOnRead({ resolveInternalField }, 'sys_account', row);
    expect('previous_password_hashes' in row).toBe(false);
    for (const call of resolveInternalField.mock.calls) {
      expect(call[2]).not.toBe('previous_password_hashes');
    }
    // Discriminating positive control: the refusal above is SELECTIVE, not a
    // seam that simply attaches nothing — `password` on the same row, in the
    // same call, was resolved.
    expect(resolveInternalField.mock.calls.map((c: any[]) => c[2])).toContain('password');
  });

  it('an engine with NO accessor is left alone — absence is ordinary on these columns', async () => {
    // The asymmetry with `sys_session.token` above, and the reason it exists.
    // These three columns are `required: false` and are empty on every
    // credential (password) account, so a missing key does NOT prove the strip
    // ran. Throwing here broke ordinary sign-in against the in-memory fake
    // engines — measured: 16 red tests across session-of-record,
    // session-tombstone and impersonation-bearer-rotation, because
    // better-auth's `findCredentialAccount` reads exactly such a row on the
    // sign-in path. An engine with no `resolveInternalField` does not
    // implement the `internal` channel at all, so it never stripped anything.
    const row: any = ACCOUNT_ROW();
    await expect(reattachInternalFieldsOnRead({}, 'sys_account', row)).resolves.toBeUndefined();
    expect('access_token' in row).toBe(false);
  });

  it('…while the SESSION column keeps failing closed on the same engine (posture is per column)', async () => {
    // Guards the discriminator itself: a future edit that made the account
    // columns inert by making the whole seam inert would take #7823's
    // fail-closed contract with it, silently.
    await expect(
      reattachInternalFieldsOnRead({}, 'sys_session', { id: 's1' }),
    ).rejects.toThrow(/resolveInternalField/);
  });

  it('…and stays inert for account rows that still carry their columns', async () => {
    const row: any = {
      ...ACCOUNT_ROW(),
      access_token: 'at',
      refresh_token: 'rt',
      id_token: 'it',
    };
    await expect(reattachInternalFieldsOnRead({}, 'sys_account', row)).resolves.toBeUndefined();
    expect(row.access_token).toBe('at');
  });
});

describe('#8676 recoverInternalFieldsForSystemRead — plugin-auth\'s own RAW-engine reads', () => {
  // The second seam. `reattachInternalFieldsOnRead` above is imported by
  // exactly one file (`objectql-adapter.ts`), so it only ever repairs rows
  // better-auth asked the adapter for. plugin-auth's ADR-0069 D1 reuse ring and
  // the dev seed-admin probe call the engine directly and are starved by the
  // same flag — this is what recovers them.

  it('recovers the exact columns the ADR-0069 D1 reuse ring reads', async () => {
    const resolveInternalField = resolver({
      a1: { password: 'hash:current', previous_password_hashes: '["hash:old1"]' },
    });
    const row: any = { id: 'a1' }; // what the real engine returns for the :5033 query
    await recoverInternalFieldsForSystemRead({ resolveInternalField }, 'sys_account', row, [
      'password',
      'previous_password_hashes',
    ]);
    expect(row.password).toBe('hash:current');
    expect(row.previous_password_hashes).toBe('["hash:old1"]');
    // One batched privileged read per COLUMN — the accessor's per-field contract.
    expect(resolveInternalField).toHaveBeenCalledTimes(2);
    expect(resolveInternalField).toHaveBeenCalledWith('sys_account', ['a1'], 'password');
  });

  it('is bounded by the caller\'s list — it does NOT recover every flagged column', async () => {
    // `recordPasswordHistory` reads only the ring. Pulling `password` too would
    // be an unasked-for dereference of a credential column.
    const resolveInternalField = resolver({
      a1: { password: 'hash:current', previous_password_hashes: '["h"]' },
    });
    const row: any = { id: 'a1' };
    await recoverInternalFieldsForSystemRead({ resolveInternalField }, 'sys_account', row, [
      'previous_password_hashes',
    ]);
    expect(row.previous_password_hashes).toBe('["h"]');
    expect('password' in row).toBe(false);
    expect(resolveInternalField).toHaveBeenCalledTimes(1);
    // Discriminating positive control: the omission is the BOUND, not a dead
    // seam — the column that WAS asked for came back on the same call.
    expect(resolveInternalField.mock.calls[0]![2]).toBe('previous_password_hashes');
  });

  it('handles the ql.find shape (an array) — the dev seed-admin probe', async () => {
    const resolveInternalField = resolver({ a1: { password: 'argon2:seed' } });
    const rows: any[] = [{ id: 'a1', provider_id: 'credential' }];
    await recoverInternalFieldsForSystemRead({ resolveInternalField }, 'sys_account', rows, [
      'password',
    ]);
    expect(rows[0].password).toBe('argon2:seed');
  });

  it('stays INERT against an engine with no accessor — it never stripped anything', async () => {
    // Required posture, not a default. `previous_password_hashes` is genuinely
    // absent on a credential account that has never changed its password, so
    // "the key is missing ⇒ the strip ran" is false for it; a seam that threw
    // on absence would break the FIRST password change of every user, and every
    // unit test built on a strip-less fake engine.
    const row: any = { id: 'a1' };
    await expect(
      recoverInternalFieldsForSystemRead({}, 'sys_account', row, ['previous_password_hashes']),
    ).resolves.toBeUndefined();
    expect('previous_password_hashes' in row).toBe(false);
  });

  it('leaves a row that already carries the column untouched, issuing no privileged read', async () => {
    const resolveInternalField = resolver({ a1: { password: 'FROM-ACCESSOR' } });
    const row: any = { id: 'a1', password: 'already-here' };
    await recoverInternalFieldsForSystemRead({ resolveInternalField }, 'sys_account', row, [
      'password',
    ]);
    expect(row.password).toBe('already-here');
    expect(resolveInternalField).not.toHaveBeenCalled();
  });

  it('is a no-op on a nullish row, so callers need no null check', async () => {
    const resolveInternalField = resolver({});
    await expect(
      recoverInternalFieldsForSystemRead({ resolveInternalField }, 'sys_account', null, ['password']),
    ).resolves.toBeUndefined();
    expect(resolveInternalField).not.toHaveBeenCalled();
  });
});
