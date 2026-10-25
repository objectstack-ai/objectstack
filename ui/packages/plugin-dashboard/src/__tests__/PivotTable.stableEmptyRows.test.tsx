/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5562 — `PivotTable`'s OWN "no rows" value must be stable.
 *
 * `PivotTable` spelled the empty array twice, and both spellings feed the same
 * memo:
 *
 *   :146  data: rawData = [],                          // destructuring default
 *   :176  const data = Array.isArray(rawData) ? rawData : [];
 *   :241  }, [data, rowField, columnField, valueField, aggregation]);
 *
 * So a schema that declares no `data` key, or one whose `data` is a
 * provider-config object, handed the memo a FRESH array identity on every
 * render. The memo is not trivial — two ordered key sets, a
 * `bucket[row][col] = number[]` map, the aggregated matrix and the
 * row/column/grand totals — and all of it was rebuilt over nothing.
 *
 * ## Why this asserts on the memo and not on the render
 *
 * Nothing renders wrong today: the churn feeds a `useMemo`, not a `setState`,
 * and the wasted matrix is discarded by the `data.length === 0` early return
 * one line later. A "the pivot renders correctly" assertion is GREEN against
 * the broken code and proves nothing. The observable that actually moves is
 * how many times the memo's factory RUNS, so that is what this measures — by
 * wrapping `useMemo` and counting invocations of the cross-tabulation memo,
 * identified by its exact five-entry dependency list.
 *
 * ## Why both cases, separately
 *
 * The two literals are independent churn sources on independent lines. Fixing
 * only the `Array.isArray` arm leaves a schema with no `data` key still
 * churning through the destructuring default, and vice versa — and a single
 * test cannot tell you which half is live. One case per line.
 *
 * The object-bound path (`ObjectPivotTable` -> `PivotTable`) was closed by
 * objectui#4629 and is pinned by `ObjectPivotTable.stableEmptyRows.test.tsx`.
 * This file covers the DIRECT-USE path — `DashboardRenderer` /
 * `DashboardGridLayout` construct pivot schemas without `ObjectPivotTable` in
 * the chain.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

/** Fixture field names — also the signature that identifies the memo below. */
const ROW_FIELD = 'stage';
const COLUMN_FIELD = 'owner';
const VALUE_FIELD = 'amount';
const AGGREGATION = 'sum';

const probe = vi.hoisted(() => ({
  /** One entry per RENDER that reached the memo's call site. */
  seenDeps: [] as readonly unknown[][],
  /** One increment per actual factory execution (i.e. per recompute). */
  computes: 0,
  reset() {
    (this.seenDeps as unknown[][]).length = 0;
    this.computes = 0;
  },
}));

/**
 * The cross-tabulation memo at PivotTable.tsx:241, matched by its dependency
 * list `[data, rowField, columnField, valueField, aggregation]`. Anchored to
 * this file's fixture values so it cannot accidentally match a memo belonging
 * to some other component in the tree; the "reached once per render"
 * assertions below fail loudly if it ever stops matching, so a filter that
 * silently selects nothing cannot read as a pass.
 */
function isCrossTabMemo(deps: readonly unknown[] | undefined): boolean {
  return (
    Array.isArray(deps) &&
    deps.length === 5 &&
    deps[1] === ROW_FIELD &&
    deps[2] === COLUMN_FIELD &&
    deps[3] === VALUE_FIELD &&
    deps[4] === AGGREGATION
  );
}

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useMemo: (factory: () => unknown, deps?: readonly unknown[]) => {
      if (!isCrossTabMemo(deps)) return actual.useMemo(factory, deps as never);
      (probe.seenDeps as unknown[][]).push(deps as unknown[]);
      // Same hook, same position, same deps — only the factory is wrapped, so
      // hook order and React's own memoization are untouched.
      return actual.useMemo(() => {
        probe.computes += 1;
        return factory();
      }, deps as never);
    },
  };
});

import React from 'react';
import { PivotTable } from '../PivotTable';

afterEach(() => {
  cleanup();
  probe.reset();
});

