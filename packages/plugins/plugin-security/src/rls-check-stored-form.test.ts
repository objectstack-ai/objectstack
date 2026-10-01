// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21109, ruling A] The row-level write `check` judges a `date`, `datetime` or
 * `time` column in its STORED form, so the write and the read the same policy
 * scopes give one answer for one row.
 *
 * Driven through the real engine, the real plugin and two SQL driver families,
 * as a member who resolves a permission set. Each cell writes one value under a
 * policy whose `using` and `check` are the same predicate, then asks the read:
 * the write is admitted exactly when the read shows the row that value is
 * stored as. Measured on `main` before the step (`rls-check-stored-form.ts`):
 *
 * | `check` | written | write, before | stored | read |
 * |---|---|---|---|---|
 * | `record.due_on == '2026-01-05'` | `'2026-01-05T15:00:00Z'`, a `Date` | 403 | `2026-01-05` | shown |
 * | `record.due_on > '2026-01-05'` | `'2026-01-05T15:00:00Z'` | admitted | `2026-01-05` | hidden |
 * | `record.start_time == '09:00'` | `'09:00:00'` | 403 | `09:00:00` | shown |
 * | `record.due_at == '2026-01-05T10:00:00Z'` | `'2026-01-05T18:00:00+08:00'` | 403 | `2026-01-05T10:00:00.000Z` | shown |
 *
 * ## formula's whole-day copy is out of reach here
 *
 * `@objectstack/formula`'s matcher carries its own copy of the whole-day upper
 * bound (a bare-day `$lte` read as "through that day"), which today is what
 * admits a `due_on` written as an instant or a `Date` on the boundary day under
 * `record.due_on <= '2026-01-05'`. Ruling A retires that copy once the check
 * judges the stored form, so these cells must pass WITHOUT it: the matcher is
 * wrapped so a `$lte` reaches it as `$lt` or `$eq`, and a `$between` as `$gte`
 * plus that, and the copy never runs. The first cell pins that the wrapper is
 * live.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
// The mocked module (see `vi.mock` below), loaded at module top.
import { matchesFilterCondition } from '@objectstack/formula';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { declaredTemporalColumns, storedFormCheckFilter, storedFormImage } from './rls-check-stored-form.js';

/** A plain object — a filter node or an operator map. */
function isPlain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

/** `$lte` as `$lt` or `$eq`, so the matcher's whole-day copy is never reached. */
const plainLte = (column: string, bound: unknown) => ({
  $or: [{ [column]: { $lt: bound } }, { [column]: { $eq: bound } }],
});

/** The filter with every `$lte` and `$between` spelled without the operators the copy serves. */
function withoutWholeDayCopy(node: unknown): unknown {
  if (!isPlain(node)) return node;
  const conjuncts: unknown[] = [];
  for (const [key, value] of Object.entries(node)) {
    if ((key === '$and' || key === '$or') && Array.isArray(value)) {
      conjuncts.push({ [key]: value.map(withoutWholeDayCopy) });
    } else if (key === '$not') {
      conjuncts.push({ $not: withoutWholeDayCopy(value) });
    } else if (key.startsWith('$') || !isPlain(value) || !('$lte' in value || '$between' in value)) {
      conjuncts.push({ [key]: value });
    } else {
      const { $lte, $between, ...rest } = value;
      if (Object.keys(rest).length > 0) conjuncts.push({ [key]: rest });
      if ($lte !== undefined) conjuncts.push(plainLte(key, $lte));
      if (Array.isArray($between)) conjuncts.push({ [key]: { $gte: $between[0] } }, plainLte(key, $between[1]));
    }
  }
  return conjuncts.length === 1 ? conjuncts[0] : { $and: conjuncts };
}

vi.mock('@objectstack/formula', async (importOriginal) => {
  const real = await importOriginal<typeof import('@objectstack/formula')>();
  return {
    ...real,
    matchesFilterCondition: ((record, filter, options) =>
      real.matchesFilterCondition(record, withoutWholeDayCopy(filter) as never, options)) as typeof real.matchesFilterCondition,
  };
});

const SYS_CTX = { isSystem: true, userId: 'usr_system' };
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

type Driver = { disconnect?: () => Promise<void> };
const DRIVERS: Array<[name: string, make: () => Driver]> = [
  ['driver-sql (better-sqlite3)', () =>
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })],
  ['driver-sqlite-wasm', () => new SqliteWasmDriver({ filename: ':memory:' })],
];

const booted: ObjectQL[] = [];
afterEach(async () => {
  while (booted.length) {
    try { await booted.pop()!.destroy(); } catch { /* noop */ }
  }
});

