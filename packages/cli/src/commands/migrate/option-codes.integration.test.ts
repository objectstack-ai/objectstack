// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate option-codes` (#29643): the walk on a real engine (`ObjectQL` +
 * sqlite `SqlDriver`).
 *
 * Since #29562 (PR #29638) the write door stores a number or boolean written
 * to an option field as its code string. Rows written before keep the form
 * the driver stored: SQLite TEXT `"3.0"` / `"1.0"` / `"0.0"` for a single
 * value, raw JSON elements in a multi-value array on both drivers, and the raw
 * `3` / `true` on driver-memory. The legacy rows here are written through the
 * DRIVER, below the engine's door, which is exactly what the pre-#29562 door
 * handed it; the physical value is read with the driver's own query builder.
 *
 * driver-memory's face (a raw `3` / `true` on a single-value field) is the
 * `scalar` arm of `decideOptionCode`, pinned by the decision table below and,
 * end to end, by the raw JSON elements every driver keeps in a multi-value
 * array. driver-memory itself is not a test backend here: its test consumers
 * are a closed census (`check:driver-memory-census`).
 *
 * Pinned: the decision table (`decideOptionCode`); a dry run counts and
 * writes nothing; `--apply` makes `{ f: "3" }` find every legacy row and a
 * unique field's new `"3"` collide; undecidable values (SQLite `"N.0"` on a
 * free field, an undeclared reading, an ambiguous `"1.0"`) are reported and
 * left as stored; a unique collision is a per-row failure, not an abort; a
 * re-run reads zero to rewrite.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { decideOptionCode, migrateOptionCodes, optionCodeFields } from './option-codes.js';

const opts = (...codes: string[]) => codes.map((value) => ({ value, label: value }));
const OBJ = {
  name: 'oc_obj', label: 'Option codes', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    coded: { name: 'coded', type: 'select' as const, options: opts('3', 'true', 'false', 'x') },
    radio: { name: 'radio', type: 'radio' as const, options: opts('1', '2') },
    free: { name: 'free', type: 'select' as const },
    both: { name: 'both', type: 'select' as const, options: opts('1', 'true') },
    gone: { name: 'gone', type: 'select' as const, options: opts('a', 'b') },
    uq: { name: 'uq', type: 'select' as const, options: opts('3', '7'), unique: true },
    multi: { name: 'multi', type: 'multiselect' as const, options: opts('3', 'true', 'x') },
    tags: { name: 'tags', type: 'tags' as const },
    title: { name: 'title', type: 'text' as const },
  },
};
const OTHER = {
  name: 'oc_other', label: 'Other', systemFields: false,
  fields: { id: { name: 'id', type: 'text' as const, primaryKey: true }, o: { name: 'o', type: 'select' as const, options: opts('3') } },
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
  for (const o of [OBJ, OTHER]) engine.registry.registerObject(o as any);
  await engine.syncSchemas();
  const knex = (driver as any).knex;
  const stored = async (object: string, id: string) =>
    (await knex(object).where({ id }).first()) as Record<string, unknown>;
  return { engine, driver, stored };
}
type Boot = Awaited<ReturnType<typeof boot>>;
const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);

const ids = async (ctx: Boot, where: Record<string, unknown>) =>
  ((await ctx.engine.find('oc_obj', { where, fields: ['id'] })) as Array<{ id: string }>).map((r) => r.id).sort();

/** The pre-#29562 door: the raw scalar handed to the driver. */
async function plantLegacy(ctx: Boot) {
  await ctx.driver.create('oc_obj', { id: 'n3', coded: 3, radio: 2, free: 3, uq: 3, multi: [3, true], tags: [0, 'k'], title: 42 });
  await ctx.driver.create('oc_obj', { id: 'b1', coded: true, free: true, both: true, multi: ['x'] });
  await ctx.driver.create('oc_obj', { id: 'f0', coded: false, gone: 3 });
  await ctx.driver.create('oc_obj', { id: 'held', coded: 'x', radio: '1', free: 'hello', uq: '7', multi: ['x'], tags: ['k'] });
  await ctx.driver.create('oc_other', { id: 'o1', o: 3 });
}

