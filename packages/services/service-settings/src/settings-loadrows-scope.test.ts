// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11228] `loadRows` — a user-keyed load must include tenant/global rows.
 *
 * The engine branch used to build `where.user_id = userId`, which excludes
 * every upper-scope row (they carry `user_id NULL`), while the in-memory
 * branch's predicate includes them. Two consumers search the ONE result set a
 * user-keyed load returns, so on every engine-bound deployment — i.e. every
 * real one —
 *
 *   1. `resolveKey`'s user→tenant→global cascade fell straight through to the
 *      manifest default whenever the user had no personal row, silently
 *      ignoring persisted tenant/global values; and
 *   2. the Phase-2 upper-scope lock check found no locked tenant/global row,
 *      so a lock that should refuse user-scope writes never fired.
 *
 * The suite stayed green because the in-memory double answered correctly —
 * the #4434 class (a double looser than the engine), in a WHERE clause.
 * Pinned here: both consumers against the ENGINE branch, plus a differential
 * check that the engine and memory branches resolve identically.
 *
 * Upper-scope rows for a user-declared key are seeded store-level in these
 * fixtures: the public write path always lands at the key's DECLARED scope,
 * while the cascade and the lock check are explicitly written to honor rows
 * at any upper scope, however they were provisioned.
 */

import { describe, it, expect, vi } from 'vitest';
import { SettingsService } from './settings-service.js';
import { SettingsLockedError } from './settings-service.types.js';

// Same deliberately-strict matcher as settings-getmany.test.ts: `$or` is
// implemented, every other combinator throws (a silent field-name read of
// `$or` is exactly how this defect hid).
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === '$or') {
      return (v as Array<Record<string, unknown>>).some((b) => matches(row, b));
    }
    if (k.startsWith('$')) throw new Error(`fake matcher: unimplemented combinator ${k}`);
    return (row as any)[k] === v;
  });
}

function makeEngine(rows: Array<Record<string, unknown>>) {
  const find = vi.fn(async (_obj: string, opts: any) =>
    rows.filter((r) => matches(r, opts?.where ?? {})),
  );
  return {
    find,
    insert: vi.fn(async (_obj: string, data: Record<string, unknown>) => data),
    update: vi.fn(), delete: vi.fn(), count: vi.fn(),
  };
}

const MANIFEST = {
  namespace: 'localization',
  label: 'Localization',
  specifiers: [
    { key: 'timezone', type: 'string', scope: 'user', default: 'UTC' },
  ],
} as any;

// The defect fixture: a persisted GLOBAL value for a user-scope key, and a
// user who has no personal row. Values are stored plain, as the
// persist path writes them.
const GLOBAL_ROW = {
  namespace: 'localization', key: 'timezone', scope: 'global',
  value: 'America/New_York', user_id: null,
  value_enc: null, encrypted: false, locked: false, locked_reason: null,
  updated_at: '2026-08-01T00:00:00.000Z', updated_by: null,
};
const U2_ROW = {
  namespace: 'localization', key: 'timezone', scope: 'user',
  value: 'Asia/Tokyo', user_id: 'u2',
  value_enc: null, encrypted: false, locked: false, locked_reason: null,
  updated_at: '2026-08-01T00:00:00.000Z', updated_by: null,
};

function makeEngineService(rows: Array<Record<string, unknown>>) {
  const svc = new SettingsService();
  svc.registerManifest(MANIFEST);
  svc.bindEngine(makeEngine(rows) as any);
  return svc;
}

function makeMemoryService(rows: Array<Record<string, unknown>>) {
  const svc = new SettingsService();
  svc.registerManifest(MANIFEST);
  (svc as any).memory.push(...rows.map((r) => ({ ...r })));
  return svc;
}

describe('[#11228] loadRows user-keyed load includes upper-scope rows', () => {
  it('engine branch: a user with no personal row falls back to the persisted global value, not the default', async () => {
    const svc = makeEngineService([GLOBAL_ROW]);
    const got = await svc.get('localization', 'timezone', { userId: 'u1' });
    expect(got.value).toBe('America/New_York');
    expect(got.source).toBe('global');
  });

  it("engine branch: another user's personal row is still excluded", async () => {
    const svc = makeEngineService([U2_ROW]);
    const got = await svc.get('localization', 'timezone', { userId: 'u1' });
    expect(got.value).toBe('UTC');
    expect(got.source).toBe('default');
  });

  it('engine and memory branches resolve the same fixture identically (differential)', async () => {
    const rows = [GLOBAL_ROW, U2_ROW];
    const engineSvc = makeEngineService(rows);
    const memorySvc = makeMemoryService(rows);
    for (const ctx of [{ userId: 'u1' }, { userId: 'u2' }, {}]) {
      const a = await engineSvc.get('localization', 'timezone', ctx);
      const b = await memorySvc.get('localization', 'timezone', ctx);
      expect({ value: a.value, source: a.source }).toEqual({ value: b.value, source: b.source });
    }
  });

  it('engine branch: a locked global row refuses a user-scope write (Phase-2 lock reaches the engine path)', async () => {
    const svc = makeEngineService([{ ...GLOBAL_ROW, locked: true }]);
    await expect(
      svc.set('localization', 'timezone', 'Asia/Tokyo', { userId: 'u1' }),
    ).rejects.toThrow(SettingsLockedError);
  });
});
