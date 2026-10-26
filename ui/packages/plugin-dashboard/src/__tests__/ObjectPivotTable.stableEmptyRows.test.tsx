/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4629 (package sweep) — the identical expression in
 * `ObjectPivotTable`.
 *
 * `const finalData = Array.isArray(rawData) ? rawData : []` evaluated a FRESH
 * array literal on every render, and unlike `ObjectDataTable` this component
 * has no unconditional empty-state early return: it hands the value straight
 * to `PivotTable` as `finalSchema.data`, where it is the identity key of the
 * cross-tabulation memo (`[data, rowField, columnField, valueField,
 * aggregation]`). So the churn ESCAPED the component here and rebuilt the
 * row/column sets, the bucket map and the totals on every render over nothing.
 *
 * This closes the OBJECT-BOUND path only: the stable empty passes through
 * `PivotTable`'s own `Array.isArray` arm unchanged. `PivotTable` still spells
 * two per-render literals of its own for callers that reach it directly — out
 * of this card's file surface, filed as objectui#5562.
 *
 * This is the direct identity assertion: the same array object must reach
 * `PivotTable` on every render. An `eslint-disable` suppression would not move
 * it, and it is not satisfiable by "the pivot renders correctly" (which is
 * green against the broken code too).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import React from 'react';

const captured = vi.hoisted(() => ({ data: [] as any[] }));

vi.mock('../PivotTable', () => ({
  PivotTable: ({ schema }: any) => {
    captured.data.push(schema.data);
    return <div data-testid="pivot">{(schema.data ?? []).map((r: any, i: number) => <span key={i}>{String(r.stage)}</span>)}</div>;
  },
}));

import { ObjectPivotTable } from '../ObjectPivotTable';

afterEach(() => {
  cleanup();
  captured.data.length = 0;
});

/**
 * `data` is a PROVIDER CONFIG object rather than rows — the truthy non-array
 * that selects the fallback arm. No `objectName`, so no fetch and no
 * "no data source" early return: the component reaches `PivotTable`.
 */
const PROVIDER_CONFIG_SCHEMA = {
  type: 'pivot-table',
  rowField: 'stage',
  columnField: 'owner',
  valueField: 'amount',
  data: { provider: 'object', object: 'opportunity' },
} as any;

function renderUnderHostChurn(schema: any) {
  let bump: (() => void) | null = null;
  const Host = () => {
    const [, setTick] = React.useState(0);
    bump = () => setTick((n) => n + 1);
    return <ObjectPivotTable schema={schema} />;
  };
  const utils = render(<Host />);
  return {
    ...utils,
    churn: (times: number) => {
      for (let i = 0; i < times; i += 1) act(() => { bump!(); });
    },
  };
}

describe('ObjectPivotTable keeps "no rows yet" stable (#4629)', () => {
  it('hands PivotTable one and the same empty array across host re-renders', () => {
    const tile = renderUnderHostChurn(PROVIDER_CONFIG_SCHEMA);

    // Load-bearing: the component really reached `PivotTable`, and with "no
    // rows" — otherwise the identity assertion below would be vacuous.
    expect(captured.data.length).toBe(1);
    expect(captured.data[0]).toEqual([]);

    tile.churn(3);

    expect(captured.data.length).toBeGreaterThanOrEqual(4);
    // Pre-fix: one distinct identity per render (4). The whole fix is that
    // this is 1.
    expect(new Set(captured.data).size).toBe(1);
    // The module-scope empty is frozen, so a consumer that mutates the array
    // it was handed cannot corrupt every other pivot on the page.
    expect(Object.isFrozen(captured.data[0])).toBe(true);
  });

  it('still forwards rows when they arrive — the pass-through was not removed', () => {
    let setData: ((d: any) => void) | null = null;
    const Host = () => {
      const [data, set] = React.useState<any>({ provider: 'object', object: 'opportunity' });
      setData = set;
      return (
        <ObjectPivotTable
          schema={{ ...PROVIDER_CONFIG_SCHEMA, data } as any}
        />
      );
    };
    const { getByTestId } = render(<Host />);
    const rows = [{ stage: 'Won', owner: 'ann', amount: 10 }];

    act(() => { setData!(rows); });

    expect(captured.data[captured.data.length - 1]).toBe(rows);
    expect(getByTestId('pivot').textContent).toContain('Won');
  });
});
