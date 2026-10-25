/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/plugin-calendar` ↔ `@objectstack/spec` symbol-collision tripwire
 * (objectui#4650). Sibling of `spec-symbol-4650.test.ts` in plugin-grid,
 * plugin-form and plugin-kanban — one card, four packages, one verdict.
 *
 * `@objectstack/spec/ui` owns `ObjectCalendarProps` from 17.0.0: it is the
 * AUTHORED props document of the `object-calendar` element (`z.input<typeof
 * ObjectCalendarPropsSchema>`), a serialisable authoring surface. This package's
 * same-named interface was the RENDERER's props — a live `dataSource`, records
 * pre-fetched by a parent, eight host callbacks — so the two are different
 * things under one word, and the local one was renamed to
 * `ObjectCalendarComponentProps` rather than derived. Same verdict and same
 * suffix as `PageHeaderProps` -> `PageHeaderComponentProps` (app-shell) and the
 * `Record*ComponentProps` family in `@object-ui/types`.
 *
 * This package had TWO of the card's six collisions, not one: the interface, and
 * the barrel's `export type { ObjectCalendarProps };` — a re-export with no
 * `from` clause, which `scripts/check-spec-symbol-derivation.mjs` judges as its
 * own declaration (the barrel skip it applies to `export … from './x'` cannot
 * apply when there is no module specifier to recognise). The barrel now spells
 * the alias with its `from` clause, so the name is judged once, at the
 * declaration.
 *
 * The spec is reached through a type-level `import('@objectstack/spec/ui').X`
 * rather than an `import type * as` statement because a namespace import of that
 * subpath binds `FormField`/`FormFieldSchema`, which `eslint.config.js` restricts
 * to an ERROR (objectui#3090). See the plugin-grid sibling for that in full, for
 * why these are compile-time pins rather than a runtime name probe, and for why
 * the "the spec still owns the old name" half of the ratchet is not asserted
 * before the pin reaches GA.
 *
 * Compiled by this package's `tsconfig.test.json` (objectui#3181) — without
 * that, every `Assert<…>` below is erased before vitest runs and proves nothing.
 */

import { describe, it } from 'vitest';
import type { ObjectCalendarComponentProps, ObjectCalendarProps } from '../index';

type Assert<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

describe('the rename off the spec name holds', () => {
  it('is pinned at compile time', () => {
    // @ts-expect-error `@objectstack/spec/ui` must not own this name. If it
    // starts to, tsc fails with "Unused '@ts-expect-error' directive" — the
    // tripwire firing, not a stale suppression.
    type _NewNameIsFree = import('@objectstack/spec/ui').ObjectCalendarComponentProps;

    // A local type erased to `any` would satisfy every assertion below while
    // proving nothing (objectstack#4171 is that failure for other symbols).
    type _NotAny = Assert<Equal<IsAny<ObjectCalendarComponentProps>, false>>;

    // The deprecated alias denotes the SAME type — the whole promise it makes to
    // importers that still spell the old name. This is also what keeps the
    // barrel's re-export a re-export instead of a second declaration.
    type _AliasIsSameType = Assert<Equal<ObjectCalendarProps, ObjectCalendarComponentProps>>;

    // Still the renderer's props: `dataSource` is a live object no authored
    // document can carry. If this stops holding, re-triage the symbol rather
    // than keeping the rename out of habit.
    type _StillRendererShaped = Assert<
      Equal<'dataSource' extends keyof ObjectCalendarComponentProps ? true : false, true>
    >;
  });
});
