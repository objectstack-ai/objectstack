/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-chart`'s `chartType` declares the installed `@objectstack/spec`'s
 * chart families that plugin-charts draws, on both faces (objectui#11513).
 *
 * ## The defect this pins
 *
 * Both faces declared eight families (`bar`, `column`, `horizontal-bar`,
 * `line`, `area`, `pie`, `donut`, `scatter`). The spec's `ChartTypeSchema`
 * declares more, and plugin-charts draws five of them as charts too
 * (`funnel`, `treemap`, `sankey`, `combo`, `radar`). The dashboard renderers
 * compose an `object-chart` node with every series family they route, so the
 * node they build named families the face refused, and objectui#11466's V1
 * could not type that producer without a cast.
 *
 * ## The set, and where it comes from
 *
 * The seat's ruling A: the face declares the spec's families the renderer
 * draws, by reference where the sets coincide. They do not coincide here, so
 * the zod mirror picks the drawn families out of the spec's enum (`.extract`)
 * and the TS twin `Extract`s them from the spec's `ChartType`. A spec family
 * that draws no chart on this block stays undeclared: the single-value
 * families render one row's number, the tabular ones a notice. Which families
 * draw a chart is re-derived by rendering, in plugin-charts'
 * `object-chart-declared-families-11513.test.tsx`. This file holds the two
 * faces to the set, and the set to the spec.
 *
 * ## Two instruments
 *
 * The `Expect` / `Equal` block is TYPE-level: `tsc -p tsconfig.test.json` (the
 * third leg of this package's `type-check` script) reads it, and vitest does
 * not. The `describe` blocks are RUNTIME.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ChartTypeSchema as SpecChartTypeSchema, type ChartType as SpecChartType } from '@objectstack/spec/ui';
import { enumOptions } from '@object-ui/test-support';

import type { ObjectChartSchema as TsObjectChartSchema } from '../objectql';
import { ObjectChartSchema, StrictAnyComponentSchema, safeValidateSchema } from '../zod/index.zod.js';

/* ── The set this card declares, written out once ───────────────────────── */

/** The spec families plugin-charts draws as a chart, measured by rendering (objectui#11513). */
const DECLARED = [
  'bar', 'horizontal-bar', 'column', 'line', 'area', 'pie', 'donut', 'funnel',
  'scatter', 'treemap', 'sankey', 'combo', 'radar',
] as const;
type Declared = (typeof DECLARED)[number];

/**
 * The installed spec's families this block draws no chart of: the single-value
 * ones render one row's number and the tabular ones a notice.
 */
const UNDECLARED_SPEC_FAMILIES = ['gauge', 'solid-gauge', 'metric', 'kpi', 'bullet', 'table', 'pivot'] as const;

/* ── Type-level: the `tsc` channel ───────────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type TsFamily = NonNullable<TsObjectChartSchema['chartType']>;
type ZodFamily = NonNullable<z.input<typeof ObjectChartSchema>['chartType']>;

export type assertionBothFacesDeclareTheSet = [
  Expect<Equal<TsFamily, Declared>>,
  Expect<Equal<ZodFamily, Declared>>,
  Expect<Equal<TsObjectChartSchema['chartType'], z.input<typeof ObjectChartSchema>['chartType']>>,
];

export type assertionEveryFamilyIsTheSpecs = [
  // Every declared family is a spec `ChartType`, so the `Extract` dropped nothing.
  Expect<Equal<Exclude<Declared, SpecChartType>, never>>,
  // The undeclared ones are the spec's too, and the two lists cover the spec.
  Expect<Equal<Exclude<(typeof UNDECLARED_SPEC_FAMILIES)[number], SpecChartType>, never>>,
  Expect<Equal<Exclude<SpecChartType, Declared | (typeof UNDECLARED_SPEC_FAMILIES)[number]>, never>>,
];

/** Non-vacuity: the declared set is a STRICT subset, so `Equal` can fail on it. */
export type assertionInstrumentFires = [
  Expect<Equal<Equal<TsFamily, SpecChartType>, false>>,
  Expect<Equal<Equal<TsFamily, Exclude<Declared, 'radar'>>, false>>,
];

/* ── Runtime ─────────────────────────────────────────────────────────────── */

type Issue = z.core.$ZodIssue & { values?: unknown[] };

const mirrorFamilies = (): string[] => enumOptions(ObjectChartSchema.shape.chartType);

const FACES = [
  ['safeValidateSchema', (doc: unknown) => safeValidateSchema(doc)],
  ['the strict authoring face', (doc: unknown) => StrictAnyComponentSchema.safeParse(doc)],
] as const;

/** A bag node naming `family` on the inline object path the dashboard composes: `objectName` + `aggregate`. */
const bagNode = (family: string) => ({
  type: 'object-chart',
  properties: { chartType: family, objectName: 'opportunity', aggregate: { field: 'amount', function: 'sum', groupBy: 'stage' } },
});

function issuesOf(result: { success: boolean; error?: { issues: Issue[] } }): Issue[] {
  if (result.success) throw new Error('expected a refusal, the document parsed');
  return result.error!.issues;
}

describe('object-chart `chartType` is the spec families plugin-charts draws (objectui#11513)', () => {
  it('reads the declared set off the mirror, and it is this card\'s set', () => {
    expect(mirrorFamilies()).not.toEqual([]);
    expect([...mirrorFamilies()].sort()).toEqual([...DECLARED].sort());
  });

  it('the set is a strict subset of the installed spec\'s ChartTypeSchema; the rest is named', () => {
    const spec = enumOptions(SpecChartTypeSchema);
    expect(spec.length, 'could not read ChartTypeSchema.options from the spec').toBeGreaterThan(DECLARED.length);
    expect(mirrorFamilies().filter((f) => !spec.includes(f)), 'a declared family the spec does not declare').toEqual([]);
    // A spec bump that adds a family turns this red: measure whether it draws, then declare it or list it here.
    expect(spec.filter((f) => !mirrorFamilies().includes(f)).sort()).toEqual([...UNDECLARED_SPEC_FAMILIES].sort());
  });

  it('`specType` stays the spec\'s ChartTypeSchema by identity (objectui#10770); `chartType` is picked out of it', () => {
    // The spec export is a `lazySchema()` proxy; the enum it materialises is the object a member wraps.
    const specEnum = SpecChartTypeSchema.optional().unwrap();
    expect(ObjectChartSchema.shape.specType.unwrap()).toBe(specEnum);
    // `.extract` builds a new enum, so identity cannot hold here; its members are the spec's own.
    expect(ObjectChartSchema.shape.chartType.unwrap()).not.toBe(specEnum);
    expect(enumOptions(specEnum)).toEqual(expect.arrayContaining(mirrorFamilies()));
  });

  it.each(DECLARED.map((f) => [f] as const))('`%s` parses in the bag on both faces and on the flat mirror', (family) => {
    for (const [face, parse] of FACES) expect(parse(bagNode(family)).success, face).toBe(true);
    expect(ObjectChartSchema.safeParse({ type: 'object-chart', chartType: family }).success).toBe(true);
  });

  it.each([
    ...UNDECLARED_SPEC_FAMILIES.map((f) => [`the spec family \`${f}\``, f] as const),
    ['an off-spec family', 'sunburst'],
    ['a mis-cased family', 'Bar'],
    ['a registry key written as a family', 'bar-chart'],
  ] as const)('%s is refused at `properties.chartType` with the set named, on both faces', (_label, family) => {
    for (const [face, parse] of FACES) {
      const issue = issuesOf(parse(bagNode(family))).find((i) => i.code === 'invalid_value');
      expect(issue?.path, face).toEqual(['properties', 'chartType']);
      expect([...(issue?.values ?? [])].sort(), face).toEqual([...DECLARED].sort());
      for (const declared of DECLARED) expect(issue?.message, `${face}: the refusal names ${declared}`).toContain(declared);
    }
  });

  it('the flat mirror refuses the same spelling at `chartType`, and the lit control parses', () => {
    const issue = issuesOf(ObjectChartSchema.safeParse({ type: 'object-chart', chartType: 'gauge' })).find((i) => i.code === 'invalid_value');
    expect(issue?.path).toEqual(['chartType']);
    expect(ObjectChartSchema.safeParse({ type: 'object-chart', chartType: 'funnel' }).success).toBe(true);
  });
});
