// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Date-bucket parity conformance — exercises the reusable `checkDateBucketParity`
// helper (from @objectstack/verify) against the framework's own SQL drivers.
// A granularity a driver ADVERTISES via `supports.queryDateGranularity` must
// bucket identically whether `engine.aggregate` pushes it down as SQL or falls
// back to `applyInMemoryAggregation` — they are one feature with two
// implementations, and the engine picks between them per query.
//
// This is the seam #3773 crossed silently. SQLite stores a `Field.datetime` as
// INTEGER epoch ms; `strftime` read the bare integer as a Julian day number, so
// every row bucketed as NULL and a trend chart collapsed into one bar. Every
// existing gate was green: the driver's own bucket suites build their tables
// with `knex.schema.createTable` + `t.string(...)` (ISO TEXT — the half
// `strftime` parses natively), and the engine never second-guesses a
// granularity a driver claims to support.
//
// It also closes the drift the `⚠️ Keep in sync` comments cannot: three test
// files hand-copy `bucketDateValue` because driver-sql cannot depend on
// objectql, and a copy that stops tracking its original leaves the copy and the
// SQL agreeing with each other while both are wrong. Here the reference side is
// the REAL `applyInMemoryAggregation`.

import { describe, it, expect } from 'vitest';
import { checkDateBucketParity } from '@objectstack/verify';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

const DRIVERS = [
  {
    name: 'driver-sql (better-sqlite3 :memory:)',
    make: () =>
      new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      }),
  },
  {
    // Inherits `buildDateBucketExpr` from SqlDriver, so it inherited #3773 too —
    // and resolves its base class from BUILT dist, which is its own way to drift.
    name: 'driver-sqlite-wasm (:memory:)',
    make: () => new SqliteWasmDriver({ filename: ':memory:' }),
  },
];

describe.each(DRIVERS)('date-bucket parity conformance: $name', ({ make }) => {
  it('buckets identically pushed-down and in-memory, on both storage forms', async () => {
    const problems = await checkDateBucketParity(make(), {
      createOptions: { bypassTenantAudit: true },
    });
    expect(problems).toEqual([]);
  });
});

describe('checkDateBucketParity detects a driver whose SQL bucketing is wrong', () => {
  // The negative control. A gate nobody has watched fail is a gate nobody knows
  // is wired up — and this one is cheap to fake, because the #3773 shape is
  // exactly "advertise the granularity, then bucket everything as NULL".
  function brokenDriver(overrides: Record<string, unknown> = {}) {
    const rows = [
      { id: 'b1', at: '2024-01-15T10:00:00.000Z', on: '2024-01-15', n: 1 },
      { id: 'b2', at: '2024-06-30T23:59:59.000Z', on: '2024-06-30', n: 1 },
      { id: 'b3', at: '2024-07-01T00:00:00.000Z', on: '2024-07-01', n: 1 },
      { id: 'b4', at: '2024-12-30T12:00:00.000Z', on: '2024-12-30', n: 1 },
      { id: 'b5', at: '2025-01-01T00:00:00.000Z', on: '2025-01-01', n: 1 },
      { id: 'b6', at: '2025-05-19T09:00:00.000Z', on: '2025-05-19', n: 1 },
      { id: 'b7', at: '2025-05-19T22:30:00.000Z', on: '2025-05-19', n: 1 },
      { id: 'b8', at: null, on: null, n: 1 }, // the empty bucket (#3839)
    ];
    return {
      async connect() {},
      async disconnect() {},
      async syncSchema() {},
      async create() {},
      async find() {
        return rows;
      },
      // Everything collapses into one null bucket — the pre-#3773 SQLite shape.
      async aggregate(_object: string, query: any) {
        const field = query.groupBy[0].field;
        return [{ [field]: null, n: rows.length }];
      },
      supports: { queryDateGranularity: { day: true, month: true, quarter: true, year: true, week: false } },
      ...overrides,
    };
  }

  it('flags every advertised granularity on both columns', async () => {
    const problems = await checkDateBucketParity(brokenDriver());
    // 4 advertised granularities × 2 storage forms = 8 disagreements, and the
    // cross-column pass stays quiet because both columns are broken the same way.
    expect(problems).toHaveLength(8);
    expect(problems.join('\n')).toMatch(/Field\.datetime 'at' @ month/);
    expect(problems.join('\n')).toMatch(/Field\.date 'on' @ year/);
    expect(problems.join('\n')).toMatch(/pushed-down SQL and in-memory bucketing disagree/);
  });

  it('flags a driver that advertises a granularity it cannot actually run', async () => {
    const problems = await checkDateBucketParity(
      brokenDriver({
        async aggregate() {
          throw new Error("dateGranularity 'month' not supported on dialect");
        },
      })
    );
    expect(problems.join('\n')).toMatch(/advertises this granularity but aggregate\(\) threw/);
  });

  it('flags a storage-form leak — one column right, the other collapsed', async () => {
    // The #3773 shape exactly: the TEXT-stored `date` column buckets fine while
    // the epoch-stored `datetime` column does not.
    const problems = await checkDateBucketParity(
      brokenDriver({
        async aggregate(_object: string, query: any) {
          const field = query.groupBy[0].field;
          if (field === 'on') {
            return [
              { on: '2024', n: 4 },
              { on: '2025', n: 3 },
              { on: null, n: 1 },
            ];
          }
          return [{ at: null, n: 8 }];
        },
        supports: { queryDateGranularity: { year: true } },
      })
    );
    expect(problems.join('\n')).toMatch(/Field\.datetime 'at' @ year/);
    expect(problems.join('\n')).toMatch(
      /describe the same days but bucket differently/,
    );
  });

  // #3839's shape, and the reason the fixture now carries a null instant. This
  // driver buckets every real instant correctly and disagrees on ONE row: the
  // empty one, which it spells as a sentinel string instead of NULL. That is
  // precisely what the in-memory path did before #3839 — and with the old
  // `String(row[field])` keying, `'null'` would have compared EQUAL to a real
  // `null` and this check would have passed a driver that is out of step.
  it.each([
    ['the legacy in-memory sentinel', '(null)'],
    ['a stringified SQL NULL', 'null'],
  ])('flags a driver that spells the empty bucket as %s', async (_label, sentinel) => {
    const problems = await checkDateBucketParity(
      brokenDriver({
        async aggregate(_object: string, query: any) {
          const field = query.groupBy[0].field;
          return [
            { [field]: '2024', n: 4 },
            { [field]: '2025', n: 3 },
            { [field]: sentinel, n: 1 },
          ];
        },
        supports: { queryDateGranularity: { year: true } },
      })
    );
    expect(problems.join('\n')).toMatch(/pushed-down SQL and in-memory bucketing disagree/);
    expect(problems.join('\n')).toContain(sentinel);
  });

  it('stays quiet on a driver that advertises nothing', async () => {
    const problems = await checkDateBucketParity(
      brokenDriver({ supports: { queryDateGranularity: {} } })
    );
    // Nothing advertised ⇒ the engine buckets everything in-memory ⇒ nothing to
    // disagree about. A driver is never faulted for declining.
    expect(problems).toEqual([]);
  });
});
