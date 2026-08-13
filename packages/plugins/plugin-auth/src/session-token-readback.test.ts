// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #7823 — the session-token READBACK seam, unit-pinned from both directions.
//
// The engine's `internal: true` read strip removes `sys_session.token` from
// every find/findOne result; better-auth's lifecycle routes read that token
// back OFF adapter results (revoke-other-sessions filters by it, sliding
// refresh and expired cleanup delete/update by it). This module re-attaches
// the value through `Engine.resolveInternalField` (#8118's privileged batch
// accessor). The end-to-end proof that revoke-other-sessions actually revokes
// lives in the dogfood suite; THIS file pins the seam's own contract:
//
//  - re-attach only for `sys_session`, only for rows the strip actually hit,
//    only when the caller's projection did not exclude the column;
//  - one batched privileged read per page, never one per row;
//  - FAIL CLOSED and loud when a stripped row meets an engine with no
//    accessor — that state is exactly what turns a security control into a
//    silent no-op, so it must never pass quietly.

import { describe, it, expect, vi } from 'vitest';
import { reattachSessionTokenOnRead } from './session-token-readback.js';

const resolver = (map: Record<string, unknown>) =>
  vi.fn(async (_object: string, ids: readonly string[], _field: string) => {
    const out = new Map<string, unknown>();
    for (const id of ids) if (id in map) out.set(id, map[id]);
    return out;
  });

describe('#7823 reattachSessionTokenOnRead', () => {
  it('re-attaches the token to stripped sys_session rows — one batched call', async () => {
    const resolveInternalField = resolver({ s1: 'tok-1', s2: 'tok-2' });
    const rows: any[] = [
      { id: 's1', user_id: 'u1' },
      { id: 's2', user_id: 'u1' },
    ];
    await reattachSessionTokenOnRead({ resolveInternalField }, 'sys_session', rows);
    expect(rows[0].token).toBe('tok-1');
    expect(rows[1].token).toBe('tok-2');
    expect(resolveInternalField).toHaveBeenCalledTimes(1);
    expect(resolveInternalField).toHaveBeenCalledWith('sys_session', ['s1', 's2'], 'token');
  });

  it('handles the findOne shape (a single row, not an array)', async () => {
    const resolveInternalField = resolver({ s1: 'tok-1' });
    const row: any = { id: 's1', user_id: 'u1' };
    await reattachSessionTokenOnRead({ resolveInternalField }, 'sys_session', row);
    expect(row.token).toBe('tok-1');
  });

  it('never touches another object, and issues no privileged read for one', async () => {
    const resolveInternalField = resolver({ k1: 'HASH' });
    const row: any = { id: 'k1' };
    await reattachSessionTokenOnRead({ resolveInternalField }, 'sys_api_key', row);
    expect(row).toEqual({ id: 'k1' });
    expect(resolveInternalField).not.toHaveBeenCalled();
  });

  it('rows still carrying `token` are left byte-identical and trigger no privileged read', async () => {
    // Fake engines in adapter tests (and any engine without the strip) return
    // the row whole — the seam must be inert there.
    const resolveInternalField = resolver({ s1: 'REPLACED' });
    const row: any = { id: 's1', token: 'original' };
    await reattachSessionTokenOnRead({ resolveInternalField }, 'sys_session', row);
    expect(row.token).toBe('original');
    expect(resolveInternalField).not.toHaveBeenCalled();
  });

  it('a projection that deliberately excluded `token` keeps its projection', async () => {
    const resolveInternalField = resolver({ s1: 'tok-1' });
    const row: any = { id: 's1' };
    await reattachSessionTokenOnRead({ resolveInternalField }, 'sys_session', row, ['id', 'expires_at']);
    expect('token' in row).toBe(false);
    expect(resolveInternalField).not.toHaveBeenCalled();
    // …but a projection that NAMED the column gets it back.
    await reattachSessionTokenOnRead({ resolveInternalField }, 'sys_session', row, ['id', 'token']);
    expect(row.token).toBe('tok-1');
  });

  it('FAILS CLOSED: a stripped session row plus an engine with no accessor throws loudly', async () => {
    const row: any = { id: 's1', user_id: 'u1' };
    await expect(
      reattachSessionTokenOnRead({}, 'sys_session', row),
    ).rejects.toThrow(/resolveInternalField/);
    // The message names the consequence and the remedy — this is the state
    // that makes revoke-other-sessions a 200 that revokes nothing.
    await expect(
      reattachSessionTokenOnRead({}, 'sys_session', row),
    ).rejects.toThrow(/revoke-other-sessions/);
  });

  it('…but an engine with no accessor and NO stripped rows stays quiet (inert seam)', async () => {
    const row: any = { id: 's1', token: 'tok' };
    await expect(reattachSessionTokenOnRead({}, 'sys_session', row)).resolves.toBeUndefined();
  });

  it('a row deleted between the read and the dereference stays token-less', async () => {
    const resolveInternalField = resolver({ s1: 'tok-1' }); // s2 vanished
    const rows: any[] = [{ id: 's1' }, { id: 's2' }];
    await reattachSessionTokenOnRead({ resolveInternalField }, 'sys_session', rows);
    expect(rows[0].token).toBe('tok-1');
    expect('token' in rows[1]).toBe(false);
  });

  it('non-record members and id-less rows are skipped, not judged', async () => {
    const resolveInternalField = resolver({ s1: 'tok-1' });
    const rows: any[] = [{ id: 's1' }, null, 'noise', { user_id: 'u1' }];
    await expect(
      reattachSessionTokenOnRead({ resolveInternalField }, 'sys_session', rows),
    ).resolves.toBeUndefined();
    expect(rows[0].token).toBe('tok-1');
    expect(resolveInternalField).toHaveBeenCalledWith('sys_session', ['s1'], 'token');
  });
});
