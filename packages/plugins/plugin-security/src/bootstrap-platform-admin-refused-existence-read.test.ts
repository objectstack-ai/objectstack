// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22169] `bootstrapPlatformAdmin`'s existence read: a read that did not
 * answer is not an absent row.
 *
 * The seed loop reads each default permission set BY NAME and inserts when it
 * finds none. Its `tryFind` answers `[]` for a refused read as well as for an
 * empty table, and the loop inserted on both — so on a table without the
 * per-organization unique index a refused read minted a second row of a set
 * that already existed, and a table holding such duplicates can never build
 * that index again. Measured on a real engine with that index dropped: two
 * declared sets, two INSERTs, under a refused read.
 *
 * The double below has no `update` or `delete` member — the seed pass without
 * `resync` calls neither — so it is not an engine double those dispatch
 * contracts govern. Its `find` answers from its rows, bounded by the caller's
 * `limit`; the refused read is a spy laid over it, so the two inputs the pass
 * must tell apart — an answer, and a throw — come from one table.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { bootstrapPlatformAdmin } from './bootstrap-platform-admin.js';

afterEach(() => { vi.restoreAllMocks(); });

function makeQl(seedRows: any[] = []) {
  const rows: any[] = seedRows.map((r) => ({ ...r }));
  const inserted: any[] = [];
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
      if (object !== 'sys_permission_set') return null;
      inserted.push({ ...data });
      rows.push({ ...data });
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

describe('#22169 — bootstrapPlatformAdmin declines the insert when its existence read was refused', () => {
  it('a refused read inserts NOTHING, and says so once for the whole pass', async () => {
    const ql = makeQl([{ id: 'ps_existing', name: 'admin_full_access' }]);
    refuseSetReads(ql);
    const { warns, logger } = capture();

    const r = await bootstrapPlatformAdmin(ql, [set('admin_full_access'), set('member_default'), set('viewer_readonly')], { logger });

    expect(ql.inserted, '⛔ no row minted on a read that did not answer').toEqual([]);
    expect(r.seeded).toBe(0);
    const lines = warns.filter((w) => w.msg.includes('could not be read'));
    expect(lines, 'one line per pass, never one per set').toHaveLength(1);
    expect(lines[0]!.meta).toMatchObject({
      unreadable: 3, total: 3, names: ['admin_full_access', 'member_default', 'viewer_readonly'],
    });
    // The promotion half reports the read that failed, not a set that is "missing".
    expect(r.reason).toBe('admin_permission_set_unreadable');
  });

  it('control: an EMPTY answer is still "absent" — a fresh install seeds every default set', async () => {
    const ql = makeQl();
    const { warns, logger } = capture();

    const r = await bootstrapPlatformAdmin(ql, [set('admin_full_access'), set('member_default')], { logger });

    expect(ql.inserted.map((row) => row.name)).toEqual(['admin_full_access', 'member_default']);
    expect(r.seeded).toBe(2);
    expect(warns.filter((w) => w.msg.includes('could not be read'))).toEqual([]);
  });

  it('control: an existing row is found and left alone — no insert, no unreadable line', async () => {
    const ql = makeQl([{ id: 'ps_existing', name: 'member_default' }]);
    const { warns, logger } = capture();

    await bootstrapPlatformAdmin(ql, [set('member_default')], { logger });

    expect(ql.inserted).toEqual([]);
    expect(warns.filter((w) => w.msg.includes('could not be read'))).toEqual([]);
  });
});
