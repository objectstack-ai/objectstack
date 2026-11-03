// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate blank-single-values` (#29431): the walk on a real engine
 * (`ObjectQL` + sqlite `SqlDriver`).
 *
 * The write door stores a cleared optional single-value option / reference /
 * file value as `null` since #29277 (ruling B on #29346, record 6579813296).
 * Rows stored before it still hold `''`, which `$empty: true` does not find on
 * those types. The legacy rows here are written through the DRIVER, below the
 * engine's door, which is how the before-state stored them; the physical
 * column is read with the driver's own query builder.
 *
 * Pinned: the column set is `blankAsNullColumns`' single-value arm (eleven
 * types, no `required`, text, unique text, `multiple: true` or typed column);
 * a dry run counts per object and column and writes nothing; `--apply` makes
 * `$empty: true` find every legacy row and leaves the out-of-scope columns
 * exactly as stored; a re-run reads zero; `objects` narrows the walk.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { blankAsNullColumns } from '@objectstack/core';
import { blankSingleValueColumns, cleanBlankSingleValues } from './blank-single-values.js';

const OPTS = [{ value: 'gold', label: 'Gold' }, { value: 'silver', label: 'Silver' }];
const TARGET = {
  name: 'bsv_target', label: 'Target', systemFields: false,
  fields: { id: { name: 'id', type: 'text' as const, primaryKey: true }, name: { name: 'name', type: 'text' as const } },
};
const IN_SCOPE = {
  c_select: { name: 'c_select', type: 'select' as const, options: OPTS },
  c_radio: { name: 'c_radio', type: 'radio' as const, options: OPTS },
  c_lookup: { name: 'c_lookup', type: 'lookup' as const, reference: 'bsv_target' },
  c_master: { name: 'c_master', type: 'master_detail' as const, reference: 'bsv_target' },
  c_user: { name: 'c_user', type: 'user' as const },
  c_tree: { name: 'c_tree', type: 'tree' as const },
  c_image: { name: 'c_image', type: 'image' as const },
  c_file: { name: 'c_file', type: 'file' as const },
  c_avatar: { name: 'c_avatar', type: 'avatar' as const },
  c_video: { name: 'c_video', type: 'video' as const },
  c_audio: { name: 'c_audio', type: 'audio' as const },
};
const PER_TYPE = Object.keys(IN_SCOPE);
// Out of scope, each for its own reason: `required`, text-like (plain and
// unique: #29176's arm), `multiple: true` (#29343's row).
const OUT_OF_SCOPE = {
  r_select: { name: 'r_select', type: 'select' as const, options: OPTS, required: true },
  t_text: { name: 't_text', type: 'text' as const },
  u_text: { name: 'u_text', type: 'text' as const, unique: true },
  m_select: { name: 'm_select', type: 'select' as const, options: OPTS, multiple: true },
};
const OBJ = {
  name: 'bsv_obj', label: 'Blank single values', systemFields: false,
  fields: { id: { name: 'id', type: 'text' as const, primaryKey: true }, ...IN_SCOPE, ...OUT_OF_SCOPE },
};
const OTHER = {
  name: 'bsv_other', label: 'Other', systemFields: false,
  fields: { id: { name: 'id', type: 'text' as const, primaryKey: true }, o_select: { name: 'o_select', type: 'select' as const, options: OPTS } },
};

