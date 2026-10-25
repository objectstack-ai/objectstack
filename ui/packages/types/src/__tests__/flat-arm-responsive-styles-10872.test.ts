/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `flex`, `object-grid` and `object-chart` declare the node-level
 * `responsiveStyles` that `@objectstack/spec`'s `PageComponentSchema` declares
 * on every page component, by reference, from the same fragment as the
 * public-block arms (objectui#10872, batch 9).
 *
 * ## The defect these pin
 *
 * Batch 8 declared the key on the 30 public-block arms. Objectstack's showcase
 * and its UI skill also write it on nodes of three arms outside that set:
 * `flex`, `object-grid` and `object-chart`. That reading is recorded on
 * objectui#10872, and nothing here re-derives it. `SchemaRenderer` compiles
 * the key to id-scoped CSS on every node (ADR-0065), but these three arms did
 * not declare it, so:
 *
 *   - the STRICT authoring face refused a spec-valid node by name
 *     (`unrecognized_keys`), and
 *   - the TOLERANT face passed it unjudged: `responsiveStyles: 7`, or a
 *     breakpoint the spec does not have (`md`), parsed clean and styled
 *     nothing.
 *
 * ## What is and is not widened
 *
 * The three arms spread the ONE shared fragment the public-block arms spread,
 * `PAGE_COMPONENT_ENVELOPE`, so the member is the same object on all 33 arms.
 *
 * ⚠️ objectui#11276 moved `object-chart`'s AUTHORED arm into the public-block
 * set (`ObjectChartBlockSchema`, its props in the `properties` bag), and its
 * `object-grid` batch moved `object-grid`'s the same way
 * (`ObjectGridBlockSchema`), so the authored chart and grid arms are pinned
 * with the other public blocks in `./public-block-responsive-styles-10872.test.ts`.
 * Its `flex` batch moved `flex`'s authored arm to the bag too
 * (`FlexBlockSchema`), which stays in the layout union, outside the public-block
 * set: so the population below is that one arm, `flex`, whose nodes now carry
 * their props in the bag beside the node-level key. The flat `FlexSchema`,
 * `ObjectChartSchema` and `ObjectGridSchema` mirrors keep the shared member as
 * the post-hoist reading.
 * The key is NOT declared on `BaseSchema` and NOT on any arm without a measured
 * producer: `grid`, `stack` and `container` below are the control, and the
 * whole arm list is read at run time so an arm that gains the member silently
 * turns this file red. The published TypeScript twins declare it too, as the
 * spec's `ResponsiveStyles` type by reference, so the mirror-parity census
 * measures no mirrored-but-undeclared key on these pairs.
 *
 * Every verdict is read against the INSTALLED spec at run time: the member is
 * compared with the spec's own `ResponsiveStylesSchema`, and a refusal is
 * compared with the issue the spec itself emits for the same value.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  PageComponentSchema,
  ResponsiveStylesSchema as SpecResponsiveStylesSchema,
  type ResponsiveStyles as SpecResponsiveStyles,
} from '@objectstack/spec/ui';

