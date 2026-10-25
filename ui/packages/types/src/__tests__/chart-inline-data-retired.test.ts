/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ChartDataSeries.data` is an ADR-0049 RETIREMENT TOMBSTONE, and `categories`
 * is NOT retired — it is live with corrected prose (objectui#6896, maintainer
 * ruling 2026-08-31, decision batch #20 ③).
 *
 * ## What was measured
 *
 * The static `ChartSchema` node declared two data keys that its renderer does
 * not implement the way the declaration said:
 *
 *   1. `data: number[]` was REQUIRED on every authored series and read by
 *      nothing. `normalizeChartSchema`'s `normalizeSeries`
 *      (`@object-ui/plugin-charts`) reads `dataKey`/`name`, `label`,
 *      `chartType`/`type`, `variant`, `opacity`, `dashArray`, `stack`, `yAxis`
 *      and `color` — `data` is not among them. Rows come from the chart-level
 *      `data`, a key `ChartSchema` did not declare at the time, which survived
 *      only because `BaseSchema` carried an index signature.
 *   2. `categories` was documented as "X-axis labels/categories" and is read as
 *      an ALTERNATIVE SERIES LIST — consulted only when `series` is absent, each
 *      entry normalized as `{ dataKey }`. The category axis comes from
 *      `xAxisKey` / `xAxis`.
 *
 * The ruling split them: (1) is retired, immediately and without a dual-reading
 * window; (2) keeps its behaviour and its prose was corrected to match — prose
 * follows machine. Fixing only (1) was named as NOT a valid landing, so both
 * halves are pinned here.
 *
 * ## Why a tombstone and not a deletion
 *
 * `ChartDataSeriesSchema` is a NON-STRICT `z.object`, so a deleted key is
 * silently STRIPPED — one silent no-op traded for another. The tombstone keeps
 * the key DECLARED and unwritable: `?: never` on the interface (a `tsc` error at
 * the authoring site) and `retirementTombstone()` on the mirror (a parse refusal
 * whose message IS the migration note). The COUNTER-PROBE below builds the
 * deletion that was not chosen, in this same run, and measures the difference —
 * so "simplifying" the tombstone into a deletion turns this file red instead of
 * quietly restoring the silence.
 *
 * The `@ts-expect-error` directives are REAL enforcement: this package
 * type-checks its tests through `tsconfig.test.json`, so re-widening the
 * declaration fails the build on the unused directive.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { ChartDataSeries, ChartSchema } from '../data-display';
import { ChartDataSeriesSchema, ChartSchema as ChartZodSchema } from '../zod/data-display.zod';

/** A series authored the way the renderer actually reads one. */
const LIVE_SERIES = { name: 'Revenue', type: 'line', color: '#3b82f6' } as const;

/** The value an author following the old declaration would have written. */
const RETIRED_VALUE = [12000, 15000, 18000] as const;

const shapeOf = (schema: unknown): Record<string, unknown> =>
  (schema as { shape: Record<string, unknown> }).shape;

const describeOf = (schema: unknown, key: string): string | undefined =>
  (shapeOf(schema)[key] as { description?: string } | undefined)?.description;

/* ── (a) the tombstone: the `tsc` channel ────────────────────────────────── */

describe('objectui#6896 — `ChartDataSeries.data` is a tombstone at the type level', () => {
  it('refuses an authored `data` at the authoring site', () => {
    const series: ChartDataSeries = {
      name: 'Revenue',
      // @ts-expect-error `data` is a retirement tombstone (objectui#6896)
      data: [12000, 15000, 18000],
    };
    expect(series.name).toBe('Revenue');
  });

  it('no longer REQUIRES anything beyond `name` — the other half of the move', () => {
    // Before the retirement this did not compile: `data` was required, so every
    // author had to supply numbers that were then dropped. The accept set moves
    // in BOTH directions here, and this is the widening half.
    const series: ChartDataSeries = { name: 'Revenue' };
    expect(series.name).toBe('Revenue');
  });

  it('keeps `categories` LIVE and writable — it was NOT retired', () => {
    // No `@ts-expect-error`: the ruling kept this key's behaviour and corrected
    // its prose. If this line ever needs a directive, half (b) was undone.
    const chart: ChartSchema = {
      type: 'chart',
      chartType: 'bar',
      categories: ['revenue', 'expenses'],
      series: [],
    };
    expect(chart.categories).toEqual(['revenue', 'expenses']);
  });
});

/* ── (a) the tombstone: the parse channel, refusing loudly ───────────────── */

describe('objectui#6896 — the mirror REFUSES `data`, and the refusal carries its remedy', () => {
  it('a live series still parses GREEN — the non-vacuity control, in this test', () => {
    // Without this, a mirror that refused everything would satisfy every
    // assertion below by accident.
    const control = ChartDataSeriesSchema.safeParse(LIVE_SERIES);
    expect(control.success).toBe(true);
    if (control.success) {
      expect(control.data.name).toBe('Revenue');
      expect(control.data.type).toBe('line');
    }
  });

  it('a bare `{ name }` series parses green — `data` is no longer required', () => {
    const result = ChartDataSeriesSchema.safeParse({ name: 'Revenue' });
    expect(result.success).toBe(true);
  });

  it('refuses `data`, names it in the path, and answers with its own guidance', () => {
    const result = ChartDataSeriesSchema.safeParse({ ...LIVE_SERIES, data: [...RETIRED_VALUE] });
    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find((i) => String(i.path[0]) === 'data');
    expect(issue, 'no issue addressed to `data`').toBeDefined();

    // The accept-set contract: the same address and the same code a bare
    // `z.never()` reports. A `refine`-based spelling would report `custom`.
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.path).toEqual(['data']);

    // The message is the migration note, not zod's generic string.
    expect(issue!.message).not.toContain('Invalid input: expected never, received ');
    expect(issue!.message).toContain('RETIRED (ADR-0049)');
    expect(issue!.message).toContain('`xAxisKey`');

    // ONE string, BOTH channels — the invariant `retirementTombstone()` exists
    // to make unbreakable. Asserted derived, which is why the literal anchors
    // above sit beside it: two empty strings are also equal.
    expect(issue!.message).toBe(describeOf(ChartDataSeriesSchema, 'data'));
  });

  it('refuses it through the whole chart node, not just the bare series', () => {
    const result = ChartZodSchema.safeParse({
      type: 'chart',
      chartType: 'bar',
      series: [{ name: 'Revenue', data: [...RETIRED_VALUE] }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'series.0.data');
      expect(issue, 'no issue addressed to `series.0.data`').toBeDefined();
      expect(issue!.message).toContain('RETIRED (ADR-0049)');
    }
  });
});

/* ── ANNOUNCED, not merely gone ──────────────────────────────────────────── */

describe('objectui#6896 — the retirement is ANNOUNCED', () => {
  it('`data` stays in the mirror\'s shape — a tombstone is DECLARED, just unwritable', () => {
    expect(shapeOf(ChartDataSeriesSchema)).toHaveProperty('data');
    const text = describeOf(ChartDataSeriesSchema, 'data');
    expect(text).toBeDefined();
    expect(text).toContain('RETIRED (ADR-0049)');
    // The announcement names a REMEDY, not just a removal. This is the half a
    // silent deletion cannot carry at all.
    expect(text).toContain('chart-level `data`');
    expect(text).toContain('`xAxisKey`');
  });
});

/* ── THE COUNTER-PROBE: the deletion this retirement did not choose ──────── */

describe('objectui#6896 — the counter-probe: a deletion would restore the silence', () => {
  /**
   * The same series schema with `data` simply ABSENT — non-strict, exactly as
   * `ChartDataSeriesSchema` is. Built here so the contrast is measured in this
   * run rather than recalled from a comment.
   */
  const DELETION_SHAPED = z.object({
    name: z.string(),
    type: z.enum(['bar', 'line', 'area']).optional(),
    color: z.string().optional(),
  });

  it('the deletion ACCEPTS an authored `data` and strips it in silence', () => {
    const result = DELETION_SHAPED.safeParse({ ...LIVE_SERIES, data: [...RETIRED_VALUE] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty('data');
  });

  it('the deletion announces NOTHING — no shape entry, no guidance', () => {
    expect(shapeOf(DELETION_SHAPED)).not.toHaveProperty('data');
    expect(describeOf(DELETION_SHAPED, 'data')).toBeUndefined();
  });

  it('the shipped schema does the OPPOSITE on the same input — refuses, and says why', () => {
    // This is the probe. If the tombstone is ever "simplified" into a deletion,
    // the shipped schema starts behaving like DELETION_SHAPED above and this
    // assertion goes red — which is the whole reason the contrast is built here
    // instead of being asserted about the shipped schema alone.
    const shipped = ChartDataSeriesSchema.safeParse({ ...LIVE_SERIES, data: [...RETIRED_VALUE] });
    const deleted = DELETION_SHAPED.safeParse({ ...LIVE_SERIES, data: [...RETIRED_VALUE] });
    expect(deleted.success).toBe(true);
    expect(shipped.success).toBe(false);
    expect(describeOf(ChartDataSeriesSchema, 'data')).toBeDefined();
  });

  it('an UNDECLARED key still rides through — the silence a tombstone is measured against', () => {
    const result = ChartDataSeriesSchema.safeParse({ ...LIVE_SERIES, notAKeyAtAll: 'anything' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty('notAKeyAtAll');
  });
});

/* ── (b) `categories`: prose follows machine ─────────────────────────────── */

describe('objectui#6896 — `categories` is live, and its prose now states the read', () => {
  it('still parses a list of strings — the behaviour is untouched', () => {
    const result = ChartZodSchema.safeParse({
      type: 'chart',
      chartType: 'bar',
      categories: ['revenue', 'expenses'],
      series: [],
    });
    expect(result.success).toBe(true);
  });

  it('the published description says SERIES LIST, and denies the axis reading', () => {
    // The docblock in `../data-display.ts` is the other half of this pair; the
    // behaviour itself is pinned in `@object-ui/plugin-charts`'
    // `normalizeChartSchema.test.ts`, which is where the read lives.
    const text = describeOf(ChartZodSchema, 'categories');
    expect(text).toBeDefined();
    expect(text).toContain('series list');
    expect(text).toContain('`series` is absent');
    expect(text).toContain('NOT axis labels');
    // The correction is the point: the old text must not survive anywhere in
    // the published metadata.
    expect(text).not.toContain('X-axis categories');
  });

  it('is NOT a tombstone — writing it is accepted, unlike `data`', () => {
    const written = ChartDataSeriesSchema.safeParse({ ...LIVE_SERIES, data: [1] });
    const live = ChartZodSchema.safeParse({
      type: 'chart', chartType: 'bar', categories: ['a'], series: [],
    });
    expect(written.success).toBe(false);
    expect(live.success).toBe(true);
  });
});
