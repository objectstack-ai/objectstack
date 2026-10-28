// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26718] A `deleteBehavior: 'restrict'` lookup refuses the delete of its
 * parent even when the same child ALSO cascades from that parent — on the real
 * stack: a real `ObjectQL` over a real `SqlDriver` (better-sqlite3, on disk),
 * driven through the real `ObjectStackProtocolImplementation`'s data-plane
 * deletes (`deleteData` serves `DELETE /api/v1/data/:object/:id`,
 * `deleteManyData` the bulk door).
 *
 * ## The defect
 *
 * A child holding a `master_detail` AND an authored `restrict` lookup to the
 * same parent row: deleting the parent answered success and the child was
 * gone. The by-id cascade collects its cascade set first (#22305) and judged
 * every `restrict` only against rows OUTSIDE that set. The child is in the set,
 * through its own master_detail, so its restrict was never asked; the cascade
 * then deleted it. The record the author declared undeletable was destroyed.
 *
 * ## The rule (triage on #26718)
 *
 * Every restrict is evaluated before any cascade, so a restrict on any path
 * refuses the delete with 409 `DELETE_RESTRICTED` naming the restricting
 * object, and nothing is deleted. The engine now judges, before its first
 * write, every AUTHORED restrict held by a row the delete reaches only through
 * the record that restrict protects; see
 * `ObjectQL.refuseRestrictsInsideOwnCascade`. The #22305 rule for a row the
 * cascade reaches through another record (a sibling under a common parent) is
 * unchanged, and pinned in `packages/objectql/src/engine-cascade-delete-sibling-restrict.test.ts`.
 *
 * ## Controls
 *
 * - the two fields pointing at DIFFERENT parents still refuse;
 * - a plain master_detail with no restrict still cascades;
 * - a grandchild reached through a cascade, holding a restrict to the root,
 *   refuses the root and leaves every row in place;
 * - the bulk door reaches the same walk per id, so it refuses the same row.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SqlDriver } from '@objectstack/driver-sql';

const PART = { name: 'zz_widget_part', fields: { name: { type: 'text' } } };

/** The card's shape: master_detail first, then the restrict lookup. */
const CHILD = {
  name: 'zz_widget_child',
  fields: {
    name: { type: 'text' },
    f_master_detail: { type: 'master_detail', reference: 'zz_widget_part', required: true },
    f_lookup: { type: 'lookup', reference: 'zz_widget_part', deleteBehavior: 'restrict' },
  },
};

/** The same two fields in the other declaration order. */
const CHILD_LOOKUP_FIRST = {
  name: 'zz_widget_child',
  fields: {
    name: { type: 'text' },
    f_lookup: { type: 'lookup', reference: 'zz_widget_part', deleteBehavior: 'restrict' },
    f_master_detail: { type: 'master_detail', reference: 'zz_widget_part', required: true },
  },
};

/** A plain detail: cascades, holds no restrict. */
const PLAIN = {
  name: 'zz_widget_plain',
  fields: {
    name: { type: 'text' },
    part: { type: 'master_detail', reference: 'zz_widget_part', required: true },
  },
};

/** A detail of the part, and a detail of THAT, holding a restrict to the part. */
const MID = {
  name: 'zz_widget_mid',
  fields: {
    name: { type: 'text' },
    part: { type: 'master_detail', reference: 'zz_widget_part', required: true },
  },
};
const LEAF = {
  name: 'zz_widget_leaf',
  fields: {
    name: { type: 'text' },
    mid: { type: 'master_detail', reference: 'zz_widget_mid', required: true },
    guard: { type: 'lookup', reference: 'zz_widget_part', deleteBehavior: 'restrict' },
  },
};

