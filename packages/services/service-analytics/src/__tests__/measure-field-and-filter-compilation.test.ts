// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A measure is compiled from EVERYTHING it declares — `aggregate`, `field` and
 * `filter` — on both doors (#10298).
 *
 * Two defects, one gap. A dataset measure carries three declarations; the
 * compiled SQL used only the first:
 *
 *  1. `{ aggregate: 'count', field: 'resolved_by_article' }` emitted `COUNT(*)`.
 *     The wrapper table took the column and threw it away, so a measure that
 *     asks "how many cases carry an article" counted every case it was handed.
 *     A deflection rate built as `kb_resolved_count / closed_count` therefore
 *     read 100% where the truth was 12.5% — with 8 and 8 printed beside it, and
 *     the pivot underneath grouping seven of those eight under a null article.
 *
 *  2. `/api/v1/analytics/query` dropped every per-measure `filter`, and the
 *     dataset's definition-level `filter` with it. That door addresses the
 *     REGISTERED CUBE directly; the filters live beside the cube, in the
 *     dataset registry, and only `DatasetExecutor` — the dashboard's door —
 *     ever read them. So one cube and one set of measure names answered two
 *     different numbers depending on which door the caller came in, and the API
 *     door was the one that silently answered wrong.
 *
 * # Why the pins are on the SQL, not only on the number
 *
 * The response carries the compiled statement, and that is what this card is
 * about. A number-only assertion passes on any arithmetic that happens to agree
 * on one fixture — `COUNT(*)` and `COUNT(col)` agree on any fixture with no
 * nulls, which is most of them. So the compiled shape is pinned directly:
 * `COUNT(<col>)` for a `count` that names a field, and one conditional
 * aggregate per filtered measure.
 *
 * `CASE WHEN` rather than SQL-standard `FILTER (WHERE …)`: `FILTER` is
 * Postgres and SQLite ≥ 3.30 only, and this strategy compiles one statement for
 * whichever SQL driver owns the object — MySQL among them.
 *
 * # And the numbers, on a real database
 *
 * The last block runs both doors against a real SQLite (`sql.js`, the pure-WASM
 * engine `driver-sql` itself falls back to) over the issue's own ground truth:
 * 24 opportunities, 8 won, 5 lost, won revenue 1,290,000. Before the fix the
 * API door answered 24 / 24 / 24 / 5,632,500 — the shape assertions above
 * cannot tell that apart from a fix that merely emits plausible SQL, so the two
 * doors are made to agree on rows that really exist.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import { DatasetSchema, type Dataset } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';

// ── datasets ────────────────────────────────────────────────────────────────

/** The card's `case_metrics`: a `count` that names a field, both measures scoped. */
const CASE_METRICS: Dataset = DatasetSchema.parse({
  name: 'case_metrics',
  label: 'Case Metrics',
  object: 'crm_case',
  dimensions: [],
  measures: [
    { name: 'case_count', label: 'Cases', aggregate: 'count' },
    { name: 'closed_count', label: 'Closed Cases', aggregate: 'count', filter: { is_closed: true } },
    {
      name: 'kb_resolved_count', label: 'Resolved by KB', aggregate: 'count',
      field: 'resolved_by_article', filter: { is_closed: true },
    },
    // The same `count(field)` WITHOUT a filter — the plain `COUNT(col)` form.
    { name: 'article_count', label: 'With an article', aggregate: 'count', field: 'resolved_by_article' },
  ],
}) as Dataset;

/** The card's `opportunity_metrics`, measure for measure. */
const OPPORTUNITY_METRICS: Dataset = DatasetSchema.parse({
  name: 'opportunity_metrics',
  label: 'Opportunity Metrics',
  object: 'crm_opportunity',
  dimensions: [
    { name: 'stage', label: 'Stage', field: 'stage', type: 'string' },
    // Grouped agreement is asserted on OWNER, never on `stage`: grouping by the
    // very column a measure filters on makes the filtered and unfiltered
    // aggregates COINCIDE inside the matching group, so an assertion there
    // passes with the filter dropped. Measured — that is exactly what the first
    // draft of the grouped test did, and the ablation caught it, not the fix.
    { name: 'owner', label: 'Owner', field: 'owner', type: 'string' },
  ],
  measures: [
    { name: 'opp_count', label: 'Opportunities', aggregate: 'count' },
    { name: 'won_count', label: 'Won Deals', aggregate: 'count', filter: { stage: 'closed_won' } },
    { name: 'lost_count', label: 'Lost Deals', aggregate: 'count', filter: { stage: 'closed_lost' } },
    {
      name: 'won_amount', label: 'Won Revenue', aggregate: 'sum', field: 'amount',
      filter: { stage: 'closed_won' },
    },
  ],
}) as Dataset;

/** A dataset carrying a definition-level `filter` — its intrinsic scope. */
const SCOPED_METRICS: Dataset = DatasetSchema.parse({
  name: 'scoped_metrics',
  label: 'Scoped Metrics',
  object: 'crm_opportunity',
  filter: { is_deleted: false },
  dimensions: [],
  measures: [
    { name: 'opp_count', label: 'Opportunities', aggregate: 'count' },
    { name: 'won_count', label: 'Won Deals', aggregate: 'count', filter: { stage: 'closed_won' } },
  ],
}) as Dataset;

/**
 * A dataset that JOINS, so base columns come out table-qualified — the exact
 * shape the card reported from a real deployment (`SUM("crm_opportunity"."amount")`).
 * A single-object cube keeps bare columns by design, so both spellings are
 * pinned rather than one of them being mistaken for the rule.
 */
const JOINED_METRICS: Dataset = DatasetSchema.parse({
  name: 'joined_case_metrics',
  label: 'Joined Case Metrics',
  object: 'crm_case',
  include: ['account'],
  dimensions: [{ name: 'industry', label: 'Industry', field: 'account.industry', type: 'string' }],
  measures: [
    {
      name: 'kb_resolved_count', label: 'Resolved by KB', aggregate: 'count',
      field: 'resolved_by_article', filter: { is_closed: true },
    },
  ],
}) as Dataset;

/** A service with the native-SQL capability and no executor — SQL only. */
const sqlOnlyService = (...datasets: Dataset[]): AnalyticsService => {
  const svc = new AnalyticsService({
    debugSql: true,
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async () => [],
  });
  for (const d of datasets) svc.registerDataset(d);
  return svc;
};

const sqlFor = async (svc: AnalyticsService, query: AnalyticsQuery) =>
  svc.generateSql(query);

// ── 1. `count` compiles its `field` ─────────────────────────────────────────

describe('[#10298] `aggregate: \'count\'` compiles the `field` it declares', () => {
  it('emits COUNT(<column>) for a count that names a field', async () => {
    const svc = sqlOnlyService(CASE_METRICS);
    const { sql } = await sqlFor(svc, { cube: 'case_metrics', measures: ['article_count'] });
    expect(sql).toContain('COUNT(resolved_by_article) AS "article_count"');
    // The defect's signature, gone: the star counted rows, not values.
    expect(sql).not.toContain('COUNT(*) AS "article_count"');
  });

  it('table-qualifies the counted column when the cube can join', async () => {
    const svc = sqlOnlyService(JOINED_METRICS);
    const { sql } = await sqlFor(svc, {
      cube: 'joined_case_metrics', measures: ['kb_resolved_count'], dimensions: ['industry'],
    });
    expect(sql).toContain('THEN "crm_case"."resolved_by_article" END)');
  });

  it('keeps COUNT(*) for a count that names NO field', async () => {
    const svc = sqlOnlyService(CASE_METRICS);
    const { sql } = await sqlFor(svc, { cube: 'case_metrics', measures: ['case_count'] });
    // `sql: '*'` IS the compiler's "no field declared" spelling; a star must
    // keep counting rows, or every unqualified `count` measure changes meaning.
    expect(sql).toContain('COUNT(*) AS "case_count"');
  });
});

// ── 2. per-measure filters reach the strict wrapper ─────────────────────────

describe('[#10298] `/api/v1/analytics/query` compiles every per-measure `filter`', () => {
  it('emits one conditional aggregate per filtered measure, and binds its comparand', async () => {
    const svc = sqlOnlyService(OPPORTUNITY_METRICS);
    const { sql, params } = await sqlFor(svc, {
      cube: 'opportunity_metrics',
      measures: ['opp_count', 'won_count', 'lost_count', 'won_amount'],
    });

    // The unfiltered measure is untouched…
    expect(sql).toContain('COUNT(*) AS "opp_count"');
    // …and each filtered one carries its own predicate.
    expect(sql).toContain('COUNT(CASE WHEN stage = $1 THEN 1 END) AS "won_count"');
    expect(sql).toContain('COUNT(CASE WHEN stage = $2 THEN 1 END) AS "lost_count"');
    expect(sql).toContain('SUM(CASE WHEN stage = $3 THEN amount END) AS "won_amount"');

    // Comparands are BOUND, in the order their placeholders appear. The SELECT
    // list precedes the WHERE clause and `$n` is positional, so a filter
    // compiled anywhere but inside the SELECT loop would misalign the binds.
    expect(params).toEqual(['closed_won', 'closed_lost', 'closed_won']);

    // The defect's exact signature from the card: three identical row counts.
    expect(sql).not.toContain('COUNT(*) AS "won_count"');
    expect(sql).not.toContain('COUNT(*) AS "lost_count"');
    expect(sql).not.toContain('SUM(amount) AS "won_amount"');
  });

  it('composes a measure `filter` with a measure `field` — the card\'s `kb_resolved_count`', async () => {
    const svc = sqlOnlyService(CASE_METRICS);
    const { sql, params } = await sqlFor(svc, {
      cube: 'case_metrics', measures: ['closed_count', 'kb_resolved_count'],
    });
    // Both scoped to closed cases; only the second counts a COLUMN's values.
    expect(sql).toContain('COUNT(CASE WHEN is_closed = $1 THEN 1 END) AS "closed_count"');
    expect(sql).toContain('COUNT(CASE WHEN is_closed = $2 THEN resolved_by_article END) AS "kb_resolved_count"');
    expect(params).toEqual([1, 1]);
  });

  it('applies the dataset\'s definition-level filter on the strict door too', async () => {
    const svc = sqlOnlyService(SCOPED_METRICS);
    const { sql, params } = await sqlFor(svc, {
      cube: 'scoped_metrics', measures: ['opp_count', 'won_count'],
    });
    // The dataset's intrinsic scope narrows the whole statement…
    expect(sql).toContain('WHERE is_deleted = $2');
    // …while the measure filter stays scoped to its own measure.
    expect(sql).toContain('COUNT(CASE WHEN stage = $1 THEN 1 END) AS "won_count"');
    expect(sql).toContain('COUNT(*) AS "opp_count"');
    expect(params).toEqual(['closed_won', 0]);
  });

  it('leaves a cube that is not a compiled dataset exactly as it was', async () => {
    const svc = new AnalyticsService({
      debugSql: true,
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async () => [],
      // A MANIFEST cube — no dataset registry entry, so there is nothing to
      // scope by and the emitted statement must be what it always was.
      cubes: [{
        name: 'crm_case', title: 'Cases', sql: 'crm_case', public: false,
        measures: {
          count: { name: 'count', label: 'Count', type: 'count', sql: '*' },
          amount_sum: { name: 'amount_sum', label: 'Amount', type: 'sum', sql: 'amount' },
        },
        dimensions: {},
      }],
    });
    const { sql, params } = await sqlFor(svc, { cube: 'crm_case', measures: ['count', 'amount_sum'] });
    expect(sql).toBe('SELECT COUNT(*) AS "count", SUM(amount) AS "amount_sum" FROM "crm_case"');
    expect(params).toEqual([]);
  });
});

// ── 3. both doors, one cube, real rows ──────────────────────────────────────

/** Point sql.js at the `.wasm` shipped inside its own package (Node-safe). */
async function locateWasm(): Promise<((file: string) => string) | undefined> {
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve('sql.js/package.json');
    const { dirname, join } = await import('node:path');
    const dir = dirname(pkgJsonPath);
    return (file: string) => join(dir, 'dist', file);
  } catch {
    return undefined;
  }
}

