/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11364: the TypeScript authoring types in `../authoring-nodes.ts`,
 * pinned.
 *
 * Most assertions here are TYPE-level: the `Assert` aliases and the
 * `@ts-expect-error` directives are judged by this package's `type-check`
 * (its `tsc -p tsconfig.test.json` leg), never by vitest, which strips types.
 * A directive that stops being needed is TS2578, so each one is real
 * enforcement in both directions.
 *
 * ## The acceptance pin, and why it does not wait for objectui#8347
 *
 * The card's pin is "a misspelled key inside an `element:text` `properties`
 * bag stops type-checking once `BaseSchema`'s index signature is gone, and the
 * spec's spelling compiles". When this was written `BaseSchema` still carried
 * `[key: string]: any`, so the union `SchemaRenderer`'s `schema` prop declares
 * accepted that misspelling. `PostRemovalSchema` below is that same union with
 * `BaseSchema`'s index signatures stripped at the type level. It simulated the
 * removal without editing anything, so the pin ran in every type-check before
 * objectui#8347 and keeps running now that the removal has landed (the strip is
 * the identity on `BaseSchema` since then). `@object-ui/react` pins the prop's
 * union exactly (`SchemaRenderer.propsResolution.test.ts`, assertion 1), and
 * this file substitutes only its `BaseSchema` member.
 *
 * ⚠️ Dated note, 2026-10-02 (objectui#11466): the prop's object member is now
 * `DeclaredNode`, which has no `BaseSchema` arm, so `PostRemovalSchema` is no
 * longer the prop with one member substituted. It is kept as the model this
 * file's assertions were written against: every `AuthoringNode` still fits it,
 * and its refusals still hold. The current prop and slot are pinned in
 * `node-slot-union-11466.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { ElementRecordPickerPropsSchema as SpecElementRecordPickerPropsSchema } from '@objectstack/spec/ui';
import type { BaseSchema } from '../base.js';
import type {
  AuthoringNode,
  ElementRecordPickerNode,
  ElementTextInputNode,
  PageDocumentNode,
  PublicBlockNode,
  PublicBlockNodeOf,
} from '../authoring-nodes.js';
import { PublicBlockComponentSchema } from '../zod/index.zod.js';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** `T` without its string / number index signatures: `BaseSchema` as objectui#8347 leaves it. */
type WithoutIndexSignature<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

/** `SchemaRendererProps['schema']` with the removal applied to its `BaseSchema` member. */
type PostRemovalSchema = WithoutIndexSignature<BaseSchema> | AuthoringNode | string | null | undefined;

// 1. No arm is lost. `ClosedArmInput` maps anything that is not a zod object
//    to `never`, so the derived `type` set must equal the union's own.
type _EveryArmIsTyped = Assert<
  Equal<PublicBlockNode['type'], z.input<typeof PublicBlockComponentSchema>['type']>
>;

// 2. No member carries an index signature. A bare `z.input` of a
//    `.passthrough()` arm does (`[k: string]: unknown`), which would put the
//    removed signature back on exactly these nodes.
type IndexedMembers<U> = U extends unknown ? (string extends keyof U ? U : never) : never;
type _NoMemberIsIndexed = Assert<Equal<IndexedMembers<AuthoringNode>, never>>;
// The control: the check fires on the bare `z.input` of the same arms, which is
// the reason the derivation reads each arm's shape instead.
type _ControlBareArmInputIsIndexed = Assert<
  Equal<IndexedMembers<z.input<typeof PublicBlockComponentSchema>>, never> extends true ? false : true
>;

// 3. Every node type is accepted where `SchemaRenderer` takes a schema, after
//    the removal too.
type _EveryNodeFitsThePostRemovalProp = Assert<AuthoringNode extends PostRemovalSchema ? true : false>;

describe('objectui#11364: the spec-declared nodes have a TypeScript authoring face', () => {
  it('element:text: a misspelled bag key is refused and the spec spelling compiles, after the removal', () => {
    const spelled: PostRemovalSchema = { type: 'element:text', id: 'title', properties: { content: 'Hello', variant: 'h1' } };
    // @ts-expect-error `contnet` is not a member of ComponentPropsMap['element:text'] (the spec row is closed)
    const misspelled: PostRemovalSchema = { type: 'element:text', properties: { contnet: 'Hello' } };
    // @ts-expect-error a node-level misspelling is refused too: no member of the union declares it
    const flatMisspelled: PostRemovalSchema = { type: 'element:text', properties: { content: 'x' }, contnet: 'y' };
    // @ts-expect-error a bag on a node type that declares none (`button` is not one of these nodes)
    const bagOnPlainNode: PostRemovalSchema = { type: 'button', properties: { content: 'x' } };
    expect([spelled, misspelled, flatMisspelled, bagOnPlainNode]).toHaveLength(4);
  });

  it('the node type itself refuses a misspelled bag key, with or without the removal', () => {
    const ok: PublicBlockNodeOf<'element:text'> = { type: 'element:text', properties: { content: 'x' } };
    // @ts-expect-error `contnet` is not a member of the bag
    const bad: PublicBlockNodeOf<'element:text'> = { type: 'element:text', properties: { contnet: 'x' } };
    expect([ok, bad]).toHaveLength(2);
  });

  it('page:tabs and action:button take their keys in the properties bag, not flat on the node', () => {
    const tabs: PublicBlockNodeOf<'page:tabs'> = {
      type: 'page:tabs',
      properties: { items: [{ label: 'Details', value: 'details', children: [] }] },
    };
    // @ts-expect-error `items` is a member of the bag (PageTabsProps), not of the node
    const flatTabs: PublicBlockNodeOf<'page:tabs'> = { type: 'page:tabs', items: [] };
    const button: PublicBlockNodeOf<'action:button'> = {
      type: 'action:button',
      properties: { label: 'Open', actionType: 'url', target: '/users/ada' },
    };
    // @ts-expect-error the retired flat executor spelling (objectui#11183): `actionType` belongs in the bag
    const flatButton: PublicBlockNodeOf<'action:button'> = { type: 'action:button', actionType: 'url' };
    expect([tabs, flatTabs, button, flatButton]).toHaveLength(4);
  });

  it('element:text_input and element:record_picker take their spec rows as the bag', () => {
    const input: ElementTextInputNode = { type: 'element:text_input', id: 'ws', properties: { label: 'Workspace', inputType: 'email' } };
    // @ts-expect-error `lable` is not a member of ComponentPropsMap['element:text_input']
    const badInput: ElementTextInputNode = { type: 'element:text_input', properties: { lable: 'Workspace' } };
    // The object is named by the node-level `dataSource` binding, which the renderer reads.
    const bound: ElementRecordPickerNode = {
      type: 'element:record_picker',
      dataSource: { object: 'account' },
      properties: { placeholder: 'Pick an account' },
    };
    // @ts-expect-error `objct` is not a member of ComponentPropsMap['element:record_picker']
    const badPicker: ElementRecordPickerNode = { type: 'element:record_picker', properties: { objct: 'account' } };
    expect([input, badInput, bound, badPicker]).toHaveLength(4);
  });

  it('element:record_picker: the bag\'s flat `object` type-checks exactly where the installed row takes it (objectui#12093)', () => {
    // objectstack#11509 retires the flat `object` (objectstack PR #22421: a tombstone
    // on objectstack `main`), and the installed release still declares it. This file
    // is compiled against both: by the pull-request type-check against the installed
    // spec, and by the Spec Main Shape Gate against `main`. So the pin is the ROW's
    // verdict held on the node type, not either answer written down: where the row
    // refuses the key, `ElementRecordPickerNode` refuses a bag that writes it. This
    // replaces the `unbound` literal that asserted the flat key compiles.
    type NodeTakesFlatObject =
      { type: 'element:record_picker'; properties: { object: string } } extends ElementRecordPickerNode ? true : false;
    type RowTakesFlatObject = { object: string } extends Pick<z.input<typeof SpecElementRecordPickerPropsSchema>, 'object'>
      ? true
      : false;
    const verdict: Equal<NodeTakesFlatObject, RowTakesFlatObject> = true;
    expect(verdict).toBe(true);
  });

  it('the spec-row nodes carry the node envelope and refuse a node-level child list, exactly as element:text does', () => {
    // The node envelope every arm spreads (`NODE_ENVELOPE`: `responsiveStyles`, the spec's
    // `ResponsiveStylesSchema`) compiles on both spec-row nodes after the removal, as on `element:text`.
    const styles = { small: { padding: '8px' } };
    const textStyled: PostRemovalSchema = { type: 'element:text', properties: { content: 'x' }, responsiveStyles: styles };
    const inputStyled: PostRemovalSchema = { type: 'element:text_input', properties: { label: 'x' }, responsiveStyles: styles };
    const pickerStyled: PostRemovalSchema = {
      type: 'element:record_picker',
      dataSource: { object: 'a' },
      properties: {},
      responsiveStyles: styles,
    };
    // The `body` / `children` tombstones every arm carries: a node-level child list is refused
    // after the removal on all three, and on each node type itself.
    // @ts-expect-error control: `element:text` refuses a node-level `children` (objectui#9256)
    const textChildren: PostRemovalSchema = { type: 'element:text', properties: { content: 'x' }, children: [{ type: 'text' }] };
    // @ts-expect-error the same tombstone on `element:text_input`
    const inputChildren: PostRemovalSchema = { type: 'element:text_input', properties: { label: 'x' }, children: [{ type: 'text' }] };
    // @ts-expect-error the same tombstone on `element:text_input`, on the node type itself
    const inputNodeChildren: ElementTextInputNode = { type: 'element:text_input', children: [] };
    // @ts-expect-error the same tombstone on `element:record_picker`, on the node type itself
    const pickerNodeChildren: ElementRecordPickerNode = { type: 'element:record_picker', children: [] };
    expect([textStyled, inputStyled, pickerStyled, textChildren, inputChildren, inputNodeChildren, pickerNodeChildren]).toHaveLength(7);
  });

  it('a stored page document is typed under its page kind', () => {
    const home: PageDocumentNode = { type: 'home', kind: 'html', name: 'landing', label: 'Landing', source: '<Page />' };
    // @ts-expect-error `kind` is the spec's override mode (full | slotted | html | react)
    const badKind: PageDocumentNode = { type: 'home', kind: 'markdown', name: 'landing', label: 'Landing' };
    // @ts-expect-error `type` is the page kind the registry dispatches on, so the node must carry it
    const untyped: PageDocumentNode = { name: 'landing', label: 'Landing' };
    expect([home, badKind, untyped]).toHaveLength(3);
  });

  it('every public-block arm is a zod object, the premise the type derivation reads', () => {
    const notObjects = PublicBlockComponentSchema.options
      .filter((arm) => (arm as z.ZodType).def.type !== 'object')
      .map((arm) => String(arm.shape.type.value));
    expect(notObjects).toEqual([]);
    expect(PublicBlockComponentSchema.options.length).toBeGreaterThan(0);
  });
});