describe('[#26718] a restrict lookup to the parent a child also cascades from — real driver (better-sqlite3)', () => {
  let dir: string | null = null;
  let engine: ObjectQL | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
  });

  async function rig(objects: unknown[]) {
    dir = mkdtempSync(join(tmpdir(), 'os-26718-real-'));
    const real = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: join(dir, 'data.sqlite') },
      useNullAsDefault: true,
    });
    await real.initObjects(objects as any);
    engine = new ObjectQL();
    engine.registerDriver(real as any, true);
    await engine.init();
    for (const o of objects) engine.registry.registerObject(o as any, 'com.objectstack.test.26718');
    const protocol: any = new ObjectStackProtocolImplementation(engine as any);
    return { protocol, real };
  }

  it.each([
    ['master_detail declared first', CHILD],
    ['restrict lookup declared first', CHILD_LOOKUP_FIRST],
  ] as Array<[string, unknown]>)('refuses the parent delete 409 and deletes nothing (%s)', async (_label, child) => {
    const { protocol, real } = await rig([PART, child]);
    const p: any = await engine!.insert('zz_widget_part', { name: 'P' });
    await engine!.insert('zz_widget_child', { name: 'c', f_master_detail: p.id, f_lookup: p.id });

    const err: any = await protocol.deleteData({ object: 'zz_widget_part', id: p.id }).catch((e: any) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('DELETE_RESTRICTED');
    expect(err.status).toBe(409);
    expect(err.dependentObject).toBe('zz_widget_child');
    expect(err.developerMessage).toContain('via f_lookup');
    // Counted out of the DRIVER, not through the engine: both rows are there.
    expect(await real.count('zz_widget_part')).toBe(1);
    expect(await real.count('zz_widget_child')).toBe(1);
  });

  it('the bulk door refuses the same row and deletes nothing', async () => {
    const { protocol, real } = await rig([PART, CHILD]);
    const p: any = await engine!.insert('zz_widget_part', { name: 'P' });
    await engine!.insert('zz_widget_child', { name: 'c', f_master_detail: p.id, f_lookup: p.id });

    const res: any = await protocol.deleteManyData({ object: 'zz_widget_part', ids: [p.id] });

    expect(res).toMatchObject({ success: false, succeeded: 0, failed: 1 });
    expect(res.results[0].success).toBe(false);
    expect(await real.count('zz_widget_part')).toBe(1);
    expect(await real.count('zz_widget_child')).toBe(1);
  });

  it('refuses the root when a grandchild the cascade reaches holds the restrict, and deletes nothing', async () => {
    const { protocol, real } = await rig([PART, MID, LEAF]);
    const p: any = await engine!.insert('zz_widget_part', { name: 'P' });
    const m: any = await engine!.insert('zz_widget_mid', { name: 'm', part: p.id });
    await engine!.insert('zz_widget_leaf', { name: 'l', mid: m.id, guard: p.id });

    const err: any = await protocol.deleteData({ object: 'zz_widget_part', id: p.id }).catch((e: any) => e);

    expect(err.code).toBe('DELETE_RESTRICTED');
    expect(err.status).toBe(409);
    expect(err.dependentObject).toBe('zz_widget_leaf');
    expect(await real.count('zz_widget_part')).toBe(1);
    expect(await real.count('zz_widget_mid')).toBe(1);
    expect(await real.count('zz_widget_leaf')).toBe(1);
  });

  it('control: the two fields at DIFFERENT parents still refuse the lookup parent', async () => {
    const { protocol, real } = await rig([PART, CHILD]);
    const owner: any = await engine!.insert('zz_widget_part', { name: 'owner' });
    const guarded: any = await engine!.insert('zz_widget_part', { name: 'guarded' });
    await engine!.insert('zz_widget_child', { name: 'c', f_master_detail: owner.id, f_lookup: guarded.id });

    const err: any = await protocol.deleteData({ object: 'zz_widget_part', id: guarded.id }).catch((e: any) => e);

    expect(err.code).toBe('DELETE_RESTRICTED');
    expect(err.status).toBe(409);
    expect(err.dependentObject).toBe('zz_widget_child');
    expect(await real.count('zz_widget_part')).toBe(2);
    expect(await real.count('zz_widget_child')).toBe(1);
  });

  it('control: a plain master_detail with no restrict still cascades', async () => {
    const { protocol, real } = await rig([PART, PLAIN]);
    const p: any = await engine!.insert('zz_widget_part', { name: 'P' });
    await engine!.insert('zz_widget_plain', { name: 'd', part: p.id });

    const res = await protocol.deleteData({ object: 'zz_widget_part', id: p.id });

    expect(res).toMatchObject({ object: 'zz_widget_part', id: p.id, success: true });
    expect(await real.count('zz_widget_part')).toBe(0);
    expect(await real.count('zz_widget_plain')).toBe(0);
  });

  it('control: once the child is gone the parent deletes', async () => {
    const { protocol, real } = await rig([PART, CHILD]);
    const p: any = await engine!.insert('zz_widget_part', { name: 'P' });
    const c: any = await engine!.insert('zz_widget_child', { name: 'c', f_master_detail: p.id, f_lookup: p.id });

    await protocol.deleteData({ object: 'zz_widget_child', id: c.id });
    const res = await protocol.deleteData({ object: 'zz_widget_part', id: p.id });

    expect(res).toMatchObject({ success: true });
    expect(await real.count('zz_widget_part')).toBe(0);
  });
});
