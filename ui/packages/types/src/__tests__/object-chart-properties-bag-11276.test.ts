/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-chart` takes its props in the `properties` bag, and the flat
 * spelling retires from both authoring faces (objectui#11276, the
 * `object-chart` batch of triage's routing call A).
 *
 * ## The defect this pins
 *
 * `@objectstack/spec`'s strict `PageComponentSchema` refuses a prop written on
 * a page component itself as mis-layered (ADR-0089 D3a), for every component
 * type, and accepts the same props in `properties`. objectui's arm was the flat
 * mirror of the TypeScript twin instead, so the two validators disagreed in
 * both directions:
 *
 *   - the objectstack showcase's command-center charts,
 *     `{ type: 'object-chart', responsiveStyles, properties: { … } }`, were
 *     refused by `safeValidateSchema` (the flat mirror's chart-family floor
 *     found no family on the node) and by the strict face, which added
 *     `properties` as an unrecognized key;
 *   - the flat node `os validate` refuses parsed green on both faces.
 *
 * ## The one difference from batches 4 and 5: there is no spec row
 *
 * `ComponentPropsMap` carries no `object-chart` row, so the spec's page
 * component takes ANY bag for this type, and no row is invented here. The bag's
 * members are the flat `ObjectChartSchema` mirror's own members, BY REFERENCE —
 * the same schema objects — and everything else is the construct batches 4
 * and 5 used: `propsBag`, one `aliasKeyRefusal` per member written flat, the
 * mirror's tombstones and content-channel refusals.
 *
 * ## What the arm keeps that the spec does not say
 *
 * The flat mirror's chart-family floor (objectui#10770) stays, read in the bag.
 * The spec has no such rule, so a node naming no family passes the spec's page
 * component and is refused here, as the flat mirror refused it.
 *
 * ## What did NOT move
 *
 * The TypeScript `ObjectChartSchema` (`../objectql.ts`) and its zod mirror stay
 * published: they are the node as `ObjectChart` reads it AFTER `SchemaRenderer`
 * hoists `properties`, and as `ObjectView` / `ListView` / the dashboard
 * renderers / the react-page wrapper compose it. The mirror is no longer an arm
 * of `AnyComponentSchema`; `ObjectChartBlockSchema` is.
 *
 * ## Two instruments, and which half each one reads
 *
 * The `Expect` / `Equal` block below is TYPE-level: `tsc -p tsconfig.test.json`
 * (the third leg of this package's `type-check` script) reads it, and vitest —
 * which strips types — does not. The `describe` blocks are RUNTIME.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ComponentPropsMap as SpecComponentPropsMap,
  PageComponentSchema as SpecPageComponentSchema,
} from '@objectstack/spec/ui';

import type { ObjectChartSchema as TsObjectChartSchema, ObjectQLComponentSchema as TsObjectQLComponentSchema } from '../objectql';
import {
  BaseSchema,
  ObjectChartBlockSchema,
  ObjectChartSchema,
  ObjectMapBlockSchema,
  ObjectQLComponentSchema,
  ObjectQLPublicBlockComponentSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';

/* ── Type-level parity: the `tsc` channel ────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type ShapeOf<M> = M extends { shape: infer S } ? S : never;
/** What a shape entry ACCEPTS (input side, so `.optional()` shows). */
type InputOf<T> = T extends z.ZodType ? z.input<T> : never;
type Arm = ShapeOf<typeof ObjectChartBlockSchema>;
type Mirror = ShapeOf<typeof ObjectChartSchema>;
type Bag = ShapeOf<NonNullable<ReturnType<Arm['properties']['unwrap']>>>;
/** The node-level keys: the node base's, the envelope's, and the binding (objectui#11070). */
type NodeLevel = keyof ShapeOf<typeof BaseSchema> | 'responsiveStyles' | 'dataSource';

/**
 * The bag's key set is exactly the mirror's own members (its shape less the
 * node-level keys), and each member IS the mirror's schema type.
 */
export type assertionBagIsTheMirrorsOwnMembers = [
  Expect<Equal<keyof Bag, Exclude<keyof Mirror, NodeLevel>>>,
  Expect<Equal<Bag['chartType'], Mirror['chartType']>>,
  Expect<Equal<Bag['aggregate'], Mirror['aggregate']>>,
  Expect<Equal<Bag['yAxis'], Mirror['yAxis']>>,
  Expect<Equal<Bag['xAxisField'], Mirror['xAxisField']>>,
];

/** Every bag member written flat on the arm accepts nothing, and so do both content channels. */
export type assertionEveryBagKeyIsRefusedFlat = [
  Expect<Equal<{ [K in keyof Bag]: InputOf<Arm[K]> }[keyof Bag], undefined>>,
  Expect<Equal<InputOf<Arm['children']>, undefined>>,
  Expect<Equal<InputOf<Arm['body']>, undefined>>,
];

/**
 * The TypeScript twin is RE-DECLARED, not retired: still published, still the
 * post-hoist reading with its flat members, still a member of the TypeScript
 * ObjectQL union. A narrowing or a removal here reddens `tsc`.
 */
export type assertionTwinStaysPublished = [
  Expect<Equal<TsObjectChartSchema['type'], 'object-chart'>>,
  Expect<Equal<TsObjectChartSchema['dataset'], string | undefined>>,
  // objectui#11513 widened the family set; `object-chart-families-11513.test.ts` holds its members.
  Expect<Equal<TsObjectChartSchema['chartType'], z.input<typeof ObjectChartSchema>['chartType']>>,
  Expect<Equal<Extract<TsObjectQLComponentSchema, { type: 'object-chart' }>, TsObjectChartSchema>>,
];

/** Non-vacuity: a key set narrower than the mirror's own is not Equal to it. */
export type assertionInstrumentFires = [
  Expect<Equal<Equal<'chartType' | 'dataset', Exclude<keyof Mirror, NodeLevel>>, false>>,
];

/* ── Runtime fixtures ────────────────────────────────────────────────────── */

const PALETTE = ['hsl(192 86% 46%)', 'hsl(256 72% 62%)'];

/**
 * The objectstack showcase command-center producer's `chart()` helper, as it
 * WRITES the node — `integerYAxis` on — and the same helper without it.
 */
const SHOWCASE_BAR = {
  id: 'cc_status_c',
  type: 'object-chart',
  responsiveStyles: { large: { width: '100%', minWidth: '0' } },
  properties: {
    dataset: 'showcase_task_metrics',
    dimensions: ['status'],
    values: ['task_count'],
    chartType: 'bar',
    colors: PALETTE,
    yAxis: [{ field: 'task_count', stepSize: 1 }],
  },
} as const;
const SHOWCASE_DONUT = {
  id: 'cc_health_c',
  type: 'object-chart',
  responsiveStyles: { large: { width: '100%', minWidth: '0' } },
  properties: { dataset: 'showcase_project_metrics', dimensions: ['health'], values: ['project_count'], chartType: 'donut', colors: PALETTE },
} as const;

/** The inline object path: `objectName` + the spec's `aggregate`, a `filter` and a drill. */
const INLINE = {
  type: 'object-chart',
  properties: {
    objectName: 'opportunity',
    chartType: 'bar',
    aggregate: { field: 'amount', function: 'sum', groupBy: 'stage' },
    filter: [['stage', '!=', 'lost']],
    xAxis: { field: 'stage' },
    drillDown: { target: 'drawer' },
    title: 'Pipeline by stage',
  },
} as const;

/** The family named by `specType` alone, with the spec's `{ name }` series arm. */
const SPEC_TYPE = {
  type: 'object-chart',
  properties: { objectName: 'invoice', specType: 'line', series: [{ name: 'total', label: 'Invoice value' }] },
} as const;

/** The flat spelling this batch retires. */
const FLAT = { type: 'object-chart', objectName: 'opportunity', chartType: 'bar' } as const;

type Issues = z.core.$ZodIssue[];

function issuesOf(result: { success: boolean; error?: { issues: Issues } }): Issues {
  if (result.success) throw new Error('expected a refusal, the document parsed');
  return result.error!.issues;
}

const FACES = [
  ['safeValidateSchema', (doc: unknown) => safeValidateSchema(doc)],
  ['the strict authoring face', (doc: unknown) => StrictAnyComponentSchema.safeParse(doc)],
] as const;

const bagOf = () => ObjectChartBlockSchema.shape.properties.unwrap();
const bagKeys = () => Object.keys(bagOf().shape);
/** The three list-view spellings objectui#10608 retired — tombstones in the mirror. */
const RETIRED = ['xAxisField', 'yAxisFields', 'aggregation'] as const;

describe('object-chart validates in the `properties` bag (objectui#11276)', () => {
  it.each([
    ['the showcase command-center bar chart (dataset-bound, integer y axis)', SHOWCASE_BAR],
    ['the showcase command-center donut', SHOWCASE_DONUT],
    ['an object-bound chart with its aggregate, filter, axis and drill', INLINE],
    ['a chart naming its family by `specType`, with the spec series arm', SPEC_TYPE],
  ] as const)('%s is accepted by safeValidateSchema and by the strict authoring face', (_label, doc) => {
    const tolerant = safeValidateSchema(doc);
    expect(tolerant.success, JSON.stringify(tolerant.success ? null : tolerant.error.issues)).toBe(true);
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success, JSON.stringify(strict.success ? null : strict.error.issues)).toBe(true);
  });

  it('the fixtures are spec-valid by the spec\'s own page component (lit control)', () => {
    for (const doc of [SHOWCASE_BAR, SHOWCASE_DONUT, INLINE, SPEC_TYPE]) {
      const r = SpecPageComponentSchema.safeParse(doc);
      expect(r.success, JSON.stringify(r.success ? null : r.error.issues)).toBe(true);
    }
  });

  it('the bag survives the parse unchanged on both faces', () => {
    expect((safeValidateSchema(SHOWCASE_BAR).data as { properties?: unknown }).properties).toEqual(SHOWCASE_BAR.properties);
    expect((StrictAnyComponentSchema.safeParse(SHOWCASE_BAR).data as { properties?: unknown }).properties).toEqual(
      SHOWCASE_BAR.properties,
    );
  });

  it('reaches the arm at a child slot and at a page container\'s bag child list', () => {
    expect(safeValidateSchema({ type: 'page', children: [SHOWCASE_BAR, INLINE] }).success).toBe(true);
    const section = { type: 'page:section', properties: { children: [SHOWCASE_BAR, SHOWCASE_DONUT] } };
    for (const [, parse] of FACES) expect(parse(section).success).toBe(true);
    // Control: the walk does judge a chart nested in the bag — a flat one is refused there.
    const flatInSection = { type: 'page:section', properties: { children: [FLAT] } };
    const nested = issuesOf(safeValidateSchema(flatInSection)).find(
      (i) => i.path.join('.') === 'properties.children.0.objectName',
    );
    expect(nested?.message).toContain('`objectName` → `properties.objectName`');
  });
});

describe('the spec has no `object-chart` row, and none is invented (objectui#11276)', () => {
  it('`ComponentPropsMap` carries no `object-chart` row (lit control, read off the installed spec)', () => {
    expect(Object.prototype.hasOwnProperty.call(SpecComponentPropsMap, 'object-chart')).toBe(false);
    // Control: the read finds a row where one exists.
    expect(Object.prototype.hasOwnProperty.call(SpecComponentPropsMap, 'object-map')).toBe(true);
  });

  it('so the spec\'s page component takes any bag on this type', () => {
    const r = SpecPageComponentSchema.safeParse({ type: 'object-chart', properties: { inventedKey11276: 1, chartType: 7 } });
    expect(r.success).toBe(true);
  });

  it('the bag\'s description names the mirror, not a row; a row-backed arm\'s still names its row', () => {
    const own = ObjectChartBlockSchema.shape.properties.description ?? '';
    expect(own).toContain('`ObjectChartSchema`');
    expect(own).toContain('no `ComponentPropsMap[\'object-chart\']` row');
    const control = ObjectMapBlockSchema.shape.properties.description ?? '';
    expect(control).toContain('`ComponentPropsMap[\'object-map\']`, by reference');
  });
});

