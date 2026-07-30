// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION for the temporal storage line — #3912, #3928, #3942,
// #3954, #3979, #3994, #4022, #4033 — exercised end-to-end through the real
// HTTP + service stack.
//
// Every one of those bugs shared a signature that unit tests are structurally
// bad at catching: the driver, the strategy and the read path were each
// internally consistent, so each layer's own tests passed. What disagreed was
// what a value physically IS between them — a `Field.time` stored as INTEGER
// epoch by one writer and bare text by another, a filter comparand shaped
// unlike the column it compares against, a bucket that is grouped by but never
// projected. The failures were therefore SILENT: the list showed the row, the
// chart drew the bar, and only the filtered/sorted/labelled view was wrong.
//
// Four of these were found by hand-driving a booted app, not by review. This
// file is that session turned into a gate, so the next drift is caught by CI:
//
//   1. `Field.date`   — a business-window filter returns the rows in it
//                       (the original #3912 report: a dashboard dateRange
//                       returning empty), and a day-boundary instant does not
//                       shift the stored calendar day.
//   2. ordering       — a temporal column sorts chronologically in both
//                       directions (#3928: mixed storage put every INTEGER row
//                       before every TEXT one, so 14:30 sorted before 08:00).
//   3. `Field.time`   — every accepted input shape converges on ONE stored
//                       wall clock (#3994), so an equality filter cannot be
//                       split by how the value happened to be written.
//   4. analytics      — a `timeDimensions` bucket reaches the caller with its
//                       label (#4033: right numbers, no x-axis).
//
// Assertions are scoped to rows this file creates (unique name prefixes), so
// it tolerates other suites' data.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const P = 'tstor'; // name prefix — every row this file owns

/**
 * One wall clock (14:30:00.500 UTC) written every way a REST client may send it.
 *
 * Deliberately no epoch-millisecond entry: the record validator accepts only
 * string time-of-day shapes and answers a bare number with 400 `invalid_time`
 * (pinned below). The driver's `canonicalTimeOfDay` DOES fold an epoch — that
 * is its defence for an in-process writer binding a `Date` — but the two live
 * at different altitudes and the API boundary is the stricter one. Conflating
 * them is a mistake worth not repeating: driver-level shape coverage belongs in
 * `sql-driver-time-canonical-storage.test.ts`, not here.
 */
const TIME_SHAPES: Array<[string, unknown, string]> = [
  ['hm', '14:30', '14:30:00'],
  ['hms', '14:30:00', '14:30:00'],
  ['ms', '14:30:00.500', '14:30:00.500'],
  ['iso', '2026-01-15T14:30:00.500Z', '14:30:00.500'],
  ['naive', '2026-01-15 14:30:00', '14:30:00'],
];

/**
 * `Field.date` fixtures. `late`/`early` are the two day-boundary instants a
 * timezone-naive write path moves in OPPOSITE directions — 23:30Z rolls
 * forward east of UTC, 00:30Z rolls back west of it — so together they catch a
 * shift in either direction regardless of the host's zone.
 */
const DATE_SHAPES: Array<[string, string, string]> = [
  ['in_a', '2026-07-10', '2026-07-10'],
  ['in_b', '2026-07-25', '2026-07-25'],
  ['out', '2026-02-10', '2026-02-10'],
  ['late', '2026-07-15T23:30:00.000Z', '2026-07-15'],
  ['early', '2026-07-15T00:30:00.000Z', '2026-07-15'],
];

