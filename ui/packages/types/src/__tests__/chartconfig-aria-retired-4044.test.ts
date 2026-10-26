/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — `DashboardWidgetSchema.chartConfig.aria` (objectui#4044).
 *
 * Ruling C on objectui#4044 (maintainer, decision batch #118 item 2) judged the
 * protocol wrong for this one key: the chart config already carries a working
 * accessible-name channel in `description`, and one node gets one
 * accessibility vocabulary. objectstack-ai/objectstack#17751 retired
 * `ChartConfigSchema.aria` as a `retiredKey` tombstone, released in
 * `@objectstack/spec` 17.5.0, and the dashboard widget's chart config
 * (`DashboardWidgetChartConfigSchema`, which extends it) carries the same
 * tombstone. This file is the contract twins' half of that retirement.
 *
 * The two faces got there differently, and the pins say which is which:
 *
 *  - **Zod.** `zod/complex.zod.ts` `DashboardWidgetSchema` takes the spec's
 *    `chartConfig` by reference (`specFieldsExcept` excludes only `id` and
 *    `type`), so the refusal was INHERITED the moment the lockfile resolved
 *    17.5.0. Nothing in this package changed for it. The cases below record
 *    it on every face that answers for a dashboard document, and check that
 *    the message is the spec's own, read off the spec at run time rather than
 *    copied here.
 *  - **TypeScript.** `complex.ts` re-typed `chartConfig` as `any`, so an
 *    authored `aria` compiled. The member now takes `aria` from the spec's own
 *    input type, which is the spec's retired-key type (the branded `[REMOVED]`
 *    mark at the pinned 18.1.0 and on objectstack `main`, bare `undefined`
 *    through 17.5.0; both
 *    spellings are `retired-key-type.ts`'s), so an authored value is a compile
 *    error.
 *    The `@ts-expect-error` below is the real enforcement: this package's
 *    `type-check` compiles every test file (`tsconfig.test.json`), and putting
 *    `chartConfig?: any` back leaves the directive unused, which fails `tsc`.
 *
 * The four structure keys the same release retired on this carrier (`type`,
 * `xAxis`, `yAxis`, `series`) are typed the same way since objectui#11315 and
 * pinned in `chartconfig-structure-retired-11315.test.ts`; every other
 * `chartConfig` key keeps its old TypeScript typing. The control cases show
 * that a legal chart config still compiles and still parses.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { DashboardWidgetChartConfigSchema as SpecWidgetChartConfigSchema } from '@objectstack/spec/ui';
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
// `any` satisfies every `extends`, so the "admits no value" check below is only
// meaningful once `any` is ruled out first.
type IsAny<T> = 0 extends 1 & T ? true : false;

describe('the TS interface types `chartConfig.aria` as the spec tombstone (objectui#4044)', () => {
  it('`aria` is a declared member, not `any`, and admits no value', () => {
    // Type-level pins, erased at runtime. Under the old `chartConfig?: any` the
    // first would not compile: `keyof any` has no `'aria'` literal.
    const ariaDeclared: 'aria' extends Declared ? true : false = true;
    const ariaNotAny: IsAny<ChartConfigMember['aria']> extends false ? true : false = true;
    const ariaAdmitsNoValue: IsRetiredKeyType<ChartConfigMember['aria']> extends true ? true : false = true;
    // The control for the line above, through the same helper: a live sibling
    // key is NOT a retired-key type, so a helper that said "retired" of
    // anything would turn this line red (objectui#11330).
    const titleIsLive: IsRetiredKeyType<ChartConfigMember['title']> extends false ? true : false = true;
    expect(ariaDeclared && ariaNotAny && ariaAdmitsNoValue && titleIsLive).toBe(true);
  });

  it('an authored `chartConfig.aria` is a compile error; a legal chart config still compiles', () => {
    // The control. If the member refused every key, this literal would fail to
    // compile and the directive below would be proving nothing about `aria`.
    const legal: DashboardWidgetInterface = {
      id: 'w1',
      type: 'bar',
      chartConfig: { title: 'Pipeline', description: 'Pipeline value by stage', colors: ['#2563eb'] },
    };
    const authored: DashboardWidgetInterface = {
      id: 'w2',
      type: 'bar',
      chartConfig: {
        title: 'Pipeline',
        // @ts-expect-error `chartConfig.aria` is the spec's retirement tombstone (objectui#4044).
        aria: { ariaLabel: 'Pipeline' },
      },
    };
    expect([legal.id, authored.id]).toEqual(['w1', 'w2']);
  });
});

/* ── Zod faces ─────────────────────────────────────────────────────────────── */

const legalChartConfig = { title: 'Pipeline', description: 'Pipeline value by stage' };
const ariaChartConfig = { title: 'Pipeline', aria: { ariaLabel: 'Pipeline' } };

// A dataset-bound chart widget, the ADR-0021 shape. The control uses `title`,
// not `type`: on a dashboard widget the spec retired `chartConfig.type` in the
// same release (the widget's own `type` is the chart family), so a chart config
// carrying `type` is refused for a reason this file is not about.
const widget = (chartConfig: Record<string, unknown>) => ({
  id: 'w1',
  type: 'bar' as const,
  dataset: 'pipeline',
  dimensions: ['stage'],
  values: ['amount'],
  chartConfig,
});
const dashboard = (chartConfig: Record<string, unknown>) => ({
  type: 'dashboard' as const,
  widgets: [widget(chartConfig)],
});

/** The spec's own tombstone message, read from the spec, never copied here. */
const specTombstoneMessage = (): string => {
  const r = SpecWidgetChartConfigSchema.safeParse(ariaChartConfig);
  expect(r.success, 'the spec re-admitted `chartConfig.aria`; re-open objectui#4044').toBe(false);
  const issue = r.success ? undefined : r.error.issues.find((i) => i.path.join('.') === 'aria');
  expect(issue, 'the spec refused, but not at `aria`').toBeTruthy();
  return issue!.message;
};

/**
 * Every issue, union arms included. An issue inside an arm keeps the path zod
 * gave it, which is relative to the union's own position.
 */
const flatten = (issues: readonly z.core.$ZodIssue[]): z.core.$ZodIssue[] =>
  issues.flatMap((i) => (i.code === 'invalid_union' ? [i, ...i.errors.flatMap((arm) => flatten(arm))] : [i]));

describe('the spec still carries the tombstone (the premise of every case below)', () => {
  it('the spec widget chart config refuses `aria` and admits the legal control', () => {
    expect(specTombstoneMessage()).toMatch(/aria/);
    expect(SpecWidgetChartConfigSchema.safeParse(legalChartConfig).success).toBe(true);
  });
});

describe('the Zod twin refuses `chartConfig.aria` with the spec tombstone, inherited by reference', () => {
  it('a legal chart config parses: the control for the refusal below', () => {
    expect(DashboardWidgetSchema.safeParse(widget(legalChartConfig)).success).toBe(true);
  });

  it('`aria` is refused at `chartConfig.aria`, with the spec\'s own message', () => {
    const r = DashboardWidgetSchema.safeParse(widget(ariaChartConfig));
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.path.join('.') === 'chartConfig.aria');
    expect(issue, 'no issue at path `chartConfig.aria`').toBeTruthy();
    // A tombstone is a declared `never`, so zod reports `invalid_type`.
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.message).toBe(specTombstoneMessage());
  });

  it('an undeclared key is refused differently, so the red above is the tombstone, not strictness', () => {
    // The spec's chart config is a strict object: an unknown key is refused as
    // `unrecognized_keys` on the object. If `aria` ever lost its tombstone and
    // fell to that path, the case above would go red on its code and path.
    const r = DashboardWidgetSchema.safeParse(widget({ ...legalChartConfig, objectui4044NotAKey: 1 }));
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.map((i) => [i.code, i.path.join('.')])).toEqual([['unrecognized_keys', 'chartConfig']]);
  });
});

