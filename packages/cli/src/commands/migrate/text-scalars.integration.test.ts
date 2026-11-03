// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate text-scalars` (#29702): the walk on a real engine (`ObjectQL` +
 * sqlite `SqlDriver`).
 *
 * Since #29241 the write door stores a number or boolean written to a
 * text-family field as its string. Rows written before keep the form the
 * driver stored: SQLite TEXT `"42.0"` / `"1.0"` / `"0.0"`, and the raw `42` /
 * `true` on driver-memory. The legacy SQLite rows here are written through
 * the DRIVER, below the engine's door, which is exactly what the pre-#29241
 * door handed it; the physical value is read with the driver's own query
 * builder.
 *
 * driver-memory's face (a raw `42` / `true`) is the `rewrite` arm of
 * `decideTextScalar`, pinned by the decision table below. driver-memory itself
 * is not a test backend here: its test consumers are a closed census
 * (`check:driver-memory-census`). The rewrite arm's walk (one update per row,
 * a unique collision as a per-row failure, a re-run reading zero) is driven
 * on the real sqlite engine through `memoryFace`: reads hand back the raw
 * scalar driver-memory kept for a row whose column is still unwritten, every
 * write goes to the real engine and its real unique index.
 *
 * Pinned: the decision table; the field scope (the spec's
 * `BOUNDED_STRING_FIELD_TYPES`, the door's walk); a SQLite `"N.0"` is
 * reported per object and field and never rewritten, dry run or `--apply`;
 * a dry run writes nothing; `--apply` rewrites a raw scalar so `{ f: "42" }`
 * finds it; a unique collision is a per-row failure, not an abort; a re-run
 * reads zero to rewrite.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { decideTextScalar, migrateTextScalars, textScalarFields, type TextScalarsEngine } from './text-scalars.js';

const OBJ = {
  name: 'ts_obj', label: 'Text scalars', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    t: { name: 't', type: 'text' as const },
    u: { name: 'u', type: 'text' as const, unique: true },
    body: { name: 'body', type: 'textarea' as const },
    mail: { name: 'mail', type: 'email' as const },
    pick: { name: 'pick', type: 'select' as const },
    n: { name: 'n', type: 'number' as const },
  },
};
const OTHER = {
  name: 'ts_other', label: 'Other', systemFields: false,
  fields: { id: { name: 'id', type: 'text' as const, primaryKey: true }, code: { name: 'code', type: 'text' as const } },
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

const ids = async (ctx: Boot, where: Record<string, unknown>, object = 'ts_obj') =>
  ((await ctx.engine.find(object, { where, fields: ['id'] })) as Array<{ id: string }>).map((r) => r.id).sort();

/** The pre-#29241 door on SQLite: the raw scalar handed to the driver. */
async function plantSqlite(ctx: Boot) {
  await ctx.driver.create('ts_obj', { id: 'n42', t: 42, u: 42, body: -1.5, mail: 'a@b.co', n: 42 });
  await ctx.driver.create('ts_obj', { id: 'b1', t: true, body: false });
  await ctx.driver.create('ts_obj', { id: 'held', t: 'hello', u: '7', body: '42.0 is a version' });
  await ctx.driver.create('ts_other', { id: 'o1', code: 1e21 });
}

/**
 * driver-memory's read face over the real engine: a row listed in `raw`
 * reads back the raw scalar driver-memory kept for it while its column is
 * still unwritten (`null`) in the real table; every write is the real
 * engine's.
 */
function memoryFace(engine: ObjectQL, raw: Record<string, Record<string, unknown>>): TextScalarsEngine {
  return {
    getObject: (name) => engine.getObject(name),
    getConfigs: () => engine.getConfigs(),
    find: async (object, options) =>
      ((await engine.find(object, options as EngineQueryOptions)) as Array<Record<string, unknown>>).map((row) => {
        const planted = raw[`${object}:${String(row.id)}`];
        if (!planted) return row;
        const out = { ...row };
        for (const [k, v] of Object.entries(planted)) if (out[k] == null) out[k] = v;
        return out;
      }),
    update: (object, data, options) => engine.update(object, data, options),
  };
}

describe('os migrate text-scalars: the decision (#29702)', () => {
  it.each([
    // raw scalars (driver-memory's face): decidable by type, the #29241 door's string
    [42, { kind: 'rewrite', to: '42' }],
    [-1.5, { kind: 'rewrite', to: '-1.5' }],
    [0, { kind: 'rewrite', to: '0' }],
    [true, { kind: 'rewrite', to: 'true' }],
    [false, { kind: 'rewrite', to: 'false' }],
    [1e21, { kind: 'rewrite', to: '1e+21' }],
    // SQLite REAL text: undecidable on a text field, reported
    ['42.0', { kind: 'report', reason: 'sqlite-real-text' }],
    ['1.0', { kind: 'report', reason: 'sqlite-real-text' }],
    ['0.0', { kind: 'report', reason: 'sqlite-real-text' }],
    ['-3.0', { kind: 'report', reason: 'sqlite-real-text' }],
    ['1.0e+21', { kind: 'report', reason: 'sqlite-real-text' }],
    // left alone
    ['42', { kind: 'ok' }],
    ['-1.5', { kind: 'ok' }],
    ['hello', { kind: 'ok' }],
    ['42.0 is a version', { kind: 'ok' }],
    ['', { kind: 'ok' }],
    [null, { kind: 'ok' }],
    [undefined, { kind: 'ok' }],
    [{ a: 1 }, { kind: 'ok' }],
    [[42], { kind: 'ok' }],
  ] as const)('%o → %o', (value, verdict) => {
    expect(decideTextScalar(value)).toEqual(verdict);
  });

  it('walks the spec text family the #29241 door rewrites: readonly in, key, lifecycle and system out', () => {
    const fields = textScalarFields({
      fields: {
        id: { type: 'text', primaryKey: true },
        k: { type: 'text', primaryKey: true },
        a: { type: 'text' }, b: { type: 'textarea' }, c: { type: 'email' }, d: { type: 'url' }, e: { type: 'phone' },
        f: { type: 'password' }, g: { type: 'markdown' }, h: { type: 'html' }, i: { type: 'richtext' },
        j: { type: 'code' }, l: { type: 'signature' }, m: { type: 'qrcode' },
        ro: { type: 'text', readonly: true },
        sys: { type: 'text', system: true },
        sysro: { type: 'text', system: true, readonly: true },
        created_by: { type: 'text' },
        s: { type: 'select' }, n: { type: 'number' }, x: { type: 'json' }, y: { type: 'secret' }, z: { type: 'lookup' },
      },
    });
    expect(fields.map((f) => f.name)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'l', 'm', 'ro', 'sysro']);
  });
});