describe('the bag is the flat mirror\'s own members, by reference (objectui#11276)', () => {
  it('its key set is the mirror\'s shape less the node-level keys, read on every run', () => {
    // `dataSource` is the node's binding (objectui#11070): node-level, beside the bag.
    const nodeLevel = new Set([...Object.keys(BaseSchema.shape), 'responsiveStyles', 'dataSource']);
    const expected = Object.keys(ObjectChartSchema.shape).filter((key) => !nodeLevel.has(key)).sort();
    expect(bagKeys().sort()).toEqual(expected);
    // Non-vacuity: the chart's own vocabulary is in it.
    expect(expected.length).toBeGreaterThan(10);
    expect(expected).toEqual(expect.arrayContaining(['chartType', 'dataset', 'objectName', 'aggregate', 'xAxis', 'yAxis']));
  });

  it('each member IS the mirror\'s schema object, not a copy', () => {
    const mirror = ObjectChartSchema.shape as Record<string, unknown>;
    for (const [key, member] of Object.entries(bagOf().shape)) expect(member, key).toBe(mirror[key]);
  });

  it.each([
    // `gauge` since objectui#11513: `radar` joined the declared families then, and `gauge` is a spec
    // family this block draws no chart of, so it stays outside.
    ['a chart family outside the vocabulary', { chartType: 'gauge' }, ['properties', 'chartType'], 'invalid_value'],
    ['a bare column name as `xAxis` (objectui#10518)', { chartType: 'bar', xAxis: 'stage' }, ['properties', 'xAxis'], 'invalid_union'],
    ['a single axis object as `yAxis` (objectui#10518)', { chartType: 'bar', yAxis: { field: 'n' } }, ['properties', 'yAxis'], 'invalid_type'],
    ['an `aggregate` with no `groupBy` (the spec\'s strict schema)', { chartType: 'bar', aggregate: { function: 'count' } }, ['properties', 'aggregate', 'groupBy'], 'invalid_union'],
    ['a series entry naming no column (objectui#10770)', { chartType: 'bar', series: [{ label: 'x' }] }, ['properties', 'series', 0], 'invalid_union'],
  ] as const)('%s is refused at that member on both faces', (_label, props, path, code) => {
    for (const [, parse] of FACES) {
      const issue = issuesOf(parse({ type: 'object-chart', properties: props })).find((i) => i.code === code);
      expect(issue?.path).toEqual(path);
    }
  });

  it.each(RETIRED.map((key) => [key] as const))('the retired `%s` is refused in the bag with its retirement (objectui#10608)', (key) => {
    const [issue] = issuesOf(safeValidateSchema({ type: 'object-chart', properties: { chartType: 'bar', [key]: 'x' } }));
    expect(issue.code).toBe('invalid_type');
    expect(issue.path).toEqual(['properties', key]);
    expect(issue.message).toContain('RETIRED (objectui#10608');
  });

  it('a key the chart does not declare, in the bag, stays unjudged by the tolerant face and is refused by the strict face', () => {
    // The mirror's own posture (`BaseSchema`'s `.passthrough()`), kept one layer down.
    const doc = { type: 'object-chart', properties: { chartType: 'bar', inventedKey11276: 1 } };
    expect(safeValidateSchema(doc).success).toBe(true);
    const issue = issuesOf(StrictAnyComponentSchema.safeParse(doc)).find((i) => i.code === 'unrecognized_keys');
    expect(issue?.path).toEqual(['properties']);
    expect((issue as { keys?: string[] } | undefined)?.keys).toEqual(['inventedKey11276']);
  });
});

