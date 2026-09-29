// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20263] `having` takes the temporal-comparand door `where` (#8690) and the
// per-aggregation `filter` (#20148) take: the same walk, the same
// `@objectstack/core` predicate (`isUninterpretableTemporalComparand`), with
// each aggregated column's kind read from the class #20127 derives —
// `min` / `max` of a temporal field keeps its kind, a groupBy projection takes
// its field's, a `day` bucket is a `date`, and `count` / `sum` / `avg` are not
// temporal.
//
// Measured on the base (`89f87f2344`) through `engine.aggregate` and
// `POST /api/v1/data/:object/query`, on InMemoryDriver, SqlDriver on SQLite and
// SqlDriver on PostgreSQL 16, on both `having` paths, four groups c1–c4:
//
// | `having` | base, all three drivers, both paths | its `where` twin |
// |:--|:--|:--|
// | `{ last_placed: { $lt: 'not-a-date' } }` on `max(placed_on)` | 200, keeps c1–c4 | 400 |
// | the same under `$gt` | 200, keeps no group | 400 |
// | `'+010000-01-01T00:00:00.000Z'` on `max(placed_on)`, `$gt` | 200, keeps c1–c4 | 400 |
// | the number for 10000-01-01 on `max(placed_on)`, `$gt` | 200, keeps c1–c4 | 400 |
// | `'not-a-date'` on `min(opened_at)` / `max(slot)`, `$lt` | 200, keeps c1–c4 | 400 |
// | `'not-a-date'` on a `placed_on` groupBy key or a `day` bucket | 200, keeps no group | 400 |
//
// Each read the driver once. Now each is refused `INVALID_FILTER` / 400 before
// any driver is asked for a row, on both paths. The drivers are not the
// question — no driver reads `having` — so this file holds the engine to it
// with a counting driver of each path's shape; the REST door is held over a
// real SqlDriver in `packages/rest/src/data-query-having-temporal-door.test.ts`.

import { describe, it, expect } from 'vitest';
import { isUninterpretableTemporalComparand, type TemporalComparandKind } from '@objectstack/core';
import type { EngineAggregateOptions, FilterCondition } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { applyInMemoryAggregation } from './in-memory-aggregation.js';

const OBJECT = 'ledger_order';

const FIELDS = {
  customer_id: { type: 'text' },
  amount: { type: 'number' },
  placed_on: { type: 'date' },
  opened_at: { type: 'datetime' },
  slot: { type: 'time' },
};

// In the storage form every driver presents a row in (ADR-0053).
const ROWS = [
  { id: 'o1', customer_id: 'c1', amount: 100, placed_on: '2026-01-10', opened_at: '2026-01-01T10:00:00.000Z', slot: '09:00:00' },
  { id: 'o2', customer_id: 'c1', amount: 400, placed_on: '2026-01-02', opened_at: '2026-01-02T10:00:00.000Z', slot: '10:30:00' },
  { id: 'o3', customer_id: 'c2', amount: 900, placed_on: '2026-03-01', opened_at: '2026-02-01T10:00:00.000Z', slot: '11:00:00' },
  { id: 'o4', customer_id: 'c2', amount: 300, placed_on: '2026-02-01', opened_at: '2026-02-05T10:00:00.000Z', slot: '12:00:00' },
  { id: 'o5', customer_id: 'c3', amount: 50, placed_on: '2026-01-15', opened_at: '2026-02-06T10:00:00.000Z', slot: '13:00:00' },
  { id: 'o6', customer_id: 'c4', amount: 20, placed_on: '2026-02-01', opened_at: '2026-03-01T10:00:00.000Z', slot: '14:00:00' },
];

