/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4548 — COMPILE-TIME pins on the props a `SchemaRenderer` JSX call
 * site is actually held to. The sibling of `plugin-list`'s and
 * `plugin-dashboard`'s `*.propsResolution` pins (objectui#4528 / PR #4551).
 *
 * These assertions are erased at runtime; `tsc` is the only thing that can
 * check them, which is why this file is carried by
 * `packages/react/tsconfig.test.json` and why the `expect` below is deliberately
 * trivial — the real assertions are the `Assert< Equal< … > >` types, and a
 * violation is a compile error, not a red test.
 *
 * ## What was measured before the fix
 *
 * Probed on the pre-fix source, compiled through this same project:
 *
 *     keyof ComponentProps< typeof SchemaRenderer >            ->  string
 *     ComponentProps< typeof SchemaRenderer >['schema']        ->  any
 *     ({ schema: SchemaNode } & Record< string, any >)['schema'] ->  SchemaNode
 *
 * and — the half the sibling packages did not have — these three all compiled
 * SILENTLY, which is the same defect seen from the other side:
 *
 *     < SchemaRenderer / >                       // no schema at all
 *     < SchemaRenderer schema={12345} / >
 *     < SchemaRenderer schema={{…}} bogusProp={1} / >
 *
 * The declaration was right and nobody was held to it. The props type argument
 * carried `Record< string, any >`, which puts `string` into `keyof Props`, so
 * React's `PropsWithoutRef` took its `Omit` branch and `Omit` over a string
 * index signature keeps ONLY the index signature.
 *
 * ## What is pinned, and what is deliberately NOT
 *
 * The forwarding surface is intentionally still open — this is the renderer
 * loop, and `packages/react/README.md` documents forwarding a component's own
 * props through it. So `keyof` is still `string` and an unknown prop is still
 * accepted; assertion 6 pins that openness as a DECISION rather than leaving it
 * to be read as the bug it used to be. What is pinned is that the openness no
 * longer costs the declared props: `schema` is typed, and it is required.
 */

/*
 * The `Assert< … >` aliases below are the assertions themselves — they are
 * deliberately never referenced, and a violation is a COMPILE error rather than
 * a use site. `no-unused-vars` has nothing to say about that here.
 */

import { describe, it, expect } from 'vitest';
import type { ComponentProps } from 'react';
import type { BaseSchema, DeclaredNode } from '@object-ui/types';
import { SchemaRenderer, type SchemaRendererProps } from '../SchemaRenderer';
import { toRenderableSchema } from '../schema-input';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;

/** The props a JSX call site is held to. */
type CallSiteProps = ComponentProps<typeof SchemaRenderer>;

// 1. THE assertion. `schema` survives to the call site with its declared type.
//    Before the fix this was `any`, so every schema — and any prop typo next to
//    it — passed silently. objectui#11364 widened the object member by the
//    referenced `AuthoringNode` types only (no index signature, no `Record`);
//    objectui#11466 made it `DeclaredNode`, the union of the declared node
//    types, with no `BaseSchema` (`type: string`) arm.
type _SchemaIsDeclared = Assert<
  Equal<CallSiteProps['schema'], DeclaredNode | string | null | undefined>
>;
// 1b. …and `BaseSchema` is no longer an arm of it (objectui#11466): a value typed
//     `BaseSchema` names no declared type, so it does not reach the prop.
type _BaseSchemaIsNotAnArm = Assert<Equal<BaseSchema extends CallSiteProps['schema'] ? true : false, false>>;

// 2. …and that is not vacuously true because the whole thing is `any`. On the
//    pre-fix shape assertion 1 would have "passed" against `any` for any type
//    written on the right-hand side; this is what discriminates.
type _SchemaIsNotAny = Assert<Equal<IsAny<CallSiteProps['schema']>, false>>;

// 3. The call-site type agrees with the DECLARED interface on `schema`.
type _CallSiteAgreesWithInterface = Assert<
  Equal<CallSiteProps['schema'], SchemaRendererProps['schema']>
>;

// 4. `schema` is REQUIRED. Pre-fix `< SchemaRenderer / >` type-checked: the
//    props had collapsed to a bare index signature, which requires nothing.
//    Asked via `Required<…>` rather than the usual `{} extends …` idiom — the
//    `{}` type is banned by `@typescript-eslint/no-empty-object-type`, and this
//    spelling says the same thing: an OPTIONAL property is absent-able, so its
//    `Pick` does not extend its own `Required` form.
type _SchemaIsRequired = Assert<
  Equal<
    Pick<SchemaRendererProps, 'schema'> extends Required<Pick<SchemaRendererProps, 'schema'>>
      ? true
      : false,
    true
  >
>;

// 5. The declared union does NOT admit `number` / `boolean`. The runtime
//    tolerates them (defence in depth, pinned in the behaviour suite), but no
//    author is invited to author them.
type _NumberIsNotDeclared = Assert<Equal<number extends CallSiteProps['schema'] ? true : false, false>>;
type _BooleanIsNotDeclared = Assert<Equal<boolean extends CallSiteProps['schema'] ? true : false, false>>;

// 6. The forwarding surface stays OPEN, deliberately (see the header). An
//    arbitrary prop is still assignable — this is the renderer loop, and it
//    forwards to the component the schema names. If this ever flips, it is a
//    contract change and not a cleanup.
type _ForwardingSurfaceStaysOpen = Assert<
  Equal<{ schema: string; anyOtherProp: number } extends CallSiteProps ? true : false, true>
>;

// 7. `toRenderableSchema` lands exactly on the declared input — it is the
//    documented bridge from `@object-ui/types`' wider `SchemaNode`, so its
//    return type must not drift away from what the renderer accepts.
type _BridgeLandsOnDeclaredInput = Assert<
  Equal<ReturnType<typeof toRenderableSchema>, SchemaRendererProps['schema']>
>;

describe('objectui#4548 — SchemaRenderer serves its declared props', () => {
  it('pins the resolved call-site props at compile time', () => {
    // The assertions are the types above; this body only keeps the file a test.
    const probe: CallSiteProps['schema'] = { type: 'text' };
    expect(typeof probe).toBe('object');
  });
});
