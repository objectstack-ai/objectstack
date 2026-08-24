// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#11541 — the #8790 unresolvable-column refusal reaches the THIRD
 * read door, attributed to the clause the caller's own query names.
 *
 * ## The five-row probe this card was filed from
 *
 * Measured on the #11455 branch (and re-measured on `main` at 4e786cd8eb while
 * implementing this card — identical), embedded SQLite:
 *
 * ```
 * find   where nosuchcol   => INVALID_FILTER  400   "Filter on 'nosuchcol' …"
 * count  where nosuchcol   => INVALID_FILTER  400   (identical message)
 * agg    where nosuchcol   => DATABASE_ERROR  500   (the generic terminal)
 * agg    avg(nosuchcol)    => DATABASE_ERROR  500
 * agg    groupBy nosuchcol => DATABASE_ERROR  500
 * ```
 *
 * The first two rows are #8790's ruled answer (maintainer, 2026-08-15: one
 * unresolvable WHERE column, one answer, on both read halves, naming the
 * column). `aggregate()` never received the arm — and #11455 deliberately did
 * not add it, because a BLANKET arm would tell the author of `avg('nosuchcol')`
 * that their FILTER was wrong: the unsupportable attribution the #8931 ruling
 * (2026-08-17 「同意 C」) refuses to make.
 *
 * ## The fix this suite pins — attribution from the caller's own query
 *
 * `SqlDriver.aggregateBackendFault` reads the dialect-named column back
 * against the query AST the statement was built from:
 *
 * 1. named by a `groupBy` field or an aggregation `field` ⇒ `INVALID_FIELD` /
 *    400 naming that clause and the column;
 * 2. named by neither ⇒ the WHERE (the statement's only other column source),
 *    so #8790's `unresolvableFilterColumnRefusal` applies verbatim;
 * 3. `unresolvableColumnNameOf` answers `null` ⇒ no attribution is
 *    supportable, so the #11455 terminal envelope stands unchanged.
 *
 * ## Why `INVALID_FIELD` and not `INVALID_QUERY` — read off the repo, not chosen
 *
 * The protocol ingress refuses THIS condition one layer up with exactly this
 * code: `assertGroupByFieldsExist` / `assertAggregationFieldsExist`
 * (`@objectstack/metadata-protocol`, #4254) answer a grouping/aggregation
 * target the object does not have with `400 INVALID_FIELD` + `field` +
 * `object`, reserving `INVALID_QUERY` for entries the spec cannot READ. One
 * condition refused at two layers must not carry two codes — the rule the
 * #8790 WHERE refusal already applied when it took the ingress door's
 * `INVALID_FILTER`. #5907's `INVALID_QUERY` on this door is about a FUNCTION
 * name the protocol does not declare — a query no backend can run — where a
 * missing column is a query that answers rows the moment schema sync runs.
 * No code is minted (ADR-0112 D3/D4): `INVALID_FIELD` is a standard-catalog
 * member and already the write path's answer for an unknown column.
 *
 * ## What this suite deliberately does NOT decide
 *
 * Nothing here touches #11152 / #11249 (whether a boolean aggregate answers a
 * number or refuses) — this card is about a column that does not exist on any
 * type. And the terminal's own pins live in
 * `sql-driver-11455-aggregate-fault-envelope.test.ts`, unchanged: an error the
 * classifier does not claim still leaves as `DATABASE_ERROR` / 500.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, dialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'agg_unres_task';
const MISSING_TABLE = 'agg_unres_never_created';

/**
 * The caller's bound value, distinctive on purpose: the dialect text inlines
 * it on SQLite and MySQL, so its absence from every caller-visible surface is
 * what pins the redaction rather than merely the status code.
 */
const SECRET_LITERAL = 'zz-agg-unres-must-not-leak';

/** An alias distinctive enough that "the message names the COLUMN, not the
 *  alias" is assertable without matching accidental substrings. */
const DISTINCTIVE_ALIAS = 'zz_output_alias';

async function caught(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  return expect.fail('expected the query to be refused, but it resolved');
}

/** Capture the driver's server-log line for one call. */
async function withLog(
  driver: SqlDriver,
  run: () => Promise<unknown>,
): Promise<{ err: any; logged: string[] }> {
  const logged: string[] = [];
  const sink = { warn: (m: string) => logged.push(String(m)), info: () => {}, error: () => {} };
  const original = (driver as unknown as { logger: unknown }).logger;
  (driver as unknown as { logger: unknown }).logger = sink;
  try {
    return { err: await caught(run), logged };
  } finally {
    (driver as unknown as { logger: unknown }).logger = original;
  }
}

/**
 * The disclosure clause on one caller-visible message — the #8931 suites'
 * negative-set-plus-positive-anchor shape, so an emptied message cannot
 * satisfy it trivially.
 */
function expectNoStatementShape(message: string, object: string, label: string): void {
  expect(message, `${label}: no compiled statement`).not.toMatch(/\bselect\s/i);
  expect(message, `${label}: no positional placeholder`).not.toMatch(/\$\d/);
  expect(message, `${label}: no quoted physical reference`).not.toMatch(/["`]/);
  expect(message, `${label}: no bound literal`).not.toContain(SECRET_LITERAL);
  expect(message, `${label}: the caller is still told which object refused`).toContain(object);
}

function declareSweep(cell: DialectCell): void {
describe(`[#11541] driver-sql — aggregate() attributes an unresolvable column (${cell.label})`, () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver(cell.config());
    await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver.initObjects([
      { name: TABLE, fields: { title: { type: 'string' }, rank: { type: 'integer' } } },
    ]);
    await driver.create(TABLE, { id: 't1', title: 'Design', rank: 1 }, { bypassTenantAudit: true });
    await driver.create(TABLE, { id: 't2', title: 'Build', rank: 3 }, { bypassTenantAudit: true });
  });

  afterAll(async () => {
    await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver.disconnect();
  });

  // ───────────────────────────────────────────────────────────────
  // THE PROBE TABLE — five rows, three doors, one class of answer
  // ───────────────────────────────────────────────────────────────

  const WHERE_NOSUCHCOL: NonNullable<DriverQuery['where']> = { nosuchcol: SECRET_LITERAL };

  it('rows 1-2: find() and count() still answer the #8790 refusal — the baseline this door joins', async () => {
    for (const [half, run] of [
      ['find', () => driver.find(TABLE, { where: WHERE_NOSUCHCOL })],
      ['count', () => driver.count(TABLE, { where: WHERE_NOSUCHCOL })],
    ] as const) {
      const err = await caught(run);
      expect(err.code, `${half}: code`).toBe('INVALID_FILTER');
      expect(err.status, `${half}: status`).toBe(400);
      expect(String(err.message), `${half}: names the column`).toContain('nosuchcol');
    }
  });

  // ⭐ ROW 3 — the WHERE arm, verbatim. Same predicate, same refusal, whichever
  // of the three read doors asked: the split the card measured was a list
  // view's find()/count() saying "'nosuchcol' is not a column" while the
  // dashboard tile over the same object answered an opaque 500.
  it('row 3: aggregate() with the same unresolvable WHERE answers the #8790 refusal VERBATIM', async () => {
    const onFind = await caught(() => driver.find(TABLE, { where: WHERE_NOSUCHCOL }));
    const onAggregate = await caught(() =>
      driver.aggregate(TABLE, {
        where: WHERE_NOSUCHCOL,
        aggregations: [{ function: 'count', alias: 'n' }],
      }),
    );
    expect({ code: onAggregate.code, status: onAggregate.status, message: onAggregate.message })
      .toEqual({ code: onFind.code, status: onFind.status, message: onFind.message });
  });

  // ⭐ ROW 4 — the aggregation arm. Before this card: DATABASE_ERROR / 500.
  // A blanket #8790 arm would have said the FILTER was wrong — the #8931
  // fence — so the refusal names the clause the caller's own query names.
  it('row 4: avg(nosuchcol) refuses INVALID_FIELD / 400 naming the column — and makes no filter claim', async () => {
    const err = await caught(() =>
      driver.aggregate(TABLE, {
        aggregations: [{ function: 'avg', field: 'nosuchcol', alias: DISTINCTIVE_ALIAS }],
      }),
    );
    expect(err.code, 'code').toBe('INVALID_FIELD');
    expect(err.status, 'status').toBe(400);
    expect(String(err.message), 'names the column').toContain('nosuchcol');
    expect(String(err.message), 'attributes the aggregation clause').toMatch(/aggregation/i);
    // ⛔ The #8931 fence: no verdict about a clause the signal does not support.
    expect(String(err.message), 'no filter attribution').not.toMatch(/filter/i);
    // The column is a column reference; the alias is an output name.
    expect(String(err.message), 'the alias is not the column').not.toContain(DISTINCTIVE_ALIAS);
    // The enrichment the ingress door's INVALID_FIELD family carries, so
    // @objectstack/rest serves the same envelope whichever layer refused.
    expect(err.field, 'field').toBe('nosuchcol');
    expect(err.object, 'object').toBe(TABLE);
    expectNoStatementShape(String(err.message), TABLE, 'avg');
  });

  // ⭐ ROW 5 — the groupBy arm, in both its spellings.
  it('row 5: groupBy nosuchcol refuses INVALID_FIELD / 400 naming the column — and makes no filter claim', async () => {
    for (const [spelling, groupBy] of [
      ['string entry', ['nosuchcol']],
      ['structured entry', [{ field: 'nosuchcol', alias: DISTINCTIVE_ALIAS }]],
    ] as const) {
      const err = await caught(() =>
        driver.aggregate(TABLE, { groupBy: groupBy as NonNullable<DriverQuery['groupBy']> }),
      );
      expect(err.code, `${spelling}: code`).toBe('INVALID_FIELD');
      expect(err.status, `${spelling}: status`).toBe(400);
      expect(String(err.message), `${spelling}: names the column`).toContain('nosuchcol');
      expect(String(err.message), `${spelling}: attributes the groupBy clause`).toContain('groupBy');
      expect(String(err.message), `${spelling}: no filter attribution`).not.toMatch(/filter/i);
      expect(err.field, `${spelling}: field`).toBe('nosuchcol');
      expectNoStatementShape(String(err.message), TABLE, spelling);
    }
  });

  // ───────────────────────────────────────────────────────────────
  // ATTRIBUTION — whose clause the refusal claims, and when
  // ───────────────────────────────────────────────────────────────

  it('one column named by BOTH groupBy and an aggregation is attributed to both', async () => {
    const err = await caught(() =>
      driver.aggregate(TABLE, {
        groupBy: ['nosuchcol'],
        aggregations: [{ function: 'avg', field: 'nosuchcol', alias: DISTINCTIVE_ALIAS }],
      }),
    );
    expect(err.code).toBe('INVALID_FIELD');
    expect(err.status).toBe(400);
    expect(String(err.message)).toContain('groupBy');
    expect(String(err.message)).toMatch(/aggregation/i);
    expect(String(err.message)).toContain('nosuchcol');
  });

  // A column in both the WHERE and the groupBy: arm 1 wins, and its claim is
  // still true — the caller's groupBy really does name a column the table
  // lacks, whichever clause the backend happened to trip on first.
  it('a column named by the where AND the groupBy takes the clause attribution, not the filter one', async () => {
    const err = await caught(() =>
      driver.aggregate(TABLE, { where: WHERE_NOSUCHCOL, groupBy: ['nosuchcol'] }),
    );
    expect(err.code).toBe('INVALID_FIELD');
    expect(err.status).toBe(400);
    expect(String(err.message)).toContain('groupBy');
  });

  // ───────────────────────────────────────────────────────────────
  // DISCLOSURE — statement to the log, name to the caller
  // ───────────────────────────────────────────────────────────────

  it('the refusal keeps the dialect text server-side; the caller message carries no bound literal', async () => {
    const { err, logged } = await withLog(driver, () =>
      driver.aggregate(TABLE, {
        where: { title: SECRET_LITERAL },
        aggregations: [{ function: 'avg', field: 'nosuchcol', alias: DISTINCTIVE_ALIAS }],
      }),
    );
    expect(err.code).toBe('INVALID_FIELD');
    expectNoStatementShape(String(err.message), TABLE, 'disclosure');
    expect(String(err.stack ?? ''), 'stack').not.toContain(SECRET_LITERAL);
    for (const key of Object.keys(err ?? {})) {
      const value = (err as Record<string, unknown>)[key];
      if (typeof value === 'string') {
        expect(value, `error property '${key}'`).not.toContain(SECRET_LITERAL);
      }
    }
    // The withholding half: the dialect's own words reach the operator.
    const line = logged.find((l) => l.includes('INVALID_FIELD') && l.includes('nosuchcol'));
    expect(line, 'the dialect message must reach the server log').toBeDefined();
    expect(String(line), 'the log carries the compiled statement').toMatch(/\bselect\b/i);
  });

  // ───────────────────────────────────────────────────────────────
  // CONTROLS — the attribution is SELECTIVE, and the terminal stands
  // ───────────────────────────────────────────────────────────────

  it('CONTROL a working aggregate over declared columns is untouched', async () => {
    const rows = await driver.aggregate(TABLE, {
      groupBy: ['title'],
      aggregations: [{ function: 'count', alias: 'n' }],
    });
    expect(rows).toHaveLength(2);
    const avg = await driver.aggregate(TABLE, {
      aggregations: [{ function: 'avg', field: 'rank', alias: 'a' }],
    });
    expect(Number(avg[0].a), 'avg over an integer column').toBe(2);
  });

  it('CONTROL a resolvable predicate that matches nothing still answers honestly', async () => {
    const rows = await driver.aggregate(TABLE, {
      where: { title: 'no-such-title' },
      aggregations: [{ function: 'count', alias: 'n' }],
    });
    expect(Number(rows[0].n), 'count over zero matching rows').toBe(0);
  });

  // ⛔ The classifier must not widen: an error that is not about an
  // unresolvable column keeps the #11455 terminal — `relation "x" does not
  // exist` has no 'column' in it and must never become a clause verdict.
  it('CONTROL a table that was never provisioned still takes the terminal envelope', async () => {
    const err = await caught(() =>
      driver.aggregate(MISSING_TABLE, { aggregations: [{ function: 'count', alias: 'n' }] }),
    );
    expect(err.code).toBe('DATABASE_ERROR');
    expect(err.status).toBe(500);
    expect(err.code).not.toBe('INVALID_FIELD');
  });
});
}