describe('the flat spelling is refused by name, with the bag member as the remedy (objectui#11276)', () => {
  it('the spec\'s own page component refuses the flat node (lit control: the reason holds for this type)', () => {
    const issues = issuesOf(SpecPageComponentSchema.safeParse(FLAT));
    expect(issues.map((i) => i.code)).toEqual(['unrecognized_keys']);
    expect((issues[0] as { keys?: string[] }).keys).toEqual(['objectName', 'chartType']);
  });

  it.each(FACES)('%s refuses the flat node at each flat key, naming `properties.KEY`', (_face, parse) => {
    const issues = issuesOf(parse(FLAT));
    const byPath = new Map(issues.map((i) => [i.path.join('.'), i.message]));
    expect([...byPath.keys()].sort()).toEqual(['chartType', 'objectName']);
    expect(byPath.get('chartType')).toContain('`chartType` → `properties.chartType`');
    expect(byPath.get('objectName')).toContain('`objectName` → `properties.objectName`');
    // The prescription is the whole document shape, not only the path.
    expect(byPath.get('chartType')).toContain('"properties": {');
  });

  it('the bag is non-trivial, so the per-key rows below are not vacuous', () => {
    expect(bagKeys().length).toBeGreaterThan(10);
  });

  // Every member of the bag but the three retired ones, read off the arm on
  // each run — not a transcribed list that could drift from it.
  const LIVE_KEYS = Object.keys(ObjectChartBlockSchema.shape.properties.unwrap().shape).filter(
    (key) => !(RETIRED as readonly string[]).includes(key),
  );

  it.each(LIVE_KEYS.map((key) => [key] as const))('a flat `%s` is refused on the tolerant face, by name', (key) => {
    const issues = issuesOf(safeValidateSchema({ ...SHOWCASE_BAR, [key]: true }));
    const issue = issues.find((i) => i.path.join('.') === key);
    expect(issue, JSON.stringify(issues)).toBeDefined();
    expect(issue!.message).toContain(`\`${key}\` → \`properties.${key}\``);
  });

  it.each(RETIRED.map((key) => [key] as const))(
    'a flat `%s` keeps its retirement, not a pointer at a retired bag member',
    (key) => {
      for (const [, parse] of FACES) {
        const issue = issuesOf(parse({ ...SHOWCASE_BAR, [key]: 'x' })).find((i) => i.path.join('.') === key);
        expect(issue?.message).toContain('RETIRED (objectui#10608');
        expect(issue?.message).not.toContain('Did you mean');
      }
    },
  );

  it.each([
    ['an invented key', 'inventedKey11276'],
  ] as const)('%s written flat stays unjudged on the tolerant face and is refused on the strict face', (_label, key) => {
    const doc = { ...SHOWCASE_BAR, [key]: { object: 'x' } };
    expect(safeValidateSchema(doc).success).toBe(true);
    const issue = issuesOf(StrictAnyComponentSchema.safeParse(doc)).find((i) => i.code === 'unrecognized_keys');
    expect((issue as { keys?: string[] } | undefined)?.keys).toEqual([key]);
  });

  it('the node-level `dataSource` binding parses on both faces and is not a bag member (objectui#11070)', () => {
    const doc = { ...SHOWCASE_BAR, dataSource: { object: 'x' } };
    for (const [, parse] of FACES) expect(parse(doc).error?.issues ?? []).toEqual([]);
    expect(bagKeys()).not.toContain('dataSource');
  });

  it('a `BaseSchema` key stays on the node, as on every arm (control)', () => {
    for (const [, parse] of FACES) expect(parse({ ...SHOWCASE_BAR, className: 'min-h-0' }).success).toBe(true);
  });

  it.each(['body', 'children'] as const)('refuses the `%s` content channel by name (objectui#9256)', (key) => {
    const issue = issuesOf(safeValidateSchema({ ...SHOWCASE_BAR, [key]: [{ type: 'text', content: 'x' }] }))[0];
    expect(issue.path).toEqual([key]);
    expect(issue.message).toContain('objectui#9256');
    expect(issue.message).toContain('`object-chart`');
  });
});

