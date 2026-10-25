/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `pivot`, `object-metric` and `object-master-detail-form` have a zod arm in
 * `AnyComponentSchema` (objectui#10859, batch 2).
 *
 * ## The defect these pin
 *
 * All three are registered (`@object-ui/plugin-dashboard`,
 * `@object-ui/plugin-form`) and declared — `pivot` on this package's TypeScript
 * face (`PivotTableSchema` in `../data-display.ts`), the other two by their
 * `@objectstack/spec` `ComponentPropsMap` row — and `AnyComponentSchema`
 * carried no arm for any of them, so `safeValidateSchema`, and
 * `objectui validate` with it, refused every document naming one with
 * `invalid_union` at `type`.
 *
 * ## Two instruments, and which half each one reads
 *
 * The `Expect` / `Equal` block below is TYPE-level: `tsc -p tsconfig.test.json`
 * (the third leg of this package's `type-check` script) reads it, and vitest —
 * which strips types — does not. The `describe` blocks are RUNTIME and vitest
 * reads them. A green run of either one alone says nothing about the other.
 *
 * ## What "mirrors its declaration" means for each arm
 *
 * - `pivot` restates `PivotTableSchema` by hand, so the parity half holds the
 *   arm's key set equal to the declaration's and each member's accepted type
 *   invariantly equal to the declaration's.
 * - `object-metric` and `object-master-detail-form` restate nothing: each arm's
 *   `properties` IS the spec row, by reference (`../zod/objectql.zod.ts` says
 *   why), so the parity half holds the bag's accepted type equal to the spec's
 *   published props type, and the runtime half holds the bag to BE the row.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ElementDataSourceSchema as SpecElementDataSourceSchema,
  ObjectMasterDetailFormPropsSchema as SpecObjectMasterDetailFormPropsSchema,
  ObjectMetricPropsSchema as SpecObjectMetricPropsSchema,
  type ObjectMasterDetailFormProps as SpecObjectMasterDetailFormProps,
  type ObjectMetricProps as SpecObjectMetricProps,
} from '@objectstack/spec/ui';

import {
  DataDisplaySchema,
  ObjectMasterDetailFormBlockSchema,
  ObjectMetricBlockSchema,
  ObjectQLPublicBlockComponentSchema,
  PivotTableSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';
import { stripImportedDefaults } from '../zod/imported-defaults.js';
import type { PivotTableSchema as Ts_PivotTableSchema } from '../data-display';

/* ── Type-level parity: the `tsc` channel ────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/** The mirror's own shape. */
type ShapeOf<M> = M extends { shape: infer S } ? S : never;
/** What a shape entry ACCEPTS (input side, so `.optional()` shows). */
type InputOf<T> = T extends z.ZodType ? z.input<T> : never;
/** The declaration's DECLARED keys — any index signature dropped (`BaseSchema` carried one until objectui#8347). */
type DeclaredKeys<D> = Extract<
  keyof { [K in keyof D as string extends K ? never : number extends K ? never : K]: D[K] },
  string
>;
/** The mirror's declared keys, read from its own shape. */
type MirroredKeys<M> = Extract<keyof ShapeOf<M>, string>;

/** Declared members whose accepted type differs from the declaration's. */
type MismatchedKeys<M, D> = {
  [K in DeclaredKeys<D> & MirroredKeys<M>]: Equal<InputOf<ShapeOf<M>[K]>, D[K]> extends true ? never : K;
}[DeclaredKeys<D> & MirroredKeys<M>];

/** `pivot`: the arm declares exactly the declaration's keys, each accepting exactly its type. */
export type assertionPivotMirrorsItsDeclaration = [
  Expect<Equal<MirroredKeys<typeof PivotTableSchema>, DeclaredKeys<Ts_PivotTableSchema>>>,
  Expect<Equal<MismatchedKeys<typeof PivotTableSchema, Ts_PivotTableSchema>, never>>,
];

/**
 * The two spec-row arms: the bag accepts exactly the spec's published props
 * type (absent allowed), and the node adds nothing to `BaseSchema` but `type`,
 * the bag, the `dataSource` binding (objectui#10859 batch 3, pinned at runtime
 * below) and — on the master-detail form — its three runtime slots.
 */
export type assertionSpecRowArmsAreTheRow = [
  Expect<Equal<InputOf<ShapeOf<typeof ObjectMetricBlockSchema>['properties']>, SpecObjectMetricProps | undefined>>,
  Expect<
    Equal<
      InputOf<ShapeOf<typeof ObjectMasterDetailFormBlockSchema>['properties']>,
      SpecObjectMasterDetailFormProps | undefined
    >
  >,
  Expect<Equal<InputOf<ShapeOf<typeof ObjectMasterDetailFormBlockSchema>['onSuccess']>, undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof ObjectMasterDetailFormBlockSchema>['onError']>, undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof ObjectMasterDetailFormBlockSchema>['onCancel']>, undefined>>,
];

/**
 * Non-vacuity: the comparisons can fail. A member typed differently on the two
 * sides is reported by name, an unmirrored key is caught by the key-set row,
 * and a bag narrower than the spec's props type is not Equal to it.
 */
export type assertionInstrumentFires = [
  Expect<Equal<MismatchedKeys<z.ZodObject<{ a: z.ZodString }>, { a: number }>, 'a'>>,
  Expect<Equal<Equal<MirroredKeys<z.ZodObject<{ a: z.ZodString }>>, DeclaredKeys<{ a: string; b: string }>>, false>>,
  Expect<Equal<Equal<{ objectName?: string } | undefined, SpecObjectMetricProps | undefined>, false>>,
];

/* ── Runtime: the documents that were refused ────────────────────────────── */

/** One minimal document per armed key — what the declaration requires, and nothing more. */
const MINIMAL = [
  { type: 'pivot', rowField: 'region', columnField: 'quarter', valueField: 'revenue', data: [] },
  { type: 'object-metric' },
  { type: 'object-master-detail-form' },
] as const;

/**
 * Shipped documents: the objectstack showcase authors both spec-row blocks in
 * the spec's `{ type, properties }` form. Copied from
 * `examples/app-showcase/src/ui/pages/index.ts` (the home page's first KPI) and
 * `examples/app-showcase/src/ui/pages/project-workspace.page.ts` (the
 * "New Project + Tasks" form) in objectstack-ai/objectstack, whose tree this
 * repository cannot read at test time — so these are copies, and a change to
 * the originals does not reach them.
 */
const SHOWCASE_OBJECT_METRIC = {
  type: 'object-metric',
  properties: {
    objectName: 'showcase_project',
    label: 'Projects',
    icon: 'folder-kanban',
    colorVariant: 'blue',
    description: 'active & planned',
    aggregate: { field: 'id', function: 'count' },
  },
};
const SHOWCASE_MASTER_DETAIL_FORM = {
  type: 'object-master-detail-form',
  properties: {
    objectName: 'showcase_project',
    mode: 'create',
    formType: 'simple',
    submitText: 'Create Project + Tasks',
    fields: ['name', 'account', 'status', 'health', 'budget', 'end_date'],
    details: [{ title: 'Tasks', childObject: 'showcase_task', addLabel: 'Add task' }],
  },
};

/** The first issue of a refused parse, or a message that says it was not refused. */
function firstIssue(result: ReturnType<typeof safeValidateSchema>) {
  if (result.success) throw new Error('expected a refusal, the document parsed');
  return result.error.issues[0];
}

describe('the registered types armed in batch 2 validate (objectui#10859)', () => {
  it.each(MINIMAL)('$type is accepted by safeValidateSchema', (doc) => {
    const result = safeValidateSchema(doc);
    expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true);
  });

  it.each(MINIMAL)('$type is accepted by the strict authoring face', (doc) => {
    const result = StrictAnyComponentSchema.safeParse(doc);
    expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true);
  });

  it.each([
    ['object-metric', SHOWCASE_OBJECT_METRIC],
    ['object-master-detail-form', SHOWCASE_MASTER_DETAIL_FORM],
  ] as const)('accepts the showcase\'s shipped `%s` document on both faces', (type, doc) => {
    // Lit control on the fixture: it is spec-valid by the spec's own row.
    const row = type === 'object-metric' ? SpecObjectMetricPropsSchema : SpecObjectMasterDetailFormPropsSchema;
    expect(row.safeParse(doc.properties).success).toBe(true);
    expect(safeValidateSchema(doc).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse(doc).success).toBe(true);
  });

  it.each([
    [
      'object-metric',
      {
        type: 'object-metric',
        dataSource: { object: 'showcase_project', filter: [{ field: 'status', operator: 'equals', value: 'active' }] },
        properties: { label: 'Projects', aggregate: { field: 'id', function: 'count' } },
      },
    ],
    [
      'object-master-detail-form',
      {
        type: 'object-master-detail-form',
        dataSource: { object: 'showcase_project' },
        properties: { mode: 'create', details: [{ title: 'Tasks', childObject: 'showcase_task' }] },
      },
    ],
  ] as const)('%s bound through the node\'s `dataSource` is accepted by the strict face (objectui#10859 batch 3)', (type, doc) => {
    // The registration is `elementDataSourceBlock`-wrapped, so the node's
    // `dataSource` is read through `ElementDataSourceGate`; the key is the
    // spec's `PageComponentSchema.dataSource`. Lit control: the binding is
    // spec-valid by the spec's own schema.
    expect(SpecElementDataSourceSchema.safeParse(doc.dataSource).success).toBe(true);
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success, JSON.stringify(strict.success ? null : strict.error.issues)).toBe(true);
    expect(safeValidateSchema(doc).success).toBe(true);
    // Judged as the binding, not merely admitted: an adapter name is refused on both faces.
    const adapterShaped = { type, dataSource: 'objectstack' };
    expect(StrictAnyComponentSchema.safeParse(adapterShaped).success).toBe(false);
    expect(safeValidateSchema(adapterShaped).success).toBe(false);
  });

  it('accepts a fully populated `pivot` document on both faces', () => {
    // Every member the arm still accepts. `drillDown` is not one of them since
    // objectui#10932 retired it on this node; its refusal is pinned in
    // `pivot-drilldown-retired-10932.test.ts`.
    const doc = {
      type: 'pivot',
      title: 'Revenue by region',
      rowField: 'region',
      columnField: 'quarter',
      valueField: 'revenue',
      aggregation: 'avg',
      data: [{ region: 'EU', quarter: 'Q1', revenue: 10 }],
      showRowTotals: true,
      showColumnTotals: false,
      format: '$,.2f',
      columnColors: { Q1: 'text-emerald-600' },
    };
    expect(safeValidateSchema(doc).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse(doc).success).toBe(true);
  });

  it('reaches each arm at a child slot too — a page of the three', () => {
    const page = { type: 'page', children: [...MINIMAL, SHOWCASE_OBJECT_METRIC] };
    expect(safeValidateSchema(page).success).toBe(true);
  });
});

