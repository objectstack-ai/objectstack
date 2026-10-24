/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Type-level pin for objectui#7483 — the Console `ObjectView`'s props are the
 * declared `ConsoleObjectViewProps`, not `any`.
 *
 * ## What the defect was
 *
 * `ObjectView` (exported from the package entry) and `ObjectViewInner` both took
 * a bare `any`. That erased the prop NAMES, not just their value types: a
 * misspelled prop compiled clean and was silently dropped, and the README's
 * `ObjectView` block — covered by `check:doc-snippets` — mounted the view with
 * `dataSource` alone and still compiled, although the wrapper's first act is
 * `objects.find(...)`. A sibling whose props are an object type, even one whose
 * values are `any` (`DashboardView`), already refused a misspelling.
 *
 * Ruled on the card (letter B): export `ConsoleObjectViewProps` — the name
 * `ObjectViewProps` belongs to `@object-ui/plugin-view` (objectui#6172, one
 * authority per exported type name) — with `dataSource: DataSource` and
 * `onEdit` required, `objects: any[]`, and `externalRefreshKey?: number`.
 *
 * ## Why the instrument is `tsc` and not a test run
 *
 * Every assertion here is erased before vitest sees it. What makes them a pin is
 * `packages/app-shell/tsconfig.test.json`, which compiles every
 * `src/**\/*.test.tsx` in the package and is chained off the package's
 * `type-check` script. Two instruments, because they fail in different
 * directions:
 *
 * - `Assert<Equal<…>>` on the parameter reds if it becomes anything other than
 *   the declared interface — including `any`.
 * - `@ts-expect-error` reds via TS2578 ("unused '@ts-expect-error' directive")
 *   the moment a refusal stops biting. With the parameter back to `any`, both
 *   refusals below compile again and each directive becomes the error.
 *
 * The runtime `expect`s only keep this a file vitest can run; the elements are
 * created, never rendered.
 */
import * as React from 'react';
import { describe, it, expect } from 'vitest';
import type { DataSource } from '@object-ui/types';

import { ObjectView, type ConsoleObjectViewProps } from './ObjectView';

type Assert<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

/** What the exported component actually declares it accepts. */
type Param = Parameters<typeof ObjectView>[0];

// Guard against the probe lying: were any of these `any`, every assertion and
// every refusal below would pass or fail for the wrong reason.
type _ParamNotAny = Assert<Equal<IsAny<Param>, false>>;
type _PropsNotAny = Assert<Equal<IsAny<ConsoleObjectViewProps>, false>>;
type _DataSourceNotAny = Assert<Equal<IsAny<DataSource>, false>>;

/** The card as one type equation: the parameter IS the exported interface. */
type _ParamIsTheDeclaredProps = Assert<Equal<Param, ConsoleObjectViewProps>>;
/** `dataSource` is the published contract, not a loose value type. */
type _DataSourceIsTheContract = Assert<Equal<ConsoleObjectViewProps['dataSource'], DataSource>>;
/**
 * The ruled shape, member by member: names, optionality, value types
 * (5871194128). The `@ts-expect-error` rows below accept ANY error code, so on
 * their own they would stay green if `objects` or `onEdit` became optional —
 * the alternative the ruling priced and rejected. This equation is what binds
 * the shape.
 */
type _PropsAreTheRuledShape = Assert<
  Equal<
    ConsoleObjectViewProps,
    {
      dataSource: DataSource;
      objects: any[];
      onEdit: (record: Record<string, unknown>) => void;
      externalRefreshKey?: number;
    }
  >
>;

/**
 * Never rendered — only passed as a prop value to elements that are created and
 * discarded, so no member of the contract is ever called.
 */
const DATA_SOURCE = {} as DataSource;
const OBJECTS = [{ name: 'account', label: 'Account', fields: {} }];
const noop = (_record: Record<string, unknown>) => {};

describe('objectui#7483 — ObjectView props are the declared ConsoleObjectViewProps', () => {
  it('refuses a misspelled prop name (TS2322)', () => {
    // THE CARD's probe. Under the bare `any` this compiled with no diagnostic.
    // @ts-expect-error objectui#7483 — `dataSourceX` is not a prop (TS2322).
    const misspelled = <ObjectView dataSourceX={DATA_SOURCE} objects={OBJECTS} onEdit={noop} />;

    expect(React.isValidElement(misspelled)).toBe(true);
  });

  it('refuses a mount that omits the required `objects` and `onEdit` (TS2739)', () => {
    // The README's `ObjectView` block before this change: it compiled, and a
    // verbatim copy threw on first render at `objects.find(...)`.
    // @ts-expect-error objectui#7483 — `objects` and `onEdit` are required (TS2739).
    const incomplete = <ObjectView dataSource={DATA_SOURCE} />;

    expect(React.isValidElement(incomplete)).toBe(true);
  });

  it('accepts the four props the component reads', () => {
    // The overshoot control: an interface that refused the real call shape
    // (AppContent mounts exactly this) would fail here.
    const complete = (
      <ObjectView dataSource={DATA_SOURCE} objects={OBJECTS} onEdit={noop} externalRefreshKey={1} />
    );

    expect(React.isValidElement(complete)).toBe(true);
  });
});
