/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11468: the authored `properties`-bag carriers outside the public
 * blocks (the eight `ObjectQLPublicBlockComponentSchema` arms and
 * `FlexBlockSchema`) have a TypeScript node type, derived by reference and
 * joined into `AuthoringNode`, pinned.
 *
 * As in `authoring-nodes-11364.test.ts`, most assertions here are TYPE-level,
 * judged by this package's `type-check` (its `tsc -p tsconfig.test.json` leg),
 * never by vitest. `PostRemovalSchema` is `SchemaRenderer`'s `schema` prop with
 * `BaseSchema`'s index signature stripped at the type level, so the pins ran
 * while the signature was still present and keep running now that
 * objectui#8347 has removed it.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { BaseSchema } from '../base.js';
import type {
  AuthoringNode,
  FlexBlockNode,
  ObjectChartBlockNode,
  ObjectFormBlockNode,
  ObjectGanttBlockNode,
  ObjectGridBlockNode,
  ObjectMapBlockNode,
  ObjectMasterDetailFormBlockNode,
  ObjectMetricBlockNode,
  ObjectPivotBlockNode,
  EmbeddableFormBlockNode,
  ListViewBlockNode,
  ObjectQLPublicBlockNode,
  ObjectTimelineBlockNode,
  PublicBlockNode,
} from '../authoring-nodes.js';
import {
  FlexBlockSchema,
  ObjectQLPublicBlockComponentSchema,
  PublicBlockComponentSchema,
} from '../zod/index.zod.js';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** `T` without its string / number index signatures: `BaseSchema` as objectui#8347 leaves it. */
type WithoutIndexSignature<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

/** `SchemaRendererProps['schema']` with the removal applied to its `BaseSchema` member. */
type PostRemovalSchema = WithoutIndexSignature<BaseSchema> | AuthoringNode | string | null | undefined;

/**
 * The `type` of every member whose `properties` bag accepts an undeclared key:
 * a string index signature whose value is not `never`. (`element:divider`'s
 * bag is `Record<string, never>`, which refuses every key, so it is closed.)
 */
type OpenBagTypes<U> = U extends { type: infer T; properties?: infer Bag }
  ? string extends keyof NonNullable<Bag>
    ? [NonNullable<Bag>[string]] extends [never]
      ? never
      : T
    : never
  : never;

/** The derivation before objectui#11468: the arm's shape read closed, its bag read as it stands. */
type ShapeOnlyArmInput<Arm> = Arm extends z.ZodObject ? z.input<z.ZodObject<Arm['shape']>> : never;

// 1. No arm is lost. The derivation maps anything that is not a zod object to
//    `never`, so the derived `type` sets must equal the arms' own.
type _EveryObjectQLArmIsTyped = Assert<
  Equal<ObjectQLPublicBlockNode['type'], z.input<typeof ObjectQLPublicBlockComponentSchema>['type']>
>;
type _FlexIsTyped = Assert<Equal<FlexBlockNode['type'], z.input<typeof FlexBlockSchema>['type']>>;

// 2. Each named node type is its arm's member, and every one is in `AuthoringNode`.
type _EachAliasIsItsArm = Assert<
  Equal<
    [
      ObjectMetricBlockNode['type'],
      ObjectMasterDetailFormBlockNode['type'],
      ObjectTimelineBlockNode['type'],
      ObjectFormBlockNode['type'],
      ObjectMapBlockNode['type'],
      ObjectChartBlockNode['type'],
      ObjectGanttBlockNode['type'],
      ObjectGridBlockNode['type'],
      ObjectPivotBlockNode['type'],
      EmbeddableFormBlockNode['type'],
      ListViewBlockNode['type'],
    ],
    [
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
    ]
  >
>;
type _JoinedIntoAuthoringNode = Assert<
  Equal<Extract<AuthoringNode, { type: ObjectQLPublicBlockNode['type'] | 'flex' }>, ObjectQLPublicBlockNode | FlexBlockNode>
>;

// 3. No member of `AuthoringNode` carries an open bag. `flex` and `object-chart`
//    have no spec row: their bags are the flat mirrors' own members, kept
//    `.passthrough()` for the tolerant face, so reading the arm's shape alone
//    leaves each bag with `[k: string]: unknown`. `object-pivot` and
//    `embeddable-form` (objectui#11440) have no row either: their required bags
//    are built from the registration inputs, kept `.passthrough()` the same way.
//    The page `list-view` (objectui#12670) has no row either: its bag is the
//    `ListViewSchema` mirror's own members, kept `.passthrough()` like `object-chart`'s.
//    The control shows that, which is why the derivation reads the bag's shape too.
type _NoAuthoringNodeBagIsOpen = Assert<Equal<OpenBagTypes<AuthoringNode>, never>>;
type _ControlShapeOnlyLeavesTheOwnMemberBagsOpen = Assert<
  Equal<
    OpenBagTypes<ShapeOnlyArmInput<(typeof ObjectQLPublicBlockComponentSchema)['options'][number] | typeof FlexBlockSchema>>,
    'object-chart' | 'flex' | 'object-pivot' | 'embeddable-form' | 'list-view'
  >