// A matrix that silently finds zero cells reports OK — assert the axis is real
// before iterating it.
describe('[#11541] the dialect axis this suite runs', () => {
  it('runs every dialect this driver speaks', () => {
    expect(DIALECT_CELLS.map((c) => c.id)).toEqual(['sqlite', 'pg', 'mysql']);
  });
});

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'aggregate unresolvable-column refusal', declareSweep);
}

// ─────────────────────────────────────────────────────────────────
// THE CLASSIFIER — arms and fences on crafted wordings, no server needed
// ─────────────────────────────────────────────────────────────────

/**
 * `aggregateBackendFault` is exercised directly so the arms that depend on a
 * WORDING (a name nothing parsed; a dialect that names the clause position)
 * are measured on every runner — the same reason the #8790 suite carries its
 * message-shape sweep beside the live cells. The live sweep above proves the
 * catch actually routes through this classifier; this block proves what the
 * classifier decides.
 */
describe('[#11541] aggregateBackendFault — the three arms and their fences', () => {
  let driver: SqlDriver;
  const OBJECT = 'probe_obj';
  type ClassifierSeam = {
    aggregateBackendFault(object: string, query: DriverQuery, error: unknown): Error;
  };
  const classify = (query: DriverQuery, message: string): any =>
    (driver as unknown as ClassifierSeam).aggregateBackendFault(OBJECT, query, new Error(message));

  beforeAll(() => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    // The refusal composers log the dialect text on the way out; a unit block
    // has no operator, so the lines are swallowed rather than printed.
    (driver as unknown as { logger: unknown }).logger = { warn: () => {}, info: () => {}, error: () => {} };
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  // Arm 1 fires identically on all three dialects' real wordings — the
  // attribution reads the query AST, never the dialect's prose, so no dialect
  // can be forgotten the way #8926 measured a wording arm being forgotten.
  const GROUPBY_QUERY: DriverQuery = { groupBy: ['nosuchcol'] };
  const WORDINGS: ReadonlyArray<{ dialect: string; message: string }> = [
    { dialect: 'sqlite', message: 'select `nosuchcol` from `t` group by `nosuchcol` - no such column: nosuchcol' },
    { dialect: 'postgres', message: 'select "nosuchcol" from "t" group by "nosuchcol" - column "nosuchcol" does not exist' },
    { dialect: 'mysql', message: "select `nosuchcol` from `t` group by `nosuchcol` - Unknown column 'nosuchcol' in 'field list'" },
  ];

  it('arm 1: every dialect wording drives ONE attribution, judged on the query AST', () => {
    for (const { dialect, message } of WORDINGS) {
      const err = classify(GROUPBY_QUERY, message);
      expect(err.code, `${dialect}: code`).toBe('INVALID_FIELD');
      expect(err.status, `${dialect}: status`).toBe(400);
      expect(err.field, `${dialect}: field`).toBe('nosuchcol');
      expect(err.object, `${dialect}: object`).toBe(OBJECT);
      expect(String(err.message), `${dialect}: clause`).toContain('groupBy');
    }
  });

  it('arm 1: an aggregation field is attributed to the aggregation, not the groupBy', () => {
    const err = classify(
      { aggregations: [{ function: 'avg', field: 'nosuchcol', alias: 'n' }] },
      'select avg("nosuchcol") as "n" from "t" - column "nosuchcol" does not exist',
    );
    expect(err.code).toBe('INVALID_FIELD');
    expect(String(err.message)).toMatch(/aggregation/i);
    expect(String(err.message)).not.toContain('groupBy');
  });

  it('arm 2: a name in neither clause is the WHERE — #8790 verbatim', () => {
    const err = classify(
      { where: { nosuchcol: 1 }, aggregations: [{ function: 'count', alias: 'n' }] },
      'select count(*) as `n` from `t` where `nosuchcol` = 1 - no such column: nosuchcol',
    );
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(String(err.message)).toContain('nosuchcol');
  });

  // ⚠️ Arm 3 — the arm a refactor loses first. A recognised class whose
  // wording yields NO name supports no attribution: without a name there is
  // no AST lookup, and handing it to the WHERE refusal (the way `count()`
  // does unconditionally) would attribute a clause on no evidence. The #11455
  // terminal stands unchanged.
  it('arm 3: a recognised wording that parses to NO name keeps the terminal envelope — not a filter verdict', () => {
    const err = classify(
      { where: { nosuchcol: 1 }, groupBy: ['nosuchcol'] },
      'no such column: ',
    );
    expect(err.code, 'not a clause verdict').not.toBe('INVALID_FIELD');
    expect(err.code, 'not a filter verdict').not.toBe('INVALID_FILTER');
    expect(err.code).toBe('DATABASE_ERROR');
    expect(err.status).toBe(500);
  });

  // ⛔ The exact-match fence: a dotted WHERE key must never be attributed to
  // an aggregation over its tail segment. `title.x` ≠ `x`, so this falls to
  // arm 2 — the same answer find()/count() give the dotted key on SQLite and
  // MySQL (DOTTED_STATUS_QUO, #8371 owns the dotted-path verdict).
  it('FENCE: a dotted where key is not attributed to an aggregation over its tail segment', () => {
    const err = classify(
      { where: { 'title.x': 1 }, aggregations: [{ function: 'avg', field: 'x', alias: 'n' }] },
      'select avg(`x`) as `n` from `t` where `title`.`x` = 1 - no such column: title.x',
    );
    expect(err.code).toBe('INVALID_FILTER');
    expect(String(err.message)).toContain('title.x');
  });

  // ⛔ No second recognizer: MySQL's wording names the clause position, and it
  // is deliberately unread. The query AST decides — the caller's groupBy
  // really names the column, so the attribution holds whatever position the
  // backend happened to report first.
  it("FENCE: mysql's clause position is not consulted — the AST decides", () => {
    const err = classify(
      { groupBy: ['nosuchcol'] },
      "select * from `t` - Unknown column 'nosuchcol' in 'where clause'",
    );
    expect(err.code).toBe('INVALID_FIELD');
    expect(String(err.message)).toContain('groupBy');
  });

  // An aggregation ALIAS is an output name, not a column reference — a
  // dialect error naming it cannot have come from the alias, so it is not
  // attributed to the aggregation.
  it('FENCE: an alias is never treated as a column the aggregation named', () => {
    const err = classify(
      { aggregations: [{ function: 'avg', field: 'rank', alias: 'nosuchcol' }] },
      'select avg(`rank`) as `nosuchcol` from `t` - no such column: nosuchcol',
    );
    expect(err.code).not.toBe('INVALID_FIELD');
    expect(err.code).toBe('INVALID_FILTER');
  });

  it('CONTROL: an error outside the recognised class keeps the terminal envelope', () => {
    const err = classify(
      { aggregations: [{ function: 'count', alias: 'n' }] },
      'select count(*) as "n" from "t" - relation "t" does not exist',
    );
    expect(err.code).toBe('DATABASE_ERROR');
    expect(err.status).toBe(500);
  });
});
