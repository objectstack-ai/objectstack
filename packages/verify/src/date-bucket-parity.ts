// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Date-bucket parity conformance — a reusable, driver-agnostic check.
 *
 * A driver that advertises `supports.queryDateGranularity[g]` is telling
 * `engine.aggregate` it may push `dateGranularity: g` down as SQL instead of
 * fetching rows and bucketing them in JS. The two must then be
 * interchangeable: **the same rows bucketed either way must carry the same
 * labels.** They are not two features, they are one feature with two
 * implementations, and the engine picks between them per query — a granularity
 * the driver advertises goes down as SQL, one it does not goes to
 * `applyInMemoryAggregation`, and a non-UTC timezone forces the in-memory path
 * regardless. A dashboard can cross that seam mid-drill-down.
 *
 * "Same labels" includes the EMPTY bucket: a row with no instant must key the
 * same way on both sides (#3839). It is the one label neither side computes —
 * each just propagates its own idea of nothing — which is exactly why it drifted
 * apart for so long without a test to notice.
 *
 * This is the invariant #3773 broke and nothing caught. SQLite stores a
 * `Field.datetime` as INTEGER epoch milliseconds; `strftime` read the bare
 * integer as a Julian day number, so every row bucketed as NULL and a trend
 * chart collapsed into one bar. The driver's own suites were green because
 * their fixtures built tables with `knex.schema.createTable` + `t.string(...)`
 * — ISO TEXT, the half `strftime` parses natively — and the engine never
 * second-guesses a granularity a driver claims to support.
 *
 * The reference side imports the REAL `applyInMemoryAggregation`. Three test
 * files carry a hand-copied `bucketDateValue` for self-containment (driver-sql
 * cannot depend on objectql), and a hand copy that stops tracking its original
 * is the failure mode those `⚠️ Keep in sync` comments cannot detect: the copy
 * and the SQL agree with each other, and both are wrong. This check is the one
 * place the two implementations meet for real.
 *
 * Like {@link checkReadCoercion}, it returns human-readable problems (empty =
 * conformant) and carries NO test-runner dependency, so an out-of-tree driver —
 * cloud's `driver-turso`, which is remote SQLite with the same epoch storage —
 * runs the identical contract against itself.
 */

import { applyInMemoryAggregation } from '@objectstack/objectql';

/** The minimal driver surface this check drives. */
export interface BucketableDriver {
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
  syncSchema(object: string, schema: unknown, options?: unknown): Promise<void>;
  create(object: string, data: Record<string, unknown>, options?: unknown): Promise<unknown>;
  find(object: string, query: unknown, options?: unknown): Promise<any[]>;
  aggregate(object: string, query: unknown, options?: unknown): Promise<any[]>;
  supports?: { queryDateGranularity?: Record<string, boolean> };
}

export interface DateBucketParityOptions {
  /** Object/table name to create for the probe. Default `date_bucket_probe`. */
  object?: string;
  /** Extra options threaded to `create` (e.g. `{ bypassTenantAudit: true }`). */
  createOptions?: unknown;
}

type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'year';

const GRANULARITIES: Granularity[] = ['day', 'week', 'month', 'quarter', 'year'];

/**
 * Both temporal storage forms under one probe: `at` is a `Field.datetime`
 * (epoch-stored on SQLite), `on` is a `Field.date` (ISO TEXT everywhere). Each
 * row's two columns name the same calendar day, so any granularity must label
 * them identically — a divergence between the columns is a storage-form leak.
 */
const FIELDS = {
  at: { type: 'datetime' },
  on: { type: 'date' },
  n: { type: 'number' },
} as const;

/**
 * Instants chosen to straddle every boundary the labels encode: year, quarter,
 * month, ISO week (2024-12-30 is 2025-W01), and midnight in both directions —
 * plus, at the end, a NULL instant.
 *
 * That last row is here deliberately (#3839), and it used to be deliberately
 * absent: the two paths disagreed about how to SPELL "empty" — SQL NULL against
 * the in-memory literal `'(null)'` — so including it would have failed this
 * check for a reason it is not about. That divergence is closed; both sides now
 * key the empty bucket as real `null`. The row belongs here precisely because
 * the convergence is the kind that decays silently: nothing else compares the
 * two paths on a null input, and either side could drift back to a sentinel
 * without a single existing test noticing.
 */
const FIXTURE: ReadonlyArray<{ id: string; iso: string | null }> = [
  { id: 'b1', iso: '2024-01-15T10:00:00.000Z' }, // 2024 / Q1 / Jan / W03
  { id: 'b2', iso: '2024-06-30T23:59:59.000Z' }, // last instant of Q2
  { id: 'b3', iso: '2024-07-01T00:00:00.000Z' }, // first instant of Q3
  { id: 'b4', iso: '2024-12-30T12:00:00.000Z' }, // Dec 2024, but ISO week 2025-W01
  { id: 'b5', iso: '2025-01-01T00:00:00.000Z' }, // exact midnight, year boundary
  { id: 'b6', iso: '2025-05-19T09:00:00.000Z' },
  { id: 'b7', iso: '2025-05-19T22:30:00.000Z' }, // same day bucket as b6
  { id: 'b8', iso: null }, // the empty bucket — both paths must key it `null`
];

/**
 * The empty bucket's label, chosen so no `String(value)` can produce it. That is
 * what makes a sentinel visible: a side spelling "empty" as the STRING
 * `'(null)'`, or as `'null'` from stringifying SQL NULL, lands under its own
 * literal and reads as a different label than the other side's real `null`.
 * Under a plain `String()` the two would have compared equal in one of those
 * cases and this check would have blessed the divergence.
 */
const EMPTY_LABEL = '‹empty bucket›';

/**
 * `{label: count}` from aggregate rows keyed by `field`.
 *
 * A missing property counts as empty alongside `null`: a driver that omits the
 * key for a null group is describing the same bucket, and JSON round-tripping
 * turns one into the other anyway.
 */
function labelCounts(rows: any[], field: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows ?? []) {
    const v = row?.[field];
    out[v == null ? EMPTY_LABEL : String(v)] = Number(row?.n ?? 0);
  }
  return out;
}

