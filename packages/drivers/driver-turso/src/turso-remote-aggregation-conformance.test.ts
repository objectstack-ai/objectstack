// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6409] Aggregate-vocabulary conformance for TursoDriver's REMOTE transport —
 * the shared `@objectstack/spec/data` cases, on rows.
 *
 * The twin of `driver-sql`'s `sql-driver-aggregation-conformance.test.ts`, and
 * the half of the pair that cannot be satisfied by editing one package. The
 * LOCAL face of this same driver passes its twin by INHERITANCE (`TursoDriver
 * extends SqlDriver`, so `mapAggregateFunc` compiles the aggregation). Remote
 * mode inherits none of it: `RemoteTransport.aggregate` builds its own SELECT
 * list, with its own lowering table, its own identifier quoting and its own
 * default alias. It is the independent Nth backend the shared table exists for,
 * and this seam has demonstrably split on the aggregate axis three times
 * already — #5907 (two wire identities for one refusal), #6203 (`COUNT`
 * compiled here, refused there), #6321 (an undeclared `agg.func` limb).
 *
 * ## Why a SQLite-backed client stub
 *
 * Same reason as the remote filter-logic suite next door: libsql IS SQLite, so
 * `makeLibsqlSqliteStub` gives the transport real value semantics with no
 * network and no credentials — and `count_distinct` is precisely a case where
 * every wrong lowering still emits VALID SQL. `count("stage")` loses the dedup,
 * `count(*)` loses the NULL exclusion as well, and both run and return a
 * number. Only executing the statement tells them apart; the suites that mock
 * `execute` and assert on the SQL string keep the network as their concern.
 *
 * ## Reverse verification — direction predicted BEFORE it was run
 *
 * The twin's two reverts, applied to BOTH faces at once (which is how a real
 * change to this lowering would land — see the note on
 * `REMOTE_AGGREGATE_FUNCTIONS`).
 *
 * **(A) the `count_distinct` entry deleted** — the pre-#6409 state. Predicted:
 * the `count_distinct` cases fail by THROWING `NOT_IMPLEMENTED`/501 out of
 * `refuseAggregateFunction`, never on a value.
 *
 * **(B) `distinct` flipped to `false`** — the copied-neighbour mistake, and the
 * one a review that only checked the two faces' tables have the same KEYS would
 * pass. Predicted: failures on VALUES (4 vs 2 ungrouped, `west` 3 vs 2), with
 * `count_distinct(score)` GREEN because that column has nothing to dedup.
 *
 * Measured after writing the above, of 17:
 *
 * - **(A) 6 failed / 11 passed.** The three value cases, both emitted-SQL cases
 *   and the field-less refusal case. The value cases died on the thrown 501,
 *   none on a number — as predicted. The refusal case went red on
 *   `expected 'NOT_IMPLEMENTED' to be 'INVALID_QUERY'`: unnamed in the
 *   prediction, kept because it is what proves the two refusals are
 *   distinguishable rather than interchangeable.
 * - **(B) 5 failed / 12 passed**, on the two value comparisons, on
 *   `expected 'SELECT count("stage") AS "count_disti…' to be
 *   'SELECT count(distinct "stage") AS "co…'`, and on the field-less case
 *   RESOLVING instead of refusing — `count(*)` is valid, so a non-distinct
 *   lowering has nothing to refuse. `count_distinct(score)` green throughout.
 *
 * Both directions report the SAME two wrong numbers the local twin reports,
 * which is the pairing doing its job: the shared table is what makes "the two
 * faces agree" a measured fact rather than a side-by-side read of two files.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AGGREGATION_CASES, AGGREGATION_ROWS } from '@objectstack/spec/data';
import type { AggregationCase, QueryAST } from '@objectstack/spec/data';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

const CONFORMANCE_OBJECT = {
  name: 'conformance_agg',
  fields: {
    id: { type: 'string' },
    region: { type: 'string' },
    // Nullable, and it must stay that way — see `AggregationRow.stage`.
    stage: { type: 'string' },
    score: { type: 'number' },
  },
};

/** The case as a `QueryAST`. The alias is the harness's, not the table's. */
const astFor = (c: AggregationCase): QueryAST => ({
  object: CONFORMANCE_OBJECT.name,
  aggregations: [{ function: c.function, ...(c.field ? { field: c.field } : {}), alias: 'n' }],
  // [#6401] A case carrying `groupByAlias` is sent as the STRUCTURED node, so
  // what the face receives is the union member that declares `alias`. Without
  // this the alias cases would send a bare string and pin nothing.
  ...(c.groupBy
    ? { groupBy: [c.groupByAlias ? { field: c.groupBy, alias: c.groupByAlias } : c.groupBy] }
    : {}),
});

const actualFor = (c: AggregationCase, rows: Array<Record<string, unknown>>) => {
  // [#6401] The group value is read from the column the case SAYS it lands in —
  // `groupByAlias ?? groupBy`. Reading `c.groupBy` unconditionally is the bug
  // this axis exists to catch: it is green on a face that ignores the alias.
  const groupKey = c.groupByAlias ?? c.groupBy;
  return rows
    .map((r) => ({ group: groupKey ? String(r[groupKey]) : null, value: Number(r.n) }))
    .sort((x, y) => String(x.group).localeCompare(String(y.group)));
};

