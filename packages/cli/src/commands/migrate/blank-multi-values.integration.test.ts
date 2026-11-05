// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate blank-multi-values` (#29653): the walk on a real engine
 * (`ObjectQL` + sqlite `SqlDriver`).
 *
 * The write door stores a cleared optional multi-value value (`[]` or `''`)
 * as `null` since #29343 (ruling A, record 6591577985). Rows stored before it
 * still hold the JSON text `'[]'` or `'""'`. The legacy rows here are written
 * through the DRIVER, below the engine's door, which is how the before-state
 * stored them; the physical column is read with the driver's own query
 * builder.
 *
 * Pinned: the door stores `null` today (the premise), and before the run
 * `$null` and the read shape split the legacy rows from it and `$empty` misses
 * the stored `''`; the column set is
 * `blankAsNullColumns`' `'emptyList'` arm, one column per type (multiselect,
 * checkboxes, tags, a `multiple: true` lookup), with no `required`, `readonly`
 * or single-value column; a dry run counts per object and column and writes
 * nothing; `--apply` stores `null`, so the legacy rows read like one cleared
 * today, and leaves out-of-scope columns and non-empty lists exactly as
 * stored; a re-run reads zero; `objects` narrows the walk.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { blankMultiValueColumns, cleanBlankMultiValues } from './blank-multi-values.js';

const OPTS = [{ value: 'gold', label: 'Gold' }, { value: 'silver', label: 'Silver' }];
const TARGET = {
  name: 'bmv_target', label: 'Target', systemFields: false,
  fields: { id: { name: 'id', type: 'text' as const, primaryKey: true }, name: { name: 'name', type: 'text' as const } },
};
const IN_SCOPE = {
  c_multiselect: { name: 'c_multiselect', type: 'multiselect' as const, options: OPTS },
  c_checkboxes: { name: 'c_checkboxes', type: 'checkboxes' as const, options: OPTS },
  c_tags: { name: 'c_tags', type: 'tags' as const },
  c_lookups: { name: 'c_lookups', type: 'lookup' as const, reference: 'bmv_target', multiple: true },
};
const PER_TYPE = Object.keys(IN_SCOPE);
// Out of scope, each for its own reason: `required` (refused at the door),
// `readonly` (a platform-stamped `[]`, record 6598733139), single-value
// (`blank-single-values`' arm).
const OUT_OF_SCOPE = {
  r_tags: { name: 'r_tags', type: 'tags' as const, required: true },
  ro_tags: { name: 'ro_tags', type: 'tags' as const, readonly: true },
  s_select: { name: 's_select', type: 'select' as const, options: OPTS },
};
const OBJ = {
  name: 'bmv_obj', label: 'Blank multi values', systemFields: false,
  fields: { id: { name: 'id', type: 'text' as const, primaryKey: true }, ...IN_SCOPE, ...OUT_OF_SCOPE },
};
const OTHER = {
  name: 'bmv_other', label: 'Other', systemFields: false,
  fields: { id: { name: 'id', type: 'text' as const, primaryKey: true }, o_tags: { name: 'o_tags', type: 'tags' as const } },
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
  await engine.insert('bmv_target', { id: 't1', name: 'T1' });
  const knex = (driver as any).knex;
  const stored = async (object: string, id: string) =>
    (await knex(object).where({ id }).first()) as Record<string, unknown>;
  const ids = async (object: string, where: Record<string, unknown>) =>
    ((await engine.find(object, { where, fields: ['id'] })) as Array<{ id: string }>).map((r) => r.id).sort();
  return { engine, driver, stored, ids };
}
type Ctx = Awaited<ReturnType<typeof boot>>;

/**
 * The before-state, below the engine's door: `[]` on one row and `''` on
 * another for every column, a row holding values, and a row cleared through
 * today's door.
 */
async function plantLegacy(ctx: Ctx) {
  const all = [...PER_TYPE, 'r_tags', 'ro_tags'];
  await ctx.driver.create('bmv_obj', { id: 'legacy_list', ...Object.fromEntries(all.map((f) => [f, []])) });
  await ctx.driver.create('bmv_obj', { id: 'legacy_blank', ...Object.fromEntries(all.map((f) => [f, ''])), s_select: '' });
  await ctx.driver.create('bmv_obj', {
    id: 'held', c_multiselect: ['gold'], c_checkboxes: ['silver'], c_tags: ['x'], c_lookups: ['t1'], r_tags: ['x'],
  });
  await ctx.driver.create('bmv_other', { id: 'other', o_tags: [] });
  await ctx.engine.insert('bmv_obj', { id: 'cleared_now', r_tags: ['x'] });
  await ctx.engine.update('bmv_obj', { id: 'cleared_now', ...Object.fromEntries(PER_TYPE.map((f) => [f, []])) });
}

describe('os migrate blank-multi-values: the column set', () => {
  it('is the emptyList arm of blankAsNullColumns: one column per multi-value type, nothing out of scope', () => {
    expect(blankMultiValueColumns(OBJ).map((c) => c.name).sort()).toEqual([...PER_TYPE].sort());
    expect(blankMultiValueColumns(OBJ).map((c) => c.type).sort()).toEqual(['checkboxes', 'lookup', 'multiselect', 'tags']);
  });
});

