// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22169] `bootstrapPlatformAdmin`'s one catalog read: a read that did not
 * answer is not an absent row.
 *
 * [ADR-0131 D3/D4] The bootstrap writes no `sys_permission_set` row. It still
 * READS the legacy `admin_full_access` row an older release seeded, because
 * that row's id is how the holder scan reaches a grant written before the
 * name column existed (leg C, restrict-only). A refused read cannot say no
 * such grant exists, so the promotion is withheld — loudly — rather than risk
 * minting a second administrator.
 *
 * The double has no `update` or `delete` member — the bootstrap calls neither —
 * so it is not an engine double those dispatch contracts govern. Its `find`
 * answers from its rows, bounded by the caller's `limit`; the refused read is a
 * spy laid over it.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { bootstrapPlatformAdmin } from './bootstrap-platform-admin.js';

afterEach(() => { vi.restoreAllMocks(); });

function makeQl(seedRows: any[] = []) {
  const rows: any[] = seedRows.map((r) => ({ ...r }));
  const inserted: Array<{ object: string; data: any }> = [];
  return {
    rows,
    inserted,
    async find(object: string, q: any) {
      if (object !== 'sys_permission_set') return [];
      const where = q?.where ?? {};
      const matched = rows.filter((r) => Object.entries(where).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        return r[k] === v;
      }));
      return typeof q?.limit === 'number' ? matched.slice(0, q.limit) : matched;
    },
    async insert(object: string, data: any) {
      inserted.push({ object, data: { ...data } });
      return { id: data.id };
    },
  };
}

/** Every `sys_permission_set` read now throws; every other read still answers. */
function refuseSetReads(ql: ReturnType<typeof makeQl>): void {
  const answer = ql.find.bind(ql);
  vi.spyOn(ql, 'find').mockImplementation(async (object: string, q: any) => {
    if (object === 'sys_permission_set') throw new Error('fake outage: sys_permission_set read refused');
    return answer(object, q);
  });
}

const set = (name: string) => ({ name, label: name, objects: {}, systemPermissions: [] }) as any;

function capture() {
  const warns: Array<{ msg: string; meta?: any }> = [];
  return { warns, logger: { info: () => {}, warn: (msg: string, meta?: any) => warns.push({ msg, meta }) } };
}

describe('#22169 — bootstrapPlatformAdmin withholds the promotion when its legacy read was refused', () => {
  it('a refused read writes NOTHING, reports the read that failed, and says so once', async () => {
    const ql = makeQl([{ id: 'ps_existing', name: 'admin_full_access' }]);
    refuseSetReads(ql);
    const { warns, logger } = capture();

    const r = await bootstrapPlatformAdmin(ql, [set('admin_full_access'), set('member_default')], { logger });

    expect(ql.inserted, '⛔ nothing written on a read that did not answer').toEqual([]);
    expect(r.reason).toBe('admin_permission_set_unreadable');
    expect(r.adminPromoted).toBe(false);
    expect(warns.filter((w) => w.msg.includes('promotion WITHHELD'))).toHaveLength(1);
  });

  it('control: an EMPTY answer is "no legacy row" — the pass goes on, and writes no catalog row', async () => {
    const ql = makeQl();
    const { warns, logger } = capture();

    const r = await bootstrapPlatformAdmin(ql, [set('admin_full_access'), set('member_default')], { logger });

    expect(ql.inserted.filter((w) => w.object === 'sys_permission_set')).toEqual([]);
    // No users in this double, so the pass ends at "nobody to promote yet" —
    // past the legacy read, which is the point.
    expect(r.reason).toBe('no_users');
    expect(warns.filter((w) => w.msg.includes('promotion WITHHELD'))).toEqual([]);
  });
});
