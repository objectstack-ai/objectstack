// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The report authoring face keeps the two shapes objectui#6121 relaxed — pinned
 * so a later narrowing is a red test rather than a silent re-break.
 *
 * ## Why a relaxation needs a pin at all
 *
 * Both changes below WIDEN a published type: they make authored JSON that used
 * to be a type error legal. A widening has no natural guard — every existing
 * caller still compiles, every test still passes, and nothing anywhere fails if
 * someone later "tightens" it back. A relaxation with no pin is indistinguishable
 * from an accident, in both directions and at any later date. These are the pins.
 *
 * ## What was relaxed, and the measurement behind each
 *
 * **1. `ReportComponentSchema.exportConfigs` — total `Record` -> `Partial<Record>`.**
 * A total `Record<ReportExportFormat, ReportExportConfig>` forced an author
 * configuring ONE format to declare all five. Measured on
 * `content/docs/core/report-schema.mdx`, whose three-format example failed:
 *
 *     TS2739: Type '{ pdf: …; excel: …; csv: … }' is missing the following
 *             properties from type 'Record<ReportExportFormat, ReportExportConfig>':
 *             html, json
 *
 * The runtime twin was NEVER total — `../zod/reports.zod.ts` declares
 * `exportConfigs: z.record(z.string(), ReportExportConfigSchema)`, whose keys are
 * all optional. So the TS declaration was stricter than the validator that
 * actually judges authored JSON, and this makes them agree in the direction the
 * validator already took. That asymmetry is itself pinned below (section 1c):
 * if a later change makes the MIRROR total, the two drift apart again the other
 * way and this file says so.
 *
 * **2. `ChartDataSeries.type` — declared, because the renderer already reads it.**
 * The chart example on the same page authors `type: 'line'` on a series, which
 * was `TS2353: … 'type' does not exist in type 'ChartDataSeries'`. It is not a
 * documentation slip: `normalizeChartSchema`'s `normalizeSeries`
 * (`@object-ui/plugin-charts`) reads exactly that key —
 *
 *     const family = str(raw.chartType) ?? str(raw.type);
 *     if (family === 'bar' || family === 'line' || family === 'area') …
 *
 * — so `type` is the AUTHOR spelling of the per-series family override that
 * `chartType` carries internally. The union pinned here is those three families
 * and no more: a wider union would advertise an override the normalizer drops in
 * silence (declared-but-unenforced, ADR-0049's shape).
 *
 * ⚠️ This is NOT `@objectstack/spec`'s `ChartSeries`, whose `type` is the full
 * `ChartType`. The two are deliberately separate shapes (objectstack#4115) — see
 * the `ChartDataSeries` header in `../data-display.ts`. Narrowing THIS union to
 * match the spec's would be the same mistake in reverse.
 *
 * ## Which instrument checks which assertion (stated, because they differ)
 *
 * The `Assert<Eq<…>>` lines are TYPE-level and are judged by
 * `pnpm --filter @object-ui/types type-check`, whose third leg is
 * `tsc -p tsconfig.test.json` — the project that exists precisely because
 * `tsconfig.json` excludes every `.test.ts` file. ⛔ They are NOT judged by `vitest`,
 * which strips types. That distinction is this package's own scar tissue:
 * `spec-derived-unions.test.ts` once built its whole contract on `satisfies`
 * checks that no `tsc` invocation ever read (objectstack#4074).
 *
 * The `expect(…)` lines below are RUNTIME and are judged by vitest. Every
 * relaxation therefore carries at least one assertion of each kind, so neither
 * instrument going missing can make this file vacuous on its own.
 *
 * ## 3. The RETIREMENT this card's own ruling ordered (maintainer, 2026-08-30)
 *
 * The third section pins the opposite direction: `ReportComponentSchema.dataSource`
 * and `ReportBuilderSchema.dataSources` are RETIRED. Both were annotated with the
 * runtime `DataSource` ADAPTER — a shape no JSON document can author — and no read
 * site ever consumed either key. A retirement needs its own pin for the mirror
 * reason a widening does: `?: never` compiles for every existing caller (nobody
 * wrote the key), so nothing would fail if a later edit restored the adapter
 * annotation or relaxed the mirror back to `z.any()`. Both halves are pinned —
 * the `never` TypeScript twin AND the mirror's named refusal — because either one
 * alone leaves `declared !== enforced`, which is the defect ADR-0049 names.
 */

import { describe, it, expect } from 'vitest';
import type {
  ReportBuilderSchema,
  ReportComponentSchema,
  ReportExportConfig,
  ReportExportFormat,
} from '../reports.js';
import type { ChartDataSeries } from '../data-display.js';
import { ChartDataSeriesSchema } from '../zod/data-display.zod.js';
import {
  ReportBuilderSchema as ReportBuilderZodSchema,
  ReportComponentSchema as ReportComponentZodSchema,
} from '../zod/reports.zod.js';

/** `true` only when the two types are mutually assignable AND identical. */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type Assert<T extends true> = T;

describe('objectui#6121 — ReportComponentSchema.exportConfigs is partial', () => {
  // 1a. THE PIN. Exact identity against `Partial<Record<…>>`. Narrowing back to
  // the total `Record<ReportExportFormat, ReportExportConfig>` fails this line,
  // and so does widening it to an untyped bag.
  type ExportConfigs = NonNullable<ReportComponentSchema['exportConfigs']>;
  type _ExportConfigsStayPartial = Assert<
    Eq<ExportConfigs, Partial<Record<ReportExportFormat, ReportExportConfig>>>
  >;

  // 1b. The capability the relaxation exists for: ONE format, annotated at the
  // declaration so excess/missing-property checking is really engaged.
  it('accepts a single-format configuration', () => {
    const oneFormat: ReportComponentSchema = {
      type: 'report',
      exportConfigs: {
        csv: { format: 'csv', filename: 'sales.csv', includeHeaders: true },
      },
    };
    expect(Object.keys(oneFormat.exportConfigs ?? {})).toEqual(['csv']);

    // …and the same literal through the published validator, which is the half a
    // JSON author actually meets.
    const parsed = ReportComponentZodSchema.safeParse(oneFormat);
    expect(parsed.success).toBe(true);
  });

  // 1c. The asymmetry that made the total Record wrong: the mirror accepts a
  // one-key map. If a later change makes the mirror total, this fails.
  it('the published validator accepts a partial export map', () => {
    const result = ReportComponentZodSchema.safeParse({
      type: 'report',
      exportConfigs: { pdf: { format: 'pdf' } },
    });
    expect(result.success).toBe(true);
  });

  // 1d. Still keyed by the format union — the relaxation must not have become
  // "any string key". An unknown format stays a type error.
  it('rejects an unknown export format key', () => {
    // @ts-expect-error 'xml' is not a ReportExportFormat
    const bad: ReportComponentSchema = { type: 'report', exportConfigs: { xml: { format: 'csv' } } };
    expect(bad).toBeTruthy();
  });
});

describe('objectui#6121 — ChartDataSeries declares the per-series family override', () => {
  // 2a. THE PIN. Exactly the three families `normalizeChartSchema` honours.
  // Removing the key, or widening it to the spec's full `ChartType`, fails here.
  type SeriesType = ChartDataSeries['type'];
  type _SeriesTypeStaysThreeFamilies = Assert<
    Eq<SeriesType, 'bar' | 'line' | 'area' | undefined>
  >;

  it('accepts the series shape the documentation authors', () => {
    // `data` was authored here until objectui#6896 retired it — the series
    // NAMES a column on the chart-level `data`, it does not carry numbers.
    const series: ChartDataSeries = {
      name: 'Revenue',
      type: 'line',
    };
    expect(series.type).toBe('line');
    // The zod twin moves in lockstep — an unmirrored key is what
    // `zod-mirror-parity.test.ts` fails on.
    expect(ChartDataSeriesSchema.parse(series).type).toBe('line');
  });

  it('rejects a family the normalizer would silently drop', () => {
    // @ts-expect-error 'pie' is not a per-series override the renderer performs
    const bad: ChartDataSeries = { name: 'Revenue', type: 'pie' };
    expect(bad).toBeTruthy();
    // No `data` here: it would make this refusal ambiguous between the family
    // union and objectui#6896's tombstone, and this pin is about the union.
    expect(ChartDataSeriesSchema.safeParse({ name: 'Revenue', type: 'pie' }).success)
      .toBe(false);
  });

  it('leaves the override optional — a plain inline series still parses', () => {
    const plain: ChartDataSeries = { name: 'Revenue' };
    expect(ChartDataSeriesSchema.parse(plain).type).toBeUndefined();
  });
});

describe('objectui#6121 — the two report data-source keys are retired on both faces', () => {
  // 3a. THE TYPE PIN. `?: never` resolves the member type to `undefined`, so
  // this line fails if either key is restored to `DataSource` / `DataSource[]`
  // — or to any other value type, including the `ViewData` binding whose key
  // name is still an open question on this card.
  type RetiredDataSource = ReportComponentSchema['dataSource'];
  type RetiredDataSources = ReportBuilderSchema['dataSources'];
  type _DataSourceStaysRetired = Assert<Eq<RetiredDataSource, undefined>>;
  type _DataSourcesStayRetired = Assert<Eq<RetiredDataSources, undefined>>;

  it('refuses an authored `dataSource` on both faces, by name', () => {
    const authored = {
      type: 'report' as const,
      title: 'Quarterly Sales Analysis',
      // The exact face `content/docs/core/report-schema.mdx` used to teach.
      dataSource: { provider: 'api', read: { url: '/api/sales', method: 'GET' } },
    };

    // @ts-expect-error `dataSource` is retired — `?: never` admits no value
    const typed: ReportComponentSchema = authored;
    expect(typed).toBeTruthy();

    const result = ReportComponentZodSchema.safeParse(authored);
    expect(result.success).toBe(false);
    // The ENVELOPE, not the fact that something failed: one issue, at this
    // key's own path, reported as `invalid_type` (what `z.never()` emits) —
    // and carrying the tombstone's guidance rather than zod's generic text,
    // which is the half `retirementTombstone` exists for.
    const issues = result.success ? [] : result.error.issues;
    expect(issues.map((i) => [i.code, i.path.join('.')])).toEqual([['invalid_type', 'dataSource']]);
    expect(issues[0]?.message).toContain('RETIRED (objectui#6121, ADR-0049)');
  });

  it('refuses an authored `dataSources` on the builder, by name', () => {
    const authored = {
      type: 'report-builder' as const,
      dataSources: [{ provider: 'api', read: { url: '/api/sales' } }],
    };

    // @ts-expect-error `dataSources` is retired — `?: never` admits no value
    const typed: ReportBuilderSchema = authored;
    expect(typed).toBeTruthy();

    const result = ReportBuilderZodSchema.safeParse(authored);
    expect(result.success).toBe(false);
    const issues = result.success ? [] : result.error.issues;
    expect(issues.map((i) => [i.code, i.path.join('.')])).toEqual([['invalid_type', 'dataSources']]);
    expect(issues[0]?.message).toContain('RETIRED (objectui#6121, ADR-0049)');
  });

  // 3b. CONTROLS, in the same run. Two zeros above need two things that fire:
  // without these, a mirror that refused EVERYTHING would read as a pass, and
  // so would a `.safeParse` that had stopped being called at all.
  it('the same report without the retired key still parses, and the row array is untouched', () => {
    const report: ReportComponentSchema = {
      type: 'report',
      title: 'Quarterly Sales Analysis',
      // `data` is the report ROW array — a live key with a live read
      // (`LegacyReportRenderer` reads `data.length` / `data.map`). It is NOT
      // the retired binding, and this control is what keeps the retirement
      // above from reading as "reports refuse data".
      data: [{ region: 'EMEA', revenue: 1 }],
    };
    const result = ReportComponentZodSchema.safeParse(report);
    expect(result.success).toBe(true);
    expect(result.success && result.data.data).toHaveLength(1);

    const builder: ReportBuilderSchema = { type: 'report-builder', showPreview: true };
    expect(ReportBuilderZodSchema.safeParse(builder).success).toBe(true);
  });

  // 3c. The guidance reaches the OTHER author-facing channel too — the
  // `.describe()` metadata that feeds generated JSON Schema and the docs
  // surface. One string, two channels, so they cannot drift apart.
  it('publishes the retirement guidance as schema metadata', () => {
    const shapeOf = (schema: { shape: Record<string, { description?: string }> }) => schema.shape;
    const componentDescribe = shapeOf(
      ReportComponentZodSchema as unknown as { shape: Record<string, { description?: string }> },
    ).dataSource?.description;
    const builderDescribe = shapeOf(
      ReportBuilderZodSchema as unknown as { shape: Record<string, { description?: string }> },
    ).dataSources?.description;

    expect(componentDescribe).toContain('RETIRED (objectui#6121, ADR-0049)');
    expect(builderDescribe).toContain('RETIRED (objectui#6121, ADR-0049)');
    // Control for the reader itself: a NON-retired member's description is
    // still its own noun, so the two hits above are not "every key says
    // RETIRED".
    expect(
      shapeOf(ReportComponentZodSchema as unknown as { shape: Record<string, { description?: string }> })
        .title?.description,
    ).toBe('Report title');
  });
});