describe('os migrate blank-multi-values: the walk on sqlite (#29653)', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
    await plantLegacy(ctx);
  });

  it('premise: the door stores null for a cleared column, and the legacy rows store the JSON texts', async () => {
    const now = await ctx.stored('bmv_obj', 'cleared_now');
    const list = await ctx.stored('bmv_obj', 'legacy_list');
    const blank = await ctx.stored('bmv_obj', 'legacy_blank');
    for (const f of PER_TYPE) {
      expect(now[f], `${f} door`).toBeNull();
      expect(list[f], `${f} legacy []`).toBe('[]');
      expect(blank[f], `${f} legacy ''`).toBe('""');
    }
  });

  it('red before: $null finds only the row cleared today, $empty misses the stored "", the read shapes differ', async () => {
    const read = async (id: string) => (await ctx.engine.find('bmv_obj', { where: { id }, fields: PER_TYPE }))[0] as Record<string, unknown>;
    const [now, list, blank] = [await read('cleared_now'), await read('legacy_list'), await read('legacy_blank')];
    for (const f of PER_TYPE) {
      expect(await ctx.ids('bmv_obj', { [f]: { $null: true } }), f).toEqual(['cleared_now']);
      expect(await ctx.ids('bmv_obj', { [f]: { $empty: true } }), f).not.toContain('legacy_blank');
      expect([now[f], list[f], blank[f]], f).toEqual([null, [], '']);
    }
  });

  it('a dry run counts per object and column and writes nothing', async () => {
    const before = [await ctx.stored('bmv_obj', 'legacy_list'), await ctx.stored('bmv_obj', 'legacy_blank')];
    const report = await cleanBlankMultiValues(ctx.engine as any, silent, {});
    expect(report.applied).toBe(false);
    expect(report.scannedObjects.sort()).toEqual(['bmv_obj', 'bmv_other']);
    const counted = Object.fromEntries(report.columns.map((c) => [`${c.object}.${c.field}`, [c.blankRows, c.cleared]]));
    expect(counted).toEqual({
      ...Object.fromEntries(PER_TYPE.map((f) => [`bmv_obj.${f}`, [2, 0]])),
      'bmv_other.o_tags': [1, 0],
    });
    expect(report.blankValues).toBe(9);
    expect(report.cleared).toBe(0);
    expect(report.failures).toEqual([]);
    expect([await ctx.stored('bmv_obj', 'legacy_list'), await ctx.stored('bmv_obj', 'legacy_blank')]).toEqual(before);
  });

  it('--apply stores null: legacy rows read like one cleared today, out-of-scope columns stay as stored, a re-run reads zero', async () => {
    const before = { list: await ctx.stored('bmv_obj', 'legacy_list'), blank: await ctx.stored('bmv_obj', 'legacy_blank') };
    const report = await cleanBlankMultiValues(ctx.engine as any, silent, { apply: true });
    expect(report.failures).toEqual([]);
    expect(report.cleared).toBe(9);

    const after = { list: await ctx.stored('bmv_obj', 'legacy_list'), blank: await ctx.stored('bmv_obj', 'legacy_blank') };
    for (const f of PER_TYPE) {
      expect(after.list[f], `${f} [] physical`).toBeNull();
      expect(after.blank[f], `${f} '' physical`).toBeNull();
      expect(await ctx.ids('bmv_obj', { [f]: { $null: true } }), f).toEqual(['cleared_now', 'legacy_blank', 'legacy_list']);
      expect(await ctx.ids('bmv_obj', { [f]: { $empty: true } }), f).toContain('legacy_blank');
    }
    // `required`, `readonly` and single-value columns keep exactly what they held.
    for (const f of Object.keys(OUT_OF_SCOPE)) {
      expect(after.list[f], f).toEqual(before.list[f]);
      expect(after.blank[f], f).toEqual(before.blank[f]);
    }
    expect(after.list.ro_tags).toBe('[]');
    expect(after.blank.s_select).toBe('');
    // A row holding values is not touched.
    const held = await ctx.stored('bmv_obj', 'held');
    expect([held.c_multiselect, held.c_tags, held.c_lookups]).toEqual(['["gold"]', '["x"]', '["t1"]']);
    expect((await ctx.stored('bmv_other', 'other')).o_tags).toBeNull();

    const again = await cleanBlankMultiValues(ctx.engine as any, silent, { apply: true });
    expect([again.blankValues, again.cleared, again.columns]).toEqual([0, 0, []]);
  });

  it('objects narrows the walk to the named objects', async () => {
    const report = await cleanBlankMultiValues(ctx.engine as any, silent, { apply: true, objects: ['bmv_other'] });
    expect(report.scannedObjects).toEqual(['bmv_other']);
    expect(report.cleared).toBe(1);
    expect((await ctx.stored('bmv_obj', 'legacy_list')).c_tags).toBe('[]');
  });
});