describe('the batch-2 arms are closed where their declaration is (objectui#10859)', () => {
  it.each([
    ['pivot', { ...MINIMAL[0], inventedKey10859: true }],
    ['object-metric', { type: 'object-metric', inventedKey10859: true }],
    ['object-master-detail-form', { type: 'object-master-detail-form', inventedKey10859: true }],
  ] as const)('%s: an undeclared node key is refused on the strict face, by name — the strictness control', (_type, doc) => {
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success).toBe(false);
    if (strict.success) return;
    const issue = strict.error.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue, JSON.stringify(strict.error.issues)).toBeDefined();
    expect((issue as { keys?: string[] }).keys).toEqual(['inventedKey10859']);
    // The rendering face keeps its `.passthrough()`, as on every other arm.
    expect(safeValidateSchema(doc).success).toBe(true);
  });

  it.each([
    ['object-metric', { type: 'object-metric', properties: { objectName: 'order', inventedKey10859: 1 } }],
    [
      'object-master-detail-form',
      { type: 'object-master-detail-form', properties: { objectName: 'order', inventedKey10859: 1 } },
    ],
  ] as const)('%s: an undeclared key inside the bag is refused on the TOLERANT face, by name', (_type, doc) => {
    const issue = firstIssue(safeValidateSchema(doc));
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.path).toEqual(['properties']);
    expect((issue as { keys?: string[] }).keys).toEqual(['inventedKey10859']);
  });

  it.each([
    ['pivot', { ...MINIMAL[0], aggregation: 'median' }, ['aggregation']],
    ['object-metric', { type: 'object-metric', properties: { colorVariant: 'pink' } }, ['properties', 'colorVariant']],
    [
      'object-master-detail-form',
      { type: 'object-master-detail-form', properties: { formType: 'wizzard' } },
      ['properties', 'formType'],
    ],
  ] as const)('%s: a spec-invalid member value is refused at that member', (_type, doc, path) => {
    const issue = firstIssue(safeValidateSchema(doc));
    expect(issue.code).toBe('invalid_value');
    expect(issue.path).toEqual(path);
  });

  it('pivot: a member the declaration requires is refused when absent', () => {
    const withoutData = { type: 'pivot', rowField: 'region', columnField: 'quarter', valueField: 'revenue' };
    const issue = firstIssue(safeValidateSchema(withoutData));
    expect(issue.code).toBe('invalid_type');
    expect(issue.path).toEqual(['data']);
  });

  it('pivot: `drillDown` is refused whole, not judged member by member (objectui#10932)', () => {
    // Until objectui#10932 this arm judged the key by the shared drill-down
    // mirror, so the refusal landed at `['drillDown', 'enabled']`. The key is a
    // retirement tombstone now; `pivot-drilldown-retired-10932.test.ts` pins it.
    const issue = firstIssue(safeValidateSchema({ ...MINIMAL[0], drillDown: { enabled: 'yes' } }));
    expect(issue.code).toBe('invalid_type');
    expect(issue.path).toEqual(['drillDown']);
  });

  it.each(['body', 'children'] as const)('pivot refuses the `%s` content channel by name (objectui#9256)', (key) => {
    const issue = firstIssue(safeValidateSchema({ ...MINIMAL[0], [key]: [{ type: 'text', content: 'x' }] }));
    expect(issue.path).toEqual([key]);
    expect(issue.message).toContain('objectui#9256');
    expect(issue.message).toContain('`pivot`');
  });

  it.each(['onSuccess', 'onError', 'onCancel'] as const)(
    'object-master-detail-form refuses an authored `%s` as a RUNTIME SLOT (objectui#6124)',
    (key) => {
      const issue = firstIssue(safeValidateSchema({ type: 'object-master-detail-form', [key]: 'handleIt' }));
      expect(issue.code).toBe('custom');
      expect(issue.path).toEqual([key]);
      expect(issue.message).toContain(`\`${key}\``);
      expect(issue.message).toContain('RUNTIME SLOT');
    },
  );
});

