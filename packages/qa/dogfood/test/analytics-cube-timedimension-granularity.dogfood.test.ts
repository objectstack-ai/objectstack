// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#13714 — a cube query with a `timeDimensions[].granularity` is
 * SERVED, over real HTTP, on a real SQL driver.
 *
 * ## Why this suite exists at THIS layer
 *
 * The card is a field report from a running deployment, and it names the trap
 * itself: the date-bucket parity pins (#3773 date-bucket-parity, #3839
 * empty-group-parity) were GREEN the whole time the endpoint answered 500,
 * because they exercise bucketing at a layer that never carries what actually
 * breaks. So a repair verified only at that layer cannot reproduce the defect,
 * and this file is the half that can: `POST /api/v1/analytics/query`, through
 * the real Hono app, the real analytics strategy fork, the real
 * `engine.aggregate` dispatch and a real SQL driver.
 *
 * ## The reported request, and the fork underneath it
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
 * A measure is addressed on the wire as `<cube>.<measure>`, and
 * `ObjectQLStrategy` uses that dotted name verbatim as the driver-level
 * aggregation `alias` — it is the key the caller reads its own number back
 * under. `driver-sql` then bound that alias through knex's `??`, which SPLITS a
 * dotted identifier into `table.column`, so the statement reached the database
 * as `count(*) as \`showcase_delivery\`.\`count\`` and was refused before it ran.
 *
 * ⚠️ The granularity is the ROUTER, not the fault. `NativeSQLStrategy.canHandle`
 * declines exactly on `timeDimensions[].granularity`, and that face hand-writes
 * `AS "<measure>"` — one quoted identifier, already correct. That is precisely
 * why the report's controls (same cube, same measure, `dimensions` instead of a
 * granularity) answered 200 while the bucketed query answered 500, and both
 * halves are asserted here so the fork itself stays pinned.
 *
 * ## Coverage boundary, stated rather than implied
 *
 * `bootStack` runs `driver-sqlite-wasm`, which inherits `aggregate()` from
 * `SqlDriver`; the report was filed against `better-sqlite3`, which inherits the
 * same method. The per-dialect measurement — better-sqlite3 embedded, Postgres
 * and MySQL live — is
 * `packages/drivers/driver-sql/src/sql-driver-13714-aggregate-alias-single-identifier.test.ts`,
 * which runs the live-dialect matrix. What THIS file adds that no driver suite
 * can is the road: that a granularity really does route off the native face onto
 * this door, over HTTP, in a booted app.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AnalyticsServicePlugin } from '@objectstack/service-analytics';
import { DateGranularity } from '@objectstack/spec/data';
import { tdFixtureStack, TdDeliveryCube } from './fixtures/analytics-timedimension-fixture.js';

const CUBE = 'td_delivery_cube';
const COUNT = `${CUBE}.count`;
const HOURS = `${CUBE}.total_estimate_hours`;
const DUE_DATE = `${CUBE}.due_date`;
const STATUS = `${CUBE}.status`;

/** Two months, three rows — enough for a `month` bucket to have work to do. */
const SEED = [
  { name: 'jan-a', status: 'open', due_date: '2026-01-15', estimate_hours: 2 },
  { name: 'jan-b', status: 'open', due_date: '2026-01-20', estimate_hours: 3 },
  { name: 'feb-a', status: 'done', due_date: '2026-02-05', estimate_hours: 4 },
];

type AnalyticsBody = { rows?: Array<Record<string, unknown>>; error?: unknown; code?: string };