describe('the chart family is required, read in the bag (objectui#11276)', () => {
  it.each([
    ['the bare node', { type: 'object-chart' }],
    ['an empty bag', { type: 'object-chart', properties: {} }],
    ['a bag with a dataset and no family', { type: 'object-chart', properties: { dataset: 'm', values: ['n'] } }],
  ] as const)('%s is refused on both faces at `properties.chartType`', (_label, doc) => {
    for (const [, parse] of FACES) {
      const found = issuesOf(parse(doc)).filter((i) => i.code === 'custom');
      expect(found.map((i) => i.path)).toEqual([['properties', 'chartType']]);
      expect(found[0].message).toContain('`properties.chartType`');
    }
  });

  it.each([
    ['`properties.chartType`', { chartType: 'pie' }],
    ['`properties.specType`', { specType: 'pie' }],
  ] as const)('%s alone names the family', (_label, props) => {
    expect(safeValidateSchema({ type: 'object-chart', properties: props }).success).toBe(true);
  });

  it('a family written flat is not a family: it is refused by name and pointed at the bag', () => {
    const issue = issuesOf(safeValidateSchema({ type: 'object-chart', chartType: 'bar' })).find(
      (i) => i.path.join('.') === 'chartType',
    );
    expect(issue?.message).toContain('`chartType` → `properties.chartType`');
  });

  it('the spec has no such rule: its page component accepts the bare node (the recorded divergence)', () => {
    expect(SpecPageComponentSchema.safeParse({ type: 'object-chart' }).success).toBe(true);
  });
});

describe('the arm moved; the post-hoist mirror stayed (objectui#11276)', () => {
  const literalsOf = (union: { options: readonly unknown[] }) =>
    union.options.map((arm) => (arm as { shape: { type: z.ZodLiteral<string> } }).shape.type.value);

  it('`object-chart` is armed by the bag arm, not by the flat mirror', () => {
    expect(literalsOf(ObjectQLPublicBlockComponentSchema)).toContain('object-chart');
    expect(literalsOf(ObjectQLComponentSchema)).not.toContain('object-chart');
    expect(ObjectQLPublicBlockComponentSchema.options).toContain(ObjectChartBlockSchema);
  });

  it('the flat mirror is still published and still judges the post-hoist node', () => {
    // It is what `ObjectChart` reads after the hoist, and what the composers
    // build — neither is an authored `object-chart` node.
    expect(ObjectChartSchema.safeParse(FLAT).success).toBe(true);
    expect(ObjectChartSchema.safeParse({ ...FLAT, xAxisKey: 'stage', series: [{ dataKey: 'amount' }] }).success).toBe(true);
    expect(ObjectChartSchema.safeParse({ ...FLAT, chartType: 'gauge' }).success).toBe(false);
  });
});
