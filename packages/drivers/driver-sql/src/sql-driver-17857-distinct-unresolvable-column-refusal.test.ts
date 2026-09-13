// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#17857 — the #8790 unresolvable-column refusal reaches the LAST
 * read door, attributed to the clause the caller's own request names.
 *
 * ## The five-row probe this card was filed from
 *
 * One object with a single `title` column; one column name the table does not
 * have; the SAME condition asked at four doors. Measured on `origin/main` at
 * `dbea1756d9` (embedded SQLite) while implementing this card, and identical to
 * the card's own reading on better-sqlite3 and live PostgreSQL 16.13:
 *
 * ```
 * count(t,     { where: { nosuchcol: 1 } }) => INVALID_FILTER 400  "Filter on 'nosuchcol' …"
 * find(t,      { where: { nosuchcol: 1 } }) => INVALID_FILTER 400  (identical message)
 * aggregate(t, { groupBy: ['nosuchcol'] })  => INVALID_FIELD  400  "The groupBy of this query …"
 * distinct(t, 'title', { nosuchcol: 1 })    => DATABASE_ERROR 500  ← this card
 * distinct(t, 'nosuchcol')                  => DATABASE_ERROR 500  ← this card
 * ```
 *
 * The first three rows are ruled answers (#8790, maintainer 2026-08-15: one
 * unresolvable WHERE column, one answer, on both read halves; #11541 for the
 * aggregate door). `distinct()` served the caller's own typo as a SERVER fault
 * naming nothing they could act on — and a picklist-populating `distinct()`
 * sits beside the `find()` and `count()` of the same list view.
 *
 * ## What #17639 landed, and why it stopped where it did
 *
 * #17639 gave this door the TERMINAL envelope (`DATABASE_ERROR` / 500 instead
 * of pg's raw `DatabaseError`) and deliberately left the ATTRIBUTION arm filed,
 * with the reason written at the door: a BLANKET `isUnresolvableColumnError`
 * arm answers *"Filter on 'x' names a column …"*, and this door names columns
 * in TWO clauses — the `field` being listed and the WHERE compiled from
 * `filters`. Telling the author of `distinct(o, 'nosuchcol')`, who passed no
 * filter at all, that their FILTER was wrong is the unsupportable attribution
 * the #8931 ruling (2026-08-17 「同意 C」) refuses to make. That is the same
 * split #11455 made on the `aggregate()` door and #11541 closed a card later.
 *
 * ## The fix this suite pins — attribution from the caller's own request
 *
 * `SqlDriver.distinctBackendFault` reads the dialect-named column back against
 * the request the statement was built from:
 *
 * 1. the name EQUALS the `field` argument ⇒ `INVALID_FIELD` / 400 naming the
 *    listed column (`unresolvableDistinctColumnRefusal`);
 * 2. it does not ⇒ the statement's only remaining column sources are the WHERE
 *    compiled from `filters` and the tenant-scope predicate, both filters, so
 *    #8790's `unresolvableFilterColumnRefusal` applies verbatim;
 * 3. `unresolvableColumnNameOf` answers `null` ⇒ no attribution is supportable,
 *    so the #17639 terminal envelope stands unchanged.
 *
 * ⭐ Arm 2 is the COMPLEMENT of arm 1, never a search of the `filters` AST for
 * the name — pinned below on `{ $or: [{ nosuchcol: 1 }] }`. `FilterCondition`
 * nests (`$and` / `$or` / `$not`), so a key scan would have to walk every
 * declared node shape, and each shape it failed to walk would silently
 * downgrade that filter's 400 back to the 500 this card removes: the defect
 * itself, re-introduced one nesting level down, invisible to any pin written on
 * a flat filter. The complement needs no walker to be complete — the compiled
 * statement is `select distinct <field> from <table> where <filters + tenant
 * scope>`, so a column reference that is not the `field` came from a predicate.
 *
 * ## Why `INVALID_FIELD` on arm 1 and not `INVALID_QUERY` — read off the repo
 *
 * No code is minted (ADR-0112). `INVALID_FIELD` is the standard-catalog answer
 * this repo already gives for a named column an object does not have: the
 * protocol ingress (`assertGroupByFieldsExist` / `assertAggregationFieldsExist`,
 * #4254), the write path at the REST boundary, and #11541's
 * `unresolvableAggregateColumnRefusal` for this condition's aggregate twin. One
 * condition must not carry two codes depending on which door asked — the whole
 * of #8790's ruling.
 *
 * ## What this suite deliberately does NOT decide
 *
 * ⛔ Nothing here touches #17590 (whether a `json` column should ANSWER a
 * distinct read). That is a different condition — a column that EXISTS whose
 * type has no equality operator — and it stays on #17639's terminal envelope,
 * whose own pins in `sql-driver-17639-distinct-fault-envelope.test.ts` are
 * unchanged by this card: an error this classifier does not claim still leaves
 * as `DATABASE_ERROR` / 500.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import type { FilterCondition } from '@objectstack/spec/data';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'distinct_unres_task';
