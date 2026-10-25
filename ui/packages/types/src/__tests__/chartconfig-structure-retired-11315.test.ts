/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — `DashboardWidgetSchema.chartConfig.type` / `xAxis` /
 * `yAxis` / `series` (objectui#11315).
 *
 * `@objectstack/spec` 17.5.0 gave the dashboard widget its own chart-config
 * carrier, `DashboardWidgetChartConfigSchema`, a `.extend()` of
 * `ChartConfigSchema` that tombstones these four STRUCTURE keys (ADR-0021 ·
 * ADR-0049 D2; maintainer ruling 2026-09-12, decision batch #121 item 1). A
 * dashboard widget is dataset-bound, so the dataset owns the structure: the
 * family is the widget's own `type`, the category axis is `dimensions`, the
 * measures and series are `values`. `chartConfig` keeps the appearance.
 *
 * The retirement is per CARRIER. The base `ChartConfigSchema`, which the react
 * `ObjectChart` tier publishes for a chart bound to inline `data`, keeps all
 * four authorable. The spec-standing case below pins both halves, so a reader
 * of a red here can tell "the spec moved" from "objectui moved".
 *
 * The two faces got there differently, as with `aria`
 * (`chartconfig-aria-retired-4044.test.ts`, whose shape this file follows):
 *
 *  - **Zod.** `zod/complex.zod.ts` `DashboardWidgetSchema` takes the spec's
 *    `chartConfig` by reference, so it refused the four from the moment the
 *    lockfile resolved 17.5.0. The cases below record that on every face that
 *    answers for a dashboard document, with the spec's own message read off
 *    the spec at run time rather than copied here.
 *  - **TypeScript.** `complex.ts` typed every `chartConfig` key but `aria` as
 *    `any`, so the four compiled. Each is now the spec's own member, which is
 *    the spec's retired-key type. The `@ts-expect-error` lines are the real
 *    enforcement: this package's `type-check` compiles every test file
 *    (`tsconfig.test.json`), and a member that admits a value again leaves its
 *    directive unused, which fails `tsc`.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import {
  ChartConfigSchema as SpecChartConfigSchema,
  DashboardWidgetChartConfigSchema as SpecWidgetChartConfigSchema,
} from '@objectstack/spec/ui';
import type { DashboardWidgetSchema as DashboardWidgetInterface } from '../complex';
import type { IsRetiredKeyType } from './retired-key-type';
import {
  DashboardComponentSchema,
  DashboardWidgetSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';

/* ── TypeScript face ───────────────────────────────────────────────────────── */

type ChartConfigMember = NonNullable<DashboardWidgetInterface['chartConfig']>;
// Literal (declared) keys of T: `string extends K` is true only for the index
// signature's key, so mapping it to `never` leaves exactly the declared members.
type DeclaredKeys<T> = { [K in keyof T as string extends K ? never : K]: T[K] };
type Declared = keyof DeclaredKeys<ChartConfigMember>;
// `any` satisfies every `extends`, so the retired-key check is only meaningful
// once `any` is ruled out first.
type IsAny<T> = 0 extends 1 & T ? true : false;
// One line per key: declared on the face, not `any`, and the spec's
// retired-key type (admits nothing but absence).
type Tombstoned<K extends string> = K extends Declared
  ? IsAny<ChartConfigMember[K]> extends false
    ? IsRetiredKeyType<ChartConfigMember[K]>
    : false
  : false;

describe('the TS interface types the four structure keys as the spec tombstone (objectui#11315)', () => {
  it('`type`, `xAxis`, `yAxis` and `series` are declared, not `any`, and admit no value', () => {
    // Type-level pins, erased at runtime. Under the old index-signature `any`
    // none of these would compile: `Declared` had no literal for them.
    const typeTombstoned: Tombstoned<'type'> extends true ? true : false = true;
    const xAxisTombstoned: Tombstoned<'xAxis'> extends true ? true : false = true;
    const yAxisTombstoned: Tombstoned<'yAxis'> extends true ? true : false = true;
    const seriesTombstoned: Tombstoned<'series'> extends true ? true : false = true;
    // The control, through the same helper: a live appearance key is NOT a
    // tombstone, so a `Tombstoned` that said "retired" of anything goes red here.
    const titleIsLive: Tombstoned<'title'> extends false ? true : false = true;
    expect([typeTombstoned, xAxisTombstoned, yAxisTombstoned, seriesTombstoned, titleIsLive]).toEqual([
      true, true, true, true, true,
    ]);
  });

  it('an authored dashboard widget with `chartConfig.series` fails `tsc`; a legal chart config still compiles', () => {
    // The control. If the member refused every key, this literal would fail to
    // compile and the directives below would prove nothing about the four.
    const legal: DashboardWidgetInterface = {
      id: 'w1',
      type: 'combo',
      chartConfig: { title: 'Tasks vs progress', showLegend: true, colors: ['#2563eb', '#16a34a'] },
    };
    // The card's own pin: the combo shape a dashboard widget could author before
    // 17.5.0. The combo family stays on the widget's `type`; the per-series
    // mark does not.
    const series: DashboardWidgetInterface = {
      id: 'w2',
      type: 'combo',
      chartConfig: {
        // @ts-expect-error `chartConfig.series` is the spec's retirement tombstone on a dashboard widget (objectui#11315).
        series: [{ name: 'avg_progress', type: 'line', yAxis: 'right' }],
      },
    };
    const xAxis: DashboardWidgetInterface = {
      id: 'w3',
      type: 'bar',
      chartConfig: {
        // @ts-expect-error `chartConfig.xAxis` is the spec's retirement tombstone on a dashboard widget (objectui#11315).
        xAxis: { field: 'stage', title: 'Stage' },
      },
    };
    const yAxis: DashboardWidgetInterface = {
      id: 'w4',
      type: 'bar',
      chartConfig: {
        // @ts-expect-error `chartConfig.yAxis` is the spec's retirement tombstone on a dashboard widget (objectui#11315).
        yAxis: [{ field: 'amount', min: 0 }],
      },
    };
    const chartType: DashboardWidgetInterface = {
      id: 'w5',
      type: 'bar',
      chartConfig: {
        // @ts-expect-error `chartConfig.type` is the spec's retirement tombstone on a dashboard widget (objectui#11315).
        type: 'line',
      },
    };
    expect([legal, series, xAxis, yAxis, chartType].map((w) => w.id)).toEqual(['w1', 'w2', 'w3', 'w4', 'w5']);
  });
});

/* ── Zod faces ─────────────────────────────────────────────────────────────── */

/** One authored value per retired key, each the shape the key took before 17.5.0. */
const RETIRED = {
  type: 'line',
  xAxis: { field: 'stage', title: 'Stage' },
  yAxis: [{ field: 'amount' }, { field: 'pct', position: 'right', min: 0, max: 100 }],
  series: [{ name: 'amount', type: 'bar' }, { name: 'pct', type: 'line', yAxis: 'right' }],
} as const;
const RETIRED_KEYS = Object.keys(RETIRED) as Array<keyof typeof RETIRED>;

const legalChartConfig = { title: 'Pipeline', description: 'Pipeline value by stage', showLegend: false };

// A dataset-bound chart widget, the ADR-0021 shape.
const widget = (chartConfig: Record<string, unknown>) => ({
  id: 'w1',
  type: 'combo' as const,
  dataset: 'pipeline',
  dimensions: ['stage'],
  values: ['amount', 'pct'],
  chartConfig,
});
const dashboard = (chartConfig: Record<string, unknown>) => ({
  type: 'dashboard' as const,
  widgets: [widget(chartConfig)],
});

/** The spec's own tombstone message for `key`, read from the spec, never copied here. */
const specTombstoneMessage = (key: keyof typeof RETIRED): string => {
  const r = SpecWidgetChartConfigSchema.safeParse({ [key]: RETIRED[key] });
  expect(r.success, `the spec re-admitted \`chartConfig.${key}\` on a dashboard widget; re-open objectui#11315`).toBe(false);
  const issue = r.success ? undefined : r.error.issues.find((i) => i.path.join('.') === key);
  expect(issue, `the spec refused, but not at \`${key}\``).toBeTruthy();
  return issue!.message;
};

/**
 * Every issue, union arms included. An issue inside an arm keeps the path zod
 * gave it, which is relative to the union's own position.
 */
const flatten = (issues: readonly z.core.$ZodIssue[]): z.core.$ZodIssue[] =>
  issues.flatMap((i) => (i.code === 'invalid_union' ? [i, ...i.errors.flatMap((arm) => flatten(arm))] : [i]));

describe('the spec retires the four on the dashboard carrier only (the premise of every case below)', () => {
  it.each(RETIRED_KEYS)('the dashboard widget chart config refuses `%s`, naming the key', (key) => {
    expect(specTombstoneMessage(key)).toContain(`chartConfig.${key}`);
  });

  it('the dashboard widget chart config admits the legal appearance control', () => {
    expect(SpecWidgetChartConfigSchema.safeParse(legalChartConfig).success).toBe(true);
  });

  it('the react-tier `ChartConfigSchema` still admits all four (where they stay authorable)', () => {
    // `type` is required on this carrier, so the control carries it.
    const r = SpecChartConfigSchema.safeParse({ ...RETIRED });
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
  });
});

describe('the Zod twin refuses the four with the spec tombstone, inherited by reference', () => {
  it('a legal chart config parses: the control for the refusals below', () => {
    expect(DashboardWidgetSchema.safeParse(widget(legalChartConfig)).success).toBe(true);
  });

  it.each(RETIRED_KEYS)('`%s` is refused at `chartConfig.<key>`, with the spec\'s own message', (key) => {
    const r = DashboardWidgetSchema.safeParse(widget({ ...legalChartConfig, [key]: RETIRED[key] }));
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.path.join('.') === `chartConfig.${key}`);
    expect(issue, `no issue at path \`chartConfig.${key}\``).toBeTruthy();
    // A tombstone is a declared `never`, so zod reports `invalid_type`, not
    // `unrecognized_keys`: the red is the tombstone, not strictness.
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.message).toBe(specTombstoneMessage(key));
  });
});

describe('every face that answers for a dashboard document refuses them the same way', () => {
  const faces = [
    ['DashboardComponentSchema', (d: unknown) => DashboardComponentSchema.safeParse(d)],
    ['safeValidateSchema (tolerant face)', (d: unknown) => safeValidateSchema(d)],
    ['StrictAnyComponentSchema (strict face)', (d: unknown) => StrictAnyComponentSchema.safeParse(d)],
  ] as const;

  for (const [name, parse] of faces) {
    it(`${name}: the control parses, and each of the four is refused by the spec tombstone`, () => {
      expect(parse(dashboard(legalChartConfig)).success, `${name} refused the legal control`).toBe(true);

      for (const key of RETIRED_KEYS) {
        const r = parse(dashboard({ ...legalChartConfig, [key]: RETIRED[key] }));
        expect(r.success, `${name} admitted \`chartConfig.${key}\``).toBe(false);
        if (r.success) continue;
        // The widget slot is a union (component arm, spec-widget arm), so the
        // spec-widget arm carries the tombstone at `chartConfig.<key>`,
        // relative to the widget.
        const tombstone = flatten(r.error.issues).find((i) => i.path.join('.') === `chartConfig.${key}`);
        expect(tombstone, `${name}: no issue at \`chartConfig.${key}\` in any arm`).toBeTruthy();
        expect(tombstone!.code).toBe('invalid_type');
        expect(tombstone!.message).toBe(specTombstoneMessage(key));
      }
    });
  }
});