let seq = 0;
/** One engine and plugin, with ONE policy whose `using` and `check` are the same predicate. */
async function boot(makeDriver: () => Driver, predicate: string) {
  const OBJ = `qa_due_stored_${process.pid}_${++seq}`;
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver() as never, true);
  await engine.init();
  engine.registerApp({
    id: `com.objectstack.qa.rls-check-stored-form-${seq}`,
    name: 'RLS check stored form',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      {
        name: OBJ,
        label: 'Duty',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          title: { name: 'title', type: 'text' },
          due_on: { name: 'due_on', type: 'date' },
          due_at: { name: 'due_at', type: 'datetime' },
          start_time: { name: 'start_time', type: 'time' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  booted.push(engine);

  const set = PermissionSetSchema.parse({
    name: 'qa_due_guard',
    objects: { [OBJ]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    rowLevelSecurity: [{ name: 'due_guard', object: OBJ, operation: 'all', using: predicate, check: predicate }],
  });
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, set],
    },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  const caller = { userId: 'usr_member', positions: ['qa_pos'], permissions: [set.name], posture: 'MEMBER' };
  const storedRow = async (id: string) =>
    ((await engine.find(OBJ, { where: { id }, context: SYS_CTX } as never)) as Array<Record<string, unknown>>)[0];
  const shownTo = async (id: string) =>
    ((await engine.find(OBJ, { where: { id }, context: caller } as never)) as unknown[]).length > 0;
  return { OBJ, engine, caller, storedRow, shownTo };
}

type Envelope = { code: string; status: number };
const DENIED: Envelope = { code: 'PERMISSION_DENIED', status: 403 };
const envelopeOf = (e: unknown): Envelope => {
  const x = e as { code?: string; status?: number; statusCode?: number };
  return { code: String(x?.code), status: Number(x?.statusCode ?? x?.status) };
};
const outcome = (p: Promise<unknown>): Promise<'admitted' | Envelope> =>
  p.then(() => 'admitted' as const, (e: unknown) => envelopeOf(e));

const show = (v: unknown): string => (v instanceof Date ? `Date(${v.toISOString()})` : JSON.stringify(v));

type Cell = { predicate: string; column: string; value: unknown; stored: unknown; admitted: boolean };
const CELLS: Cell[] = [
  // `date`, the boundary day under a bare-day `$lte`: the three ways an SDK writes it.
  { predicate: "record.due_on <= '2026-01-05'", column: 'due_on', value: '2026-01-05T15:00:00Z', stored: '2026-01-05', admitted: true },
  { predicate: "record.due_on <= '2026-01-05'", column: 'due_on', value: new Date('2026-01-05T15:00:00Z'), stored: '2026-01-05', admitted: true },
  { predicate: "record.due_on <= '2026-01-05'", column: 'due_on', value: '2026-01-05', stored: '2026-01-05', admitted: true },
  { predicate: "record.due_on <= '2026-01-05'", column: 'due_on', value: '2026-01-06T01:00:00Z', stored: '2026-01-06', admitted: false },
  // `date` equality: refused before for an instant or a `Date` on the day.
  { predicate: "record.due_on == '2026-01-05'", column: 'due_on', value: '2026-01-05T15:00:00Z', stored: '2026-01-05', admitted: true },
  { predicate: "record.due_on == '2026-01-05'", column: 'due_on', value: new Date('2026-01-05T15:00:00Z'), stored: '2026-01-05', admitted: true },
  { predicate: "record.due_on == '2026-01-05'", column: 'due_on', value: '2026-01-06', stored: '2026-01-06', admitted: false },
  // `date`, strictly after the day: ADMITTED before, while the read hid the stored day.
  { predicate: "record.due_on > '2026-01-05'", column: 'due_on', value: '2026-01-05T15:00:00Z', stored: '2026-01-05', admitted: false },
  // `datetime`: one instant in two zones, and a comparand the policy spells unlike the stored form.
  { predicate: "record.due_at == '2026-01-05T10:00:00Z'", column: 'due_at', value: '2026-01-05T18:00:00+08:00', stored: '2026-01-05T10:00:00.000Z', admitted: true },
  { predicate: "record.due_at == '2026-01-05T10:00:00Z'", column: 'due_at', value: '2026-01-05T10:00:01Z', stored: '2026-01-05T10:00:01.000Z', admitted: false },
  { predicate: "record.due_at >= '2026-01-05T10:00:00Z'", column: 'due_at', value: '2026-01-05T10:00:00Z', stored: '2026-01-05T10:00:00.000Z', admitted: true },
  // `time`: a wall clock written with and without seconds.
  { predicate: "record.start_time == '09:00'", column: 'start_time', value: '09:00:00', stored: '09:00:00', admitted: true },
  { predicate: "record.start_time == '09:00'", column: 'start_time', value: '09:00', stored: '09:00:00', admitted: true },
  { predicate: "record.start_time == '09:00'", column: 'start_time', value: '09:01', stored: '09:01:00', admitted: false },
  // Control: a TEXT column is judged as written, whatever its value looks like.
  { predicate: "record.title == '2026-01-05'", column: 'title', value: '2026-01-05T15:00:00Z', stored: '2026-01-05T15:00:00Z', admitted: false },
  { predicate: "record.title > '2026-01-05'", column: 'title', value: '2026-01-05T15:00:00Z', stored: '2026-01-05T15:00:00Z', admitted: true },
];

describe("formula's whole-day copy is out of reach in this file", () => {
  it('a bare-day $lte no longer admits an instant later on that day', () => {
    expect(matchesFilterCondition({ d: '2026-01-05T15:00:00Z' }, { d: { $lte: '2026-01-05' } } as never)).toBe(false);
    expect(matchesFilterCondition({ d: '2026-01-05' }, { d: { $lte: '2026-01-05' } } as never)).toBe(true);
  });
});

for (const [driverName, makeDriver] of DRIVERS) {
  describe(`${driverName}: the write check and the read give one answer for one temporal row`, () => {
    for (const cell of CELLS) {
      const verdict = cell.admitted ? 'admitted and shown' : 'refused 403 and hidden';
      it(`${cell.predicate}, ${cell.column} written as ${show(cell.value)}: ${verdict}`, async () => {
        const r = await boot(makeDriver, cell.predicate);
        const written = await outcome(r.engine.insert(r.OBJ, { id: 'w', [cell.column]: cell.value }, { context: r.caller } as never));
        expect(written).toEqual(cell.admitted ? 'admitted' : DENIED);
        // The read under the same predicate, over the same value stored by the system.
        await r.engine.insert(r.OBJ, { id: 'r', [cell.column]: cell.value }, { context: SYS_CTX } as never);
        expect((await r.storedRow('r'))?.[cell.column]).toEqual(cell.stored);
        expect(await r.shownTo('r')).toBe(cell.admitted);
        // A refused write stored nothing; an admitted one stored the same row.
        const w = await r.storedRow('w');
        expect(w === undefined ? undefined : w[cell.column]).toEqual(cell.admitted ? cell.stored : undefined);
      });
    }

    it("a by-id update judges the stored form too: onto the day as an instant 'admitted', onto the next day 403 and unchanged", async () => {
      const r = await boot(makeDriver, "record.due_on == '2026-01-05'");
      await r.engine.insert(r.OBJ, { id: 'u', due_on: '2026-01-05' }, { context: SYS_CTX } as never);
      expect(await outcome(r.engine.update(r.OBJ, { due_on: '2026-01-05T23:30:00Z' }, { where: { id: 'u' }, context: r.caller } as never)))
        .toBe('admitted');
      expect(await outcome(r.engine.update(r.OBJ, { due_on: new Date('2026-01-06T00:30:00Z') }, { where: { id: 'u' }, context: r.caller } as never)))
        .toEqual(DENIED);
      expect((await r.storedRow('u'))?.due_on).toBe('2026-01-05');
    });
  });
}

describe('the stored-form step reads the declaration, never the values', () => {
  const COLUMNS = declaredTemporalColumns({
    fields: {
      due_on: { type: 'date', multiple: false },
      due_at: { type: 'datetime', multiple: false },
      start_time: { type: 'time', multiple: false },
      title: { type: 'text', multiple: false },
    },
  });

  it('names exactly the declared date / datetime / time columns, and none without a declaration', () => {
    expect([...COLUMNS.entries()]).toEqual([['due_on', 'date'], ['due_at', 'datetime'], ['start_time', 'time']]);
    expect(declaredTemporalColumns(undefined).size).toBe(0);
  });

  it('puts every value comparand on a temporal column into its form, and leaves everything else as written', () => {
    const filter = {
      $and: [
        { due_on: '2026-01-05T15:00:00Z' },
        { due_on: { $in: ['2026-01-05T15:00:00Z', '2026-01-06'], $null: false } },
        { start_time: { $between: ['09:00', '17:30'] } },
        { due_at: { $gte: '2026-01-05T18:00:00+08:00', $contains: '2026' } },
        { due_on: { $lte: { $field: 'title' } } },
        { title: '2026-01-05T15:00:00Z' },
      ],
    };
    const before = JSON.stringify(filter);
    expect(storedFormCheckFilter(filter, COLUMNS)).toEqual({
      $and: [
        { due_on: '2026-01-05' },
        { due_on: { $in: ['2026-01-05', '2026-01-06'], $null: false } },
        { start_time: { $between: ['09:00:00', '17:30:00'] } },
        { due_at: { $gte: '2026-01-05T10:00:00.000Z', $contains: '2026' } },
        { due_on: { $lte: { $field: 'title' } } },
        { title: '2026-01-05T15:00:00Z' },
      ],
    });
    expect(JSON.stringify(filter)).toBe(before);
  });

  it('hands back the same filter and image when nothing is temporal (copy-on-write)', () => {
    const filter = { $or: [{ title: '2026-01-05T15:00:00Z' }, { due_on: { $null: true } }] };
    expect(storedFormCheckFilter(filter, COLUMNS)).toBe(filter);
    const image = { title: '2026-01-05T15:00:00Z', due_on: '2026-01-05' };
    expect(storedFormImage(image, COLUMNS)).toBe(image);
    expect(storedFormImage({ due_on: new Date('2026-01-05T15:00:00Z') }, COLUMNS)).toEqual({ due_on: '2026-01-05' });
  });
});
