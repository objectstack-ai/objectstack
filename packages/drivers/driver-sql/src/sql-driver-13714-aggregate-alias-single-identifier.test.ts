// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#13714 — an aggregate ALIAS is one identifier, never a qualified
 * reference.
 *
 * ## The field report, and what it actually measured
 *
 * A running showcase deployment (better-sqlite3) reported:
 *
 * ```
 * POST /api/v1/analytics/query
 * { "cube": "showcase_delivery",
 *   "measures": ["showcase_delivery.count"],
 *   "timeDimensions": [{ "dimension": "showcase_delivery.due_date",
 *                        "granularity": "month" }] }
 * → 500 DATABASE_ERROR
 * ```
 *
 * with controls from the same session that SUCCEED: the same measure by
 * `dimensions: ["showcase_delivery.status"]` → 200 with buckets reconciling
 * against `/data`, a second measure by status → 200, and malformed bodies → 400
 * at the entry validator. The filer's hypothesis was a date-truncation SQL
 * emission problem on the granularity clause.
 *
 * ⚠️ That hypothesis is FALSIFIED, and the disproof is the whole point of this
 * suite. Measured on `origin/main` `62a137bae`, better-sqlite3, one driver, two
 * axes crossed:
 *
 * ```
 * alias 'n',                       granularity day/month/quarter/year → OK
 * alias 'showcase_delivery.count', NO granularity at all              → 500
 * alias 'showcase_delivery.count', granularity month                  → 500
 *
 *   select strftime('%Y-%m', `due_date`) as `due_date`,
 *          count(*) as `showcase_delivery`.`count`
 *     from `zz_repro_task` group by strftime('%Y-%m', `due_date`)
 *     - near ".": syntax error
 * ```
 *
 * The bucket expression is FINE on every row of that table. What the backend
 * refuses is the ALIAS: knex's `??` binding does not quote an identifier, it
 * PARSES one — `wrapString` splits on `.` into `table.column` and re-quotes each
 * segment — so a dotted alias compiled into a qualified reference in the alias
 * position. See {@link SqlDriver.aliasIdentifierSql} for the fix and why
 * `client.wrapIdentifier` is the same function knex itself calls per segment.
 *
 * ## Why the granularity is the ROUTER, not the fault
 *
 * Every analytics measure is named `<cube>.<measure>` on the wire and
 * `ObjectQLStrategy` uses that name verbatim as the aggregation `alias` — it is
 * the key the caller reads its own number back under. So every cube query
 * reaching THIS face carries a dotted alias. It only shows under a granularity
 * because `NativeSQLStrategy.canHandle` declines exactly on
 * `timeDimensions[].granularity` (native-sql-strategy.ts) and that face
 * hand-writes `AS "<measure>"` — one quoted identifier, already correct. So the
 * reported controls are 200 because they never reach this door, and the bucketed
 * query is a 500 because it does. That fork is pinned end to end, over HTTP,
 * by `packages/qa/dogfood/test/analytics-cube-timedimension-granularity.dogfood.test.ts`.
 *
 * ## Why the existing date-bucket pins are green while production 500s
 *
 * `#3773 date-bucket-parity` and `#3839 empty-group-parity` compare the pushed
 * down bucket against `applyInMemoryAggregation`. Their reference side keys rows
 * by the alias as a plain JS object key, where a dot is inert, and their probe
 * aliases are bare names — so the one input that breaks the SQL face is the one
 * input they never supply. They are a DECLARED CONTROL for this card (they must
 * stay green), not evidence about it.
 *
 * ## The dialect question, answered structurally
 *
 * `wrapString`'s split lives in knex's shared formatter, not in a dialect, so
 * the defect is dialect-independent by construction — and this suite runs the
 * whole matrix through {@link declareDialectCell} rather than asserting that
 * from the source: SQLite runs embedded, Postgres and MySQL run live when
 * provisioned and are reported as a NAMED UNPROVISIONED CELL otherwise (never a
 * silent skip). What each dialect quotes with differs (`"` on Postgres,
 * backticks on MySQL/SQLite) and that is exactly what a per-cell run measures.
 *
 * ## Every granularity, not just `month`
 *
 * The report names `month`; the impact statement names month/week/day together.
 * A pin on `month` alone leaves the rest open, so the sweep below is driven by
 * `DateGranularity.options` — the spec's own list — and a granularity the spec
 * grows joins it without an edit here.
 *
 * ⚠️ A dialect that does not bucket a granularity natively (SQLite + `week`,
 * which is capped in `dateGranularityCapabilities` because `%V` needs SQLite
 * 3.46) is NOT a failure and is asserted as its own declared answer: the #6212
 * `NOT_IMPLEMENTED`/501 capability refusal, which `engine.aggregate` reads off
 * `supports.queryDateGranularity` and serves in memory instead. The invariant
 * that spans both answers is the one this card is about: no shape answers
 * `DATABASE_ERROR`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DateGranularity } from '@objectstack/spec/data';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'alias_ident_task';