/**
 * Order-insensitive canonical form. Row ORDER is not part of this contract —
 * `engine.aggregate` promises no ordering without an explicit `orderBy`, and the
 * two paths naturally differ (SQL sorts its groups, the in-memory path emits
 * first-seen order). Comparing the raw objects with `JSON.stringify` made key
 * INSERTION order significant, so a driver whose buckets were entirely correct
 * but ordered differently was reported as a disagreement — with an empty diff
 * message, because {@link describeDiff} is keyed and could not name one.
 */
function canonical(counts: Record<string, number>): string {
  return JSON.stringify(Object.keys(counts).sort().map((k) => [k, counts[k]]));
}

function describeDiff(a: Record<string, number>, b: Record<string, number>): string {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys
    .filter((k) => a[k] !== b[k])
    .map((k) => `${k}: sql=${a[k] ?? '—'} in-memory=${b[k] ?? '—'}`)
    .join(', ');
}

/**
 * For every granularity the driver ADVERTISES, bucket the probe both ways and
 * report any disagreement. Empty array = conformant.
 *
 * A granularity the driver does not advertise is skipped rather than probed:
 * the engine routes it to the in-memory path by definition, so whether the
 * driver could also have done it is not part of this contract.
 */
export async function checkDateBucketParity(
  driver: BucketableDriver,
  opts: DateBucketParityOptions = {},
): Promise<string[]> {
  const object = opts.object ?? 'date_bucket_probe';
  const problems: string[] = [];

  await driver.connect?.();
  try {
    await driver.syncSchema(object, { name: object, fields: FIELDS });
    for (const { id, iso } of FIXTURE) {
      // A real `Date` for the datetime column — the shape every normal write
      // takes, and the one that produces epoch storage on SQLite. A null instant
      // is written as NULL to both columns, so the empty bucket is reached the
      // way a real record reaches it: an unset field, not a magic value.
      await driver.create(
        object,
        { id, at: iso === null ? null : new Date(iso), on: iso === null ? null : iso.slice(0, 10), n: 1 },
        opts.createOptions,
      );
    }

    // The rows the in-memory path would see: whatever `find()` presents. Using
    // the driver's own read output (rather than the fixture) is deliberate —
    // that IS what `engine.aggregate` feeds `applyInMemoryAggregation` when it
    // falls back, so a driver whose read form disagrees with its bucket form is
    // exactly what this should catch.
    const rows = await driver.find(object, { object, where: { id: { $in: FIXTURE.map((f) => f.id) } } });
    if (!Array.isArray(rows) || rows.length !== FIXTURE.length) {
      problems.push(
        `find returned ${Array.isArray(rows) ? `${rows.length} rows` : typeof rows}, expected ${FIXTURE.length} — cannot compare bucketing`,
      );
      return problems;
    }

    const caps = driver.supports?.queryDateGranularity ?? {};

    for (const field of ['at', 'on'] as const) {
      const storage = field === 'at' ? 'Field.datetime' : 'Field.date';
      for (const granularity of GRANULARITIES) {
        if (caps[granularity] !== true) continue; // engine routes this in-memory

        const ast = {
          object,
          groupBy: [{ field, dateGranularity: granularity }],
          aggregations: [{ function: 'count', alias: 'n' }],
        };

        let pushedDown: any[];
        try {
          pushedDown = await driver.aggregate(object, ast);
        } catch (err) {
          problems.push(
            `${storage} '${field}' @ ${granularity}: driver advertises this granularity but aggregate() threw: ${(err as Error)?.message ?? err}`,
          );
          continue;
        }

        const sql = labelCounts(pushedDown, field);
        const inMemory = labelCounts(applyInMemoryAggregation(rows, ast as never), field);

        if (canonical(sql) !== canonical(inMemory)) {
          problems.push(
            `${storage} '${field}' @ ${granularity}: pushed-down SQL and in-memory bucketing disagree — ${describeDiff(sql, inMemory)}`,
          );
        }
      }
    }

    // Both columns describe the same calendar days, so a granularity that
    // labels them differently is a storage-form leak even when each side is
    // internally consistent with its own in-memory reference.
    for (const granularity of GRANULARITIES) {
      if (caps[granularity] !== true) continue;
      const mk = (field: 'at' | 'on') =>
        driver.aggregate(object, {
          object,
          groupBy: [{ field, dateGranularity: granularity }],
          aggregations: [{ function: 'count', alias: 'n' }],
        });
      try {
        const [byAt, byOn] = await Promise.all([mk('at'), mk('on')]);
        const a = labelCounts(byAt, 'at');
        const b = labelCounts(byOn, 'on');
        if (canonical(a) !== canonical(b)) {
          problems.push(
            `@ ${granularity}: the datetime and date columns describe the same days but bucket differently — ${describeDiff(a, b)}`,
          );
        }
      } catch {
        // Already reported by the per-column pass above.
      }
    }
  } finally {
    await driver.disconnect?.();
  }

  return problems;
}
