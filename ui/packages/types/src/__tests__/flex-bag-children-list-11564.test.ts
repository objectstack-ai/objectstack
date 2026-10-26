/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11564: the `flex` bag's child LIST is typed as nodes on the
 * TypeScript face, as a single child already was, pinned.
 *
 * ## The gap
 *
 * `FlexBlockNode` was read off the `FlexBlockSchema` arm, whose bag member
 * `children` is `FLEX_BAG_CHILDREN`: a single node (`SchemaNodeSchema`) or
 * `z.array(z.unknown())`. The zod faces need the `unknown`: a list at
 * `properties.children` is a position `@objectstack/spec`'s page walk
 * descends, and each entry is judged there, once, at its real path
 * (`flex-properties-bag-11276.test.ts` pins that on both faces). On the
 * TypeScript face the same member read `unknown[]`, so the list, the form a
 * `flex` node is authored in, took any entry while a single child was judged
 * as a node. With `BaseSchema`'s index signature present nothing showed, since
 * the signature absorbed a misspelled key either way; once objectui#8347
 * removed it, the list would have been the one unchecked node slot, which is
 * why this card landed first.
 *
 * ## What is pinned here
 *
 * TYPE-level rows, judged by this package's `type-check` (its
 * `tsc -p tsconfig.test.json` leg), never by vitest:
 *
 *   - the bag's `children` is one node or a list of nodes, the flat mirror's
 *     own member, and it is the only member that differs from the arm;
 *   - a closed node's misspelling inside the list is refused. A spec-derived
 *     node carries no index signature, which is the shape every node has had
 *     since objectui#8347, so a node type that extends `BaseSchema` is refused
 *     there too (the `text` row); the control is the same document typed the
 *     way the arm reads it, which compiles;
 *   - an undeclared `type` and a nested array inside the list are refused,
 *     and a primitive entry compiles, as in every node slot.
 *
 * A runtime leg reads the two zod faces on the same entries, so the one kind
 * where the faces differ (a nested array) is measured here rather than stated.
 * That divergence is recorded in `zod-mirror-parity.test.ts`'s `EXCLUSIONS`
 * row for `layout.zod.ts#FlexBlockSchema`.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { FlexBlockNode } from '../authoring-nodes.js';
