/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7546 — `ChartDataSeriesSchema` declares the SIX series keys its
 * renderer reads and honours: `label`, `variant`, `opacity`, `dashArray`,
 * `stack`, `yAxis`. The seventh key the review found, `chartType`, was measured
 * NOT live on this authoring face and deliberately left undeclared by this card —
 * REPORTED for its own card. That card, objectui#7694, has since ruled and landed
 * the shape (a named alias refusal pointing at `type`); block (d) below now pins
 * the HANDOFF, and `chart-series-chart-type-alias-refusal-7694.test.ts` pins the
 * refusal itself.
 *
 * ## The defect (measured RED on origin/main a472b071 before the declaration)
 *
 * `ChartDataSeriesSchema` is a NON-STRICT `z.object`, unlike `BaseSchema`'s
 * `.passthrough()`: an undeclared key is STRIPPED in silence and `safeParse`
 * still reports success. The card's own fixture reproduced exactly:
 *
 *     input : { name, label, stack, yAxis, opacity, dashArray, variant }
 *     parse : success = true
 *     output: { name }
 *
 * Every one of the six is read by `normalizeSeries`
 * (`@object-ui/plugin-charts`, `normalizeChartSchema.ts:242-255`) and does real
 * work downstream in `AdvancedChartImpl.tsx`: `label` names the legend entry
 * (:1364, :1592; `ChartRenderer.tsx:157`), `variant === 'comparison'` selects
 * the muted overlay treatment (:2010-2033), `opacity` / `dashArray` set the
 * stroke and fill (:94-96), `stack` becomes Recharts' `stackId` (:1893, :2023)
 * and `yAxis` binds the series to the secondary axis (:1887, :2019, :2025).
 *
 * ## The ruling (comment 5548523375): measure per key, declare what is live
 *
 * "The renderer reads it" was ruled INSUFFICIENT evidence of liveness (a read
 * leg can sit on a value nothing produces — objectui#7642). So each key was
 * measured on three axes, with a lit control on every count: (1) producers,
 * (2) real work in the reader, (3) whether declaring it could surprise a
 * consumer. The six are the spec's own canonical `ChartSeriesSchema` members
 * (`@objectstack/spec/ui`, `chart.zod.ts:243-276`) under the same names and
 * with the same value domains; this node's `series` accepts the spec shape by
 * design ("both shapes" — `ChartRenderer.tsx:55-66`), in-repo producers write
 * them onto `type: 'chart'` nodes (`DashboardRenderer.tsx:648-652` `label`;
 * `ObjectChart.tsx:852-856` and `DatasetWidget.tsx:1444-1447` `variant`,
 * `chartType`, `yAxis` — internal-shape callers, see block (b);
 * `core/utils/chart-presentation.ts:126-131` all six on the dataset path),
 * and the narrowings (`variant`, `yAxis`) are design intent the reader already
 * enforces. Declaring them widens the accept set only toward what already
 * renders. `variant` is the spec's PAIR, not the normalizer's three: the third
 * spelling, `current`, is the renderer's internal default written only by the
 * two internal-shape producers above, which never meet this mirror.
 *
 * ## The seventh — `chartType` — measured, and NOT declared
 *
 * The same instrument reads it differently on every axis. (1) Zero producers
 * on this authoring face — no doc, fixture, catalog entry or designer input
 * writes `chartType` on a series (controls `name` / `dataKey` / `color` lit in
 * the same query); its only literal producers pass the renderer's INTERNAL
 * shape directly. (2) The spec's `ChartSeriesSchema` does not declare it — it
 * lists `chartType` in its `aliases` map as a spelling of `type`, refused by
 * name (`chart.zod.ts:231`), and this package's own `ChartDataSeries.type`
 * docblock (objectui#6121) calls `type` the AUTHOR spelling and `chartType`
 * the internal one. (3) Declaring it would mint a second writable name for the
 * same override, against the spec's alias posture — the N-dialects hazard
 * AGENTS.md #0.1 names. So it is REPORTED, per the ruling, not declared and
 * not retired: the right shape for it (a named alias refusal pointing at
 * `type`, as the spec does; or a fold) is a contract decision for its own card.
 * That card is objectui#7694, and it took the refusal — see block (d).
 */

import { describe, it, expect } from 'vitest';
import type { ChartDataSeries } from '../data-display';
import { ChartDataSeriesSchema } from '../zod/data-display.zod';

/** The card's own fixture — byte-for-byte the input it measured. */
const CARD_FIXTURE = {
  name: 'Revenue',
  label: 'Revenue (USD)',
  stack: 'money',
  yAxis: 'right',
  opacity: 0.4,
  dashArray: '4 4',
  variant: 'comparison',
} as const;

const SIX = ['label', 'variant', 'opacity', 'dashArray', 'stack', 'yAxis'] as const;

const shapeOf = (schema: unknown): Record<string, unknown> =>
  (schema as { shape: Record<string, unknown> }).shape;

const refusalPaths = (input: unknown): string[] => {
  const r = ChartDataSeriesSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
};

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/* ── (a) the reproduction: the card's fixture, every key surviving ────────── */

describe('objectui#7546 — the card fixture parses green AND every authored key survives', () => {
  it('reproduces the card measurement, inverted: output equals input, not `{ name }`', () => {
    // RED on the untouched base: success is true and the output is `{ name: 'Revenue' }`.
    const r = ChartDataSeriesSchema.safeParse(CARD_FIXTURE);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual(CARD_FIXTURE);
  });

  it.each(SIX)('`%s` survives the parse with its authored value', (key) => {
    const r = ChartDataSeriesSchema.safeParse(CARD_FIXTURE);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toHaveProperty(key, CARD_FIXTURE[key]);
  });

  it('CONTROL — a key declared BEFORE this change survives under the same query', () => {
    // `name` / `type` / `color` were declared on the base; if this fails the
    // instrument is dark, and the six readings above say nothing.
    const r = ChartDataSeriesSchema.safeParse({ name: 'Revenue', type: 'line', color: '#3b82f6' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toHaveProperty('name', 'Revenue');
      expect(r.data).toHaveProperty('type', 'line');
      expect(r.data).toHaveProperty('color', '#3b82f6');
    }
  });

  it('the six are on the mirror\'s OWN shape — what `zod-mirror-parity` reads', () => {
    for (const key of SIX) expect(shapeOf(ChartDataSeriesSchema)).toHaveProperty(key);
  });
});

/* ── (b) the declarations narrow to what the renderer honours ─────────────── */

describe('objectui#7546 — each declaration is the read\'s own value domain, not `unknown`', () => {
  it.each(['primary', 'comparison'] as const)('`variant: %s` is accepted — the spec\'s own pair', (v) => {
    expect(ChartDataSeriesSchema.safeParse({ name: 'r', variant: v }).success).toBe(true);
  });

  it('`variant` refuses the renderer-internal `current` spelling — not a member of the published face', () => {
    // `normalizeSeries` tolerates `current` (`normalizeChartSchema.ts:247`), but
    // it is written only by the compare-to producers onto `dataKey`-shaped
    // arrays handed straight to `ChartRenderer` (`ObjectChart.tsx:852`,
    // `DatasetWidget.tsx:1486`) — they never meet this mirror — and by nothing
    // an author writes. The spec's `ChartSeries.variant` is the pair; declaring
    // a third value here would fossilise a renderer-side tolerance into a
    // second contract (AGENTS.md #0.1). The normalizer's tolerance itself is
    // objectui#7682's decision, untouched by this card.
    expect(refusalPaths({ name: 'r', variant: 'current' })).toEqual(['variant']);
  });

  it('`variant` refuses a value the renderer would drop in silence, at its own path', () => {
    expect(refusalPaths({ name: 'r', variant: 'bogus' })).toEqual(['variant']);
  });

  it.each(['left', 'right'] as const)('`yAxis: %s` is accepted', (v) => {
    expect(ChartDataSeriesSchema.safeParse({ name: 'r', yAxis: v }).success).toBe(true);
  });

  it('`yAxis` refuses a side the renderer does not bind', () => {
    expect(refusalPaths({ name: 'r', yAxis: 'top' })).toEqual(['yAxis']);
  });

  it('`opacity` is a FINITE number — exactly `num()`\'s `Number.isFinite` gate', () => {
    expect(ChartDataSeriesSchema.safeParse({ name: 'r', opacity: 0.4 }).success).toBe(true);
    expect(refusalPaths({ name: 'r', opacity: '0.4' })).toEqual(['opacity']);
    expect(refusalPaths({ name: 'r', opacity: Number.POSITIVE_INFINITY })).toEqual(['opacity']);
  });

  it('`dashArray` and `stack` are strings', () => {
    expect(ChartDataSeriesSchema.safeParse({ name: 'r', dashArray: '4 2', stack: 'g' }).success).toBe(true);
    expect(refusalPaths({ name: 'r', dashArray: 4 })).toEqual(['dashArray']);
    expect(refusalPaths({ name: 'r', stack: 1 })).toEqual(['stack']);
  });

  it('`label` takes the spec\'s `I18nLabel` — a string OR an inline locale map, as `label()` reads', () => {
    expect(ChartDataSeriesSchema.safeParse({ name: 'r', label: 'Revenue' }).success).toBe(true);
    const map = ChartDataSeriesSchema.safeParse({ name: 'r', label: { en: 'Revenue', 'zh-CN': '收入' } });
    expect(map.success).toBe(true);
    if (map.success) expect(map.data.label).toEqual({ en: 'Revenue', 'zh-CN': '收入' });
    expect(refusalPaths({ name: 'r', label: 42 })).toEqual(['label']);
  });
});

/* ── (c) the TypeScript face moves in lockstep ────────────────────────────── */

describe('objectui#7546 — the `ChartDataSeries` interface declares the same six', () => {
  it('a series authored with all six type-checks and round-trips', () => {
    const series: ChartDataSeries = {
      name: 'Revenue',
      label: { en: 'Revenue' },
      variant: 'comparison',
      opacity: 0.4,
      dashArray: '4 4',
      stack: 'money',
      yAxis: 'right',
    };
    expect(ChartDataSeriesSchema.parse(series)).toEqual(series);
  });

  it('the unions are the reader\'s, pinned at the type level', () => {
    const variant: Eq<ChartDataSeries['variant'], 'primary' | 'comparison' | undefined> = true;
    const yAxis: Eq<ChartDataSeries['yAxis'], 'left' | 'right' | undefined> = true;
    expect(variant && yAxis).toBe(true);
  });
});

/* ── (d) the seventh key: reported here, RULED and landed by objectui#7694 ──── */

describe('objectui#7546 — `chartType`: reported by this card, refused by name since objectui#7694', () => {
  it('the gap this block used to pin is CLOSED — declared and refusing, no longer stripped', () => {
    // Until objectui#7694 this block pinned `success === true` with `chartType`
    // absent from the output — the silent strip, held visible until its own
    // card ruled a shape. The ruling (option A: a named alias refusal pointing
    // at `type`, the spec's own posture) landed, and the full pin — envelope,
    // both-written, TS face, spec agreement, JSON-Schema surface — lives in
    // `chart-series-chart-type-alias-refusal-7694.test.ts`. This is the
    // handoff, restated rather than deleted (objectui#7070): the OLD reading
    // must not come back, and if it does the thing to re-read first is still
    // the spec's alias posture (`chartType` -> `type`).
    const r = ChartDataSeriesSchema.safeParse({ name: 'r', chartType: 'line' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path.join('.'))).toEqual(['chartType']);
    expect(shapeOf(ChartDataSeriesSchema)).toHaveProperty('chartType');
  });

  it('the TS face agrees — `chartType` is a `?: never` tombstone on `ChartDataSeries`, not a member an author can write', () => {
    // @ts-expect-error `chartType` is the renderer's INTERNAL spelling of `type`; refused by name — write `type` (objectui#7694)
    const s: ChartDataSeries = { name: 'r', chartType: 'line' };
    expect(s.name).toBe('r');
  });

  it('CONTROL — `type`, the author spelling of the same override, is declared and survives', () => {
    const r = ChartDataSeriesSchema.safeParse({ name: 'r', type: 'line' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toHaveProperty('type', 'line');
  });
});

/* ── (e) neighbours unchanged: the fix is declaration, not `.strict()` ────── */

describe('objectui#7546 — what did NOT change', () => {
  it('the `data` tombstone (objectui#6896) still refuses with its remedy', () => {
    const r = ChartDataSeriesSchema.safeParse({ name: 'r', data: [1, 2, 3] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/RETIRED \(ADR-0049\)/);
  });

  it('a series binding to neither `name` nor `dataKey` is still refused at `name` (objectui#6939)', () => {
    expect(refusalPaths({ color: '#fff' })).toContain('name');
  });

  it('a truly undeclared key is still stripped — the object is still non-strict', () => {
    // Deliberate: this change declares the keys the renderer reads; it does not
    // close the object. `chart-inline-data-retired.test.ts` pins the same fact.
    const r = ChartDataSeriesSchema.safeParse({ name: 'r', notAKeyAtAll: 'x' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).not.toHaveProperty('notAKeyAtAll');
  });
});
