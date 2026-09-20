// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { DashboardWidgetSchema, DashboardWidgetChartConfigSchema } from './dashboard.zod';
import { ChartConfigSchema } from './chart.zod';
import { ReportChartSchema } from './report.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';

/**
 * Who owns a dataset-bound chart's STRUCTURE (ADR-0021; maintainer ruling
 * 2026-09-12, decision batch #121 item 1, verbatim 「同意」).
 *
 * The ruling has two halves and they fail in opposite directions, so both are
 * pinned here rather than one standing in for the other:
 *
 *  1. On a DATASET-BOUND widget, `chartConfig.type` / `.xAxis` / `.yAxis` /
 *     `.series` are refused BY NAME, each refusal naming the dataset selection
 *     the intent belongs in. Without this half the keys parse and are ignored —
 *     the declared-but-inert shape ADR-0049 exists to end, and in this case
 *     worse than inert: an authored `yAxis[].field` was a live membership
 *     channel that could silently re-point a series at another column.
 *  2. On an INLINE-DATA chart — the react `<ObjectChart data={…}>` tier, whose
 *     `dataProps` publish all four — the author's axes apply AS TODAY. Without
 *     this half the refusal fires on both faces, which is a bug rather than a
 *     stricter reading: an inline chart has no dataset to derive structure
 *     from, so refusing its axes leaves it unable to say anything at all.
 *
 * ⚠️ The second half is the one that cannot be inferred from the first, and it
 * is the reason the refusal lives on a per-carrier `.extend()`
 * ({@link DashboardWidgetChartConfigSchema}) instead of on
 * {@link ChartConfigSchema}. A tombstone on the base shape would pass every
 * assertion in half 1 and silently take the keys from the inline tier too.
 *
 * There is no ADR-0112 `code`/`status` envelope to assert on this rejection
 * class: `retiredKey()` is a Zod `never` whose issue carries the guidance as
 * its `message`, so here the wording IS the contract (the `aria-carrier-
 * tombstones.test.ts` precedent, same reason).
 */

const STRUCTURE_KEYS = ['type', 'xAxis', 'yAxis', 'series'] as const;

const VALUE_FOR: Record<(typeof STRUCTURE_KEYS)[number], unknown> = {
  type: 'line',
  xAxis: { field: 'stage' },
  yAxis: [{ field: 'amount' }],
  series: [{ name: 'amount' }],
};

const widget = (chartConfig?: Record<string, unknown>) => ({
  id: 'rev_by_stage',
  type: 'bar' as const,
  dataset: 'opportunity_metrics',
  dimensions: ['stage'],
  values: ['amount'],
  layout: { x: 0, y: 0, w: 6, h: 4 },
  ...(chartConfig ? { chartConfig } : {}),
});

const issuesAt = (result: z.ZodSafeParseResult<unknown>, path: string) =>
  result.success ? [] : result.error.issues.filter((i) => i.path.join('.') === path);

describe('dataset-bound widget: the dataset owns chart STRUCTURE', () => {
  it.each(STRUCTURE_KEYS)('refuses `chartConfig.%s` by name, at that key\'s own path', (key) => {
    const r = DashboardWidgetSchema.safeParse(widget({ [key]: VALUE_FOR[key] }));
    expect(r.success).toBe(false);
    const own = issuesAt(r, `chartConfig.${key}`);
    expect(own, `the refusal must land on chartConfig.${key}, not on the widget root`).toHaveLength(1);
    expect(own[0]!.message).toContain('`dashboard.widgets[].chartConfig.' + key + '`');
  });

  it('every refusal points at the dataset selection — the ruling\'s own words', () => {
    // Not one message spot-checked: the whole set, because "refused by name"
    // without the prescription is an unrecognized-key report with extra steps.
    for (const key of STRUCTURE_KEYS) {
      const r = DashboardWidgetSchema.safeParse(widget({ [key]: VALUE_FOR[key] }));
      const message = issuesAt(r, `chartConfig.${key}`)[0]!.message;
      expect(message, key).toMatch(/dataset/i);
      expect(message, `${key} must name where to write it instead`).toMatch(
        key === 'type' ? /widget/i : /dimensions|values/,
      );
      // The house `os migrate meta` sentence, pinned class-wide by
      // `shared/retired-key-migrate-sentence.test.ts`; asserted here too so a
      // rewrite of these four strings alone cannot drop it.
      expect(message, key).toContain('os migrate meta --from 17');
    }
  });

  it('APPEARANCE is still the author\'s on the same widget — the half a blanket refusal would break', () => {
    const r = DashboardWidgetSchema.safeParse(widget({
      title: 'Revenue by stage',
      subtitle: 'Closed-won only',
      description: 'Revenue by pipeline stage',
      colors: ['#111', '#222'],
      height: 320,
      showLegend: false,
      showDataLabels: true,
      annotations: [{ type: 'line', axis: 'y', value: 100 }],
      interaction: { tooltips: false },
    }));
    expect(r.success, JSON.stringify(r.success ? null : r.error.issues)).toBe(true);
  });

  it('the refusal reaches the author through the dashboard metadata root, not only the exported schema', () => {
    // A strict schema nobody parses gates nothing (#4583). The parse door is
    // `getMetadataTypeSchema('dashboard')` — what `MetadataManager.validate`,
    // `GET /api/v1/meta` and the Studio form all go through.
    const dash = getMetadataTypeSchema('dashboard');
    expect(dash, 'dashboard must resolve a schema — this is the parse door').toBeTruthy();
    const doc = (chartConfig?: Record<string, unknown>) => ({
      name: 'pipeline', label: 'Pipeline', widgets: [widget(chartConfig)],
    });
    expect(dash!.safeParse(doc({ title: 'Revenue' })).success, 'control').toBe(true);
    const r = dash!.safeParse(doc({ xAxis: { field: 'stage' } }));
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('chartConfig');
  });

  it('a widget with no `chartConfig` at all is untouched', () => {
    expect(DashboardWidgetSchema.safeParse(widget()).success).toBe(true);
  });
});