const MISSING_TABLE = 'distinct_unres_never_created';

/** The column the table does not have — the one condition every row asks. */
const MISSING_COLUMN = 'nosuchcol';

/**
 * The caller's bound value, distinctive on purpose: the dialect text inlines it
 * on SQLite and MySQL, so its absence from every caller-visible surface is what
 * pins the #7929 redaction rather than merely the status code.
 */
const SECRET_LITERAL = 'zz-distinct-unres-must-not-leak';

/** A well-formed aggregation over the missing column — the third door's row. */
const GROUP_BY_MISSING: DriverQuery = {
  groupBy: [MISSING_COLUMN],
  aggregations: [{ function: 'count', alias: 'n' }],
};

/**
 * Reaches the protected classifier the way a driver subclass does — which is
 * also the assertion that it IS reachable that way (`protected`, the member
 * kind #11541's sibling uses) rather than private.
 */
class ClassifierProbe extends SqlDriver {
  classify(object: string, field: string, error: unknown): Error {
    return this.distinctBackendFault(object, field, error);
  }
}

async function caught(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  return expect.fail('expected the query to fail, but it resolved');
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
 * The disclosure clause, applied to one caller-visible message — the same
 * NEGATIVE-set-plus-positive-anchor shape the #8931, #11455, #11541 and #17639
 * suites use, so an emptied message cannot satisfy it trivially.
 */
function expectNoStatementShape(message: string, object: string, half: string): void {
  expect(message, `${half}: no compiled statement`).not.toMatch(/\bselect\s/i);
  expect(message, `${half}: no positional placeholder`).not.toMatch(/\$\d/);
  expect(message, `${half}: no quoted physical reference`).not.toMatch(/["`]/);
  expect(message, `${half}: no bound literal`).not.toContain(SECRET_LITERAL);
  expect(message, `${half}: the caller is still told which object failed`).toContain(object);
}

function declareSweep(cell: DialectCell): void {
describe(`[#17857] driver-sql — distinct() attributes an unresolvable column (${cell.label})`, () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver(cell.config());
    await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver.initObjects([
      { name: TABLE, fields: { title: { type: 'string' }, rank: { type: 'integer' } } },
    ]);
    await driver.create(TABLE, { id: 't1', title: 'Design', rank: 1 }, { bypassTenantAudit: true });
    await driver.create(TABLE, { id: 't2', title: 'Build', rank: 3 }, { bypassTenantAudit: true });
    await driver.create(TABLE, { id: 't3', title: 'Design', rank: 5 }, { bypassTenantAudit: true });
  });

  afterAll(async () => {
    await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver.disconnect();
  });

  // ───────────────────────────────────────────────────────────────
  // THE CARD — the five-row probe, RUN rather than reasoned about
  // ───────────────────────────────────────────────────────────────

  it('all four read doors answer ONE unresolvable column with a 400 that names it', async () => {
    const onCount = await caught(() => driver.count(TABLE, { where: { [MISSING_COLUMN]: 1 } }));
    const onFind = await caught(() => driver.find(TABLE, { where: { [MISSING_COLUMN]: 1 } }));
    const onAggregate = await caught(() => driver.aggregate(TABLE, GROUP_BY_MISSING));
    const onDistinctFilter = await caught(() => driver.distinct(TABLE, 'title', { [MISSING_COLUMN]: 1 }));
    const onDistinctField = await caught(() => driver.distinct(TABLE, MISSING_COLUMN));

    // Rows 1-3: the ruled answers, unmoved by this card.
    expect([onCount.code, onCount.status], 'count/where').toEqual(['INVALID_FILTER', 400]);
    expect([onFind.code, onFind.status], 'find/where').toEqual(['INVALID_FILTER', 400]);
    expect([onAggregate.code, onAggregate.status], 'aggregate/groupBy').toEqual(['INVALID_FIELD', 400]);

    // Rows 4-5: the card. Both were `DATABASE_ERROR` / 500 before it.
    expect([onDistinctFilter.code, onDistinctFilter.status], 'distinct/filter').toEqual([
      'INVALID_FILTER',
      400,
    ]);
    expect([onDistinctField.code, onDistinctField.status], 'distinct/field').toEqual([
      'INVALID_FIELD',
      400,
    ]);

    // Neither row may still be the server-fault posture the card measured.
    for (const [half, err] of [
      ['distinct/filter', onDistinctFilter],
      ['distinct/field', onDistinctField],
    ] as const) {
      expect(err.code, `${half}: no longer a server fault`).not.toBe('DATABASE_ERROR');
      expect(err.status, `${half}: no longer 5xx`).toBeLessThan(500);
      expect(String(err.message), `${half}: names the column`).toContain(MISSING_COLUMN);
    }
  });

  // ───────────────────────────────────────────────────────────────
  // ARM 1 — the name equals the LISTED field
  // ───────────────────────────────────────────────────────────────

  it('arm 1: distinct over a missing column refuses as INVALID_FIELD naming the listed column', async () => {
    const err = await caught(() => driver.distinct(TABLE, MISSING_COLUMN));
    expect(err.code, 'code').toBe('INVALID_FIELD');
    expect(err.status, 'status').toBe(400);
    expect(err.field, 'the `field` rider @objectstack/rest forwards').toBe(MISSING_COLUMN);
    expect(err.object, 'the `object` rider').toBe(TABLE);
    expectNoStatementShape(String(err.message), TABLE, 'arm 1');
  });

  // ⛔ THE #8931 CLAUSE, and the reason a blanket arm stayed forbidden: this
  // caller passed NO filter, so a refusal about their filter is a claim the
  // signal cannot support. The assertion is on the caller-visible words, not
  // just the code, because the code is the half that is cheap to keep right.
  it('arm 1: the refusal makes NO claim about a filter the caller never passed', async () => {
    const err = await caught(() => driver.distinct(TABLE, MISSING_COLUMN));
    expect(err.code, 'not the WHERE refusal').not.toBe('INVALID_FILTER');
    expect(String(err.message), 'the word "filter" appears nowhere').not.toMatch(/filter/i);
    expect(String(err.message), 'it says what the caller actually did').toMatch(/distinct/i);
  });

  // ⛔ And not the other two wrong answers either: `INVALID_QUERY` would say
  // the request is malformed (it answers values the moment schema sync runs),
  // and the terminal would say the driver could attribute nothing (it just did).
  it('arm 1: not INVALID_QUERY and not the DATABASE_ERROR terminal', async () => {
    const err = await caught(() => driver.distinct(TABLE, MISSING_COLUMN));
    expect(err.code).not.toBe('INVALID_QUERY');
    expect(err.code).not.toBe('DATABASE_ERROR');
  });

  it('arm 1: writes the full dialect text to the SERVER LOG, statement included', async () => {
    const { err, logged } = await withLog(driver, () => driver.distinct(TABLE, MISSING_COLUMN));
    expect(err.code).toBe('INVALID_FIELD');
    const line = logged.find((l) => l.includes(MISSING_COLUMN));
    expect(line, 'an operator must still be able to read what the backend said').toBeDefined();
    expect(String(line), 'the withheld statement is in the log').toMatch(/\bselect\b/i);
    expect(String(line), 'the log line names the envelope it produced').toContain('INVALID_FIELD');
  });

  // ───────────────────────────────────────────────────────────────
  // ARM 2 — a PREDICATE named it, so #8790's refusal applies verbatim
  // ───────────────────────────────────────────────────────────────

  // The #8790 invariant in its strongest form: not merely the same code, the
  // same SENTENCE. A drifted wording is how one condition acquires two
  // explanations, which is the split the ruling closed.
  it('arm 2: a filter column gets byte-identical treatment at all three doors', async () => {
    const where = { [MISSING_COLUMN]: 1 };
    const onDistinct = await caught(() => driver.distinct(TABLE, 'title', where));
    const onCount = await caught(() => driver.count(TABLE, { where }));
    const onFind = await caught(() => driver.find(TABLE, { where }));
    const shape = (e: any) => ({ code: e.code, status: e.status, message: String(e.message) });
    expect(shape(onDistinct), 'distinct vs count').toEqual(shape(onCount));
    expect(shape(onDistinct), 'distinct vs find').toEqual(shape(onFind));
    expect(onDistinct.code).toBe('INVALID_FILTER');
    expect(onDistinct.status).toBe(400);
  });

  // ⭐ THE COMPLEMENT PIN. `$or` nests the offending key one level down, where a
  // top-level key scan of the `filters` AST cannot see it. An implementation
  // that searched the AST instead of complementing arm 1 answers the 500 here
  // and stays green on every flat-filter pin above — so this case is the one
  // that tells the two designs apart.
  it('arm 2: a NESTED filter key is attributed to the filter, not dropped to the terminal', async () => {
    for (const [shape, where] of [
      ['$or', { $or: [{ [MISSING_COLUMN]: 1 }, { rank: 99 }] }],
      ['$and', { $and: [{ [MISSING_COLUMN]: 1 }] }],
      ['nested $and inside $or', { $or: [{ $and: [{ [MISSING_COLUMN]: 1 }] }] }],
    ] as const) {
      const onDistinct = await caught(() => driver.distinct(TABLE, 'title', where as FilterCondition));
      expect(onDistinct.code, `${shape}: code`).toBe('INVALID_FILTER');
      expect(onDistinct.status, `${shape}: status`).toBe(400);
      const onFind = await caught(() => driver.find(TABLE, { where: where as FilterCondition }));
      expect(String(onDistinct.message), `${shape}: the same sentence find() gives`).toBe(
        String(onFind.message),
      );
    }
  });

  it('arm 2: the caller bound literal reaches neither the message nor a serialised envelope', async () => {
    const err = await caught(() =>
      driver.distinct(TABLE, 'title', { [MISSING_COLUMN]: SECRET_LITERAL }),
    );
    expect(err.code, 'code').toBe('INVALID_FILTER');
    expectNoStatementShape(String(err.message), TABLE, 'arm 2');
    expect(JSON.stringify(err), 'a serialised envelope carries no bound literal').not.toContain(
      SECRET_LITERAL,
    );
  });

  // ───────────────────────────────────────────────────────────────
  // THE TIE-BREAK — one column named by BOTH clauses
  // ───────────────────────────────────────────────────────────────

  // #11541's rule, transferred: arm 1 wins, and its claim is still true — the
  // listed field really is a column the table lacks. The alternative would be a
  // refusal whose clause depends on which reference the dialect happened to
  // report first, which is not a fact about the request at all.
  it('the tie-break: named by the field AND the filter, arm 1 wins', async () => {
    const err = await caught(() =>
      driver.distinct(TABLE, MISSING_COLUMN, { [MISSING_COLUMN]: 1 }),
    );
    expect(err.code, 'code').toBe('INVALID_FIELD');
    expect(err.status, 'status').toBe(400);
    expect(err.field, 'the rider names the listed column').toBe(MISSING_COLUMN);
  });

  // ───────────────────────────────────────────────────────────────
  // CONTROLS — the classifier is narrow, and nothing working moved
  // ───────────────────────────────────────────────────────────────

  it('CONTROL a working distinct is untouched, filtered and unfiltered', async () => {
    const titles = await driver.distinct(TABLE, 'title');
    expect([...titles].sort(), 'the unfiltered distinct set').toEqual(['Build', 'Design']);
    expect(await driver.distinct(TABLE, 'title', { rank: 5 }), 'the filtered set').toEqual(['Design']);
    // The nested filter shapes arm 2 is pinned on must also still ANSWER when
    // every column in them resolves — otherwise that pin could be passing on a
    // filter this driver simply cannot compile.
    expect(
      await driver.distinct(TABLE, 'title', { $or: [{ rank: 5 }, { rank: 99 }] } as FilterCondition),
      'a nested filter that resolves',
    ).toEqual(['Design']);
  });

  // ⛔ #17639's terminal is NOT narrowed by this card. A table that was never
  // provisioned is not an unresolvable COLUMN, so nothing here claims it.
  it('CONTROL an unclassified dialect fault still leaves as the #17639 terminal', async () => {
    const err = await caught(() => driver.distinct(MISSING_TABLE, 'title'));
    expect(err.code, 'code').toBe('DATABASE_ERROR');
    expect(err.status, 'status').toBe(500);
  });

  // ⛔ The precise refusal must still WIN over the classifier: `applyFilters`
  // raises `INVALID_FILTER` / 400 while the statement is BUILT, upstream of the
  // execution the catch guards. The probe is #6320's — a query ENVELOPE handed
  // where a bare filter belongs.
  it('CONTROL the upstream INVALID_FILTER refusal still wins over the classifier', async () => {
    const err = await caught(() =>
      driver.distinct(TABLE, 'title', { object: TABLE, where: { rank: 1 } } as never),
    );
    expect(err.code, 'a query envelope handed as a filter').toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
  });
});
}