// c1: last_placed 2026-01-10 · first_opened 2026-01-01T10:00Z · last_slot 10:30:00 · total 500
// c2: last_placed 2026-03-01 · first_opened 2026-02-01T10:00Z · last_slot 12:00:00 · total 1200
// c3: last_placed 2026-01-15 · first_opened 2026-02-06T10:00Z · last_slot 13:00:00 · total 50
// c4: last_placed 2026-02-01 · first_opened 2026-03-01T10:00Z · last_slot 14:00:00 · total 20
const AGGREGATIONS: NonNullable<EngineAggregateOptions['aggregations']> = [
  { function: 'max', field: 'placed_on', alias: 'last_placed' },
  { function: 'min', field: 'opened_at', alias: 'first_opened' },
  { function: 'max', field: 'slot', alias: 'last_slot' },
  { function: 'sum', field: 'amount', alias: 'total' },
  { function: 'count', alias: 'n' },
  { function: 'avg', field: 'amount', alias: 'mean' },
];

const Y10000 = 253402300800000; // +010000-01-01T00:00:00.000Z

type Path = 'native' | 'rows';

/**
 * The two `having` paths. `native`: the driver aggregates and the engine
 * applies `having` to what it returns. `rows`: the engine asks for rows and
 * aggregates them itself (a filtered aggregation forces that path). Both count
 * every read of the object.
 */