const silent = { info: () => {}, warn: () => {} };
const live: ObjectQL[] = [];
afterEach(async () => {
  while (live.length) {
    try { await live.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot() {
  const engine = new ObjectQL();
  live.push(engine);
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of [TARGET, OBJ, OTHER]) engine.registry.registerObject(o as any);
  await engine.syncSchemas();
  await engine.insert('bsv_target', { id: 't1', name: 'T1' });
  const knex = (driver as any).knex;
  const stored = async (object: string, id: string) =>
    (await knex(object).where({ id }).first()) as Record<string, unknown>;
  const ids = async (object: string, where: Record<string, unknown>) =>
    ((await engine.find(object, { where, fields: ['id'] })) as Array<{ id: string }>).map((r) => r.id).sort();
  return { engine, driver, stored, ids };
}
type Ctx = Awaited<ReturnType<typeof boot>>;

/** The before-state: '' on every column, written below the engine's door. */
async function plantLegacy(ctx: Ctx) {
  const blanks = Object.fromEntries([...PER_TYPE, 'r_select', 't_text', 'u_text'].map((f) => [f, '']));
  await ctx.driver.create('bsv_obj', { id: 'legacy', ...blanks });
  await ctx.driver.create('bsv_obj', { id: 'held', c_select: 'gold', c_lookup: 't1', r_select: 'gold', t_text: 'x' });
  await ctx.driver.create('bsv_other', { id: 'other', o_select: '' });
}

describe('os migrate blank-single-values: the column set', () => {
  it('is the single-value arm of blankAsNullColumns: the eleven types, nothing out of scope', () => {
    expect(blankSingleValueColumns(OBJ).map((c) => c.name).sort()).toEqual([...PER_TYPE].sort());
    expect(blankSingleValueColumns(OBJ).map((c) => c.type).sort()).toEqual(
      ['audio', 'avatar', 'file', 'image', 'lookup', 'master_detail', 'radio', 'select', 'tree', 'user', 'video'],
    );
  });

  it('[#29343] a multi_value-row column is in the door\'s map on its own reach, and out of this walk', () => {
    expect(blankAsNullColumns(OBJ as any).get('m_select')).toBe('emptyList');
    expect(blankSingleValueColumns(OBJ).map((c) => c.name)).not.toContain('m_select');
  });
});

describe('os migrate blank-single-values: the walk on sqlite (#29431)', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
    await plantLegacy(ctx);
  });

  it('red before: $empty: true misses a stored "" on every in-scope column', async () => {
    for (const f of PER_TYPE) {
      expect(await ctx.ids('bsv_obj', { [f]: { $empty: true } }), f).not.toContain('legacy');
    }
  });

  it('a dry run counts per object and column and writes nothing', async () => {
    const before = await ctx.stored('bsv_obj', 'legacy');
    const report = await cleanBlankSingleValues(ctx.engine as any, silent, {});
    expect(report.applied).toBe(false);
    expect(report.scannedObjects.sort()).toEqual(['bsv_obj', 'bsv_other']);
    const counted = Object.fromEntries(report.columns.map((c) => [`${c.object}.${c.field}`, [c.blankRows, c.cleared]]));
    expect(counted).toEqual({
      ...Object.fromEntries(PER_TYPE.map((f) => [`bsv_obj.${f}`, [1, 0]])),
      'bsv_other.o_select': [1, 0],
    });
    expect(report.blankValues).toBe(12);
    expect(report.cleared).toBe(0);
    expect(report.failures).toEqual([]);
    expect(await ctx.stored('bsv_obj', 'legacy')).toEqual(before);
  });

  it('--apply rewrites "" to null: $empty finds the row, out-of-scope columns stay as stored, a re-run reads zero', async () => {
    const before = await ctx.stored('bsv_obj', 'legacy');
    const report = await cleanBlankSingleValues(ctx.engine as any, silent, { apply: true });
    expect(report.failures).toEqual([]);
    expect(report.cleared).toBe(12);

    const after = await ctx.stored('bsv_obj', 'legacy');
    for (const f of PER_TYPE) {
      expect(after[f], `${f} physical`).toBeNull();
      expect(await ctx.ids('bsv_obj', { [f]: { $empty: true } }), f).toContain('legacy');
    }
    // `required`, text-like (plain and unique) and multi-value columns keep exactly what they held.
    for (const f of Object.keys(OUT_OF_SCOPE)) expect(after[f], f).toEqual(before[f]);
    expect(after.r_select).toBe('');
    expect(after.t_text).toBe('');
    // A row holding values is not touched.
    expect((await ctx.stored('bsv_obj', 'held')).c_select).toBe('gold');
    expect((await ctx.stored('bsv_other', 'other')).o_select).toBeNull();

    const again = await cleanBlankSingleValues(ctx.engine as any, silent, { apply: true });
    expect([again.blankValues, again.cleared, again.columns]).toEqual([0, 0, []]);
  });

  it('objects narrows the walk to the named objects', async () => {
    const report = await cleanBlankSingleValues(ctx.engine as any, silent, { apply: true, objects: ['bsv_other'] });
    expect(report.scannedObjects).toEqual(['bsv_other']);
    expect(report.cleared).toBe(1);
    expect((await ctx.stored('bsv_obj', 'legacy')).c_select).toBe('');
  });
});