describe('[#6409] TursoDriver remote — aggregate vocabulary conformance', () => {
  let driver: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    stub = makeLibsqlSqliteStub();
    driver = new TursoDriver({ url: 'libsql://conformance.turso.io', client: stub as never });
    await driver.connect();
    // The mode this suite is about — the one that inherits nothing.
    expect(driver.transportMode).toBe('remote');
    await driver.syncSchema(CONFORMANCE_OBJECT.name, CONFORMANCE_OBJECT);
    for (const row of AGGREGATION_ROWS) await driver.create(CONFORMANCE_OBJECT.name, { ...row });
  });

  afterAll(async () => {
    await driver.disconnect();
    stub.close();
  });

  /**
   * The fixture as stored, read BELOW the transport — a case that answers 2
   * because only two rows landed is not a case that deduplicated correctly, and
   * the nullable column is the one a seed is most likely to mangle.
   */
  it('the fixture is all six rows, with the nulls stored AS nulls', () => {
    const rows = stub.raw
      .prepare('select id, region, stage, score from conformance_agg order by id')
      .all() as Array<{ id: string; region: string; stage: string | null; score: number }>;
    expect(rows.map((r) => String(r.id))).toEqual(['1', '2', '3', '4', '5', '6']);
    for (const r of rows) {
      const seeded = AGGREGATION_ROWS.find((s) => s.id === String(r.id))!;
      expect([r.region, r.stage, Number(r.score)], r.id)
        .toEqual([seeded.region, seeded.stage, seeded.score]);
    }
    expect(rows.filter((r) => r.stage === null)).toHaveLength(2);
  });

  for (const c of AGGREGATION_CASES) {
    it(c.name, async () => {
      const rows = await driver.aggregate(CONFORMANCE_OBJECT.name, astFor(c));
      expect(actualFor(c, rows as any[]), c.note).toEqual([...c.expected]);
    });
  }

  /**
   * The statement this transport actually emits. It builds its SELECT list by
   * string concatenation rather than through knex, so the DISTINCT keyword's
   * placement — and the fact that the column is still quoted as an identifier
   * beside it — is worth pinning here even though the values above are the
   * standard.
   */
  it('count_distinct compiles to count(distinct "column")', async () => {
    const seen: string[] = [];
    const spy = { ...stub, execute: async (stmt: any) => { seen.push(stmt.sql); return stub.execute(stmt); } };
    const t = new TursoDriver({ url: 'libsql://conformance.turso.io', client: spy as never });
    await t.connect();
    await t.aggregate(CONFORMANCE_OBJECT.name, astFor({
      name: 'probe', function: 'count_distinct', field: 'stage', expected: [],
    }));
    expect(seen).toEqual(['SELECT count(distinct "stage") AS "n" FROM "conformance_agg"']);
  });

  /**
   * The default alias follows the DECLARED name, not the lowering — so a caller
   * who omits `alias` reads their result under `count_distinct_stage`, which is
   * predictable from their own query, rather than under `count_stage`, which
   * would collide with a plain `count` in the same select list.
   */
  it('the default alias spells itself from the declared function name', async () => {
    const seen: string[] = [];
    const spy = { ...stub, execute: async (stmt: any) => { seen.push(stmt.sql); return stub.execute(stmt); } };
    const t = new TursoDriver({ url: 'libsql://conformance.turso.io', client: spy as never });
    await t.connect();
    const ast = {
      object: CONFORMANCE_OBJECT.name,
      aggregations: [{ function: 'count_distinct', field: 'stage' }],
    } as unknown as QueryAST;
    const rows = await t.aggregate(CONFORMANCE_OBJECT.name, ast);
    expect(seen[0]).toBe(
      'SELECT count(distinct "stage") AS "count_distinct_stage" FROM "conformance_agg"',
    );
    expect((rows as any[])[0].count_distinct_stage).toBe(2);
  });

  /**
   * `COUNT(DISTINCT *)` is not valid SQL, so the transport refuses instead of
   * sending it. ADR-0112: `code` AND `status`, never a bare `toThrow` — the
   * pre-#6409 transport threw here too (a 501 from the aggregate door), so "it
   * threw" cannot tell the two behaviours apart (#6144).
   */
  it('refuses count_distinct with no field — INVALID_QUERY / 400, and sends nothing', async () => {
    const seen: string[] = [];
    const spy = { ...stub, execute: async (stmt: any) => { seen.push(stmt.sql); return stub.execute(stmt); } };
    const t = new TursoDriver({ url: 'libsql://conformance.turso.io', client: spy as never });
    await t.connect();
    seen.length = 0;
    const ast = {
      object: CONFORMANCE_OBJECT.name,
      aggregations: [{ function: 'count_distinct', alias: 'n' }],
    } as QueryAST;
    let err: (Error & { code?: string; status?: number }) | undefined;
    try {
      await t.aggregate(CONFORMANCE_OBJECT.name, ast);
    } catch (e) {
      err = e as Error & { code?: string; status?: number };
    }
    expect(err, 'expected a refusal, but the aggregation resolved').toBeDefined();
    expect(err!.code).toBe('INVALID_QUERY');
    expect(err!.status).toBe(400);
    expect(err!.message).toContain('nothing to deduplicate');
    expect(err!.message).not.toContain('capability gap');
    expect(err!.message).not.toContain('[RemoteTransport]');
    // A refused aggregation must not have cost a round trip.
    expect(seen).toEqual([]);
  });

  /** The control: `count` with no field still means `COUNT(*)`. */
  it('count with no field still means COUNT(*)', async () => {
    const ast = {
      object: CONFORMANCE_OBJECT.name,
      aggregations: [{ function: 'count', alias: 'n' }],
    } as QueryAST;
    const rows = await driver.aggregate(CONFORMANCE_OBJECT.name, ast);
    expect(Number((rows as any[])[0].n)).toBe(6);
  });
});
