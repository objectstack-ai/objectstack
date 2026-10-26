/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4528 — COMPILE-TIME pins on the props a `ListView` JSX call site is
 * actually held to.
 *
 * These assertions are erased at runtime; `tsc` is the only thing that can
 * check them, which is why this file is carried by
 * `packages/plugin-list/tsconfig.test.json` and why the `expect` below is
 * deliberately trivial — the real assertions are the `Assert< Equal< … > >`
 * types, and a violation is a compile error, not a red test.
 *
 * ## What was measured before the fix
 *
 * The card objectui#4528 asserted this package's shape BY INSPECTION rather
 * than by measurement. It was then measured, on the pre-fix source, compiled
 * through this same project — and matched the sibling package exactly:
 *
 *     keyof React.ComponentProps< typeof ListView >   ->  string | number
 *     React.ComponentProps< typeof ListView >['onRowClick']  ->  any
 *     ListViewProps['onRowClick']  ->  ((record: Record< string, unknown >) => void) | undefined
 *
 * `ListViewProps` carried a `[key: string]: any`, which puts `string` into
 * `keyof Props`, so React's `PropsWithoutRef` took its `Omit` branch and `Omit`
 * over a string index signature keeps ONLY the index signature. The interface
 * declared the contract and no consumer was held to it. The pins below are
 * exactly those reads, in their fixed direction.
 */

import { describe, it, expect } from 'vitest';
import type { ComponentProps } from 'react';
import type { SortItem, FilterBuilderRowGroup } from '@object-ui/components';
import { ListView, type ListViewProps } from '../ListView';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;

/** The props a JSX call site is held to. */
type CallSiteProps = ComponentProps<typeof ListView>;

// 1. The declared callback survives to the call site with its REAL signature.
//    Before the fix this was `any`, so a wrong-typed handler — and any prop
//    typo next to it — passed silently.
//
//    ⭐ MOVED BY objectui#9357, and this pin is how that move was noticed. The
//    second parameter is the modifier payload `useNavigationOverlay`'s
//    `handleClick` has always invoked this prop with — `ListView` passes the
//    prop straight into that option — and the declaration used to name only the
//    record. Note what caught it: `Equal` is exact identity, so it reds on a
//    widening that `extends` would have waved through in BOTH directions. Note
//    also WHERE it was caught — `tsc`, never vitest, which erases every line
//    above `describe`. This package's 77 test files stayed green across the
//    change.
type _OnRowClickIsDeclared = Assert<
  Equal<
    CallSiteProps['onRowClick'],
    ((record: Record<string, unknown>, event?: any) => void) | undefined
  >
>;

// 2. …and that is not vacuously true because the whole thing is `any`.
type _OnRowClickIsNotAny = Assert<Equal<IsAny<CallSiteProps['onRowClick']>, false>>;

// 3. The call-site type and the DECLARED interface agree key for key, once the
//    `ref` / `key` that `RefAttributes` contributes are set aside.
type _DeclaredKeysAgree = Assert<
  Equal<Exclude<keyof CallSiteProps, 'ref' | 'key'>, keyof ListViewProps>
>;

// 4. `keyof` is a union of literal keys, NOT the erased `string | number`. THIS
//    is the assertion that discriminates: on the pre-fix shape
//    `keyof CallSiteProps` was `string | number`, so `string` extended it and
//    this pin was `true` — measured, and it is the whole defect in one line.
//    (Note assertion 3 alone would NOT have caught it: pre-fix BOTH sides were
//    erased to `string | number`, so they agreed with each other while agreeing
//    with nothing the interface declared.)
type _KeysAreNotWidened = Assert<Equal<string extends keyof CallSiteProps ? true : false, false>>;

// 5. Named props the interface declares are reachable and correctly typed.
type _SchemaSurvives = Assert<Equal<CallSiteProps['schema'], ListViewProps['schema']>>;
type _ShowViewSwitcherSurvives = Assert<Equal<CallSiteProps['showViewSwitcher'], boolean | undefined>>;
type _InitialSearchTermSurvives = Assert<Equal<CallSiteProps['initialSearchTerm'], string | undefined>>;

// 6. The props this component READS off its rest object are declared by name
//    rather than reachable only through an index signature (objectui#4528).
type _OnAddRecordIsDeclared = Assert<Equal<CallSiteProps['onAddRecord'], (() => void) | undefined>>;
type _OnPageSizeChangeIsDeclared = Assert<
  Equal<CallSiteProps['onPageSizeChange'], ((pageSize: number) => void) | undefined>
>;
type _DataSourceIsDeclared = Assert<'dataSource' extends keyof ListViewProps ? true : false>;

// 7. The row affordances forwarded to the active view component are declared
//    with the signatures `ObjectGrid` receives them at.
type _OnEditIsDeclared = Assert<Equal<CallSiteProps['onEdit'], ((record: any) => void) | undefined>>;
type _OnBulkDeleteIsDeclared = Assert<
  Equal<CallSiteProps['onBulkDelete'], ((records: any[]) => void) | undefined>
>;

// 8. objectui#8106 — the two callbacks the #4528 sweep left at `any`, pinned
//    at the type their emit sites actually fire with. Both were measured at the
//    CALL SITE, not read off the declaration, and they are asymmetric on
//    purpose: `sort` crosses `emitSortChange`, whose two legs are the array it
//    is handed and `filterPlatformSortableSort`'s return — generic in the
//    element, so `SortItem[]` either way; `filters` is the toolbar
//    `FilterBuilder`'s own `onChange` value passed straight through, which is
//    why it is the builder's `FilterBuilderRowGroup` and NOT the later query-path AST.
//
//    The `IsAny` halves are the discriminating ones, exactly as in pin 2: a
//    re-widening to `any` must fail loudly here rather than silently
//    re-admitting every shape the way it did before objectui#8106.
type _OnSortChangeIsDeclared = Assert<
  Equal<CallSiteProps['onSortChange'], ((sort: SortItem[]) => void) | undefined>
>;
type _OnSortChangeParamIsNotAny = Assert<
  Equal<IsAny<Parameters<NonNullable<CallSiteProps['onSortChange']>>[0]>, false>
>;
type _OnFilterChangeIsDeclared = Assert<
  Equal<CallSiteProps['onFilterChange'], ((filters: FilterBuilderRowGroup) => void) | undefined>
>;
type _OnFilterChangeParamIsNotAny = Assert<
  Equal<IsAny<Parameters<NonNullable<CallSiteProps['onFilterChange']>>[0]>, false>
>;

describe('objectui#4528 — ListView serves its declared props', () => {
  it('pins the resolved call-site props at compile time', () => {
    // The assertions are the types above; this body only keeps the file a test.
    const probe: CallSiteProps['onRowClick'] = (record: Record<string, unknown>) => {
      void record;
    };
    expect(typeof probe).toBe('function');

    // SOURCE COMPATIBILITY, stated where it can be checked rather than only
    // claimed in a changeset: the one-parameter handler above still satisfies
    // the widened prop (that is the assignment on the line above, unchanged by
    // objectui#9357), and so does a handler that reads the payload.
    const withModifiers: CallSiteProps['onRowClick'] = (record, event) => {
      void record;
      void event?.metaKey;
    };
    expect(typeof withModifiers).toBe('function');
  });
});
