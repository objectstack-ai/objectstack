// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Date-bucket parity for `driver-mongodb` (#7580) — the contract that lets
 * `MongoDBDriver.supports.queryDateGranularity` be published at all.
 *
 * ## The contract
 *
 * A driver that advertises `supports.queryDateGranularity[g]` tells
 * `engine.aggregate` it may push `dateGranularity: g` down instead of fetching
 * rows and bucketing them in JS (`engine.ts`, aggregate dispatch). The two are
 * then one feature with two implementations, and the engine picks between them
 * PER QUERY — so the same rows bucketed either way must carry the same LABELS,
 * byte for byte. A dashboard can cross that seam mid-drill-down.
 *
 * "Same labels" includes the EMPTY bucket: a row with no instant must key the
 * same way on both sides (#3839). It is the one label neither side computes —
 * each just propagates its own idea of nothing — which is exactly why it drifted
 * apart for so long without a test to notice.
 *
 * ## Why the reference is the REAL engine, not a copy
 *
 * `driver-sql`, `driver-turso` and `driver-sqlite-wasm` each hand-copy
 * `bucketDateValue` into their bucket suites, because `driver-sql` cannot depend
 * on `objectql`. Those three files say so themselves, and say what it costs: a
 * copy that stops tracking its original leaves the copy and the driver agreeing
 * with each other while both are wrong. The repo's answer is
 * `checkDateBucketParity` (@objectstack/verify), which imports the real
 * `applyInMemoryAggregation` — but it drives a LIVE driver through
 * `create`/`find`/`aggregate`, so `driver-mongodb` cannot join it in this fleet.
 *
 * Measured rather than inherited: `objectql` depends on no driver, so
 * `driver-mongodb → objectql` is acyclic, and as a **devDependency** it does not
 * enter the published package. So this suite imports
 * {@link applyInMemoryAggregation} and {@link bucketDateValue} themselves. The
 * reference side here IS the engine's fallback — the drift the `⚠️ Keep in sync`
 * comments admit they cannot detect does not exist for this driver.
 *
 * ## ⚠️ The bound this suite carries, in full (#5517)
 *
 * **Nothing here has met a real mongod.** This fleet cannot fetch a mongod
 * binary (proxy 403 on the download), so the emitted pipeline is executed by the
 * strict in-process evaluator in `mongodb-pipeline-evaluator.testkit.ts`, whose
 * `$convert` / `$dateToString` / `$concat` / `$switch` / `$lte` semantics are
 * modelled from the MongoDB manual, not observed. What this suite proves is that
 * the LOWERING agrees with the engine under those documented semantics. What it
 * cannot prove is that a real server implements them as documented. That bound
 * is the same one `mongodb-aggregation-translation.test.ts` carries for
 * `$cond`/`$ifNull`/`$addToSet` (#6850/#6814), it is stated on
 * `MongoDBDriver.supports` where the capability is published, and it is why the
 * evaluator models the documentation independently — its ISO-8601 parser and its
 * `%G`/`%V` computation are written from the standard, never delegated to
 * `new Date(...)` or transcribed from `bucketDateValue`, so the two sides CAN
 * disagree and this comparison means something.
 *
 * Two guards against the failure mode a two-implementation comparison invites —
 * both sides sharing one wrong idea:
 *
 *  1. the literal label pins below, which state the required spellings out loud
 *     (`'2025-W01'` for 2024-12-30, `'2024-Q3'` for 2024-07-01) rather than
 *     deriving them from either side;
 *  2. the discrimination block at the bottom, which replays a plausible-but-wrong
 *     lowering (`%Y-%V`, `%G` dropped) through the evaluator and requires it to
 *     FAIL — so "all green" cannot mean "the evaluator says yes to anything".
 */

import { describe, it, expect } from 'vitest';
import { applyInMemoryAggregation, bucketDateValue } from '@objectstack/objectql';
import type { DateGranularityValue } from '@objectstack/spec/data';
import { MongoDBDriver } from './mongodb-driver.js';
import {
  buildAggregationPipeline,
  MONGODB_DATE_GRANULARITIES,
  type AggregationInput,
} from './mongodb-aggregation.js';
import { runPipeline, type Doc } from './mongodb-pipeline-evaluator.testkit.js';

const GRANULARITIES: DateGranularityValue[] = ['day', 'week', 'month', 'quarter', 'year'];

/**
 * The empty bucket's label, chosen so no `String(value)` can produce it — the
 * `checkDateBucketParity` device. A side spelling "empty" as the STRING
 * `'(null)'`, or as `'null'` from stringifying a SQL NULL, lands under its own
 * literal and reads as a different label than the other side's real `null`.
 * Under a plain `String()` those two would compare EQUAL and this suite would
 * bless the divergence.
 */
const EMPTY_LABEL = '‹empty bucket›';

/**
 * The fixture rows, in the storage forms THIS DRIVER writes (ADR-0053, and the
 * canon table in `mongodb-temporal.ts`) — which is the whole storage-form half of
 * this card:
 *
 * - `at` — `Field.datetime`, stored as a BSON `Date`;
 * - `on` — `Field.date`, stored as timezone-naive `YYYY-MM-DD` TEXT;
 * - `tod` — `Field.time`, stored as timezone-naive `HH:MM:SS` TEXT.
 *
 * `at` and `on` name the SAME calendar day on every row, so a granularity that
 * labels them differently is a storage-form leak even when each column is
 * internally consistent — the cross-column pass `checkDateBucketParity` runs.
 *
 * The instants are `checkDateBucketParity`'s own, so this evidence lines up with
 * what the SQL family is held to: they straddle year, quarter, month and ISO-week
 * boundaries (2024-12-30 is 2025-W01) and midnight in both directions. Three
 * rows are added that a live-driver fixture cannot easily carry:
 *
 * - `b8` — an explicit `null` in every temporal column (the empty bucket, #3839);
 * - `b9` — the columns MISSING entirely, which MongoDB distinguishes from null
 *   and `$convert` routes through `onNull` rather than `onError`;
 * - `b10` — unparseable junk, the row that proves the lowering is TOTAL. A
 *   non-total bucket expression fails the whole aggregation on this row where
 *   the engine's fallback answers.
 */
const ROWS: Doc[] = [
  { id: 'b1', at: new Date('2024-01-15T10:00:00.000Z'), on: '2024-01-15', tod: '10:00:00' },
  { id: 'b2', at: new Date('2024-06-30T23:59:59.000Z'), on: '2024-06-30', tod: '23:59:59' },
  { id: 'b3', at: new Date('2024-07-01T00:00:00.000Z'), on: '2024-07-01', tod: '00:00:00' },
  { id: 'b4', at: new Date('2024-12-30T12:00:00.000Z'), on: '2024-12-30', tod: '12:00:00' },
  { id: 'b5', at: new Date('2025-01-01T00:00:00.000Z'), on: '2025-01-01', tod: '00:00:00' },
  { id: 'b6', at: new Date('2025-05-19T09:00:00.000Z'), on: '2025-05-19', tod: '09:00:00' },
  { id: 'b7', at: new Date('2025-05-19T22:30:00.000Z'), on: '2025-05-19', tod: '22:30:00' },
  { id: 'b8', at: null, on: null, tod: null },
  { id: 'b9' },
  { id: 'b10', at: 'not-a-date', on: 'not-a-date', tod: 'not-a-date' },
];

const COUNT: AggregationInput[] = [{ function: 'count', alias: 'n' }];

function astFor(field: string, granularity: DateGranularityValue) {
  return {
    groupBy: [{ field, dateGranularity: granularity }],
    aggregations: [{ function: 'count' as const, alias: 'n' }],
  };
}

/** `{label: count}` from aggregate rows keyed by `field`, empty bucket out of band. */
function labelCounts(rows: any[], field: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows ?? []) {
    const v = row?.[field];
    const key = v == null ? EMPTY_LABEL : String(v);
    out[key] = (out[key] ?? 0) + Number(row?.n ?? 0);
  }
  return out;
}

/** What the DRIVER answers: the emitted pipeline, executed by the strict evaluator. */
function pushedDown(field: string, granularity: DateGranularityValue): Record<string, number> {
  const pipeline = buildAggregationPipeline({
    aggregations: COUNT,
    groupBy: [{ field, dateGranularity: granularity }],
  });
  return labelCounts(runPipeline(ROWS, pipeline as Doc[]), field);
}

/** What the ENGINE answers on the same rows, through its real in-memory fallback. */
function inMemory(field: string, granularity: DateGranularityValue): Record<string, number> {
  return labelCounts(applyInMemoryAggregation(ROWS, astFor(field, granularity) as never), field);
}

// ── The parity contract, per advertised cell ────────────────────────────────

describe('driver-mongodb date buckets match the engine, per advertised granularity × field kind', () => {
  const FIELD_KINDS: Array<{ field: string; storage: string }> = [
    { field: 'at', storage: 'Field.datetime — BSON Date' },
    { field: 'on', storage: 'Field.date — YYYY-MM-DD text' },
    { field: 'tod', storage: 'Field.time — HH:MM:SS text' },
  ];

  for (const { field, storage } of FIELD_KINDS) {
    for (const granularity of GRANULARITIES) {
      it(`${storage} @ ${granularity}`, () => {
        expect(
          MONGODB_DATE_GRANULARITIES[granularity],
          'this suite only covers ADVERTISED cells — an unadvertised one is bucketed in memory by definition',
        ).toBe(true);
        expect(pushedDown(field, granularity)).toEqual(inMemory(field, granularity));
      });
    }
  }

  it('the datetime and date columns describe the same days, so they bucket identically', () => {
    // The storage-form leak `checkDateBucketParity`'s cross-column pass exists
    // for: each column can be internally consistent with its own reference while
    // the two disagree, which is exactly the #3773 shape.
    for (const granularity of GRANULARITIES) {
      const byAt = pushedDown('at', granularity);
      const byOn = pushedDown('on', granularity);
      expect(Object.values(byAt).reduce((a, b) => a + b, 0), granularity).toBe(ROWS.length);
      expect(byAt, granularity).toEqual(byOn);
    }
  });

  it('a Field.time column has no instant, and BOTH paths say so rather than inventing one', () => {
    // `'10:00:00'` is a wall clock, not an instant (#2004) — `new Date('10:00:00')`
    // is an Invalid Date and `$convert` reports a conversion error. Every row
    // therefore lands in the empty bucket on both sides. Asserted explicitly
    // because "the two maps are equal" would also hold if both sides invented
    // the same wrong day, and because it is the measurement that says a `time`
    // field needs no separate refusal: the advertised cell is served, degenerately
    // but faithfully.
    for (const granularity of GRANULARITIES) {
      expect(pushedDown('tod', granularity), granularity).toEqual({ [EMPTY_LABEL]: ROWS.length });
    }
  });

  it('null, MISSING and unparseable share ONE empty bucket, on both sides', () => {
    // Three rows, one bucket — `bucketDateValue` deliberately does not tell them
    // apart (#3839) and neither does the lowering: `onNull` takes the first two,
    // `onError` the third, and all three answer `null`.
    for (const granularity of GRANULARITIES) {
      expect(pushedDown('at', granularity)[EMPTY_LABEL], granularity).toBe(3);
      expect(inMemory('at', granularity)[EMPTY_LABEL], granularity).toBe(3);
    }
  });
});

// ── The label spellings, stated rather than derived ─────────────────────────

describe('the bucket LABELS are the engine spellings, literally', () => {
  /** One instant through the whole lowering, as the single label it produces. */
  function labelOf(instant: Date, granularity: DateGranularityValue): string | null {
    const pipeline = buildAggregationPipeline({
      aggregations: COUNT,
      groupBy: [{ field: 'at', dateGranularity: granularity }],
    });
    const out = runPipeline([{ at: instant, n: 1 }], pipeline as Doc[]);
    expect(out).toHaveLength(1);
    return (out[0].at ?? null) as string | null;
  }

  const CASES: Array<[string, DateGranularityValue, string]> = [
    ['2024-01-15T10:00:00.000Z', 'year', '2024'],
    ['2024-01-15T10:00:00.000Z', 'quarter', '2024-Q1'],
    ['2024-01-15T10:00:00.000Z', 'month', '2024-01'],
    ['2024-01-15T10:00:00.000Z', 'day', '2024-01-15'],
    ['2024-01-15T10:00:00.000Z', 'week', '2024-W03'],
    // Quarter boundaries, both sides of the same midnight.
    ['2024-06-30T23:59:59.000Z', 'quarter', '2024-Q2'],
    ['2024-07-01T00:00:00.000Z', 'quarter', '2024-Q3'],
    ['2024-10-01T00:00:00.000Z', 'quarter', '2024-Q4'],
    // The ISO week-YEAR is not the calendar year: 2024-12-30 is 2025-W01. This
    // is the single most drift-prone label in the set, and the reason a `%Y-W%V`
    // lowering (which would answer '2024-W01') is wrong in a way that only shows
    // up one week a year.
    ['2024-12-30T12:00:00.000Z', 'week', '2025-W01'],
    ['2024-12-30T12:00:00.000Z', 'year', '2024'],
    ['2024-12-30T12:00:00.000Z', 'month', '2024-12'],
    ['2025-01-01T00:00:00.000Z', 'week', '2025-W01'],
    // …and symmetrically, a January instant whose ISO week belongs to the year
    // before: 2027-01-01 is a Friday, so it is 2026-W53.
    ['2027-01-01T00:00:00.000Z', 'week', '2026-W53'],
    ['2027-01-01T00:00:00.000Z', 'year', '2027'],
  ];

  for (const [iso, granularity, expected] of CASES) {
    it(`${iso} @ ${granularity} → ${expected}`, () => {
      expect(labelOf(new Date(iso), granularity)).toBe(expected);
      // …and the engine agrees, which is what makes the literal a contract
      // rather than a transcription of today's output.
      expect(bucketDateValue(new Date(iso), granularity)).toBe(expected);
    });
  }
});

// ── Declared = enforced ─────────────────────────────────────────────────────

describe('the published capability record and the lowering are the same set', () => {
  const driver = new MongoDBDriver({ url: 'mongodb://127.0.0.1:27017/parity-probe' });

  it('MongoDBDriver.supports publishes the builder\'s own record, not a copy', () => {
    // Identity, not equality. Two literals that happen to agree today are the
    // mechanism by which a capability record drifts from the lowering it
    // advertises — and that drift is the one failure worse than advertising
    // nothing, because the engine STOPS bucketing in memory on the strength of
    // the bit and a working query starts answering 501.
    expect(driver.supports.queryDateGranularity).toBe(MONGODB_DATE_GRANULARITIES);
  });

  it('every advertised granularity actually lowers', () => {
    for (const [granularity, advertised] of Object.entries(MONGODB_DATE_GRANULARITIES)) {
      if (advertised !== true) continue;
      expect(
        () =>
          buildAggregationPipeline({
            aggregations: COUNT,
            groupBy: [{ field: 'at', dateGranularity: granularity as DateGranularityValue }],
          }),
        granularity,
      ).not.toThrow();
    }
  });

  it('advertises exactly the five granularities @objectstack/spec declares', () => {
    // MongoDB has both halves of the ISO-8601 week date (`%G`/`%V`), which is why
    // this record carries `week: true` where `driver-sql` on SQLite carries
    // `week: false` — the dialects genuinely differ, and the records say so.
    expect(MONGODB_DATE_GRANULARITIES).toEqual({
      day: true, week: true, month: true, quarter: true, year: true,
    });
    expect(Object.keys(MONGODB_DATE_GRANULARITIES).sort()).toEqual([...GRANULARITIES].sort());
  });
});

// ── Timezones stay engine-side ──────────────────────────────────────────────

describe('the pushdown is UTC, which is the only thing it could be', () => {
  it('the builder takes no timezone, and the engine never pushes a non-UTC bucket down', () => {
    // ADR-0053 Phase 2 (D2), pinned engine-side by
    // `engine-aggregate-timezone.test.ts`: `engine.aggregate` forces the
    // in-memory path whenever a non-UTC reference zone meets a date bucket, and
    // the AST it hands a driver carries no `timezone` key at all. So this
    // lowering cannot be asked for a zoned bucket — measured here rather than
    // assumed, by showing that the zoned label for a straddling instant is a
    // DIFFERENT label, i.e. that a driver silently answering the UTC one would
    // be answering the wrong question.
    const straddling = new Date('2024-03-01T03:00:00.000Z'); // NY: 2024-02-29
    expect(bucketDateValue(straddling, 'day')).toBe('2024-03-01');
    expect(bucketDateValue(straddling, 'day', 'America/New_York')).toBe('2024-02-29');

    const pipeline = buildAggregationPipeline({
      aggregations: COUNT,
      groupBy: [{ field: 'at', dateGranularity: 'day' }],
    });
    const out = runPipeline([{ at: straddling, n: 1 }], pipeline as Doc[]);
    expect(out[0].at).toBe('2024-03-01');
    // Nothing in the emitted pipeline names a zone, so there is no seam through
    // which one could be half-applied.
    expect(JSON.stringify(pipeline)).not.toContain('timezone');
  });
});

// ── The evaluator is not the thing being tested, so it gets tested ──────────

describe('the evaluator discriminates on the date operators too', () => {
  it('the plausible-but-wrong ISO week lowering (%Y instead of %G) FAILS the year-boundary row', () => {
    // The bug this suite exists to make impossible: `%Y-W%V` looks right, agrees
    // with `%G-W%V` on 51 weeks of the year, and mislabels the week that spans
    // New Year — exactly the row `checkDateBucketParity`'s fixture carries.
    const wrong = [
      {
        $group: {
          _id: {
            at: {
              $dateToString: {
                format: '%Y-W%V',
                date: { $convert: { input: '$at', to: 'date', onError: null, onNull: null } },
              },
            },
          },
          n: { $sum: 1 },
        },
      },
      { $project: { _id: 0, at: '$_id.at', n: 1 } },
    ];
    const out = runPipeline([{ at: new Date('2024-12-30T12:00:00.000Z') }], wrong as Doc[]);
    expect(out[0].at).toBe('2024-W01');
    expect(out[0].at).not.toBe(bucketDateValue(new Date('2024-12-30T12:00:00.000Z'), 'week'));
  });

  it('refuses a date operator handed something that is not a date', () => {
    // Without the `$convert` step a text-stored `Field.date` column reaches
    // `$dateToString` as a STRING. A real mongod raises; an evaluator that
    // quietly coerced would bless a lowering that fails in production on two of
    // the three declared temporal kinds.
    expect(() =>
      runPipeline([{ on: '2024-01-15' }], [
        { $group: { _id: { on: { $dateToString: { format: '%Y', date: '$on' } } }, n: { $sum: 1 } } },
      ] as Doc[]),
    ).toThrow(/the lowering must convert first/);
  });

  it('parses ISO-8601 by its own grammar, so it CAN disagree with new Date()', () => {
    // The property that makes every comparison above meaningful. JS accepts a
    // space separator; ISO-8601 (and therefore `$dateFromString`) does not — so
    // the residual divergence `instantOf` documents shows up as a difference
    // here instead of being absorbed by a shared parser.
    const legacy = '2024-01-15 10:00:00';
    expect(Number.isNaN(new Date(legacy).getTime())).toBe(false); // JS parses it
    const pipeline = buildAggregationPipeline({
      aggregations: COUNT,
      groupBy: [{ field: 'at', dateGranularity: 'day' }],
    });
    expect(runPipeline([{ at: legacy, n: 1 }], pipeline as Doc[])[0].at ?? null).toBeNull();
    // Not a form this driver ever WRITES — `coerceTemporalValue` canonicalises a
    // `datetime` to a BSON Date and a `date` to `YYYY-MM-DD` — so this is the
    // pre-#4047 legacy-row exposure, recorded rather than papered over. (The
    // engine's exact label for it depends on the host zone, since JS reads a
    // zone-naive legacy string as LOCAL time; that it produces one at all is the
    // divergence.)
    expect(bucketDateValue(legacy, 'day')).not.toBeNull();
  });
});