/** A schema with NO `data` key at all — the destructuring default at :146. */
const NO_DATA_KEY_SCHEMA = {
  type: 'pivot',
  rowField: ROW_FIELD,
  columnField: COLUMN_FIELD,
  valueField: VALUE_FIELD,
  aggregation: AGGREGATION,
} as any;

/**
 * A schema whose `data` is a PROVIDER CONFIG object rather than rows — the
 * truthy non-array that selects the `Array.isArray` fallback arm at :176.
 */
const PROVIDER_CONFIG_SCHEMA = {
  ...NO_DATA_KEY_SCHEMA,
  data: { provider: 'object', object: 'opportunity' },
} as any;

/**
 * Render `schema` (a STABLE object, declared once) inside a host that can
 * re-render on demand. A host re-render is the most ordinary thing on a
 * dashboard — a filter change, a resize, a parent state update.
 */
function renderUnderHostChurn(schema: any) {
  let bump: (() => void) | null = null;
  const Host = () => {
    const [, setTick] = React.useState(0);
    bump = () => setTick((n) => n + 1);
    return <PivotTable schema={schema} />;
  };
  const utils = render(<Host />);
  return {
    ...utils,
    churn: (times: number) => {
      for (let i = 0; i < times; i += 1) act(() => { bump!(); });
    },
  };
}

describe('PivotTable keeps "no rows" stable across renders (objectui#5562)', () => {
  it.each([
    ['a schema with no `data` key at all (the destructuring default)', NO_DATA_KEY_SCHEMA],
    ['a schema whose `data` is a provider-config object (the Array.isArray fallback)', PROVIDER_CONFIG_SCHEMA],
  ])('does not re-run the cross-tabulation memo for %s', (_label, schema) => {
    renderUnderHostChurn(schema).churn(3);

    // Load-bearing: the memo's call site really was reached, on every render,
    // and really with "no rows" — otherwise everything below is vacuous.
    expect(probe.seenDeps.length).toBe(4);
    expect(probe.seenDeps[0][0]).toEqual([]);

    // The defect and the whole fix. Pre-fix: a fresh `[]` identity per render,
    // so 4 renders = 4 distinct identities = 4 full recomputes of the key
    // sets, the bucket map, the matrix and the totals — over nothing.
    expect(new Set(probe.seenDeps.map((deps) => deps[0])).size).toBe(1);
    expect(probe.computes).toBe(1);

    // Both spellings resolve to the SAME module-scope value, which is frozen:
    // a consumer that mutates the array it was handed cannot corrupt every
    // other pivot on the page.
    expect(Object.isFrozen(probe.seenDeps[0][0])).toBe(true);
  });

  it('uses one and the same empty for both spellings', () => {
    renderUnderHostChurn(NO_DATA_KEY_SCHEMA);
    const fromDestructuringDefault = probe.seenDeps[0][0];
    cleanup();
    probe.reset();

    renderUnderHostChurn(PROVIDER_CONFIG_SCHEMA);
    const fromIsArrayFallback = probe.seenDeps[0][0];

    expect(fromIsArrayFallback).toBe(fromDestructuringDefault);
  });

  it('still recomputes when rows actually change — the memo was not disabled', () => {
    const rows = [{ stage: 'Won', owner: 'ann', amount: 10 }];
    let setData: ((d: any) => void) | null = null;
    const Host = () => {
      const [data, set] = React.useState<any>(undefined);
      setData = set;
      return <PivotTable schema={{ ...NO_DATA_KEY_SCHEMA, data } as any} />;
    };
    const { container } = render(<Host />);

    expect(probe.computes).toBe(1);

    act(() => { setData!(rows); });

    // Real rows arrive: the memo must recompute and pass them through by
    // identity, and the matrix must actually render.
    expect(probe.computes).toBe(2);
    expect(probe.seenDeps[probe.seenDeps.length - 1][0]).toBe(rows);
    expect(container.textContent).toContain('Won');
    expect(container.textContent).toContain('10');
  });
});
