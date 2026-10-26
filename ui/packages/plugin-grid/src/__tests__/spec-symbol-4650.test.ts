/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/plugin-grid` ↔ `@objectstack/spec` symbol-collision tripwire
 * (objectui#4650).
 *
 * `@objectstack/spec/ui` owns `ObjectGridProps` from 17.0.0: it is the AUTHORED
 * props document of the `object-grid` element (`z.input<typeof
 * ObjectGridPropsSchema>` — `label`, `fields`, `defaultFilters`, `pagination`,
 * …), a serialisable authoring surface. This package's same-named interface was
 * the RENDERER's props — a live `dataSource`, host pagination handles, eleven
 * callbacks — so the two are different things under one word, and the local one
 * was renamed to `ObjectGridComponentProps` rather than derived. That is the
 * same verdict, and the same suffix, this repo already reached for
 * `PageHeaderProps` -> `PageHeaderComponentProps` (app-shell) and for the
 * `Record*ComponentProps` family in `@object-ui/types`.
 *
 * A rename only stays a fix while the new name is genuinely free, and an alias
 * only keeps its promise while it denotes the same type. Both are pinned below.
 *
 * ## Why these are compile-time pins and not a runtime name probe
 *
 * The sibling tripwires in app-shell and plugin-list read every `@objectstack/
 * spec` subpath's `.d.ts` through the TypeScript checker, because they need the
 * spec's export names as DATA (they iterate a table of them). Here the question
 * is about two names known at authoring time, so `tsc` can answer it directly —
 * which also keeps this file free of `node:` imports, and so runnable in the two
 * sibling plugins whose `tsconfig.test.json` deliberately does not pull in
 * `@types/node`.
 *
 * The spec is reached through a type-level `import('@objectstack/spec/ui').X`
 * rather than an `import type * as SpecUi` statement, and that is not a style
 * choice: a namespace import of that subpath necessarily binds `FormField` and
 * `FormFieldSchema`, which `eslint.config.js` restricts to an ERROR because the
 * spec's form-view types erase to `any` and importing them silently deletes type
 * safety (objectui#3090). A type-level `import(…)` names one member and declares
 * no binding, so it asks the question without opening that door.
 *
 * The GA half of the ratchet — "the spec still owns `ObjectGridProps`, so this
 * rename still has a reason" — is not asserted here, and deliberately so: this
 * repo is pinned to `^17.0.0-rc.6`, which does not export that name yet (#4636 /
 * PR #4639 raises it). Asserting it would fail on today's `main` for a rename
 * that is exactly what makes the GA tree green. The thing that measures the GA
 * direction is `scripts/check-spec-symbol-derivation.mjs` itself.
 *
 * Compiled by this package's `tsconfig.test.json` (objectui#3181) — without
 * that, every `Assert<…>` below is erased before vitest runs and proves nothing.
 */

import { describe, it } from 'vitest';
import type { ObjectGridComponentProps, ObjectGridProps } from '../index';

type Assert<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

describe('the rename off the spec name holds', () => {
  it('is pinned at compile time', () => {
    // The spec must not own the NEW name. If it ever ships an
    // `ObjectGridComponentProps`, this directive stops suppressing anything and
    // `tsc` fails with "Unused '@ts-expect-error' directive" — which is the
    // tripwire firing. Rename again (checking the next name here FIRST), or
    // derive from the spec if by then the two really are the same thing.
    // @ts-expect-error `@objectstack/spec/ui` must not own this name.
    type _NewNameIsFree = import('@objectstack/spec/ui').ObjectGridComponentProps;

    // Guard against the pin lying: a local type that erased to `any` would
    // satisfy every assignability question below while proving nothing
    // (objectstack#4171 is that failure for other symbols).
    type _NotAny = Assert<Equal<IsAny<ObjectGridComponentProps>, false>>;

    // The deprecated alias denotes the SAME type, which is the whole promise it
    // makes to importers that still spell the old name. If they ever diverge,
    // the alias has become a second declaration and the rename leaked.
    type _AliasIsSameType = Assert<Equal<ObjectGridProps, ObjectGridComponentProps>>;

    // The renderer props are still the renderer's: `dataSource` is a live object
    // the authored document cannot carry. This is what makes "two layers, one
    // word" true rather than asserted — if it ever goes away, re-triage the
    // symbol instead of keeping the rename out of habit.
    type _StillRendererShaped = Assert<Equal<'dataSource' extends keyof ObjectGridComponentProps ? true : false, true>>;
  });
});