// ───────────────────────────────────────────────────────────────────
// ARM 3, and the exact-equality discipline — asserted on the classifier
// itself, because no dialect can be made to produce these on demand
// ───────────────────────────────────────────────────────────────────

describe('[#17857] the classifier arms, driven directly', () => {
  const probe = new ClassifierProbe({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  // Arm 3. `null` from the extractor is a real answer, not a failure to handle
  // — and reading it as license for the WHERE arm would attribute a clause on
  // no evidence, which is arm 2's own justification inverted.
  it('arm 3: a recognised wording that yields NO name keeps the terminal envelope', () => {
    const err = probe.classify(TABLE, 'title', new Error('no such column: ')) as any;
    expect(err.code, 'code').toBe('DATABASE_ERROR');
    expect(err.status, 'status').toBe(500);
  });

  it('an error outside the recognised class keeps the terminal envelope', () => {
    const err = probe.classify(TABLE, 'title', new Error('connection terminated unexpectedly')) as any;
    expect(err.code).toBe('DATABASE_ERROR');
    expect(err.status).toBe(500);
  });

  // ⚠️ EXACT equality, #11541's discipline. A suffix match would read
  // `no such column: title.x` as "the listed field `x`" and refuse the wrong
  // clause — a false verdict about a `field` that is perfectly fine.
  it('arm 1 does not SUFFIX-match: a dotted WHERE key is not the listed field', () => {
    const err = probe.classify(TABLE, 'x', new Error('select … - no such column: title.x')) as any;
    expect(err.code, 'a dotted key belongs to the predicate, not the SELECT').toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
  });

  it('arm 1 fires on exact equality, across every dialect wording the extractor reads', () => {
    for (const [dialect, message] of [
      ['sqlite', `select distinct … - no such column: ${MISSING_COLUMN}`],
      ['pg-quoted', `select … - column "${MISSING_COLUMN}" does not exist`],
      ['pg-bare', `select … - column ${MISSING_COLUMN} does not exist`],
      ['mysql', `select … - Unknown column '${MISSING_COLUMN}' in 'field list'`],
    ] as const) {
      const err = probe.classify(TABLE, MISSING_COLUMN, new Error(message)) as any;
      expect(err.code, `${dialect}: arm 1`).toBe('INVALID_FIELD');
      expect(err.field, `${dialect}: the rider`).toBe(MISSING_COLUMN);
    }
  });

  it('arm 2 fires on the same wordings when the name is not the listed field', () => {
    for (const [dialect, message] of [
      ['sqlite', `select distinct … - no such column: ${MISSING_COLUMN}`],
      ['pg-quoted', `select … - column "${MISSING_COLUMN}" does not exist`],
      ['mysql', `select … - Unknown column '${MISSING_COLUMN}' in 'where clause'`],
    ] as const) {
      const err = probe.classify(TABLE, 'title', new Error(message)) as any;
      expect(err.code, `${dialect}: arm 2`).toBe('INVALID_FILTER');
      expect(err.status, `${dialect}: arm 2`).toBe(400);
    }
  });
});

// A matrix that silently finds zero cells reports OK — assert the axis is real
// before iterating it.
describe('[#17857] the dialect axis this suite runs', () => {
  it('runs every dialect this driver speaks', () => {
    expect(DIALECT_CELLS.map((c) => c.id)).toEqual(['sqlite', 'pg', 'mysql']);
  });
});

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'distinct unresolvable-column refusal', declareSweep);
}