describe('dogfood: a cube time-dimension granularity is served, not a 500 (#13714)', () => {
  let stack: VerifyStack;
  let token: string;

  beforeAll(async () => {
    stack = await bootStack(tdFixtureStack as never, {
      analytics: new AnalyticsServicePlugin({ cubes: [TdDeliveryCube] }),
    });
    token = await stack.signIn();

    for (const row of SEED) {
      const res = await stack.apiAs(token, 'POST', '/data/td_delivery', row);
      expect(res.status, `seeding ${row.name}`).toBeLessThan(300);
    }
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  const query = async (body: Record<string, unknown>): Promise<{ status: number; body: AnalyticsBody }> => {
    const res = await stack.apiAs(token, 'POST', '/analytics/query', { cube: CUBE, ...body });
    return { status: res.status, body: (await res.json()) as AnalyticsBody };
  };

  // ───────────────────────────────────────────────────────────────
  // THE CARD — every granularity the spec declares, not just `month`
  // ───────────────────────────────────────────────────────────────

  for (const granularity of DateGranularity.options) {
    it(`granularity '${granularity}' answers 200 and counts every row exactly once`, async () => {
      const { status, body } = await query({
        measures: [COUNT],
        timeDimensions: [{ dimension: DUE_DATE, granularity }],
      });

      expect(status, `${granularity}: ${JSON.stringify(body).slice(0, 400)}`).toBe(200);

      const rows = body.rows ?? [];
      expect(rows.length, `${granularity}: at least one bucket`).toBeGreaterThan(0);
      // The caller reads the number back under the name it asked for. A
      // response keyed `count` instead would be the silent half of the same
      // defect — the alias split leaves the last segment behind.
      for (const row of rows) {
        expect(Object.keys(row), `${granularity}: the caller's own measure key`).toContain(COUNT);
      }
      const total = rows.reduce((sum, r) => sum + Number(r[COUNT] ?? 0), 0);
      expect(total, `${granularity}: no row dropped, none double-counted`).toBe(SEED.length);
    });
  }

  it("'month' puts the two January rows in one bucket and February in another", async () => {
    // The report's exact shape, and the assertion that the buckets are the RIGHT
    // buckets rather than merely present — a single collapsed bucket is the
    // #3773 failure mode and would satisfy the count total above.
    const { status, body } = await query({
      measures: [COUNT],
      timeDimensions: [{ dimension: DUE_DATE, granularity: 'month' }],
    });

    expect(status).toBe(200);
    const byBucket = new Map(
      (body.rows ?? []).map((r) => [String(r[DUE_DATE]).slice(0, 7), Number(r[COUNT])]),
    );
    expect(byBucket.get('2026-01')).toBe(2);
    expect(byBucket.get('2026-02')).toBe(1);
  });

  it('a bucketed SUM measure answers too — the count is not a special case', async () => {
    const { status, body } = await query({
      measures: [HOURS],
      timeDimensions: [{ dimension: DUE_DATE, granularity: 'month' }],
    });

    expect(status).toBe(200);
    const total = (body.rows ?? []).reduce((sum, r) => sum + Number(r[HOURS] ?? 0), 0);
    expect(total).toBe(9);
  });

  it('two measures bucketed together keep their own two columns', async () => {
    const { status, body } = await query({
      measures: [COUNT, HOURS],
      timeDimensions: [{ dimension: DUE_DATE, granularity: 'month' }],
    });

    expect(status).toBe(200);
    for (const row of body.rows ?? []) {
      expect(Object.keys(row)).toEqual(expect.arrayContaining([COUNT, HOURS]));
    }
  });

  it('a granularity ALONGSIDE a plain dimension is served', async () => {
    const { status, body } = await query({
      measures: [COUNT],
      dimensions: [STATUS],
      timeDimensions: [{ dimension: DUE_DATE, granularity: 'month' }],
    });

    expect(status).toBe(200);
    const total = (body.rows ?? []).reduce((sum, r) => sum + Number(r[COUNT] ?? 0), 0);
    expect(total).toBe(SEED.length);
  });

  // ───────────────────────────────────────────────────────────────
  // THE REPORT'S OWN CONTROLS — these were 200 before the fix and must stay 200
  // ───────────────────────────────────────────────────────────────

  it('CONTROL: measure by a plain dimension still answers 200 and reconciles', async () => {
    const { status, body } = await query({ measures: [COUNT], dimensions: [STATUS] });

    expect(status).toBe(200);
    const byStatus = new Map((body.rows ?? []).map((r) => [String(r[STATUS]), Number(r[COUNT])]));
    expect(byStatus.get('open')).toBe(2);
    expect(byStatus.get('done')).toBe(1);
  });

  it('CONTROL: a second measure by status still answers 200', async () => {
    const { status, body } = await query({ measures: [HOURS], dimensions: [STATUS] });

    expect(status).toBe(200);
    const byStatus = new Map((body.rows ?? []).map((r) => [String(r[STATUS]), Number(r[HOURS])]));
    expect(byStatus.get('open')).toBe(5);
    expect(byStatus.get('done')).toBe(4);
  });

  it('CONTROL: the entry validator still refuses a malformed body at 400', async () => {
    // ⛔ The boundary the card draws around the fix: this defect must NOT be
    // "solved" by refusing the legitimate query at entry. The entry layer was
    // correct all along, and it stays exactly as loud as it was.
    const res = await stack.apiAs(token, 'POST', '/analytics/query', {
      cube: CUBE,
      measures: [COUNT],
      timeDimensions: [{ dimension: DUE_DATE, granularity: 'fortnight' }],
    });

    expect(res.status).toBe(400);
  });

  it('CONTROL: the buckets reconcile against /data — the same rows, counted', async () => {
    // The report reconciled its own controls against `/data`; so does this, so a
    // green bucket total cannot come from an empty or a differently-scoped read.
    const res = await stack.apiAs(token, 'GET', '/data/td_delivery');
    expect(res.status).toBe(200);
    const data = (await res.json()) as { data?: unknown[]; rows?: unknown[] };
    const records = (data.data ?? data.rows ?? []) as unknown[];
    expect(records).toHaveLength(SEED.length);
  });
});