function makeDriver(path: Path, rows: ReadonlyArray<Record<string, unknown>>) {
  const reads = { aggregate: 0, find: 0 };
  const driver: any = {
    name: `${path}-recorder`,
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { reads.find += 1; return rows.map((r) => ({ ...r })); },
    async findOne() { return null; },
    async create(_o: string, d: any) { return d; },
    async update(_o: string, _id: string, d: any) { return d; },
    async delete() { return true; },
    async count() { return rows.length; },
    async bulkCreate(_o: string, r: any[]) { return r; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  if (path === 'native') {
    driver.aggregate = async (_o: string, ast: any) => { reads.aggregate += 1; return applyInMemoryAggregation([...rows], ast); };
  }
  return { driver, reads };
}

async function makeEngine(path: Path, rows: ReadonlyArray<Record<string, unknown>>) {
  const { driver, reads } = makeDriver(path, rows);
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  (engine.registry as any).registerObject({ name: OBJECT, fields: FIELDS });
  return { engine, reads };
}

function query(path: Path, having: unknown, groupBy: EngineAggregateOptions['groupBy'] = ['customer_id']): EngineAggregateOptions {
  const aggregations = path === 'native'
    ? AGGREGATIONS
    : [...AGGREGATIONS, { function: 'count' as const, alias: 'fb', filter: { customer_id: { $ne: '' } } }];
  return { groupBy, aggregations, having: having as FilterCondition };
}

interface Refusal extends Error { code?: unknown; status?: unknown }

async function outcome(run: () => Promise<unknown>): Promise<{ rows?: any[]; err?: Refusal }> {
  try {
    return { rows: (await run()) as any[] };
  } catch (e) {
    return { err: e as Refusal };
  }
}

/**
 * Refused on both paths, on an empty and a populated object, with no read of
 * the object and one message per path — one message across the two paths as
 * well unless `acrossPaths` is false (a refusal that lists the aggregated
 * row's columns names the rows path's extra aggregation). Returns the native
 * path's message.
 */
async function expectHavingRefusal(
  having: () => unknown,
  groupBy?: EngineAggregateOptions['groupBy'],
  acrossPaths = true,
): Promise<string> {
  const messages: Partial<Record<Path, string>> = {};
  for (const path of ['native', 'rows'] as const) {
    for (const [population, rows] of [['empty', []], ['populated', ROWS]] as const) {
      const cell = `${path}, ${population}`;
      const { engine, reads } = await makeEngine(path, rows);
      const { err } = await outcome(() => engine.aggregate(OBJECT, query(path, having(), groupBy)));
      expect(err, cell).toBeInstanceOf(Error);
      expect(err!.code, cell).toBe('INVALID_FILTER');
      expect(err!.status, cell).toBe(400);
      expect(reads, cell).toEqual({ aggregate: 0, find: 0 });
      messages[path] ??= err!.message;
      expect(err!.message, cell).toBe(messages[path]);
    }
  }
  if (acrossPaths) expect(messages.rows).toBe(messages.native);
  return messages.native!;
}

/** The groups a `having` keeps, identical on both paths. */
async function keptGroups(having: unknown, key = 'customer_id', groupBy?: EngineAggregateOptions['groupBy']): Promise<string[]> {
  let kept: string[] | undefined;
  for (const path of ['native', 'rows'] as const) {
    const { engine, reads } = await makeEngine(path, ROWS);
    const rows = await engine.aggregate(OBJECT, query(path, having, groupBy));
    expect(reads.aggregate + reads.find, path).toBe(1);
    const got = rows.map((r: any) => String(r[key])).sort();
    kept ??= got;
    expect(got, path).toEqual(kept);
  }
  return kept!;
}

/** The same comparand in a `where` on the aggregated field — the twin. */
async function whereTwinOf(where: Record<string, unknown>): Promise<{ err?: Refusal; reads: number }> {
  const { engine, reads } = await makeEngine('rows', ROWS);
  const { err } = await outcome(() => engine.find(OBJECT, { where: where as FilterCondition }));
  return { err, reads: reads.find };
}

describe('[#20263] having — a comparand its column cannot read is refused before any read, as its where twin is', () => {
  // name · having · the where twin · what the message names (column, source, kind, value, path)
  const REFUSED: ReadonlyArray<readonly [string, () => Record<string, unknown>, Record<string, unknown>, readonly string[]]> = [
    ['the card\'s row: "not-a-date" $lt on max(date), which kept every group',
      () => ({ last_placed: { $lt: 'not-a-date' } }), { placed_on: { $lt: 'not-a-date' } },
      ["`having` on 'last_placed' (max(placed_on), a date column)", '"not-a-date"', 'at having.last_placed.$lt', 'not a date value']],
    ['"not-a-date" $gt on max(date), which kept no group',
      () => ({ last_placed: { $gt: 'not-a-date' } }), { placed_on: { $gt: 'not-a-date' } },
      ['at having.last_placed.$gt']],
    ['an extended-year ISO string on max(date)',
      () => ({ last_placed: { $gt: '+010000-01-01T00:00:00.000Z' } }), { placed_on: { $gt: '+010000-01-01T00:00:00.000Z' } },
      ['"+010000-01-01T00:00:00.000Z"', 'not a date value']],
    ['the number for 10000-01-01 on max(date), in the year class\'s own words',
      () => ({ last_placed: { $gt: Y10000 } }), { placed_on: { $gt: Y10000 } },
      ['253402300800000', 'outside the years 0001 to 9999', 'keep the wrong groups']],
    ['the Date for 10000-01-01 on max(date)',
      () => ({ last_placed: { $lt: new Date(Y10000) } }), { placed_on: { $lt: new Date(Y10000) } },
      ['Date +010000-01-01T00:00:00.000Z', 'outside the years 0001 to 9999']],
    // [#20264] A datetime year outside 0001..9999 is the year class too, on
    // `having` with no edit here: the predicate asks core's one range. At the
    // base this `$lt` kept no group — the extended text sorts below every year.
    ['an extended-year ISO string on min(datetime), in the year class\'s words',
      () => ({ first_opened: { $lt: '+010000-01-01T00:00:00.000Z' } }), { opened_at: { $lt: '+010000-01-01T00:00:00.000Z' } },
      ["`having` on 'first_opened' (min(opened_at), a datetime column)", 'outside the years 0001 to 9999', 'keep the wrong groups']],
    ['the number for year 0 on max(date) — [#20264] year 0 joins the refused years',
      () => ({ last_placed: { $gt: Date.parse('0000-06-15T00:00:00.000Z') } }), { placed_on: { $gt: Date.parse('0000-06-15T00:00:00.000Z') } },
      ['outside the years 0001 to 9999']],
    ['"not-a-date" on min(datetime)',
      () => ({ first_opened: { $lt: 'not-a-date' } }), { opened_at: { $lt: 'not-a-date' } },
      ["`having` on 'first_opened' (min(opened_at), a datetime column)", 'not a datetime value']],
    ['a preset name on min(datetime)',
      () => ({ first_opened: { $gte: 'last_30_days' } }), { opened_at: { $gte: 'last_30_days' } },
      ['"last_30_days"']],
    ['"noon" on max(time)',
      () => ({ last_slot: { $gt: 'noon' } }), { slot: { $gt: 'noon' } },
      ["`having` on 'last_slot' (max(slot), a time column)", 'not a time value']],
    // [#20480] A time column keeps the UTC time of day of an instant only when
    // its UTC year has a four-digit spelling. This number kept NO group at the
    // base (it was compared with `HH:MM:SS` text as written), and was listed
    // among the comparands left alone; it is refused now, with its string twin.
    ['[#20480] the number for 10000-01-01 on max(time), which kept no group',
      () => ({ last_slot: { $gt: Y10000 } }), { slot: { $gt: Y10000 } },
      ["`having` on 'last_slot' (max(slot), a time column)", '253402300800000', 'at having.last_slot.$gt']],
    ['[#20480] the card\'s extended-year instant on max(time)',
      () => ({ last_slot: { $gt: '+010000-01-01T10:00:00Z' } }), { slot: { $gt: '+010000-01-01T10:00:00Z' } },
      ["`having` on 'last_slot' (max(slot), a time column)", '"+010000-01-01T10:00:00Z"', 'at having.last_slot.$gt']],
    ['an $in member', () => ({ last_placed: { $in: ['2026-02-01', 'not-a-date'] } }), { placed_on: { $in: ['2026-02-01', 'not-a-date'] } },
      ['at having.last_placed.$in[1]']],
    ['a $nin member', () => ({ last_placed: { $nin: ['not-a-date'] } }), { placed_on: { $nin: ['not-a-date'] } },
      ['at having.last_placed.$nin[0]']],
    ['a $between endpoint', () => ({ last_placed: { $between: ['2026-01-01', 'not-a-date'] } }), { placed_on: { $between: ['2026-01-01', 'not-a-date'] } },
      ['at having.last_placed.$between[1]']],
    ['the implicit-equality slot', () => ({ last_placed: 'not-a-date' }), { placed_on: 'not-a-date' },
      ['at having.last_placed,']],
    ['behind a $or branch that holds', () => ({ $or: [{ total: { $gt: 0 } }, { last_placed: { $gt: 'not-a-date' } }] }),
      { $or: [{ amount: { $gt: 0 } }, { placed_on: { $gt: 'not-a-date' } }] },
      ['at having.$or[1].last_placed.$gt']],
    ['under $not', () => ({ $not: { last_placed: { $gt: 'not-a-date' } } }), { $not: { placed_on: { $gt: 'not-a-date' } } },
      ['at having.$not.last_placed.$gt']],
  ];

  for (const [name, having, where, named] of REFUSED) {
    it(`${name}: INVALID_FILTER / 400 on both paths, empty or populated, no read — and the where twin agrees`, async () => {
      const message = await expectHavingRefusal(having);
      expect(message.startsWith(`aggregate('${OBJECT}'): `)).toBe(true);
      for (const part of named) expect(message).toContain(part);
      expect(message).toContain('The `having` was NOT applied.');
      const twin = await whereTwinOf(where);
      expect(twin.err?.code).toBe('INVALID_FILTER');
      expect(twin.err?.status).toBe(400);
      expect(twin.reads).toBe(0);
    });
  }

  it('a groupBy key that is itself a date field is judged as a date column', async () => {
    const message = await expectHavingRefusal(() => ({ placed_on: { $gt: 'not-a-date' } }), ['placed_on']);
    expect(message).toContain("`having` on 'placed_on' (the groupBy field placed_on, a date column)");
  });

  it('a day bucket is judged as a date column, whatever the field it buckets', async () => {
    const message = await expectHavingRefusal(
      () => ({ d: { $gt: 'not-a-date' } }),
      [{ field: 'opened_at', dateGranularity: 'day', alias: 'd' }],
    );
    expect(message).toContain("`having` on 'd' (the day bucket of opened_at, a date column)");
    // The number for 10000-01-01 kept every day at the base: a date column's year rule applies.
    await expectHavingRefusal(() => ({ d: { $gt: Y10000 } }), [{ field: 'opened_at', dateGranularity: 'day', alias: 'd' }]);
  });

  // [#20334] `having` resolves placeholders through `where`'s resolver, so its
  // remedy is `where`'s: it names the relative-date placeholder that a caller
  // holding a preset name (`last_30_days`) needs, on the two kinds that take one.
  it('the remedy names the placeholder the resolver knows, in the where twin\'s words', async () => {
    const CASES: ReadonlyArray<readonly [Record<string, unknown>, Record<string, unknown>, string]> = [
      [{ last_placed: { $lt: 'last_30_days' } }, { placed_on: { $lt: 'last_30_days' } },
        "`having` on 'last_placed' (max(placed_on), a date column) compares against \"last_30_days\" at "
        + 'having.last_placed.$lt, which is not a date value this platform can interpret.'],
      [{ first_opened: { $lt: 'last_30_days' } }, { opened_at: { $lt: 'last_30_days' } },
        "`having` on 'first_opened' (min(opened_at), a datetime column) compares against \"last_30_days\" at "
        + 'having.first_opened.$lt, which is not a datetime value this platform can interpret.'],
    ];
    const after = (message: string, marker: string): string => {
      expect(message).toContain(marker);
      return message.slice(message.indexOf(marker) + marker.length);
    };
    for (const [having, where, firstSentence] of CASES) {
      // INVALID_FILTER / 400 on both paths, empty or populated, no read.
      const message = await expectHavingRefusal(() => having);
      expect(message.startsWith(`aggregate('${OBJECT}'): ${firstSentence} `)).toBe(true);
      const remedy = after(message, 'The `having` was NOT applied. ');
      expect(remedy).toContain('"{30_days_ago}"');
      const twin = await whereTwinOf(where);
      expect(twin.err?.code).toBe('INVALID_FILTER');
      expect(twin.err?.status).toBe(400);
      expect(remedy).toBe(after(twin.err!.message, 'The filter was NOT applied. '));
    }
  });
});

describe('[#20263] having — one predicate: refused exactly when @objectstack/core calls the comparand uninterpretable, as where is', () => {
  const COLUMNS: ReadonlyArray<readonly [TemporalComparandKind, string, string]> = [
    ['date', 'last_placed', 'placed_on'],
    ['datetime', 'first_opened', 'opened_at'],
    ['time', 'last_slot', 'slot'],
  ];
  const VALUES: readonly unknown[] = [
    'not-a-date', '2026-02-01', '2026-02-01T10:00:00.000Z', '2026-02-01 10:00', '+010000-01-01T00:00:00.000Z',
    '10:00', '10:00:00', '25:00', 'last_30_days', '1769940000000', '{today}', '{not_a_token}', '', '   ',
    1769940000000, Y10000, -62198755200000, new Date(1769940000000), new Date(Y10000), null, true,
  ];
  for (const [kind, column, field] of COLUMNS) {
    it(`${kind}: ${column} and its where twin on ${field}, over ${VALUES.length} comparands`, async () => {
      for (const value of VALUES) {
        const expected = isUninterpretableTemporalComparand(kind, value);
        const label = `${kind} ${String(value instanceof Date ? value.toISOString() : JSON.stringify(value))}`;
        const { engine, reads } = await makeEngine('native', ROWS);
        const having = await outcome(() => engine.aggregate(OBJECT, query('native', { [column]: { $eq: value } })));
        expect(having.err?.code === 'INVALID_FILTER', `having, ${label}`).toBe(expected);
        if (expected) expect(reads.aggregate, label).toBe(0);
        const twin = await whereTwinOf({ [field]: { $eq: value } });
        // A `{placeholder}` the resolver does not know is refused on `where`
        // one layer down, by its own code — not this door's verdict.
        const twinRefusedByDoor = twin.err?.code === 'INVALID_FILTER';
        expect(twinRefusedByDoor, `where twin, ${label}`).toBe(expected);
      }
    });
  }
});

describe('[#20263] having — what the door leaves alone answers exactly as before', () => {
  // name · having · groups kept — each measured identical on the base, all three drivers, both paths
  const UNCHANGED: ReadonlyArray<readonly [string, unknown, string[]]> = [
    ['a 2026 day $gt on max(date) (the control)', { last_placed: { $gt: '2026-02-01' } }, ['c2']],
    ['a 2026 day $lt on max(date)', { last_placed: { $lt: '2026-02-01' } }, ['c1', 'c3']],
    ['an ISO instant on max(date)', { last_placed: { $gte: '2026-02-01T00:00:00.000Z' } }, ['c2', 'c4']],
    ['an in-range number on max(date)', { last_placed: { $gt: 1769940000000 } }, ['c2']],
    ['an in-range Date on max(date)', { last_placed: { $gt: new Date(1769940000000) } }, ['c2']],
    ['a 2026 instant on min(datetime)', { first_opened: { $gt: '2026-02-01T00:00:00.000Z' } }, ['c2', 'c3', 'c4']],
    ['a bare day as the upper bound of min(datetime)', { first_opened: { $lte: '2026-02-01' } }, ['c1', 'c2']],
    // [#20264] An extended-year instant on min(datetime) is refused now (see
    // the REFUSED table); the first instant of year 1 is read, as before.
    ['the first instant of year 1 on min(datetime) — inside the range', { first_opened: { $gt: '0001-01-01T00:00:00.000Z' } }, ['c1', 'c2', 'c3', 'c4']],
    ['a wall clock on max(time)', { last_slot: { $gte: '12:00' } }, ['c2', 'c3', 'c4']],
    ['[#20480] the same wall clock as a 2026 instant on max(time) — the control', { last_slot: { $gte: '2026-01-01T12:00:00Z' } }, ['c2', 'c3', 'c4']],
    ['[#20480] the same wall clock as a 2026 epoch-ms number on max(time)', { last_slot: { $gte: Date.parse('2026-01-01T12:00:00Z') } }, ['c2', 'c3', 'c4']],
    ['a {placeholder} is stepped around, as on where', { last_placed: { $lte: '{today}' } }, ['c1', 'c2', 'c3', 'c4']],
    ['the empty string (its own card)', { last_placed: { $gt: '' } }, ['c1', 'c2', 'c3', 'c4']],
    ['null in the equality slot', { last_placed: null }, []],
    ['$exists', { last_placed: { $exists: true } }, ['c1', 'c2', 'c3', 'c4']],
    ['$in of days', { last_placed: { $in: ['2026-02-01', '2026-03-01'] } }, ['c2', 'c4']],
    ['$between of days', { last_placed: { $between: ['2026-01-01', '2026-02-01'] } }, ['c1', 'c3', 'c4']],
    ['$not', { $not: { last_placed: { $gt: '2026-02-01' } } }, ['c1', 'c3', 'c4']],
    ['$or', { $or: [{ total: { $gt: 1000 } }, { last_placed: { $lt: '2026-01-12' } }] }, ['c1', 'c2']],
    ['a { $field } reference', { last_placed: { $gte: { $field: 'last_placed' } } }, ['c1', 'c2', 'c3', 'c4']],
    // #15661: a text operator on a temporal column stays beneath every door on `having`.
    ['$contains on max(date) — a text operator, not judged', { last_placed: { $contains: '2026' } }, ['c1', 'c2', 'c3', 'c4']],
    ['$startsWith on max(date) — a text operator, not judged', { last_placed: { $startsWith: 'not-a-date' } }, []],
  ];
  for (const [name, having, kept] of UNCHANGED) {
    it(`${name}: keeps ${kept.join(', ') || 'no group'} on both paths`, async () => {
      expect(await keptGroups(having)).toEqual(kept);
    });
  }

  // [#20351] A string on a NUMERIC column is not this door's either, and it is
  // no longer compared as written: the number-comparand door, which runs after
  // this one, refuses it in its own words, before any read. (It kept no group,
  // with a 200, before that door existed.)
  it('a string on sum, count or avg is not this door\'s: the number-comparand door refuses it, before any read', async () => {
    for (const column of ['total', 'n', 'mean']) {
      for (const path of ['native', 'rows'] as const) {
        const { engine, reads } = await makeEngine(path, ROWS);
        const { err } = await outcome(() => engine.aggregate(OBJECT, query(path, { [column]: { $gt: 'not-a-date' } })));
        expect({ code: err?.code, status: err?.status }, `${column} ${path}`).toEqual({ code: 'INVALID_FILTER', status: 400 });
        // [#20510] `total` / `n` / `mean` are aggregation aliases — a numeric
        // aggregated column, not a declared field — and `having` never binds
        // to a driver, so the refusal carries no PostgreSQL clause.
        expect(err?.message, `${column} ${path}`).toContain(`compares a numeric aggregated column against "not-a-date" at having.${column}.$gt`);
        expect(err?.message, `${column} ${path}`).not.toContain('PostgreSQL');
        expect(reads, `${column} ${path}`).toEqual({ aggregate: 0, find: 0 });
      }
    }
  });

  // [#20334] An unknown one is stepped around by this door too, and is then
  // refused one layer down by the token resolver, in its own code, as on
  // `where` (it kept no group with a 200 before `having` resolved tokens).
  it('an unknown {placeholder} is not this door\'s verdict: FILTER_TOKEN_UNKNOWN from the resolver, before any read', async () => {
    for (const path of ['native', 'rows'] as const) {
      const { engine, reads } = await makeEngine(path, ROWS);
      const { err } = await outcome(() => engine.aggregate(OBJECT, query(path, { last_placed: { $gte: '{not_a_token}' } })));
      expect(err?.code, path).toBe('FILTER_TOKEN_UNKNOWN');
      expect(err?.status, path).toBe(400);
      expect(reads, path).toEqual({ aggregate: 0, find: 0 });
    }
  });

  it('a coarser bucket is a text label, and is not judged', async () => {
    const kept = await keptGroups(
      { m: { $gt: 'not-a-date' } },
      'm',
      [{ field: 'opened_at', dateGranularity: 'month', alias: 'm' }],
    );
    expect(kept).toEqual([]);
  });
});

describe('[#20263] having — a clause another door refuses keeps that refusal and its words', () => {
  // Each carries an uninterpretable temporal comparand AND the shape an earlier
  // `having` door refuses; the earlier door answers, in its own words.
  const EARLIER: ReadonlyArray<readonly [string, () => unknown, string]> = [
    ['an unknown operator (#20099)', () => ({ last_placed: { $median: 'not-a-date' } }), "Unsupported operator '$median' in `having`"],
    ['a key naming no column (#20123)', () => ({ totl: { $gt: 1 }, last_placed: { $lt: 'not-a-date' } }), "`having` filters on 'totl' at having.totl"],
    ['a comparand of no comparable type (#20099)', () => ({ total: { $eq: { v: 1 } }, last_placed: { $lt: 'not-a-date' } }), 'is a plain object'],
    ['an addDays pair on numeric columns (#20127)', () => ({ total: { $gt: { $field: 'total', addDays: 1 } }, last_placed: { $lt: 'not-a-date' } }), 'addDays adds whole days'],
    ['an array in the equality slot (#19974)', () => ({ last_placed: ['not-a-date'] }), 'requires a single comparable value'],
  ];
  for (const [name, having, words] of EARLIER) {
    it(`${name}: refused in that door's words, not this one's`, async () => {
      const message = await expectHavingRefusal(having, undefined, false);
      expect(message).toContain(words);
      expect(message).not.toContain('which is not a date value this platform can interpret');
    });
  }
});
