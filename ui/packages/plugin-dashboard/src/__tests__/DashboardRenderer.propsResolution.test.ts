/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4528 — COMPILE-TIME pins on the props a `DashboardRenderer` JSX call
 * site is actually held to.
 *
 * These assertions are erased at runtime; `tsc` is the only thing that can
 * check them, which is why this file is carried by
 * `packages/plugin-dashboard/tsconfig.test.json` and why the `expect`s below
 * are deliberately trivial — the real assertions are the `Assert< Equal< … > >`
 * types, and a violation is a compile error, not a red test.
 *
 * ## What was measured before the fix
 *
 * `DashboardRendererProps` carried a `[key: string]: any`, which puts `string`
 * into `keyof Props`, so React's `PropsWithoutRef` took its `Omit` branch and
 * `Omit` over a string index signature keeps ONLY the index signature. On the
 * pre-fix source, compiled through this same project:
 *
 *     keyof React.ComponentProps< typeof DashboardRenderer >   ->  string | number
 *     React.ComponentProps< typeof DashboardRenderer >['onWidgetClick']  ->  any
 *     DashboardRendererProps['onWidgetClick']  ->  ((widgetId: string | null) => void) | undefined
 *
 * i.e. the interface declared the contract and no consumer was held to it. The
 * pins below are exactly those three reads, in their fixed direction.
 */

import { describe, it, expect } from 'vitest';
import type { ComponentProps } from 'react';
import { DashboardRenderer, type DashboardRendererProps } from '../DashboardRenderer';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;

/** The props a JSX call site is held to. */
type CallSiteProps = ComponentProps<typeof DashboardRenderer>;

// 1. The declared callback survives to the call site with its REAL signature.
//    Before the fix this was `any`, so a wrong-arity or wrong-typed handler —
//    and any prop typo next to it — passed silently.
type _OnWidgetClickIsDeclared = Assert<
  Equal<CallSiteProps['onWidgetClick'], ((widgetId: string | null) => void) | undefined>
>;

// 2. …and that is not vacuously true because the whole thing is `any`.
type _OnWidgetClickIsNotAny = Assert<Equal<IsAny<CallSiteProps['onWidgetClick']>, false>>;

// 3. The call-site type and the DECLARED interface agree key for key, once the
//    `ref` / `key` that `RefAttributes` contributes are set aside.
type _DeclaredKeysAgree = Assert<
  Equal<Exclude<keyof CallSiteProps, 'ref' | 'key'>, keyof DashboardRendererProps>
>;

// 4. `keyof` is a union of literal keys, NOT the erased `string | number`. THIS
//    is the assertion that discriminates: on the pre-fix shape
//    `keyof CallSiteProps` was `string | number`, so `string` extended it and
//    this pin was `true` — measured, and it is the whole defect in one line.
//    (Note assertion 3 alone would NOT have caught it: pre-fix BOTH sides were
//    erased to `string | number`, so they agreed with each other while agreeing
//    with nothing the interface declared.)
type _KeysAreNotWidened = Assert<Equal<string extends keyof CallSiteProps ? true : false, false>>;

// 5. A named prop the interface declares is reachable and correctly typed.
type _SchemaSurvives = Assert<Equal<CallSiteProps['schema'], DashboardRendererProps['schema']>>;
type _DesignModeSurvives = Assert<Equal<CallSiteProps['designMode'], boolean | undefined>>;

// 6. The DOM pass-through keys the `toDomProps` whitelist forwards are DECLARED
//    rather than reachable through an index signature (objectui#4432 + #4528).
type _OnClickIsDeclared = Assert<Equal<IsAny<CallSiteProps['onClick']>, false>>;

// 7. `dataSource` is declared — the render function destructures it and both
//    in-repo hosts pass it, but it was only ever reachable through the index
//    signature. `'dataSource' extends keyof …` is false the moment it is not.
type _DataSourceIsDeclared = Assert<'dataSource' extends keyof DashboardRendererProps ? true : false>;

describe('objectui#4528 — DashboardRenderer serves its declared props', () => {
  it('pins the resolved call-site props at compile time', () => {
    // The assertions are the types above; this body only keeps the file a test.
    const probe: CallSiteProps['onWidgetClick'] = (widgetId: string | null) => {
      void widgetId;
    };
    expect(typeof probe).toBe('function');
  });
});