describe('the spec-row arms read the row by reference (objectui#10859)', () => {
  it.each([
    ['object-metric', ObjectMetricBlockSchema, SpecObjectMetricPropsSchema],
    ['object-master-detail-form', ObjectMasterDetailFormBlockSchema, SpecObjectMasterDetailFormPropsSchema],
  ] as const)('%s: the bag is the spec row, through the import boundary', (_type, arm, row) => {
    const bag = arm.shape.properties.unwrap();
    const keysOf = (schema: unknown) => Object.keys((schema as { shape: Record<string, unknown> }).shape).sort();
    // The same members, read off the installed spec on every run — not a
    // transcribed list that could drift from it.
    expect(keysOf(bag)).toEqual(keysOf(row));
    expect(keysOf(bag).length).toBeGreaterThan(5);
    // Since `@objectstack/spec` 17.7.0 each row reaches a spec default (the
    // `object-metric` row through `drillDown.report`, the spec's report
    // definition; the `object-master-detail-form` row through the page-block
    // section shape its `sections[].fields[]` take), so the import boundary
    // hands back its stripped derivation, not the spec's own export
    // (objectui#8317; re-measured at the bump, objectui#11717). Through 17.6.0
    // neither row carried one, and this line asserted the spec's export came
    // back untouched. The bag IS that derivation, memoised to one crossing, and
    // it answers every probe exactly as the spec does.
    const crossed = stripImportedDefaults(row);
    expect(crossed).not.toBe(row);
    expect(stripImportedDefaults(row)).toBe(crossed);
    expect(bag).toBe(crossed);
    for (const probe of [{}, { objectName: 'order' }, { inventedKey10859: 1 }, { objectName: 7 }]) {
      expect(bag.safeParse(probe).success, JSON.stringify(probe)).toBe(row.safeParse(probe).success);
    }
  });

  it('each arm is reachable from AnyComponentSchema through its category union', () => {
    const literals = (union: { options: readonly { shape: { type: z.ZodLiteral<string> } }[] }) =>
      union.options.map((arm) => arm.shape.type.value);
    // `object-timeline` joined the union in batch 3 (`object-timeline-arm-10859-b3.test.ts`),
    // `object-form` in batch 4 (`object-form-properties-bag-10859-b4.test.ts`),
    // `object-map` in batch 5 (`object-map-properties-bag-10859-b5.test.ts`),
    // `object-chart` in objectui#11276 (`object-chart-properties-bag-11276.test.ts`),
    // `object-gantt` in batch 6 (`object-gantt-properties-bag-10859-b6.test.ts`),
    // `object-grid` in objectui#11276 (`object-grid-properties-bag-11276.test.ts`),
    // `object-pivot` and `embeddable-form` in objectui#11440 (`passing-keys-arms-11440.test.ts`),
    // the page `list-view` in objectui#12670 (`list-view-properties-bag-12670.test.ts`).
    expect(literals(ObjectQLPublicBlockComponentSchema)).toEqual([
      'object-metric',
      'object-master-detail-form',
      'object-timeline',
      'object-form',
      'object-map',
      'object-chart',
      'object-gantt',
      'object-grid',
      'object-pivot',
      'embeddable-form',
      'list-view',
    ]);
    expect(literals(DataDisplaySchema)).toContain('pivot');
  });
});