import type { SchemaNode } from '../base.js';
import type { FlexLayoutProps } from '../layout.js';
import {
  FlexBlockSchema,
  FlexSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** The `flex` bag as `FlexBlockNode` types it. */
type Bag = NonNullable<FlexBlockNode['properties']>;

/** A shape with its `properties` member read closed: the derivation `FlexBlockNode` had before objectui#11564. */
type ClosedArmShape<S> = {
  [K in keyof S]: K extends 'properties'
    ? S[K] extends z.ZodOptional<infer Inner extends z.ZodObject>
      ? z.ZodOptional<z.ZodObject<Inner['shape']>>
      : S[K]
    : S[K];
};

/** `FlexBlockSchema` read off its arm alone, its bag closed: what `FlexBlockNode` was. */
type ArmInput = z.input<z.ZodObject<ClosedArmShape<(typeof FlexBlockSchema)['shape']>>>;
type ArmBag = NonNullable<ArmInput['properties']>;

// 1. The bag's `children` is one node or a list of nodes: the flat mirror's own member, the slot
//    `FlexLayoutProps` declares, and the single-or-list slot every node slot takes (objectui#11466).
type _BagChildrenIsANodeOrAList = Assert<Equal<Bag['children'], SchemaNode | SchemaNode[] | undefined>>;
type _BagChildrenIsTheMirrorsMember = Assert<Equal<Bag['children'], z.input<(typeof FlexSchema)['shape']['children']>>>;
type _BagChildrenIsTheDeclaredMember = Assert<Equal<Bag['children'], FlexLayoutProps['children']>>;

// 2. The arm did not move (control): its list is still `unknown[]`, left to the page walk.
type _ControlTheArmsListIsUnknown = Assert<Equal<ArmBag['children'], unknown[] | SchemaNode | undefined>>;

// 3. That is the only member that differs, on the node and in the bag.
type _NodeMembersAreTheArms = Assert<Equal<Omit<FlexBlockNode, 'properties'>, Omit<ArmInput, 'properties'>>>;
type _BagMembersAreTheArms = Assert<Equal<Omit<Bag, 'children'>, Omit<ArmBag, 'children'>>>;
type _BagStaysOptional = Assert<Equal<undefined extends FlexBlockNode['properties'] ? true : false, true>>;

type Issue = { code: string; path: string };
type Result = { success: boolean; error?: { issues: z.core.$ZodIssue[] } };

const FACES: ReadonlyArray<readonly [string, (document: unknown) => Result]> = [
  ['tolerant', (document) => safeValidateSchema(document)],
  ['strict', (document) => StrictAnyComponentSchema.safeParse(document)],
];

const issuesOf = (result: Result): Issue[] =>
  (result.error?.issues ?? []).map((issue) => ({ code: issue.code, path: issue.path.join('.') }));

describe('objectui#11564: the flex bag\'s child list is typed as nodes', () => {
  it('a closed node\'s misspelling inside the list is refused; the arm\'s own reading let it through', () => {
    // The card's probe f02, with a closed node: `contnt` is not a member of `element:text`'s bag.
    // @ts-expect-error the list entry is judged as a node, and the misspelling is refused
    const inList: FlexBlockNode = { type: 'flex', properties: { children: [{ type: 'element:text', properties: { contnt: 'x' } }] } };
    // Control: typed the way the arm reads it (`unknown[]`), the same document compiles.
    const armReading: ArmInput = { type: 'flex', properties: { children: [{ type: 'element:text', properties: { contnt: 'x' } }] } };
    // Control: the same misspelling as a single child was refused before this card too.
    // @ts-expect-error `contnt` is not a member of `element:text`'s bag
    const single: FlexBlockNode = { type: 'flex', properties: { children: { type: 'element:text', properties: { contnt: 'x' } } } };
    // Since objectui#8347 a node type that extends `BaseSchema` refuses a misspelling in the list
    // too: `text` declares `content` (the well-formed list below writes it and compiles).
    // @ts-expect-error `contnt` is no member of the `text` node
    const extendsBase: FlexBlockNode = { type: 'flex', properties: { children: [{ type: 'text', contnt: 'x' }] } };
    expect([inList, armReading, single, extendsBase]).toHaveLength(4);
  });

  it('a well-formed list compiles: declared nodes, primitives, a nested flex', () => {
    const list: FlexBlockNode = {
      type: 'flex',
      properties: {
        direction: 'col',
        gap: 4,
        children: [
          { type: 'text', content: 'Orders' },
          { type: 'element:text', properties: { content: 'Total' } },
          { type: 'flex', properties: { children: [{ type: 'button', label: 'New order' }] } },
          'plain text',
          3,
          null,
        ],
      },
    };
    expect(list.properties?.children).toHaveLength(6);
  });

  it('an undeclared `type` and a nested array inside the list are refused', () => {
    // @ts-expect-error `no-such-type-11564` names no declared node type
    const undeclared: FlexBlockNode = { type: 'flex', properties: { children: [{ type: 'no-such-type-11564' }] } };
    // @ts-expect-error an entry that is itself a list is not a node
    const nested: FlexBlockNode = { type: 'flex', properties: { children: [[{ type: 'text', content: 'x' }]] } };
    // @ts-expect-error an object with no `type` is not a node
    const untyped: FlexBlockNode = { type: 'flex', properties: { children: [{ content: 'x' }] } };
    expect([undeclared, nested, untyped]).toHaveLength(3);
  });

  it('the zod faces, on the same entries: they agree, except on a nested array', () => {
    const doc = (children: unknown[]) => ({ type: 'flex', properties: { children } });
    for (const [, judge] of FACES) {
      // Agree: a closed node's misspelling and an undeclared `type` are refused at the entry's own path.
      expect(issuesOf(judge(doc([{ type: 'element:text', properties: { contnt: 'x' } }]))).map((issue) => issue.path)).toEqual([
        'properties.children.0.properties.content',
        'properties.children.0.properties',
      ]);
      expect(issuesOf(judge(doc([{ type: 'no-such-type-11564' }])))).toEqual([
        { code: 'invalid_union', path: 'properties.children.0.type' },
      ]);
      // Agree: primitives are admitted, as in every node slot.
      expect(judge(doc(['plain text', 3, null])).success).toBe(true);
      // Differ: the page walk passes a nested array through unvisited, so both zod faces admit it,
      // while the TypeScript face refuses it (above), as the flat mirror's own member does.
      expect(judge(doc([[{ type: 'text', content: 'x' }]])).success).toBe(true);
      expect(FlexSchema.safeParse({ type: 'flex', children: [[{ type: 'text', content: 'x' }]] }).success).toBe(false);
    }
  });
});
