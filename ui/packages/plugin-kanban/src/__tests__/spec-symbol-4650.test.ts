/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/plugin-kanban` ↔ `@objectstack/spec` symbol-collision tripwire
 * (objectui#4650). Sibling of `spec-symbol-4650.test.ts` in plugin-grid,
 * plugin-form and plugin-calendar — one card, four packages, one verdict.
 *
 * `@objectstack/spec/ui` owns `ObjectKanbanProps` from 17.0.0: it is the
 * AUTHORED props document of the `object-kanban` element (`z.input<typeof
 * ObjectKanbanPropsSchema>`), a serialisable authoring surface. This package's
 * same-named interface was the RENDERER's props — a live `dataSource`, records
 * pre-fetched by a parent, host click callbacks — so the two are different
 * things under one word, and the local one was renamed to
 * `ObjectKanbanComponentProps` rather than derived. Same verdict and same suffix
 * as `PageHeaderProps` -> `PageHeaderComponentProps` (app-shell) and the
 * `Record*ComponentProps` family in `@object-ui/types`.
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
import type { ObjectKanbanComponentProps, ObjectKanbanProps } from '../index';

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
    type _NewNameIsFree = import('@objectstack/spec/ui').ObjectKanbanComponentProps;

    // A local type erased to `any` would satisfy every assertion below while
    // proving nothing (objectstack#4171 is that failure for other symbols).
    type _NotAny = Assert<Equal<IsAny<ObjectKanbanComponentProps>, false>>;

    // The deprecated alias denotes the SAME type — the whole promise it makes to
    // importers that still spell the old name.
    type _AliasIsSameType = Assert<Equal<ObjectKanbanProps, ObjectKanbanComponentProps>>;

    // Still the renderer's props: `dataSource` is a live object no authored
    // document can carry. If this stops holding, re-triage the symbol rather
    // than keeping the rename out of habit.
    type _StillRendererShaped = Assert<
      Equal<'dataSource' extends keyof ObjectKanbanComponentProps ? true : false, true>
    >;
  });
});