/**
 * The card's ground truth, row for row: 24 opportunities, 8 won summing to
 * 1,290,000, 5 lost, and a grand total of 5,632,500 — the number the broken
 * door answered for `won_amount`.
 */
interface Opp { amount: number; owner: string }
const WON: Opp[] = [
  { amount: 300_000, owner: 'u1' }, { amount: 250_000, owner: 'u2' },
  { amount: 200_000, owner: 'u1' }, { amount: 150_000, owner: 'u2' },
  { amount: 120_000, owner: 'u1' }, { amount: 110_000, owner: 'u2' },
  { amount: 100_000, owner: 'u1' }, { amount: 60_000, owner: 'u2' },
];
const LOST: Opp[] = [
  { amount: 90_000, owner: 'u1' }, { amount: 90_000, owner: 'u2' },
  { amount: 90_000, owner: 'u1' }, { amount: 90_000, owner: 'u2' },
  { amount: 90_000, owner: 'u1' },
];
const OPEN: Opp[] = [
  { amount: 350_000, owner: 'u2' }, { amount: 350_000, owner: 'u1' },
  { amount: 350_000, owner: 'u2' }, { amount: 350_000, owner: 'u1' },
  { amount: 350_000, owner: 'u2' }, { amount: 350_000, owner: 'u1' },
  { amount: 350_000, owner: 'u2' }, { amount: 350_000, owner: 'u1' },
  { amount: 350_000, owner: 'u2' }, { amount: 350_000, owner: 'u1' },
  { amount: 392_500, owner: 'u2' },
];
const ALL: Opp[] = [...WON, ...LOST, ...OPEN];
const sum = (rows: Opp[]) => rows.reduce((a, r) => a + r.amount, 0);