import {
  AnyComponentSchema,
  BaseSchema,
  FlexBlockSchema,
  FlexSchema,
  ObjectChartSchema,
  ObjectGridSchema,
  ObjectQLPublicBlockComponentSchema,
  PageSectionBlockSchema,
  PublicBlockComponentSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';
import type { FlexSchema as TsFlexSchema, StackSchema as TsStackSchema } from '../layout';
import type { ObjectChartSchema as TsObjectChartSchema, ObjectGridSchema as TsObjectGridSchema } from '../objectql';

/* ── Type-level pins (compiled by `tsc -p tsconfig.test.json`) ─────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type ShapeOf<M> = M extends { shape: infer S } ? S : never;
type InputOf<T> = T extends z.ZodType ? z.input<T> : never;

/** Each zod arm's member accepts exactly the spec's published type, absent allowed. */
export type assertionZodMemberIsTheSpecType = [
  Expect<Equal<InputOf<ShapeOf<typeof FlexBlockSchema>['responsiveStyles']>, SpecResponsiveStyles | undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof FlexSchema>['responsiveStyles']>, SpecResponsiveStyles | undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof ObjectGridSchema>['responsiveStyles']>, SpecResponsiveStyles | undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof ObjectChartSchema>['responsiveStyles']>, SpecResponsiveStyles | undefined>>,
];
/**
 * Each published TypeScript twin declares the member as the spec's type. Without
 * the declaration the member resolved through `BaseSchema`'s index signature to
 * `any`, which `Equal` refuses; since objectui#8347 the indexed access does not
 * compile at all.
 */
export type assertionTsTwinIsTheSpecType = [
  Expect<Equal<TsFlexSchema['responsiveStyles'], SpecResponsiveStyles | undefined>>,
  Expect<Equal<TsObjectGridSchema['responsiveStyles'], SpecResponsiveStyles | undefined>>,
  Expect<Equal<TsObjectChartSchema['responsiveStyles'], SpecResponsiveStyles | undefined>>,
];
/**
 * The helper can FAIL: `Equal` refuses a member whose type differs from the
 * spec's (`stack`'s declared `className` is no `SpecResponsiveStyles`), so the
 * lines above are readings. `stack` declares no `responsiveStyles` at all: the
 * member used to resolve through the index signature, and since objectui#8347
 * removed it the key is no member of `stack`.
 */
export type assertionEqualCanFail = Expect<
  Equal<Equal<TsStackSchema['className'], SpecResponsiveStyles | undefined>, false>
>;
export type assertionUndeclaredTwinIsNoMember = Expect<
  Equal<'responsiveStyles' extends keyof TsStackSchema ? true : false, false>
>;

/* ── The population ───────────────────────────────────────────────────────── */

type Arm = z.ZodObject;
const optionsOf = (union: unknown): Arm[] => (union as { options: Arm[] }).options;
const literalOf = (arm: Arm): string => (arm.shape.type as z.ZodLiteral).value as string;

/** Every arm of the node union with its `type` literals, read off the live union. */
function armsByLiteral(): Map<string, Arm> {
  const out = new Map<string, Arm>();
  const walk = (schema: unknown): void => {
    const options = (schema as { options?: unknown[] }).options;
    if (options) {
      for (const option of options) walk(option);
      return;
    }
    const type = (schema as Arm).shape?.type as { _zod?: { values?: Set<unknown> } } | undefined;
    for (const value of type?._zod?.values ?? []) out.set(String(value), schema as Arm);
  };
  walk(AnyComponentSchema);
  return out;
}

/**
 * The arms this batch widens that the node union still selects: the arms
 * outside the public-block set that a producer writes `responsiveStyles` on
 * (objectui#10872's batch-9 pull). NAMED, not derived, because the population
 * is a measurement of producers. `object-chart` was the third until
 * objectui#11276 moved its authored arm into the public-block set, and
 * `object-grid` the second until that card's `object-grid` batch moved its
 * authored arm the same way; each flat mirror keeps the member (the post-hoist
 * rows below). `flex`'s authored arm is `FlexBlockSchema` since that card's
 * `flex` batch: its props in the bag, still outside the public-block set.
 */
const FLAT_ARMS = [
  ['flex', FlexBlockSchema],
] as const;

/** Arms with no producer: the strict face still refuses the key on them. */
const CONTROL_TYPES = ['grid', 'stack', 'container'] as const;

/**
 * The arms here that already declared `dataSource` before this batch
 * (objectui#11070). `object-grid` was the one until objectui#11276 moved its
 * authored arm into the public-block set, where it is named with that set's
 * binding arms; `flex` declares none.
 */
const DECLARES_DATA_SOURCE: ReadonlySet<string> = new Set<string>();

/** The five envelope keys the spec declares and this batch leaves undeclared. */
const UNDECLARED_ENVELOPE = ['events', 'dataSource', 'aria', 'visibility', 'responsive'] as const;

/**
 * A valid node per arm, shaped like the producer's nodes, `responsiveStyles`
 * included: the key on the node, the props in the `properties` bag
 * (objectui#11276).
 */
const VALID_NODES = {
  flex: {
    type: 'flex',
    id: 'cc_panel',
    responsiveStyles: {
      large: { display: 'block', minWidth: '0', padding: '15px 17px 17px', borderRadius: '16px' },
      small: { padding: '12px', minHeight: '200px' },
    },
    properties: {
      direction: 'col',
      // A nested node carrying the key: judged at depth, through the page walk.
      children: [{ type: 'flex', id: 'cc_spacer', responsiveStyles: { large: { flex: '1 1 auto' } } }],
    },
  },
} as const;

/** Values the spec refuses: a breakpoint it does not have, a non-object, a non-CSS value. */
const INVALID_STYLES: ReadonlyArray<readonly [string, unknown]> = [
  ['a breakpoint the spec does not declare (`md`)', { md: { padding: '8px' } }],
  ['a number instead of a map', 7],
  ['a style value that is neither string nor number', { large: { padding: true } }],
];

type Result = { success: boolean; error?: { issues: z.core.$ZodIssue[] } };

/** Every issue as `{ code, path, message }`. */
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

describe('the population (objectui#10872 batch 9)', () => {
  it('each named arm is the arm the node union selects for its literal', () => {
    const arms = armsByLiteral();
    // Non-vacuity: the union is read, and it is the whole node vocabulary.
    expect(arms.size).toBeGreaterThan(100);
    for (const [type, arm] of FLAT_ARMS) {
      expect(literalOf(arm)).toBe(type);
      expect(arms.get(type)).toBe(arm);
    }
    for (const type of CONTROL_TYPES) expect(arms.has(type)).toBe(true);
  });

  it('the spec declares `responsiveStyles` on a page component of each type (lit control)', () => {
    for (const [type] of FLAT_ARMS) {
      const node = { type, responsiveStyles: VALID_NODES[type].responsiveStyles };
      expect(PageComponentSchema.safeParse(node).success).toBe(true);
      expect(SpecResponsiveStylesSchema.safeParse(node.responsiveStyles).success).toBe(true);
    }
  });
});

describe('`responsiveStyles` is declared on the batch-9 arms, from the public blocks\' fragment (objectui#10872 batch 9)', () => {
  it.each(FLAT_ARMS)('%s carries the member, and it is the SAME object the public-block arms carry', (_type, arm) => {
    const shared = PageSectionBlockSchema.shape.responsiveStyles;
    expect(shared).toBeDefined();
    expect(arm.shape.responsiveStyles).toBe(shared);
  });

  it('the flat `FlexSchema` mirror keeps the SAME member as the post-hoist reading (objectui#11276)', () => {
    // Its authored arm is `FlexBlockSchema` since the `flex` batch; the mirror
    // is the node as the `flex` renderer reads it, and it still declares the key.
    expect(FlexSchema.shape.responsiveStyles).toBe(PageSectionBlockSchema.shape.responsiveStyles);
    expect(armsByLiteral().get('flex')).not.toBe(FlexSchema);
  });

  it('the flat `ObjectChartSchema` mirror keeps the SAME member as the post-hoist reading (objectui#11276)', () => {
    // Its authored arm left the node union for the public-block set; the
    // mirror is the node as `ObjectChart` reads it, and it still declares the key.
    expect(ObjectChartSchema.shape.responsiveStyles).toBe(PageSectionBlockSchema.shape.responsiveStyles);
    expect(armsByLiteral().get('object-chart')).not.toBe(ObjectChartSchema);
  });

  it('the flat `ObjectGridSchema` mirror keeps the SAME member as the post-hoist reading (objectui#11276)', () => {
    // Its authored arm left the node union for the public-block set in the
    // `object-grid` batch; the mirror is the node as `ObjectGrid` reads it, and
    // it still declares the key and the `dataSource` binding.
    expect(ObjectGridSchema.shape.responsiveStyles).toBe(PageSectionBlockSchema.shape.responsiveStyles);
    expect('dataSource' in ObjectGridSchema.shape).toBe(true);
    expect(armsByLiteral().get('object-grid')).not.toBe(ObjectGridSchema);
  });

  it('the member is the spec\'s own map: the same breakpoints, each the spec\'s own value schema', () => {
    const member = (FlexSchema.shape.responsiveStyles as z.ZodOptional).unwrap() as z.ZodObject;
    const spec = SpecResponsiveStylesSchema as unknown as z.ZodObject;
    expect(Object.keys(member.shape).sort()).toEqual(Object.keys(spec.shape).sort());
    for (const key of Object.keys(spec.shape)) expect(member.shape[key]).toBe(spec.shape[key]);
  });

  it('exactly the public-block arms and these flat arms declare it: no other arm, and not `BaseSchema`', () => {
    expect(Object.keys(BaseSchema.shape)).not.toContain('responsiveStyles');
    const publicBlocks = [
      ...optionsOf(PublicBlockComponentSchema),
      ...optionsOf(ObjectQLPublicBlockComponentSchema),
    ].map(literalOf);
    const expected = [...publicBlocks, ...FLAT_ARMS.map(([type]) => type)].sort();
    const declaring = [...armsByLiteral()]
      .filter(([, arm]) => 'responsiveStyles' in arm.shape)
      .map(([type]) => type)
      .sort();
    expect(declaring).toEqual(expected);
  });

  it.each(CONTROL_TYPES)('%s (no producer) still refuses it on the strict face, by name', (type) => {
    const node = { type, responsiveStyles: VALID_NODES.flex.responsiveStyles };
    expect(refusedKeys(StrictAnyComponentSchema.safeParse(node))).toEqual(['responsiveStyles']);
  });
});

describe('a valid `responsiveStyles` is accepted on BOTH faces (objectui#10872 batch 9)', () => {
  it.each(FLAT_ARMS.map(([type]) => type))('%s: the node parses on both faces, and the map survives unchanged', (type) => {
    const node = VALID_NODES[type];
    const tolerant = safeValidateSchema(node);
    expect(issuesOf(tolerant)).toEqual([]);
    expect((tolerant.data as { responsiveStyles?: unknown }).responsiveStyles).toEqual(node.responsiveStyles);
    const strict = StrictAnyComponentSchema.safeParse(node);
    expect(issuesOf(strict)).toEqual([]);
    expect((strict.data as { responsiveStyles?: unknown }).responsiveStyles).toEqual(node.responsiveStyles);
  });
});

describe('an invalid `responsiveStyles` is refused on BOTH faces, with the spec\'s own issue (objectui#10872 batch 9)', () => {
  const cases = FLAT_ARMS.flatMap(([type]) => INVALID_STYLES.map(([why, value]) => [type, why, value] as const));

  it.each(cases)('%s — %s', (type, _why, value) => {
    // The spec's verdict on the same value at a page component of this type,
    // read at run time. The spec node carries only `type` and the key, so every
    // issue it reports is about the key.
    const spec = issuesOf(PageComponentSchema.safeParse({ type, responsiveStyles: value }));
    expect(spec.length, 'lit control: the spec refuses this value').toBeGreaterThan(0);
    expect(spec.every((issue) => issue.path.startsWith('responsiveStyles'))).toBe(true);
    const node = { ...VALID_NODES[type], responsiveStyles: value };
    expect(issuesOf(safeValidateSchema(node))).toEqual(spec);
    expect(issuesOf(StrictAnyComponentSchema.safeParse(node))).toEqual(spec);
  });
});

describe('the other five envelope keys stay undeclared on the batch-9 arms (objectui#10872 batch 9)', () => {
  it('no arm gained any of them: `dataSource` only where objectui#11070 declared it', () => {
    const declared = FLAT_ARMS.flatMap(([type, arm]) =>
      UNDECLARED_ENVELOPE.filter((key) => key in arm.shape).map((key) => `${type}#${key}`),
    ).sort();
    expect(declared).toEqual([...DECLARES_DATA_SOURCE].map((type) => `${type}#dataSource`));
  });

  const cases = FLAT_ARMS.flatMap(([type]) =>
    UNDECLARED_ENVELOPE.filter((key) => !(key === 'dataSource' && DECLARES_DATA_SOURCE.has(type))).map(
      (key) => [type, key] as const,
    ),
  );

  it.each(cases)('%s: a node-level `%s` is still refused on the strict face, by name', (type, key) => {
    // The valid node without the key under test and without its bag (where its
    // nested child sits), so the only refusal left is the one this row asks about.
    const { responsiveStyles: _styles, ...rest } = VALID_NODES[type] as Record<string, unknown>;
    const { properties: _bag, ...bare } = rest;
    const node = { ...bare, [key]: { x: 1 } };
    expect(refusedKeys(StrictAnyComponentSchema.safeParse(node))).toEqual([key]);
  });
});