describe('os migrate option-codes: the decision (#29643)', () => {
  const coded = { type: 'select', options: opts('3', 'true', 'false') };
  const free = { type: 'select' };
  it.each([
    // raw scalars: decidable by type
    [coded, 3, { kind: 'rewrite', to: '3', arm: 'scalar' }],
    [coded, true, { kind: 'rewrite', to: 'true', arm: 'scalar' }],
    [free, 3, { kind: 'rewrite', to: '3', arm: 'scalar' }],
    [free, -1.5, { kind: 'rewrite', to: '-1.5', arm: 'scalar' }],
    [coded, 7, { kind: 'report', reason: 'undeclared' }],
    // SQLite REAL text: decidable only against the declared codes
    [coded, '3.0', { kind: 'rewrite', to: '3', arm: 'sqlite-real' }],
    [coded, '1.0', { kind: 'rewrite', to: 'true', arm: 'sqlite-real' }],
    [coded, '0.0', { kind: 'rewrite', to: 'false', arm: 'sqlite-real' }],
    [{ type: 'radio', options: opts('0', '1') }, '0.0', { kind: 'rewrite', to: '0', arm: 'sqlite-real' }],
    [{ type: 'select', options: opts('1', 'true') }, '1.0', { kind: 'report', reason: 'ambiguous' }],
    [coded, '9.0', { kind: 'report', reason: 'undeclared' }],
    [free, '3.0', { kind: 'report', reason: 'free-field' }],
    [{ type: 'select', picklist: 'p' }, 3, { kind: 'report', reason: 'picklist-unresolved' }],
    // left alone
    [{ type: 'select', options: opts('3.0') }, '3.0', { kind: 'ok' }],
    [coded, '3', { kind: 'ok' }],
    [free, 'hello', { kind: 'ok' }],
    [free, '-1.5', { kind: 'ok' }],
    [coded, null, { kind: 'ok' }],
    [coded, undefined, { kind: 'ok' }],
  ] as const)('%o · %o → %o', (def, value, verdict) => {
    expect(decideOptionCode(def as any, value)).toEqual(verdict);
  });

  it('walks the option family only: select, radio, multiselect, checkboxes, tags, a multiple select', () => {
    const fields = optionCodeFields({
      fields: {
        a: { type: 'select' }, b: { type: 'radio' }, c: { type: 'multiselect' }, d: { type: 'checkboxes' },
        e: { type: 'tags' }, f: { type: 'select', multiple: true }, g: { type: 'text' }, h: { type: 'lookup' },
        i: { type: 'number' }, j: { type: 'boolean' },
      },
    });
    expect(fields.map((f) => [f.name, f.multi])).toEqual([
      ['a', false], ['b', false], ['c', true], ['d', true], ['e', true], ['f', true],
    ]);
  });
});

