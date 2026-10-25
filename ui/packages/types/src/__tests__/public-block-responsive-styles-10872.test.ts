/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every ADR-0080 public-block arm declares the node-level `responsiveStyles`
 * that `@objectstack/spec`'s `PageComponentSchema` declares, by reference
 * (objectui#10872, batch 8 — the envelope-key batch).
 *
 * ## The defect these pin
 *
 * `PageComponentSchema` declares six node-level keys beside `properties`:
 * `events`, `responsiveStyles`, `dataSource`, `aria`, `visibility` and the
 * retired `responsive`. `responsiveStyles` is the one with a producer — the
 * objectstack showcase writes it on public-block nodes, objectstack's UI skill
 * teaches it, and `SchemaRenderer` compiles it to id-scoped CSS on every node
 * (ADR-0065). No arm here declared it, so:
 *
 *   - the STRICT authoring face refused a spec-valid node by name
 *     (`unrecognized_keys`), and
 *   - the TOLERANT face passed it unjudged — `responsiveStyles: 7`, or a
 *     breakpoint the spec does not have (`md`), parsed clean and then styled
 *     nothing.
 *
 * ## What is and is not widened
 *
 * The key is declared on the public-block arms — `PublicBlockComponentSchema`
 * and `ObjectQLPublicBlockComponentSchema` — through ONE shared fragment
 * (batch 9 spread the same fragment into `flex`, `object-grid` and
 * `object-chart`, pinned in `./flat-arm-responsive-styles-10872.test.ts`), and
 * NOT on `BaseSchema`, which would widen every arm in `AnyComponentSchema`
 * (a different accept-set change, not granted by the batch's ruling). The other
 * five envelope keys stay undeclared: they have no producer. The pins below
 * hold both boundaries.
 *
 * Every verdict is read against the INSTALLED spec at run time, not against
 * transcribed text: the arm's member is compared with the spec's own
 * `PageComponentSchema.responsiveStyles`, and a refusal's message is compared
 * with the one the spec itself emits for the same node.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  PageComponentSchema,
  ResponsiveStylesSchema as SpecResponsiveStylesSchema,
  type ResponsiveStyles as SpecResponsiveStyles,
} from '@objectstack/spec/ui';

import {
  BaseSchema,
  ObjectMetricBlockSchema,
  ObjectQLPublicBlockComponentSchema,
  PageSectionBlockSchema,
  PublicBlockComponentSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';

/* ── Type-level pin (compiled by `tsc -p tsconfig.test.json`) ─────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type ShapeOf<M> = M extends { shape: infer S } ? S : never;
type InputOf<T> = T extends z.ZodType ? z.input<T> : never;

/** The member accepts exactly the spec's published type, absent allowed — on a bag arm and an ObjectQL arm. */
export type assertionResponsiveStylesIsTheSpecType = [
  Expect<Equal<InputOf<ShapeOf<typeof PageSectionBlockSchema>['responsiveStyles']>, SpecResponsiveStyles | undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof ObjectMetricBlockSchema>['responsiveStyles']>, SpecResponsiveStyles | undefined>>,
];
/** The helper can FAIL — a narrower map is not the spec's type. */
export type assertionEqualCanFail = Expect<
  Equal<Equal<{ large?: Record<string, string> } | undefined, SpecResponsiveStyles | undefined>, false>
>;

/* ── The population, read off the two unions ─────────────────────────────── */

type Arm = z.ZodObject;
const optionsOf = (union: unknown): Arm[] => (union as { options: Arm[] }).options;
const literalOf = (arm: Arm): string => (arm.shape.type as z.ZodLiteral).value as string;

/** Every public-block arm — the population this batch widens, and no other. */
const ARMS: readonly Arm[] = [
  ...optionsOf(PublicBlockComponentSchema),
  ...optionsOf(ObjectQLPublicBlockComponentSchema),
];
const TYPES = ARMS.map(literalOf);

/**
 * The arms that already declared `dataSource` before this batch (objectui#10872
 * batch 2: `element:number`; objectui#10859 batches 2 and 3: the three ObjectQL
 * blocks). NAMED rather than read off the shapes, so an arm that gains
 * `dataSource` later reddens the control below instead of joining it silently.
 */
const DECLARES_DATA_SOURCE: ReadonlySet<string> = new Set([
  'element:number',
  'object-metric',
  'object-master-detail-form',
  'object-timeline',
  // objectui#10859 batch 4: the `object-form` arm moved here from
  // `ObjectQLComponentSchema`, carrying the binding its flat mirror has
  // declared since objectui#11070.
  'object-form',
  // objectui#10859 batch 5: `object-map` moved here the same way, with the
  // same binding.
  'object-map',
  // objectui#10859 batch 6: `object-gantt` moved here the same way, with the
  // same binding.
  'object-gantt',
  // objectui#11070 round 7: `object-chart` (here since objectui#11276) declares
  // the same binding at node level, beside its bag — the gate-wrapped
  // registration reads it, and the react-page wrapper no longer writes the
  // host adapter under that key.
  'object-chart',
  // objectui#11276 (the `object-grid` batch): `object-grid` moved here from
  // `ObjectQLComponentSchema`, carrying the binding its flat mirror has
  // declared since objectui#11070.
  'object-grid',
  // objectui#11440: two gate-wrapped Tier A blocks armed with the binding at
  // node level, beside their bags.
  'object-pivot',
  'embeddable-form',
  // objectui#10872: the gate-wrapped `record:line_items`, armed with the binding
  // at node level beside its bag — `ElementDataSourceGate` lands
  // `dataSource.object` on the row's optional `childObject`.
  'record:line_items',
  // objectui#11880: `element:repeater` reads the binding first (its flat query
  // keys are the fallback until the v18 pin bump), so its arm declares it at
  // node level beside its bag, whose `object` is required only where no binding
  // names one (objectui#12056).
  'element:repeater',
  // objectui#12294: the three one-record blocks read the binding (their
  // renderers provide the first bound row as their record), so each arm
  // declares it at node level, beside its bag.
  'record:details',
  'record:highlights',
  'record:quick_actions',
  // objectui#12302: `record:related_list`'s gate-wrapped renderer reads the
  // binding as its CHILD rows (objectstack#6953), so its arm declares it at
  // node level, beside its bag.
  'record:related_list',
  // objectui#12670: the authored page `list-view` arm, armed with the binding its
  // flat mirror has declared since objectui#11070, at node level beside its bag.
  'list-view',
]);

/**
 * The arms that refuse a node with nothing but `responsiveStyles` for a reason
 * that is not about the envelope: `object-map` and `object-gantt` keep their
 * flat mirrors' record-source rule, read in the bag (objectui#10859 batches 5
 * and 6, `requireRecordSource`), and `object-chart` keeps the flat mirror's
 * chart-family floor, read in its bag (objectui#11276,
 * `requireObjectChartFamilyInBag`). `object-grid` keeps its flat mirror's
 * record-source rule the same way (objectui#11276's `object-grid` batch).
 * `object-pivot` and `embeddable-form` (objectui#11440) REQUIRE their bag: its
 * registration-required members (the three cross-tab fields; `formId`) and a
 * record source. The page `list-view` (objectui#12670) keeps a record-source
 * rule read in its bag, `properties.data`. Each node carries the smallest bag that satisfies its rule;
 * every other arm takes the bare node.
 */
const RECORD_SOURCE: Readonly<Record<string, Record<string, unknown>>> = {
  'object-map': { properties: { objectName: 'store' } },
  'object-gantt': { properties: { objectName: 'task' } },
  'object-chart': { properties: { chartType: 'bar' } },
  'object-grid': { properties: { objectName: 'task' } },
  'object-pivot': { properties: { objectName: 'deal', rowField: 'stage', columnField: 'owner', valueField: 'amount' } },
  'embeddable-form': { properties: { formId: 'contact-us', objectName: 'lead' } },
  // objectui#12670: the page `list-view` keeps a record-source rule, read in the bag: `data`.
  'list-view': { properties: { data: { provider: 'object', object: 'deal' } } },
};

/** The five envelope keys the spec declares and this batch leaves undeclared. */
const UNDECLARED_ENVELOPE = ['events', 'dataSource', 'aria', 'visibility', 'responsive'] as const;

/** A spec-valid map: the unconditional base and two `max-width` overrides. */
const VALID_STYLES = {
  large: { padding: 'var(--space-6)', gap: '16px' },
  small: { padding: 'var(--space-4)' },
  xsmall: { display: 'none', order: 2 },
} as const;

/** The two bag nodes the order names: a `page:` container and an ObjectQL block. */
const BAG_NODES = [
  {
    type: 'page:section',
    id: 'kpis',
    properties: { children: [{ type: 'element:text', properties: { content: 'Revenue' } }] },
    responsiveStyles: VALID_STYLES,
  },
  {
    type: 'object-metric',
    id: 'open-deals',
    properties: { objectName: 'deal', label: 'Open deals' },
    responsiveStyles: { large: { minWidth: '0' }, small: { gridColumn: 'span 2' } },
  },
] as const;

/** Values the spec refuses: a breakpoint it does not have, a non-object, a non-CSS value. */
const INVALID_STYLES: ReadonlyArray<readonly [string, unknown]> = [
  ['a breakpoint the spec does not declare (`md`)', { md: { padding: '8px' } }],
  ['a number instead of a map', 7],
  ['a style value that is neither string nor number', { large: { padding: true } }],
];

type Result = { success: boolean; error?: { issues: z.core.$ZodIssue[] } };

/** Every issue as `{ code, path, message }`, the `code` and `path` the stable part. */
const issuesOf = (result: Result) =>
  result.success
    ? []
    : result.error!.issues.map((issue) => ({ code: issue.code, path: issue.path.join('.'), message: issue.message }));

/** The keys an `unrecognized_keys` issue names, at any depth of a union. */
function refusedKeys(result: Result): string[] {
  if (result.success) return [];
  const collect = (issues: readonly z.core.$ZodIssue[]): string[] =>
    issues.flatMap((issue) => {
      if (issue.code === 'unrecognized_keys') return issue.keys;
      if (issue.code === 'invalid_union') return issue.errors.flatMap((arm) => collect(arm));
      return [];
    });
  return collect(result.error!.issues);
}

describe('the population (objectui#10872 batch 8)', () => {
  it('reads both public-block unions, and every arm is a distinct block', () => {
    // Non-vacuity: the pins below iterate this list.
    expect(optionsOf(PublicBlockComponentSchema).length).toBeGreaterThan(20);
    expect(optionsOf(ObjectQLPublicBlockComponentSchema).length).toBeGreaterThan(2);
    expect(new Set(TYPES).size).toBe(TYPES.length);
    // Every named `dataSource` arm is in the population, so the set is not stale.
    for (const type of DECLARES_DATA_SOURCE) expect(TYPES).toContain(type);
  });

  it('the spec still declares `responsiveStyles` on its page component, as `ResponsiveStylesSchema` (lit control)', () => {
    const spec = PageComponentSchema.safeParse({ type: 'page:section', responsiveStyles: VALID_STYLES });
    expect(spec.success).toBe(true);
    expect(SpecResponsiveStylesSchema.safeParse(VALID_STYLES).success).toBe(true);
  });
});

describe('`responsiveStyles` is declared on every public-block arm, by reference (objectui#10872 batch 8)', () => {
  it('every arm carries the member, and it is ONE shared object — no per-arm copy', () => {
    const members = ARMS.map((arm) => arm.shape.responsiveStyles);
    expect(members.filter((member) => member === undefined).length, 'an arm without the member').toBe(0);
    expect(new Set(members).size).toBe(1);
  });

  it('the member is the spec\'s own map: the same breakpoints, the same strictness', () => {
    const member = (ARMS[0].shape.responsiveStyles as z.ZodOptional).unwrap() as z.ZodObject;
    const spec = SpecResponsiveStylesSchema as unknown as z.ZodObject;
    expect(Object.keys(member.shape).sort()).toEqual(Object.keys(spec.shape).sort());
    // Each breakpoint's value schema is the spec's own object, not a restatement.
    for (const key of Object.keys(spec.shape)) expect(member.shape[key]).toBe(spec.shape[key]);
  });

  it('`BaseSchema` is NOT widened — the declaration is the public blocks\' alone', () => {
    expect(Object.keys(BaseSchema.shape)).not.toContain('responsiveStyles');
    // Control: a non-public-block node is still refused by name on the strict
    // face, so the accept-set change is exactly the arms above. This is the
    // boundary of this batch, not a ruling that it must stay: batch 9 moved it
    // for `flex`, `object-grid` and `object-chart`, whose nodes a producer
    // writes the key on (`./flat-arm-responsive-styles-10872.test.ts`). The
    // control is now `grid`, an arm with no producer.
    const grid = { type: 'grid', responsiveStyles: VALID_STYLES };
    expect(refusedKeys(StrictAnyComponentSchema.safeParse(grid))).toEqual(['responsiveStyles']);
  });
});

describe('a valid `responsiveStyles` is accepted on BOTH faces (objectui#10872 batch 8)', () => {
  it.each(BAG_NODES.map((node) => [node.type, node] as const))(
    '%s: a bag node with `responsiveStyles` parses on both faces, and the map survives unchanged',
    (_type, node) => {
      // Lit control: the spec's own page component accepts the same node.
      expect(PageComponentSchema.safeParse(node).success).toBe(true);
      const tolerant = safeValidateSchema(node);
      expect(issuesOf(tolerant)).toEqual([]);
      expect((tolerant.data as { responsiveStyles?: unknown }).responsiveStyles).toEqual(node.responsiveStyles);
      const strict = StrictAnyComponentSchema.safeParse(node);
      expect(issuesOf(strict)).toEqual([]);
      expect((strict.data as { responsiveStyles?: unknown }).responsiveStyles).toEqual(node.responsiveStyles);
    },
  );

  it.each(TYPES)('%s: a node carrying only `responsiveStyles` is accepted on the strict face', (type) => {
    const node = { type, ...(RECORD_SOURCE[type] ?? {}), responsiveStyles: VALID_STYLES };
    expect(issuesOf(StrictAnyComponentSchema.safeParse(node))).toEqual([]);
    expect(issuesOf(safeValidateSchema(node))).toEqual([]);
  });
});

describe('an invalid `responsiveStyles` is refused on BOTH faces, with the spec\'s own issue (objectui#10872 batch 8)', () => {
  const cases = BAG_NODES.flatMap((node) =>
    INVALID_STYLES.map(([why, value]) => [node.type, why, { ...node, responsiveStyles: value }] as const),
  );

  it.each(cases)('%s — %s', (_type, _why, node) => {
    // The spec's verdict on the same node is the expected one, read at run time.
    const spec = issuesOf(PageComponentSchema.safeParse(node));
    expect(spec.length, 'lit control: the spec refuses this node').toBeGreaterThan(0);
    expect(spec.every((issue) => issue.path.startsWith('responsiveStyles'))).toBe(true);
    // Both faces refuse it at the same path, with the same code and message.
    expect(issuesOf(safeValidateSchema(node))).toEqual(spec);
    expect(issuesOf(StrictAnyComponentSchema.safeParse(node))).toEqual(spec);
  });
});

describe('the other five envelope keys stay undeclared (objectui#10872 batch 8)', () => {
  it('no arm gained any of them — `dataSource` only where an earlier batch declared it', () => {
    const declared = ARMS.flatMap((arm) =>
      UNDECLARED_ENVELOPE.filter((key) => key in arm.shape).map((key) => `${literalOf(arm)}#${key}`),
    ).sort();
    expect(declared).toEqual([...DECLARES_DATA_SOURCE].map((type) => `${type}#dataSource`).sort());
  });

  const cases = TYPES.flatMap((type) =>
    UNDECLARED_ENVELOPE.filter((key) => !(key === 'dataSource' && DECLARES_DATA_SOURCE.has(type))).map(
      (key) => [type, key] as const,
    ),
  );

  it.each(cases)('%s: a node-level `%s` is still refused on the strict face, by name', (type, key) => {
    const node = { type, [key]: { x: 1 } };
    expect(refusedKeys(StrictAnyComponentSchema.safeParse(node))).toEqual([key]);
  });
});