describe('the refusal is scoped to the dataset-bound carrier', () => {
  it('ChartConfigSchema — the inline-data react <ObjectChart> contract — still ACCEPTS all four', () => {
    // `react-blocks.ts` declares `schema: ChartConfigSchema` for `<ObjectChart>`
    // and publishes `type` / `xAxis` / `yAxis` / `series` in its `dataProps`.
    // An inline-data chart has no dataset to derive structure from, so this arm
    // MUST stay green: a refusal that fires here is the bug, not a stricter
    // reading (ruling item 1, "On an inline-data chart the author's axes apply
    // as today").
    const r = ChartConfigSchema.safeParse({
      type: 'line',
      xAxis: { field: 'month' },
      yAxis: [{ field: 'revenue' }],
      series: [{ name: 'revenue', label: 'Revenue' }],
      title: 'Monthly revenue',
    });
    expect(r.success, JSON.stringify(r.success ? null : r.error.issues)).toBe(true);
  });

  it.each(STRUCTURE_KEYS)('ChartConfigSchema still accepts `%s` on its own', (key) => {
    const body: Record<string, unknown> = { type: 'line' };
    body[key] = VALUE_FOR[key];
    expect(ChartConfigSchema.safeParse(body).success).toBe(true);
  });

  it('ReportChartSchema keeps its own narrowed axes', () => {
    // A report chart is dataset-bound too, and it answered the same question
    // differently and earlier: `xAxis`/`yAxis` are narrowed to the bound
    // dataset's dimension and measure NAMES rather than refused. The ruling did
    // not touch that carrier, so this pin is what keeps the dashboard-side
    // tombstone from being copied onto it by a later sweep reading "refused by
    // name" as a property of the key.
    expect(ReportChartSchema.safeParse({ type: 'bar', xAxis: 'stage', yAxis: 'amount' }).success).toBe(true);
  });

  it('the tombstones are on the widget carrier only — asserted on the SHAPES, not by re-parsing', () => {
    const widgetShape = DashboardWidgetChartConfigSchema.shape;
    const baseShape = ChartConfigSchema.shape;
    for (const key of STRUCTURE_KEYS) {
      // `retiredKey()` is `z.never().optional()`: the input type is `never`, so
      // an `undefined` parses and any value is refused.
      expect(widgetShape[key]!.safeParse(undefined).success, `${key} absent`).toBe(true);
      expect(widgetShape[key]!.safeParse(VALUE_FOR[key]).success, `${key} authored`).toBe(false);
      expect(baseShape[key]!.safeParse(VALUE_FOR[key]).success, `${key} on the base`).toBe(true);
    }
  });
});

/*
 * ⭐ ON THE ABSENCE HALF — why this retirement has no tree-scoped TEXT pin, and
 * what stands in its place. Written out because the default for a retirement is
 * the opposite (`spec-property-retirement` §4: "缺席 pin 一律 tree-scoped"), and
 * a reader who finds no such pin here must not conclude one was forgotten.
 *
 * A text sweep works when the retired key's NAME leaves the tree. These four
 * names do not leave: `type`, `xAxis`, `yAxis` and `series` stay authorable on
 * `ChartConfigSchema` for the react `<ObjectChart>` tier and, for the first
 * three, on `ReportChartSchema`. `type` alone appears thousands of times across
 * this repository as an unrelated key. What is retired is a key IN A POSITION —
 * `dashboards[].widgets[].chartConfig.<key>` — which no grep can express and a
 * grep that tried would either match everything or, scoped down by hand, match
 * only the sites its author already knew about. That is the file-scoped failure
 * the tree-scoped rule exists to prevent, wearing a tree-scoped costume.
 *
 * The instruments that DO cover the position, both repo-wide and both already
 * required in CI:
 *
 *  1. `tsc`. `retiredKey()` types the key `never` on this carrier, so every
 *     authoring site in the monorepo fails to compile — which is how the five
 *     example dashboards that wrote these keys were found, not by grep.
 *     `examples/app-*` each declare `typecheck`, so the example corpus is
 *     inside that net as well as the packages.
 *  2. The parse door. `objectstack validate` (each example app's `validate`
 *     script) and the metadata-protocol publish-gate tests run authored
 *     documents through `getMetadataTypeSchema('dashboard')` — the same door
 *     pinned above — so a widget that reaches a parse with one of these keys is
 *     refused there too, in JSON sources `tsc` never sees.
 */