describe('os migrate option-codes: the walk on sqlite (#29643)', () => {
  it('red before: the legacy form is what is stored, and { f: "3" } misses it', async () => {
    const ctx = await boot();
    await plantLegacy(ctx);
    expect((await ctx.stored('oc_obj', 'n3')).coded).toBe('3.0');
    expect((await ctx.stored('oc_obj', 'b1')).coded).toBe('1.0');
    expect((await ctx.stored('oc_obj', 'f0')).coded).toBe('0.0');
    expect(parse((await ctx.stored('oc_obj', 'n3')).multi)).toEqual([3, true]);
    expect(await ids(ctx, { coded: '3' })).toEqual([]);
    // A unique field's new "3" does not collide with the old form.
    await ctx.engine.insert('oc_obj', { id: 'new', uq: '3' });
    expect(await ids(ctx, { uq: '3' })).toEqual(['new']);
  });

  it('a dry run counts what it would rewrite and report, and writes nothing', async () => {
    const ctx = await boot();
    await plantLegacy(ctx);
    const before = await ctx.stored('oc_obj', 'n3');
    const report = await migrateOptionCodes(ctx.engine as any, silent, {});
    expect(report.applied).toBe(false);
    expect(report.scannedObjects.sort()).toEqual(['oc_obj', 'oc_other']);
    const byCol = Object.fromEntries(report.columns.map((c) => [`${c.object}.${c.field}`, [c.rewriteRows, c.reported]]));
    expect(byCol['oc_obj.coded']).toEqual([3, {}]);
    expect(byCol['oc_obj.uq']).toEqual([1, {}]);
    expect(byCol['oc_obj.multi']).toEqual([1, {}]);
    expect(byCol['oc_obj.tags']).toEqual([1, {}]);
    expect(byCol['oc_obj.gone']).toEqual([0, { undeclared: 1 }]);
    expect(byCol['oc_other.o']).toEqual([1, {}]);
    expect(report.rewritten).toBe(0);
    expect(report.failures).toEqual([]);
    expect(await ctx.stored('oc_obj', 'n3')).toEqual(before);
  });

  it('--apply rewrites to the code: filters find the rows, a unique "3" collides, a re-run reads zero', async () => {
    const ctx = await boot();
    await plantLegacy(ctx);
    const report = await migrateOptionCodes(ctx.engine as any, silent, { apply: true });
    expect(report.failures).toEqual([]);
    expect(report.rewritten).toBe(report.rewriteValues);

    expect((await ctx.stored('oc_obj', 'n3')).coded).toBe('3');
    expect((await ctx.stored('oc_obj', 'b1')).coded).toBe('true');
    expect((await ctx.stored('oc_obj', 'f0')).coded).toBe('false');
    expect(await ids(ctx, { coded: '3' })).toEqual(['n3']);
    expect(await ids(ctx, { coded: 'true' })).toEqual(['b1']);
    expect(await ids(ctx, { radio: '2' })).toEqual(['n3']);
    // A free field's SQLite "3.0" is not decidable: reported below, still stored as it was.
    expect(await ids(ctx, { free: '3' })).toEqual([]);
    const n3 = (await ctx.engine.findOne('oc_obj', { where: { id: 'n3' } })) as Record<string, unknown>;
    expect(n3.multi).toEqual(['3', 'true']);
    expect(n3.tags).toEqual(['0', 'k']);
    expect(parse((await ctx.stored('oc_obj', 'n3')).multi)).toEqual(['3', 'true']);
    // Undecidable / out of scope: as stored.
    expect((await ctx.stored('oc_obj', 'f0')).gone).toEqual('3.0');
    expect((await ctx.stored('oc_obj', 'n3')).title).toEqual('42.0');
    expect((await ctx.stored('oc_obj', 'held')).free).toBe('hello');
    // The unique key now sees one value.
    await expect(ctx.engine.insert('oc_obj', { id: 'dup', uq: '3' })).rejects.toMatchObject({ code: expect.stringMatching(/UNIQUE|DUPLICATE/i) });

    const again = await migrateOptionCodes(ctx.engine as any, silent, { apply: true });
    // Reported values stay reported: free "3.0" / "1.0", ambiguous "1.0", undeclared "3.0".
    expect([again.rewriteValues, again.rewritten, again.reportedValues]).toEqual([0, 0, 4]);
  });

  it('a unique collision with a row already holding the code is a per-row failure, not an abort', async () => {
    const ctx = await boot();
    await plantLegacy(ctx);
    await ctx.engine.insert('oc_obj', { id: 'new', uq: '3' });
    const report = await migrateOptionCodes(ctx.engine as any, silent, { apply: true });
    expect(report.failures.map((f) => [f.recordId, f.fields.includes('uq')])).toEqual([['n3', true]]);
    // The rest of the walk landed.
    expect((await ctx.stored('oc_obj', 'b1')).coded).toBe('true');
    expect((await ctx.stored('oc_other', 'o1')).o).toBe('3');
  });

  it('objects narrows the walk to the named objects', async () => {
    const ctx = await boot();
    await plantLegacy(ctx);
    const report = await migrateOptionCodes(ctx.engine as any, silent, { apply: true, objects: ['oc_other'] });
    expect(report.scannedObjects).toEqual(['oc_other']);
    expect(report.rewritten).toBe(1);
    expect((await ctx.stored('oc_obj', 'n3')).coded).toBe('3.0');
  });
});

describe('os migrate option-codes: what is reported, not rewritten (#29643)', () => {
  it('a free field and an ambiguous "1.0" are reported and left as stored', async () => {
    const ctx = await boot();
    await plantLegacy(ctx);
    const report = await migrateOptionCodes(ctx.engine as any, silent, { apply: true });
    const byCol = Object.fromEntries(report.columns.map((c) => [`${c.object}.${c.field}`, c.reported]));
    expect(byCol['oc_obj.free']).toEqual({ 'free-field': 2 });
    expect(byCol['oc_obj.both']).toEqual({ ambiguous: 1 });
    expect((await ctx.stored('oc_obj', 'n3')).free).toBe('3.0');
    expect((await ctx.stored('oc_obj', 'b1')).both).toBe('1.0');
  });
});