describe('os migrate text-scalars: SQLite "N.0" is reported, never rewritten (#29702)', () => {
  it('red before: the old form is what is stored and read, { t: "42" } misses it, a unique "42" does not collide', async () => {
    const ctx = await boot();
    await plantSqlite(ctx);
    expect((await ctx.stored('ts_obj', 'n42')).t).toBe('42.0');
    expect((await ctx.stored('ts_obj', 'b1')).t).toBe('1.0');
    expect((await ctx.stored('ts_obj', 'b1')).body).toBe('0.0');
    expect((await ctx.stored('ts_other', 'o1')).code).toBe('1.0e+21');
    expect(((await ctx.engine.findOne('ts_obj', { where: { id: 'n42' } })) as Record<string, unknown>).t).toBe('42.0');
    expect(await ids(ctx, { t: '42' })).toEqual([]);
    await ctx.engine.insert('ts_obj', { id: 'new', u: '42' });
    expect(await ids(ctx, { u: '42' })).toEqual(['new']);
  });

  it('a dry run reports per object and field and writes nothing', async () => {
    const ctx = await boot();
    await plantSqlite(ctx);
    const before = await ctx.stored('ts_obj', 'n42');
    const report = await migrateTextScalars(ctx.engine as any, silent, {});
    expect(report.applied).toBe(false);
    expect(report.scannedObjects.sort()).toEqual(['ts_obj', 'ts_other']);
    const byCol = Object.fromEntries(report.columns.map((c) => [`${c.object}.${c.field}`, [c.rewriteRows, c.reportedRows]]));
    expect(byCol).toEqual({
      'ts_obj.t': [0, 2], 'ts_obj.u': [0, 1], 'ts_obj.body': [0, 1], 'ts_other.code': [0, 1],
    });
    expect([report.rewriteValues, report.reportedValues, report.rewritten]).toEqual([0, 5, 0]);
    expect(await ctx.stored('ts_obj', 'n42')).toEqual(before);
  });

  it('--apply leaves every "N.0" as stored and reports it again', async () => {
    const ctx = await boot();
    await plantSqlite(ctx);
    const report = await migrateTextScalars(ctx.engine as any, silent, { apply: true });
    expect([report.rewriteValues, report.rewritten, report.reportedValues, report.failures.length]).toEqual([0, 0, 5, 0]);
    expect((await ctx.stored('ts_obj', 'n42')).t).toBe('42.0');
    expect((await ctx.stored('ts_obj', 'b1')).t).toBe('1.0');
    expect((await ctx.stored('ts_obj', 'n42')).body).toBe('-1.5');
    expect((await ctx.stored('ts_obj', 'held')).body).toBe('42.0 is a version');
  });
});

