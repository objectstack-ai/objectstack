/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11466: a node slot and `SchemaRenderer`'s `schema` prop take
 * `DeclaredNode`, the discriminated union of the declared node types, pinned.
 *
 * Most assertions here are TYPE-level: the `Assert` aliases and the
 * `@ts-expect-error` directives are judged by this package's `type-check` (its
 * `tsc -p tsconfig.test.json` leg), never by vitest, which strips types. A
 * directive that stops being needed is TS2578, so each one holds in both
 * directions.
 *
 * ## The compile-fail pin, and why it does not wait for objectui#8347
 *
 * Until objectui#8347 removed `BaseSchema`'s index signature, a misspelled key on
 * a node type that extends `BaseSchema` still compiled: the signature absorbed it
 * on the type's own arm. (Since the removal it is refused there too, pinned in
 * `base-schema-closed-face-8347.test.ts`.) What this card changed is the SLOT: it discriminates on
 * `type`, so an inline child is judged against its own type's arm wherever it is
 * nested. `ClosedProbeNode` below is a node type declared WITHOUT an index
 * signature, the shape every arm has now that the removal has landed (objectui#8347), registered through
 * `CustomNodeRegistry`. Its misspelling is refused at a nested slot, so the pin
 * ran in every type-check before the removal and keeps running after it. The
 * spec-derived `AuthoringNode`s carry no signature either and are pinned the
 * same way.
 */

import { describe, expect, it } from 'vitest';
import type { AppComponentSchema } from '../app.js';
import type { AuthoringNode, PageDocumentNode } from '../authoring-nodes.js';
import type { BaseSchema, CustomNodeRegistry, DeclaredNode, SchemaNode } from '../base.js';
import type { ListSchema } from '../data-display.js';
import type { AnySchema, SchemaByType } from '../index.js';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** A node type with no index signature: the shape every arm takes after objectui#8347. */
interface ClosedProbeNode {
  type: 'test:closed-probe-11466';
  id?: string;
  label?: string;
  probeOnly?: string;
}

/** A LOOSE entry: `BaseSchema` itself, to pin that an entry joins under its key only. */
type LooseProbeNode = BaseSchema;

declare module '../base.js' {
  interface CustomNodeRegistry {
    'test:closed-probe-11466': ClosedProbeNode;
    'test:loose-probe-11466': LooseProbeNode;
  }
}

/** What `SchemaRendererProps['schema']` is (`@object-ui/react` pins the prop itself). */
type PropSchema = DeclaredNode | string | null | undefined;

/** The members a `type === K` check narrows a `DeclaredNode` to. */
type NarrowOn<T, K> = T extends { type: infer D } ? (K extends D ? T : never) : never;

// 1. `SchemaNode` is a declared node or a primitive rendered as content.
type _SchemaNodeShape = Assert<Equal<SchemaNode, DeclaredNode | string | number | boolean | null | undefined>>;

// 2. No `type: string` arm: `BaseSchema` is not a member, and no member's `type` is `string`.
type _BaseSchemaIsNotAnArm = Assert<Equal<BaseSchema extends DeclaredNode ? true : false, false>>;
type WideTyped<U> = U extends { type: infer K } ? (string extends K ? U : never) : never;
type _NoWideArm = Assert<Equal<WideTyped<DeclaredNode>, never>>;

// 3. Every component schema `AnySchema` declares is a member, except its `BaseSchema` arm and
//    the app-level document (`AppComponentSchema`, read structurally and never dispatched).
type _AnySchemaArmsAreMembers = Assert<Exclude<AnySchema, BaseSchema | AppComponentSchema> extends DeclaredNode ? true : false>;
type _AppDocumentIsNotANode = Assert<Equal<Extract<DeclaredNode, AppComponentSchema>, never>>;
// …and every spec-declared `AuthoringNode`.
type _AuthoringNodesAreMembers = Assert<AuthoringNode extends DeclaredNode ? true : false>;

// 4. One arm per shared token (H4 of the dispatch). `app` is the page KIND the registry
//    renders; `list` is the `list` node, because a `list` page never reaches `SchemaRenderer`.
//    `SchemaByType` reads `AnySchema` and does not move.
type _AppNarrowsToThePageKind = Assert<Equal<NarrowOn<DeclaredNode, 'app'>, PageDocumentNode>>;
type _ListNarrowsToTheListNode = Assert<Equal<NarrowOn<DeclaredNode, 'list'>, ListSchema>>;
type _SchemaByTypeApp = Assert<Equal<SchemaByType<'app'>, AppComponentSchema>>;
type _SchemaByTypeList = Assert<Equal<SchemaByType<'list'>, ListSchema>>;

// 5. A registry entry joins under its KEY: the arm is the entry intersected with
//    `{ type: KEY }`, so even a loose `BaseSchema` entry adds no `type: string` arm.
type _LooseEntryJoinsUnderItsKey = Assert<
  Equal<NarrowOn<DeclaredNode, 'test:loose-probe-11466'>, CustomNodeRegistry['test:loose-probe-11466'] & { type: 'test:loose-probe-11466' }>
>;

describe('objectui#11466: a node slot takes the declared-node union', () => {
  it('a nested child is judged against its own type: a misspelled key is refused, the declared spelling compiles', () => {
    const spelled: SchemaNode = { type: 'card', children: [{ type: 'test:closed-probe-11466', label: 'x' }] };
    // @ts-expect-error `lable` is not a member of `ClosedProbeNode`, and the slot discriminates on `type`
    const misspelled: SchemaNode = { type: 'card', children: [{ type: 'test:closed-probe-11466', lable: 'x' }] };
    // @ts-expect-error the same at a deeper slot
    const deeper: SchemaNode = { type: 'card', children: [{ type: 'grid', children: [{ type: 'test:closed-probe-11466', lable: 'x' }] }] };
    // @ts-expect-error a spec-derived node is closed too: `contnt` is not in `element:text`'s bag
    const bag: SchemaNode = { type: 'card', children: [{ type: 'element:text', properties: { contnt: 'x' } }] };
    expect([spelled, misspelled, deeper, bag]).toHaveLength(4);
  });

  it('an undeclared `type` is refused at a slot and at the prop', () => {
    // @ts-expect-error `txt` names no declared node type and no registry entry
    const nested: SchemaNode = { type: 'card', children: [{ type: 'txt' }] };
    // @ts-expect-error the same at `SchemaRenderer`'s prop
    const atProp: PropSchema = { type: 'txt' };
    const registered: PropSchema = { type: 'test:closed-probe-11466', label: 'x' };
    expect([nested, atProp, registered]).toHaveLength(3);
  });

  it("a registered type's key does not escape onto a declared type", () => {
    // @ts-expect-error `probeOnly` is `ClosedProbeNode`'s, not `element:text`'s
    const escaped: SchemaNode = { type: 'card', children: [{ type: 'element:text', probeOnly: 'x', properties: { content: 'y' } }] };
    expect([escaped]).toHaveLength(1);
  });
});
