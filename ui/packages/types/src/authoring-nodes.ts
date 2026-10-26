/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * TypeScript AUTHORING types for the nodes `@objectstack/spec` declares and the
 * renderer draws, derived BY REFERENCE (objectui#11364, the preparation
 * objectui#8347's `BaseSchema` index-signature removal needs; direction from
 * objectui#7927's ruling, "the real extension keys are declared").
 *
 * ## Why these exist
 *
 * `BaseSchema` carried `[key: string]: any`, so every key on every node
 * compiled. objectui#8347 removed it, so a node may author only the keys some
 * TypeScript declaration names. The nodes below had none: an `element:text`
 * with its `properties` bag, a `page:tabs` with `properties.items`, an
 * `action:button` with its executor keys in the bag (objectui#11183), and a
 * stored page document handed to `SchemaRenderer` under its page kind. Each of
 * them is declared by the spec, and the renderer draws it. objectui#11468 adds
 * the other authored `properties`-bag carriers the zod face arms: the eight
 * ObjectQL blocks (`object-map`, `object-grid`, …) and `flex`.
 *
 * ## How each one is derived
 *
 *   - {@link PublicBlockNode}: one member per arm of
 *     `PublicBlockComponentSchema` (`./zod/public-blocks.zod.ts`), each the
 *     arm's own `z.input`. The arm is `BaseSchema.extend(...)`, and the zod
 *     `BaseSchema` is `.passthrough()`, so a bare `z.input` of it carries
 *     `[k: string]: unknown`, which would put back the index signature
 *     objectui#8347 removed. So the arm's SHAPE is read and the object's
 *     config is left closed. Every member, value type and refusal is the arm's,
 *     and through the arm the spec row's (`propsBag`); nothing is restated, and
 *     an arm added to that union is typed here the same day.
 *   - {@link ObjectQLPublicBlockNode} and {@link FlexBlockNode}
 *     (objectui#11468): the same derivation, over the arms of
 *     `ObjectQLPublicBlockComponentSchema` (`./zod/objectql.zod.ts`) and over
 *     `FlexBlockSchema` (`./zod/layout.zod.ts`), the authored
 *     `properties`-bag carriers outside `PublicBlockComponentSchema`. Two of
 *     their bags are not spec rows: `flex` and `object-chart` have no
 *     `ComponentPropsMap` row, so each bag is its flat mirror's own members,
 *     kept `.passthrough()` for the tolerant face (objectui#11276). The
 *     derivation reads a bag's shape the way it reads the arm's, so the type
 *     is closed where the strict authoring face closes it. A spec-row bag is
 *     already closed, and the derivation changes nothing for it. One member
 *     of `flex`'s bag is read off the flat mirror instead of the arm: its
 *     `children`, whose list the arm leaves to the spec page walk and this
 *     face types as nodes (objectui#11564, at `FlexBlockShape`).
 *   - {@link ElementTextInputNode} and {@link ElementRecordPickerNode}: no zod
 *     arm exists for these two. `AnyComponentSchema` still refuses both at
 *     `type`, and `registered-types-validate-ratchet-10859` in
 *     `@object-ui/cli` counts that population. The spec carries both rows
 *     (`ComponentPropsMap`), so each node is built the way an arm is built:
 *     the zod `BaseSchema` shape extended with the `type` literal, the node
 *     envelope (`NODE_ENVELOPE`: `responsiveStyles`, which `SchemaRenderer`
 *     compiles on every node), `properties` as the row, and the `body` /
 *     `children` tombstones, each by reference. The spec's own
 *     `PageComponentSchema` refuses a node-level `children` on both types as an
 *     unrecognized key, as it does on `element:text`.
 *     `element:record_picker` also declares `dataSource` (the
 *     spec's `ElementDataSourceSchema`), because its renderer reads the node's
 *     binding, the same rule `ElementNumberBlockSchema` follows. Its bag is the
 *     row as published: the flat `object` it once left optional for the spec's
 *     `dataSource` waiver is a tombstone since `@objectstack/spec` 18.
 *   - {@link PageDocumentNode}: the spec's `PageSchema` input. `PageView`
 *     hands a stored page to `SchemaRenderer` with its page KIND written into
 *     `type` (objectui#9642), so `type` is required here, while the spec
 *     defaults it; every kind but the interface-mode `list`, which never
 *     reaches `SchemaRenderer`. `PageNodeSchema` is the separate
 *     `type: 'page'` node, and stays as it is.
 *
 * ## What these types do
 *
 * {@link AuthoringNode} is one of the three parts of `DeclaredNode`
 * (`./base.ts`, objectui#11466), beside the component schemas this package
 * declares and the types an application declares in `CustomNodeRegistry`.
 * `DeclaredNode` is the object arm of `SchemaNode`, so every node slot takes
 * these types, and it is what `SchemaRendererProps.schema` (`@object-ui/react`)
 * takes beside a string. The union has no `type: string` arm, so TypeScript
 * discriminates on the literal `type`: a node of one of these types has its own
 * keys judged wherever it is written, nested in a slot or at the prop, and its
 * required keys are required. A misspelled key inside an `element:text` bag, or
 * a bag on a node type that declares none, is refused now that objectui#8347
 * has removed `BaseSchema`'s index signature (`authoring-nodes-11364.test.ts` and
 * `node-slot-union-11466.test.ts` pin it).
 *
 * Before that removal, the component-schema members that extend `BaseSchema`
 * carried its index signature, so a misspelled key on one of THEM compiled.
 * These members never carried one, and since the removal neither do they.
 */

import type { z } from 'zod';
import type {
  ElementDataSourceSchema as SpecElementDataSourceSchema,
  ElementRecordPickerPropsSchema as SpecElementRecordPickerPropsSchema,
  ElementTextInputPropsSchema as SpecElementTextInputPropsSchema,
  PageSchema as SpecPageSchema,
} from '@objectstack/spec/ui';
import type { BaseSchema as BaseSchemaMirror } from './zod/base.zod.js';
import type { FlexBlockSchema, FlexSchema } from './zod/layout.zod.js';
import type { ObjectQLPublicBlockComponentSchema } from './zod/objectql.zod.js';
import type { NODE_ENVELOPE, PublicBlockComponentSchema } from './zod/public-blocks.zod.js';
import type { retirementTombstone } from './zod/tombstone.zod.js';

/**
 * An arm's `properties` member, read the way {@link ClosedArmInput} reads the
 * arm: when the bag is a zod object, its shape with the object config left
 * closed. A bag that is a spec row is already closed, so this changes nothing
 * for it. A bag built from a flat `.passthrough()` mirror (`flex`'s
 * `FlexPropsBag`, `object-chart`'s `ObjectChartPropsBag`, objectui#11276) keeps
 * the mirror's tolerant posture, which the strict authoring face closes, and
 * this type closes it the same way. So does a REQUIRED bag built from a
 * block's registration inputs (`object-pivot`, `embeddable-form`,
 * objectui#11440), which is a zod object rather than an optional one. Any
 * other member is left as it is.
 */
type ClosedBag<Member> = Member extends z.ZodOptional<infer Bag extends z.ZodObject>
  ? z.ZodOptional<z.ZodObject<Bag['shape']>>
  : Member extends z.ZodObject
    ? z.ZodObject<Member['shape']>
    : Member;

/**
 * A zod object arm's authoring input, read off its shape with the object
 * config left closed: the arm's `.passthrough()` index signature does not
 * reach the type, nor does its bag's ({@link ClosedBag}). Distributes over a
 * union of arms. Anything that is not an object arm maps to `never`, and the
 * pin file checks that no arm is lost that way.
 */
type ClosedArmInput<Arm> = Arm extends z.ZodObject ? z.input<z.ZodObject<ClosedArmShape<Arm['shape']>>> : never;

/** An arm's shape with its `properties` member closed ({@link ClosedBag}); every other member as it is. */
type ClosedArmShape<Shape> = { [K in keyof Shape]: K extends 'properties' ? ClosedBag<Shape[K]> : Shape[K] };

/** What `.extend()` does to a shape: `Own`'s keys replace `Base`'s, the rest stay. */
type ExtendedShape<Base, Own> = Omit<Base, keyof Own> & Own;

/**
 * The refusal every arm declares on `body` and `children` (objectui#9256,
 * objectui#10872): the schema type `retirementTombstone` returns, by reference.
 * Its input is `?: never`. The guidance text differs per arm; the type does not.
 */
type NodeTombstone = ReturnType<typeof retirementTombstone>;

/**
 * A node built from a spec `ComponentPropsMap` row with no zod arm, the way
 * every arm is built: `BaseSchema.extend({ type, ...NODE_ENVELOPE, properties,
 * body, children })`. So the zod `BaseSchema` shape (the base every arm
 * extends), with the `type` literal, the node envelope (`NODE_ENVELOPE`, whose
 * `responsiveStyles` is the spec's `ResponsiveStylesSchema`), `properties` as
 * the row, and the `body` / `children` tombstones, each by reference, plus any
 * further node-level member the renderer reads, each a spec schema by
 * reference.
 */
type SpecRowNode<
  Type extends string,
  Bag extends z.ZodType,
  NodeMembers extends z.core.$ZodShape = Record<never, never>,
> = z.input<
  z.ZodObject<
    ExtendedShape<
      (typeof BaseSchemaMirror)['shape'],
      {
        type: z.ZodLiteral<Type>;
        properties: z.ZodOptional<Bag>;
        body: NodeTombstone;
        children: NodeTombstone;
      } & typeof NODE_ENVELOPE & NodeMembers
    >
  >
>;

/**
 * Every ADR-0080 public block the zod face arms (`element:text`, `page:tabs`,
 * `action:button`, and the rest of `PublicBlockComponentSchema`), each the
 * arm's own authoring input. The block's props are its `properties` bag, which
 * is the spec's `ComponentPropsMap` row.
 */
export type PublicBlockNode = ClosedArmInput<(typeof PublicBlockComponentSchema)['options'][number]>;

/** The {@link PublicBlockNode} member whose `type` is `T`. */
export type PublicBlockNodeOf<T extends PublicBlockNode['type']> = Extract<PublicBlockNode, { type: T }>;

/**
 * The ObjectQL public blocks the zod face arms in their own union,
 * `ObjectQLPublicBlockComponentSchema` (`./zod/objectql.zod.ts`, objectui#10859
 * and objectui#11276): `object-metric`, `object-master-detail-form`,
 * `object-timeline`, `object-form`, `object-map`, `object-chart`,
 * `object-gantt` and `object-grid`, each the arm's own authoring input
 * (objectui#11468), derived exactly as {@link PublicBlockNode} is, and
 * `object-pivot` and `embeddable-form` (objectui#11440), and the page
 * `list-view` (objectui#12670). The block's props are
 * its `properties` bag: the spec's `ComponentPropsMap` row, or, for a block
 * with no row, objectui's own members, closed ({@link ClosedBag}) — the
 * `ObjectChartSchema` mirror's for `object-chart`, the `ListViewSchema`
 * mirror's for `list-view`, the registration's inputs
 * for `object-pivot` and `embeddable-form`, whose bags are required.
 *
 * ⚠️ Not the TypeScript twins in `./objectql.ts` (`ObjectFormSchema`,
 * `ObjectMapSchema`, `ObjectGanttSchema`, `ObjectChartSchema`,
 * `ObjectGridSchema`, `ListViewSchema`): each of those is the node as its
 * renderer reads it after `SchemaRenderer` hoists the bag, and as code composes
 * it (`ListViewSchema` is the `ListView` component's props). These are the
 * authored node, its props in the bag.
 */
export type ObjectQLPublicBlockNode = ClosedArmInput<(typeof ObjectQLPublicBlockComponentSchema)['options'][number]>;

/** The {@link ObjectQLPublicBlockNode} member whose `type` is `T`. */
type ObjectQLPublicBlockNodeOf<T extends ObjectQLPublicBlockNode['type']> = Extract<ObjectQLPublicBlockNode, { type: T }>;

/** An authored `object-metric` node: the `ObjectMetricBlockSchema` arm's input. */
export type ObjectMetricBlockNode = ObjectQLPublicBlockNodeOf<'object-metric'>;

/** An authored `object-master-detail-form` node: the `ObjectMasterDetailFormBlockSchema` arm's input. */
export type ObjectMasterDetailFormBlockNode = ObjectQLPublicBlockNodeOf<'object-master-detail-form'>;

/** An authored `object-timeline` node: the `ObjectTimelineBlockSchema` arm's input. */
export type ObjectTimelineBlockNode = ObjectQLPublicBlockNodeOf<'object-timeline'>;

/** An authored `object-form` node: the `ObjectFormBlockSchema` arm's input. */
export type ObjectFormBlockNode = ObjectQLPublicBlockNodeOf<'object-form'>;

/** An authored `object-map` node: the `ObjectMapBlockSchema` arm's input. */
export type ObjectMapBlockNode = ObjectQLPublicBlockNodeOf<'object-map'>;

/** An authored `object-chart` node: the `ObjectChartBlockSchema` arm's input. */
export type ObjectChartBlockNode = ObjectQLPublicBlockNodeOf<'object-chart'>;

/** An authored `object-gantt` node: the `ObjectGanttBlockSchema` arm's input. */
export type ObjectGanttBlockNode = ObjectQLPublicBlockNodeOf<'object-gantt'>;

/** An authored `object-grid` node: the `ObjectGridBlockSchema` arm's input. */
export type ObjectGridBlockNode = ObjectQLPublicBlockNodeOf<'object-grid'>;

/** An authored `object-pivot` node: the `ObjectPivotBlockSchema` arm's input (objectui#11440). */
export type ObjectPivotBlockNode = ObjectQLPublicBlockNodeOf<'object-pivot'>;

/** An authored `embeddable-form` node: the `EmbeddableFormBlockSchema` arm's input (objectui#11440). */
export type EmbeddableFormBlockNode = ObjectQLPublicBlockNodeOf<'embeddable-form'>;

/**
 * An authored page `list-view` node: the `ListViewBlockSchema` arm's input
 * (objectui#12670). Its props are its `properties` bag, the `ListViewSchema`
 * mirror's own members, closed ({@link ClosedBag}), with the list kind as
 * `type` and `objectName` / `viewType` refused. ⚠️ Not `ListViewSchema`
 * (`./objectql.ts`), which stays the `ListView` component's props.
 */
export type ListViewBlockNode = ObjectQLPublicBlockNodeOf<'list-view'>;

/** `FlexBlockSchema`'s shape with its `properties` member closed ({@link ClosedArmShape}). */
type FlexBlockArmShape = ClosedArmShape<(typeof FlexBlockSchema)['shape']>;

/**
 * The shape {@link FlexBlockNode} reads: `FlexBlockSchema`'s, closed, with ONE
 * member replaced. The bag's `children` is the flat `FlexSchema` mirror's own
 * `children` member, by reference: one node, or a list of nodes
 * (`SchemaNode | SchemaNode[]`, the slot every node slot takes since
 * objectui#11466). Every other member, of the node and of the bag, is the
 * arm's.
 *
 * ## Why this one member is not the arm's (objectui#11564)
 *
 * The arm's bag member is `FLEX_BAG_CHILDREN` (`./zod/layout.zod.ts`), whose
 * list arm is `z.array(z.unknown())`. That is right for the zod faces: a list
 * at `properties.children` is a position `@objectstack/spec`'s page walk
 * descends, so each entry is judged as a component there, once, at its real
 * path (`./zod/nested-component-walk.ts`, objectui#11223). Its input type is
 * `unknown[]`, though, and nothing on the TypeScript face does what the walk
 * does. So read off the arm, the list, which is the form a `flex` node is
 * authored in, took any entry at all, and would have stayed unchecked after
 * objectui#8347 removed `BaseSchema`'s index signature, while a single child was
 * judged as a node. The mirror's member is the accept set the walk and the single-node arm
 * judge between them.
 *
 * The zod arm does not move. The divergence is recorded where the mirror
 * ledger records this arm (`EXCLUSIONS` in
 * `__tests__/zod-mirror-parity.test.ts`) and pinned in
 * `__tests__/flex-bag-children-list-11564.test.ts`. Both faces judge an object
 * entry as a node of its own `type`: an undeclared `type` is refused by both,
 * and a key the node does not declare is refused by the strict zod face and,
 * since objectui#8347 removed the index signature, by this type (before it the
 * signature absorbed it on the node types that extend `BaseSchema`, as it did
 * for a single child). A primitive entry is admitted by both. They differ on
 * one entry kind: a nested array, which the walk passes through unvisited and
 * this type refuses, as the mirror does and as `renderChildren`
 * (`@object-ui/components`) treats it, handing it to `SchemaRenderer` whole.
 *
 * A `properties` member that is not an optional zod object makes this
 * `never`, so every `flex` literal stops compiling rather than silently losing
 * the bag.
 */
type FlexBlockShape = ExtendedShape<
  FlexBlockArmShape,
  {
    properties: FlexBlockArmShape['properties'] extends z.ZodOptional<infer Bag extends z.ZodObject>
      ? z.ZodOptional<z.ZodObject<ExtendedShape<Bag['shape'], { children: (typeof FlexSchema)['shape']['children'] }>>>
      : never;
  }
>;

/**
 * An authored `flex` node: the `FlexBlockSchema` arm's input (objectui#11468),
 * derived as {@link PublicBlockNode} is, with one member replaced
 * ({@link FlexBlockShape}, objectui#11564). Its props, the child list included,
 * are its `properties` bag: the `FlexSchema` mirror's own members
 * (`direction`, `justify`, `align`, `gap`, `wrap`, `children`), closed
 * ({@link ClosedBag}), because `@objectstack/spec` has no `flex` row
 * (objectui#11276). The bag's `children` is one node or a list of nodes, each
 * list entry judged as a node, as a single child is. The TypeScript
 * `FlexSchema` (`./layout.ts`) stays the node as the `flex` renderer reads it
 * after the hoist.
 *
 * ⚠️ An interface, not a type alias, for one reason (objectui#11466). The bag
 * holds node slots, so `FlexBlockSchema`'s inferred type names
 * `SchemaNodeSchema`, whose type names `SchemaNode`; and `SchemaNode` names
 * this type back, through `DeclaredNode` and {@link AuthoringNode}. A type
 * alias is resolved eagerly when `SchemaNode` is, so that loop is a circular
 * reference (TS2456 on this type, `AuthoringNode`, `DeclaredNode` and
 * `SchemaNode`). An interface's members are resolved only when they are read,
 * so the loop is never walked while `SchemaNode` is being resolved. The
 * interface declares nothing of its own: every member is read off
 * {@link FlexBlockShape}, as above.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- an interface on purpose, to break the SchemaNode cycle its docblock names; it declares no member of its own.
export interface FlexBlockNode extends z.input<z.ZodObject<FlexBlockShape>> {}

/**
 * `element:text_input`: `ComponentPropsMap['element:text_input']`
 * (`ElementTextInputPropsSchema`) as its `properties` bag, by reference.
 */
export type ElementTextInputNode = SpecRowNode<'element:text_input', typeof SpecElementTextInputPropsSchema>;

/**
 * `element:record_picker`: `ComponentPropsMap['element:record_picker']`
 * (`ElementRecordPickerPropsSchema`) as its `properties` bag, plus the
 * node-level `dataSource` (`ElementDataSourceSchema`) its renderer reads. Both
 * by reference. The row's flat query keys (`object`, `filter`, `sort`,
 * `limit`) are retired since `@objectstack/spec` 18 (objectui#12030), so the
 * picker's query is written on the binding.
 */
export type ElementRecordPickerNode = SpecRowNode<
  'element:record_picker',
  typeof SpecElementRecordPickerPropsSchema,
  { dataSource: z.ZodOptional<typeof SpecElementDataSourceSchema> }
>;

type SpecPageInput = z.input<typeof SpecPageSchema>;

/**
 * A stored page document as it reaches `SchemaRenderer`: the spec's `PageSchema`
 * input, whose `type` is the page kind (`PageTypeSchema`) and whose `kind` is
 * the override mode. `type` is required, because it is the discriminator the
 * registry dispatches on.
 *
 * ⛔ Every page kind but `list` (objectui#11466). A `list` page is ADR-0047
 * interface mode: `PageView` (`@object-ui/app-shell`) renders it through
 * `InterfaceListPage`, never through `SchemaRenderer`, and `ComponentRegistry`'s
 * `list` key is the `list` node's renderer (`ListSchema`, `./data-display.ts`). A page
 * document under `type: 'list'` handed to `SchemaRenderer` would be drawn by
 * that renderer, so this type does not admit one. That also leaves `list` one
 * arm in `DeclaredNode` (`./base.ts`), where the page kind and the node type
 * would otherwise share the discriminant and let each other's keys through.
 * `page-kind-node-type-channel-9642` in `@object-ui/components` re-derives
 * which kinds reach the registry.
 */
export type PageDocumentNode = SpecPageInput & { type: Exclude<NonNullable<SpecPageInput['type']>, 'list'> };

/**
 * Every node this module types, named as one type for `DeclaredNode`
 * (`./base.ts`), the union every node slot and `SchemaRendererProps.schema`
 * take (objectui#11466).
 */
export type AuthoringNode =
  | PublicBlockNode
  | ObjectQLPublicBlockNode
  | FlexBlockNode
  | ElementTextInputNode
  | ElementRecordPickerNode
  | PageDocumentNode;