>;

// 4. Closing the bag changes nothing for a spec-row bag: the 27 public blocks
//    are typed exactly as the shape-only derivation typed them.
type _PublicBlocksUnchanged = Assert<
  Equal<PublicBlockNode, ShapeOnlyArmInput<(typeof PublicBlockComponentSchema)['options'][number]>>
>;

describe('objectui#11468: the authored properties-bag carriers have a TypeScript authoring face', () => {
  it('object-map: the spec row is the bag, a misspelled bag key and a flat prop are refused, after the removal', () => {
    const spelled: PostRemovalSchema = {
      type: 'object-map',
      properties: { objectName: 'stores', map: { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name' } },
    };
    // @ts-expect-error `objectNme` is not a member of ComponentPropsMap['object-map']
    const misspelled: PostRemovalSchema = { type: 'object-map', properties: { objectNme: 'stores' } };
    // @ts-expect-error `objectName` is a member of the bag, refused flat on the node by name
    const flat: ObjectMapBlockNode = { type: 'object-map', objectName: 'stores' };
    expect([spelled, misspelled, flat]).toHaveLength(3);
  });

  it('flex: the bag is closed, and the child list lives in it', () => {
    const box: FlexBlockNode = {
      type: 'flex',
      className: 'h-screen',
      properties: { direction: 'col', gap: 4, children: [{ type: 'text', content: 'Hello' }] },
    };
    // @ts-expect-error `direciton` is not a member of the flex bag (the mirror's members, closed)
    const misspelled: FlexBlockNode = { type: 'flex', properties: { direciton: 'col' } };
    // @ts-expect-error `direction` is a member of the bag, refused flat on the node by name
    const flat: FlexBlockNode = { type: 'flex', direction: 'col' };
    // @ts-expect-error a node-level child list is refused: it is `properties.children`
    const nodeChildren: FlexBlockNode = { type: 'flex', children: [] };
    // @ts-expect-error `body` is refused toward `properties.children`
    const body: FlexBlockNode = { type: 'flex', body: [] };
    // An inline literal where `SchemaRenderer` takes a schema compiles after the removal, through
    // `AuthoringNode` (a typed constant like `box` would fit `BaseSchema` structurally either way).
    const inline: PostRemovalSchema = { type: 'flex', properties: { direction: 'row', gap: 2 } };
    expect([box, misspelled, flat, nodeChildren, body, inline]).toHaveLength(6);
  });

  it('object-chart: the bag is closed, though it is no spec row', () => {
    const chart: ObjectChartBlockNode = {
      type: 'object-chart',
      properties: { objectName: 'opportunity', chartType: 'bar' },
    };
    // @ts-expect-error `chartTyp` is not a member of the object-chart bag (the mirror's members, closed)
    const misspelled: ObjectChartBlockNode = { type: 'object-chart', properties: { chartTyp: 'bar' } };
    expect([chart, misspelled]).toHaveLength(2);
  });

  it('list-view (objectui#12670): the bag is closed, spelled `data` / `type`, and the retired pair is refused in both positions', () => {
    const ruled: ListViewBlockNode = {
      type: 'list-view',
      properties: { data: { provider: 'object', object: 'deal' }, type: 'kanban', kanban: { groupByField: 'stage' } },
    };
    // @ts-expect-error `objectName` is refused in the bag: the object is named in `data`
    const bagObjectName: ListViewBlockNode = { type: 'list-view', properties: { objectName: 'deal' } };
    // @ts-expect-error `viewType` is refused flat on the node: the kind is `properties.type`
    const flatViewType: ListViewBlockNode = { type: 'list-view', viewType: 'kanban' };
    // @ts-expect-error `viewTyp` is not a member of the list-view bag (the mirror's members, closed)
    const misspelled: ListViewBlockNode = { type: 'list-view', properties: { viewTyp: 'kanban' } };
    expect([ruled, bagObjectName, flatViewType, misspelled]).toHaveLength(4);
  });

  it('every carrier arm is a zod object, and so are the two mirror bags: the premises the derivation reads', () => {
    const arms: z.ZodType[] = [...ObjectQLPublicBlockComponentSchema.options, FlexBlockSchema];
    expect(arms.filter((arm) => arm.def.type !== 'object')).toEqual([]);
    expect(ObjectQLPublicBlockComponentSchema.options.length).toBeGreaterThan(0);
    for (const bag of [FlexBlockSchema.shape.properties, ObjectQLPublicBlockComponentSchema.options.find((arm) => arm.shape.type.value === 'object-chart')?.shape.properties]) {
      expect(bag?.def.type).toBe('optional');
      expect((bag?.def as { innerType: z.ZodType } | undefined)?.innerType.def.type).toBe('object');
    }
  });
});