describe('os migrate text-scalars: the rewrite arm, driver-memory\'s face (#29702)', () => {
  const RAW = {
    'ts_obj:m42': { t: 42, u: 42, body: true },
    'ts_obj:mb': { t: false },
    'ts_other:mo': { code: 7 },
  };
  async function plantMemoryFace(ctx: Boot) {
    // Real rows whose text columns the face fills with driver-memory's raw scalars.
    await ctx.engine.insert('ts_obj', { id: 'm42' });
    await ctx.engine.insert('ts_obj', { id: 'mb' });
    await ctx.engine.insert('ts_other', { id: 'mo' });
    return memoryFace(ctx.engine, RAW);
  }

  it('a dry run counts the raw scalars and writes nothing', async () => {
    const ctx = await boot();
    const face = await plantMemoryFace(ctx);
    const report = await migrateTextScalars(face, silent, {});
    const byCol = Object.fromEntries(report.columns.map((c) => [`${c.object}.${c.field}`, [c.rewriteRows, c.reportedRows]]));
    expect(byCol).toEqual({ 'ts_obj.t': [2, 0], 'ts_obj.u': [1, 0], 'ts_obj.body': [1, 0], 'ts_other.code': [1, 0] });
    expect(report.rewritten).toBe(0);
    expect((await ctx.stored('ts_obj', 'm42')).t).toBeNull();
  });

  it('--apply writes String(value): { t: "42" } finds the row, a unique "42" now collides, a re-run reads zero', async () => {
    const ctx = await boot();
    const face = await plantMemoryFace(ctx);
    const report = await migrateTextScalars(face, silent, { apply: true });
    expect(report.failures).toEqual([]);
    expect([report.rewriteValues, report.rewritten]).toEqual([5, 5]);
    expect((await ctx.stored('ts_obj', 'm42')).t).toBe('42');
    expect((await ctx.stored('ts_obj', 'm42')).body).toBe('true');
    expect((await ctx.stored('ts_obj', 'mb')).t).toBe('false');
    expect((await ctx.stored('ts_other', 'mo')).code).toBe('7');
    expect(await ids(ctx, { t: '42' })).toEqual(['m42']);
    await expect(ctx.engine.insert('ts_obj', { id: 'dup', u: '42' })).rejects.toMatchObject({ code: expect.stringMatching(/UNIQUE|DUPLICATE/i) });

    const again = await migrateTextScalars(face, silent, { apply: true });
    expect([again.rewriteValues, again.rewritten, again.reportedValues]).toEqual([0, 0, 0]);
  });

  it('a unique collision with a row already holding the string is a per-row failure, not an abort', async () => {
    const ctx = await boot();
    const face = await plantMemoryFace(ctx);
    await ctx.engine.insert('ts_obj', { id: 'held', u: '42' });
    const report = await migrateTextScalars(face, silent, { apply: true });
    expect(report.failures.map((f) => [f.object, f.recordId, f.fields.sort()])).toEqual([['ts_obj', 'm42', ['body', 't', 'u']]]);
    // The row is left whole, and the rest of the walk landed.
    expect((await ctx.stored('ts_obj', 'm42')).t).toBeNull();
    expect((await ctx.stored('ts_obj', 'mb')).t).toBe('false');
    expect((await ctx.stored('ts_other', 'mo')).code).toBe('7');
  });

  it('objects narrows the walk to the named objects', async () => {
    const ctx = await boot();
    const face = await plantMemoryFace(ctx);
    const report = await migrateTextScalars(face, silent, { apply: true, objects: ['ts_other'] });
    expect(report.scannedObjects).toEqual(['ts_other']);
    expect(report.rewritten).toBe(1);
    expect((await ctx.stored('ts_obj', 'm42')).t).toBeNull();
  });
});