describe('[#10298] the dashboard door and the API door answer the same numbers', () => {
  let db: any;
  let svc: AnalyticsService;

  beforeAll(async () => {
    const mod: any = await import('sql.js');
    const initSqlJs = mod.default ?? mod;
    const locateFile = await locateWasm();
    const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);

    db = new SQL.Database();
    db.run(`CREATE TABLE "crm_opportunity" (
      "id" TEXT PRIMARY KEY, "stage" TEXT, "owner" TEXT, "amount" INTEGER
    );`);
    const insert = db.prepare(
      `INSERT INTO "crm_opportunity" ("id","stage","owner","amount") VALUES (?,?,?,?)`,
    );
    let n = 0;
    for (const r of WON) insert.run([`o${++n}`, 'closed_won', r.owner, r.amount]);
    for (const r of LOST) insert.run([`o${++n}`, 'closed_lost', r.owner, r.amount]);
    for (const r of OPEN) insert.run([`o${++n}`, 'prospecting', r.owner, r.amount]);
    insert.free();

    svc = new AnalyticsService({
      debugSql: true,
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async (_object: string, sql: string, params: unknown[]) => {
        const stmt = db.prepare(sql.replace(/\$\d+/g, '?'));
        stmt.bind(params as any[]);
        const out: Record<string, unknown>[] = [];
        while (stmt.step()) out.push(stmt.getAsObject());
        stmt.free();
        return out;
      },
    });
    svc.registerDataset(OPPORTUNITY_METRICS);
  });

  afterAll(() => db?.close());

  const MEASURES = ['opp_count', 'won_count', 'lost_count', 'won_amount'];

  it('the fixture really is the card\'s org: 24 opportunities, 8 won, 5 lost', () => {
    expect(ALL.length).toBe(24);
    expect(WON.length).toBe(8);
    expect(LOST.length).toBe(5);
    expect(sum(WON)).toBe(1_290_000);
    // The grand total is the card's WRONG answer for `won_amount` — the fixture
    // can still produce it, which is what makes the assertion below falsifiable.
    expect(sum(ALL)).toBe(5_632_500);
  });

  it('the API door answers the DECLARED numbers, not the unfiltered ones', async () => {
    const result = await svc.query({ cube: 'opportunity_metrics', measures: MEASURES });
    expect(result.rows[0]).toMatchObject({
      opp_count: 24, won_count: 8, lost_count: 5, won_amount: 1_290_000,
    });
    // The card's measured wrong answer, which the fixture can still produce.
    expect(result.rows[0]).not.toMatchObject({ won_count: 24 });
    expect(result.rows[0]).not.toMatchObject({ won_amount: 5_632_500 });
  });

  it('the dashboard door answers the same, for the same cube', async () => {
    const viaApi = await svc.query({ cube: 'opportunity_metrics', measures: MEASURES });
    const viaDashboard = await svc.queryDataset(OPPORTUNITY_METRICS, { measures: MEASURES });
    for (const m of MEASURES) {
      expect(viaDashboard.rows[0]?.[m]).toBe(viaApi.rows[0]?.[m]);
    }
  });

  it('and they agree grouped by a dimension the filters do NOT name', async () => {
    const selection = { measures: MEASURES, dimensions: ['owner'] };
    const viaApi = await svc.query({ cube: 'opportunity_metrics', ...selection });
    const viaDashboard = await svc.queryDataset(OPPORTUNITY_METRICS, selection);
    const byOwner = (rows: Record<string, unknown>[]) =>
      Object.fromEntries(rows.map((r) => [String(r.owner), r]));

    const api = byOwner(viaApi.rows);
    // Each owner holds 12 of the 24 deals, four of them won.
    expect(api.u1).toMatchObject({ opp_count: 12, won_count: 4, lost_count: 3 });
    expect(api.u2).toMatchObject({ opp_count: 12, won_count: 4, lost_count: 2 });
    expect(api.u1.won_amount).toBe(sum(WON.filter((r) => r.owner === 'u1')));
    expect(api.u2.won_amount).toBe(sum(WON.filter((r) => r.owner === 'u2')));
    // …and NOT each owner's whole book, which is what a dropped filter answers.
    expect(api.u1.won_amount).not.toBe(sum(ALL.filter((r) => r.owner === 'u1')));

    const dash = byOwner(viaDashboard.rows);
    for (const owner of ['u1', 'u2']) {
      for (const m of MEASURES) {
        expect(dash[owner]?.[m], `${owner}.${m} disagrees between the two doors`)
          .toBe(api[owner]?.[m]);
      }
    }
  });
});