describe('every face that answers for a dashboard document refuses it the same way', () => {
  const faces = [
    ['DashboardComponentSchema', (d: unknown) => DashboardComponentSchema.safeParse(d)],
    ['safeValidateSchema (tolerant face)', (d: unknown) => safeValidateSchema(d)],
    ['StrictAnyComponentSchema (strict face)', (d: unknown) => StrictAnyComponentSchema.safeParse(d)],
  ] as const;

  for (const [name, parse] of faces) {
    it(`${name}: the control parses, and \`aria\` is refused by the spec tombstone`, () => {
      expect(parse(dashboard(legalChartConfig)).success, `${name} refused the legal control`).toBe(true);

      const r = parse(dashboard(ariaChartConfig));
      expect(r.success).toBe(false);
      if (r.success) return;
      // The widget slot is a union (component arm, spec-widget arm), so the
      // refusal surfaces at `widgets.0`, and the spec-widget arm carries the
      // tombstone at `chartConfig.aria`, relative to the widget.
      const tombstone = flatten(r.error.issues).find((i) => i.path.join('.') === 'chartConfig.aria');
      expect(tombstone, `${name}: no issue at \`chartConfig.aria\` in any arm`).toBeTruthy();
      expect(tombstone!.code).toBe('invalid_type');
      expect(tombstone!.message).toBe(specTombstoneMessage());
    });
  }
});