/**
 * The wire spelling of an analytics measure — `<cube>.<measure>` — used verbatim
 * as the aggregation alias by `ObjectQLStrategy`. The dot is the whole defect.
 */
const CUBE_QUALIFIED_MEASURE = 'showcase_delivery.count';
const CUBE_QUALIFIED_DIMENSION = 'showcase_delivery.due_date';

/** Two months, so a `month` bucket that works has something to separate. */
const ROWS = [
  { id: 'a1', status: 'open', due_date: '2026-01-15', closed_at: '2026-01-15T10:00:00.000Z', hours: 2 },
  { id: 'a2', status: 'open', due_date: '2026-01-20', closed_at: '2026-01-20T10:00:00.000Z', hours: 3 },
  { id: 'a3', status: 'done', due_date: '2026-02-05', closed_at: '2026-02-05T10:00:00.000Z', hours: 4 },
];

async function caught(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  return null;
}

function declareSweep(cell: DialectCell): void {
describe(`[#13714] driver-sql — an aggregate alias is ONE identifier (${cell.label})`, () => {
  let driver: SqlDriver;
  /** What this dialect PUBLISHES, which is what the engine dispatches on. */
  let caps: Record<string, boolean>;

  beforeAll(async () => {
    driver = new SqlDriver(cell.config());
    await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver.initObjects([
      {
        name: TABLE,
        fields: {
          status: { type: 'string' },
          due_date: { type: 'date' },
          closed_at: { type: 'datetime' },
          hours: { type: 'number' },
        },
      },
    ] as never);
    for (const row of ROWS) await driver.create(TABLE, { ...row }, { bypassTenantAudit: true } as never);
    caps = ((driver as unknown as { supports: { queryDateGranularity?: Record<string, boolean> } })
      .supports.queryDateGranularity ?? {});
  });

  afterAll(async () => {
    await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver.disconnect();
  });

  // ───────────────────────────────────────────────────────────────
  // THE CARD — the reported shape, for EVERY granularity the spec declares
  // ───────────────────────────────────────────────────────────────

  for (const granularity of DateGranularity.options) {
    it(`granularity '${granularity}' with a cube-qualified measure alias is SERVED, not a DATABASE_ERROR`, async () => {
      const query = {
        groupBy: [{ field: 'due_date', dateGranularity: granularity }],
        aggregations: [{ function: 'count', alias: CUBE_QUALIFIED_MEASURE }],
      } as unknown as DriverQuery;

      const err = await caught(() => driver.aggregate(TABLE, query));

      // ⛔ The one answer this card forbids on every cell, whether or not this
      // dialect buckets this granularity: a backend fault for a query that is
      // spelled correctly.
      expect(err?.code, `${granularity}: must not be a backend fault`).not.toBe('DATABASE_ERROR');

      if (caps[granularity] !== true) {
        // The declared capability gap (#6212). `engine.aggregate` never sends
        // this granularity here — it reads the same record and buckets in
        // memory — so this is the DIRECT-caller answer, and it is a refusal
        // about the BACKEND, never about the request.
        expect(err?.code, `${granularity}: declined natively → the #6212 refusal`).toBe('NOT_IMPLEMENTED');
        expect(err?.status).toBe(501);
        return;
      }

      expect(err, `${granularity}: served natively, so nothing may throw`).toBeNull();
      const rows = (await driver.aggregate(TABLE, query)) as Array<Record<string, unknown>>;

      // The alias arrives as ONE column, spelled exactly as the caller wrote
      // it. Before the fix the statement never ran at all; a compiled
      // `as "showcase_delivery"."count"` would also have keyed the row under
      // `count`, which is the silent half of the same defect.
      for (const row of rows) {
        expect(Object.keys(row), `${granularity}: the caller's own key`).toContain(CUBE_QUALIFIED_MEASURE);
      }
      const total = rows.reduce((sum, r) => sum + Number(r[CUBE_QUALIFIED_MEASURE] ?? 0), 0);
      expect(total, `${granularity}: every row counted exactly once`).toBe(ROWS.length);
    });
  }

  it("the buckets are the RIGHT buckets — 'month' separates the two months", async () => {
    if (caps.month !== true) return; // asserted as the 501 above on such a cell
    const rows = (await driver.aggregate(TABLE, {
      groupBy: [{ field: 'due_date', dateGranularity: 'month' }],
      aggregations: [{ function: 'count', alias: CUBE_QUALIFIED_MEASURE }],
    } as unknown as DriverQuery)) as Array<Record<string, unknown>>;

    const byBucket = new Map(rows.map((r) => [String(r.due_date), Number(r[CUBE_QUALIFIED_MEASURE])]));
    expect(byBucket.get('2026-01')).toBe(2);
    expect(byBucket.get('2026-02')).toBe(1);
  });

  // ───────────────────────────────────────────────────────────────
  // THE FAULT IS THE ALIAS, NOT THE BUCKET — the axis the card turns on
  // ───────────────────────────────────────────────────────────────

  it('a cube-qualified alias with NO granularity at all is served too', async () => {
    // This is the shape that proves the granularity is a ROUTER: it carries no
    // date bucket whatsoever and it failed identically before the fix. A repair
    // aimed at `buildDateBucketExpr` would leave this red.
    const rows = (await driver.aggregate(TABLE, {
      groupBy: ['status'],
      aggregations: [{ function: 'count', alias: CUBE_QUALIFIED_MEASURE }],
    } as unknown as DriverQuery)) as Array<Record<string, unknown>>;

    expect(rows.map((r) => Number(r[CUBE_QUALIFIED_MEASURE])).sort()).toEqual([1, 2]);
  });

  it('a cube-qualified groupBy ALIAS projects one column as well', async () => {
    // `GroupByNodeSchema.alias` (#6401) is the twin alias position on this door,
    // and it broke the same way. Bucketed, because that is where a dashboard
    // actually writes one.
    if (caps.month !== true) return;
    const rows = (await driver.aggregate(TABLE, {
      groupBy: [{ field: 'due_date', alias: CUBE_QUALIFIED_DIMENSION, dateGranularity: 'month' }],
      aggregations: [{ function: 'count', alias: 'n' }],
    } as unknown as DriverQuery)) as Array<Record<string, unknown>>;

    expect(rows.map((r) => String(r[CUBE_QUALIFIED_DIMENSION])).sort()).toEqual(['2026-01', '2026-02']);
  });

  it('an UNBUCKETED cube-qualified groupBy alias projects one column too', async () => {
    const rows = (await driver.aggregate(TABLE, {
      groupBy: [{ field: 'status', alias: 'showcase_delivery.status' }],
      aggregations: [{ function: 'count', alias: 'n' }],
    } as unknown as DriverQuery)) as Array<Record<string, unknown>>;

    expect(rows.map((r) => String(r['showcase_delivery.status'])).sort()).toEqual(['done', 'open']);
  });

  it('an alias containing " as " is one column, not a value plus a second alias', async () => {
    // knex's `wrapString` splits on a literal `" as "` before it splits on `.`,
    // so this is the second half of "the binding PARSES rather than quotes".
    const alias = 'hours as billed';
    const rows = (await driver.aggregate(TABLE, {
      aggregations: [{ function: 'sum', field: 'hours', alias }],
    } as unknown as DriverQuery)) as Array<Record<string, unknown>>;

    expect(Object.keys(rows[0])).toEqual([alias]);
    expect(Number(rows[0][alias])).toBe(9);
  });

  // ───────────────────────────────────────────────────────────────
  // THE CONTROLS — what must NOT move
  // ───────────────────────────────────────────────────────────────

  it('a bare alias is unchanged — same column name, same numbers', async () => {
    const rows = (await driver.aggregate(TABLE, {
      groupBy: ['status'],
      aggregations: [{ function: 'count', alias: 'n' }, { function: 'sum', field: 'hours', alias: 'total' }],
    } as unknown as DriverQuery)) as Array<Record<string, unknown>>;

    const byStatus = new Map(rows.map((r) => [String(r.status), r]));
    expect(Number(byStatus.get('open')!.n)).toBe(2);
    expect(Number(byStatus.get('open')!.total)).toBe(5);
    expect(Number(byStatus.get('done')!.n)).toBe(1);
    expect(Number(byStatus.get('done')!.total)).toBe(4);
  });

  it('an alias EQUAL to the field still emits no self-rename', async () => {
    // The `outKey === g.field` shortcut is deliberately untouched by the fix;
    // rewriting `select "status"` into `select "status" as "status"` would be a
    // gratuitous statement change on every dialect.
    const rows = (await driver.aggregate(TABLE, {
      groupBy: [{ field: 'status', alias: 'status' }],
      aggregations: [{ function: 'count', alias: 'n' }],
    } as unknown as DriverQuery)) as Array<Record<string, unknown>>;

    expect(rows.map((r) => String(r.status)).sort()).toEqual(['done', 'open']);
  });

  it('a column REFERENCE may still be qualified — only the alias is one name', async () => {
    // ⛔ The fence. `field` goes on being a `??` binding, so a qualified
    // reference still resolves; "quote the whole string" applied to references
    // would break every legitimate `table.column` this driver emits.
    const rows = (await driver.aggregate(TABLE, {
      groupBy: [`${TABLE}.status`],
      aggregations: [{ function: 'count', alias: CUBE_QUALIFIED_MEASURE }],
    } as unknown as DriverQuery)) as Array<Record<string, unknown>>;

    expect(rows.map((r) => Number(r[CUBE_QUALIFIED_MEASURE])).sort()).toEqual([1, 2]);
  });
});
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, '#13714 aggregate alias identity', declareSweep);
}