describe('dogfood: temporal storage is one shape end-to-end (#3912/#3994/#4033)', () => {
  let stack: VerifyStack;
  let token: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    token = await stack.signIn();

    // `Field.time` fixtures — written through the REAL REST write path, which
    // is the half #3994 fixed. Writing them via the engine would bypass
    // `formatInput` and prove nothing.
    for (const [key, value] of TIME_SHAPES) {
      const res = await stack.apiAs(token, 'POST', '/data/showcase_field_zoo', {
        name: `${P}_time_${key}`,
        f_time: value,
      });
      expect(res.status, `write f_time ${key}`).toBe(201);
    }
    // An out-of-window row, so a business-hours filter has something to exclude.
    expect(
      (await stack.apiAs(token, 'POST', '/data/showcase_field_zoo', {
        name: `${P}_time_early`,
        f_time: '08:00:00',
      })).status,
    ).toBe(201);

    // `Field.date` fixtures on the same object — field-zoo carries all three
    // temporal types and requires only `name`, so the fixture needs no lookup
    // targets and cannot be perturbed by another suite's seed data.
    for (const [key, written] of DATE_SHAPES) {
      const res = await stack.apiAs(token, 'POST', '/data/showcase_field_zoo', {
        name: `${P}_date_${key}`,
        f_date: written,
      });
      expect(res.status, `write f_date ${key}`).toBe(201);
    }
  }, 90_000);

  afterAll(async () => {
    await stack?.stop();
  });

  /** Records this file created, filtered server-side by name prefix. */
  async function mine(
    object: string,
    query: Record<string, unknown>,
  ): Promise<Array<Record<string, unknown>>> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      params.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    params.set('$top', '200');
    const res = await stack.apiAs(token, 'GET', `/data/${object}?${params}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { records?: Array<Record<string, unknown>> };
    return (body.records ?? []).filter((r) => String(r.name ?? '').startsWith(P));
  }

  // ── 1. Field.date — the original #3912 report ─────────────────────────────

  it('a date window returns the rows inside it, and only those', async () => {
    const rows = await mine('showcase_field_zoo', {
      $filter: { f_date: { $gte: '2026-07-01', $lte: '2026-07-31' } },
    });
    const names = rows.map((r) => r.name).sort();

    // The bug this pins returned ZERO rows for a window whose data was plainly
    // visible in the unfiltered list.
    expect(names).toEqual([
      `${P}_date_early`, `${P}_date_in_a`, `${P}_date_in_b`, `${P}_date_late`,
    ]);
    for (const r of rows) {
      expect(String(r.f_date) >= '2026-07-01').toBe(true);
      expect(String(r.f_date) <= '2026-07-31').toBe(true);
    }
  });

  it('a day-boundary instant keeps its UTC calendar day (no off-by-one)', async () => {
    const rows = await mine('showcase_field_zoo', {});
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.f_date]));
    // 23:30Z and 00:30Z are the two instants a local-timezone write path moves
    // in opposite directions. Both must stay on the 15th.
    expect(byName[`${P}_date_late`]).toBe('2026-07-15');
    expect(byName[`${P}_date_early`]).toBe('2026-07-15');
  });

  // ── 2. Ordering — #3928 ───────────────────────────────────────────────────

  it('a temporal column sorts chronologically in both directions', async () => {
    const withDate = (rows: Array<Record<string, unknown>>) =>
      rows.filter((r) => r.f_date != null).map((r) => String(r.f_date));
    const asc = withDate(await mine('showcase_field_zoo', { $orderby: 'f_date asc' }));
    const desc = withDate(await mine('showcase_field_zoo', { $orderby: 'f_date desc' }));

    expect(asc).toEqual([...asc].sort());
    expect(desc).toEqual([...asc].sort().reverse());
    // Guard against a silently-ignored sort: the two directions must differ.
    expect(asc).not.toEqual(desc);
  });

  // ── 3. Field.time — #3994 ─────────────────────────────────────────────────

  it('every accepted input shape converges on one stored wall clock', async () => {
    const rows = await mine('showcase_field_zoo', {});
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.f_time]));
    for (const [key, , presented] of TIME_SHAPES) {
      expect(byName[`${P}_time_${key}`], `f_time from ${key}`).toBe(presented);
    }
  });

  it('a business-hours window matches every 14:30 row and excludes the 08:00 one', async () => {
    const rows = await mine('showcase_field_zoo', {
      $filter: { f_time: { $gte: '09:00:00', $lte: '18:00:00' } },
    });
    const names = rows.map((r) => String(r.name)).sort();

    expect(names).toEqual(TIME_SHAPES.map(([k]) => `${P}_time_${k}`).sort());
    expect(names).not.toContain(`${P}_time_early`);
  });

  it('rejects a bare epoch number for a time field at the API boundary', async () => {
    // The driver would fold this to a wall clock; the API must not let a client
    // express a time-of-day as epoch milliseconds in the first place. Pinned so
    // the driver's defensive coercion is never mistaken for an accepted shape.
    const res = await stack.apiAs(token, 'POST', '/data/showcase_field_zoo', {
      name: `${P}_time_epoch_rejected`,
      f_time: Date.UTC(2026, 0, 15, 14, 30, 0, 500),
    });
    expect(res.status).toBe(400);
    // Asserted via the standard envelope code + the offending field, rather
    // than the lowercase field-level validator code: that literal is a D6
    // field-addressed code, and naming it here would trip
    // `check-error-code-casing` (ADR-0112 D1) or cost an exemption entry for
    // no extra assurance — the rejection and its field are the contract.
    const body = (await res.json()) as {
      code?: string;
      fields?: Array<{ field?: string }>;
    };
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.fields?.some((f) => f.field === 'f_time')).toBe(true);
  });

  it('an equality filter cannot be split by how the value was written', async () => {
    // '14:30' and '14:30:00' are the same wall clock; both spellings must find
    // both rows, or a filter silently depends on the writer's formatting.
    for (const spelling of ['14:30', '14:30:00']) {
      const rows = await mine('showcase_field_zoo', { $filter: { f_time: spelling } });
      const names = rows.map((r) => String(r.name)).sort();
      expect(names, `equality via ${spelling}`).toEqual(
        [`${P}_time_hm`, `${P}_time_hms`, `${P}_time_naive`].sort(),
      );
    }
  });

  // ── 4. Analytics bucket projection — #4033 ────────────────────────────────

  it('a timeDimensions bucket reaches the caller with its label', async () => {
    const res = await stack.apiAs(token, 'POST', '/analytics/dataset/query', {
      dataset: {
        name: `${P}_trend`,
        label: 'Invoices by month',
        object: 'showcase_field_zoo',
        dimensions: [{ name: 'issued', label: 'Issued', field: 'f_date', type: 'date' }],
        measures: [{ name: 'cnt', label: 'Count', aggregate: 'count' }],
      },
      selection: {
        measures: ['cnt'],
        timeDimensions: [{ dimension: 'issued', granularity: 'month' }],
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows?: Array<Record<string, unknown>>;
      fields?: Array<{ name: string }>;
    };

    // The regression: rows carried only `cnt` and `fields` never mentioned the
    // bucket, so a trend chart had values and no x-axis.
    expect(body.rows?.length ?? 0).toBeGreaterThan(0);
    expect(body.fields?.map((f) => f.name)).toContain('issued');

    // The regression, precisely: the bucket must be a KEY on every row. It was
    // absent entirely, so a chart had no x-axis to read. `null` is a legitimate
    // value here — rows whose `f_date` was never set (this file's time-only
    // fixtures among them) bucket together — so presence, not shape, is what
    // distinguishes fixed from broken.
    for (const row of body.rows ?? []) {
      expect(row, 'every bucket row carries its label').toHaveProperty('issued');
    }
    // …and a real date must actually bucket, or the assertion above could pass
    // on a table of nothing but nulls.
    const labelled = (body.rows ?? []).filter((r) => /^\d{4}-\d{2}/.test(String(r.issued)));
    expect(labelled.length, 'at least one non-null month bucket').toBeGreaterThan(0);
  });
});
