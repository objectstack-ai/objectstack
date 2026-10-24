/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4618 — `data-table` must not re-render itself to death.
 *
 * The reported crash ("Maximum update depth exceeded", thrown at the
 * `setMeasuredStickyLefts` call in the sticky-offset layout effect) is NOT
 * about sticky offsets. The loop is three hops of prop→state synchronization,
 * all inside `data-table.tsx`:
 *
 *   1. `columns: rawColumns = []` — the destructuring DEFAULT. When the schema
 *      carries no `columns` key, this evaluates a FRESH array literal on every
 *      render, so `rawColumns` has a new identity each time even though the
 *      schema object never changed.
 *   2. `initialColumns = useMemo(() => rawColumns.map(…), [rawColumns])` — an
 *      identity-keyed memo over hop 1, so it recomputes to a new array each
 *      render.
 *   3. `useEffect(() => setColumns(initialColumns), [initialColumns])` — the
 *      prop→state sync. New identity ⇒ new state ⇒ re-render ⇒ hop 1 again.
 *
 * Self-sustaining, because the unstable value is derived INSIDE the component:
 * the table's own re-render regenerates it, so nothing external has to change.
 * React throws from the layout effect keyed on `columns` (the synchronous
 * nested-update path it counts), which is why the stack points at a line that
 * has nothing to do with the cause.
 *
 * Mount alone is safe — `useState(initialColumns)` seeds from the very array
 * the mount-render's effect then re-sets, so the first sync is an Object.is
 * no-op. The loop starts at render #2, i.e. the first time ANY host re-renders
 * the tile. That is why this went unseen: every existing suite renders once.
 *
 * The negative control below is the load-bearing half: with `columns` declared
 * (a stable array off the schema), the same host churn must stay flat — the
 * fix must not have been "stop syncing columns".
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

afterEach(cleanup);

const ROWS = [
  { name: 'INV-1', amount: 100 },
  { name: 'INV-2', amount: 200 },
];

/**
 * Render `schema` (a STABLE object, declared once) inside a host that can
 * re-render on demand, counting the tile's commits. A host re-render is the
 * most ordinary thing on a dashboard — a filter change, a resize, a parent
 * state update — and must cost the tile a bounded number of commits.
 */
function renderUnderHostChurn(schema: Record<string, unknown>) {
  const DataTable = ComponentRegistry.get('data-table') as React.ComponentType<{ schema: unknown }>;
  if (!DataTable) throw new Error('data-table not registered');
  let commits = 0;
  let bump: (() => void) | null = null;
  const Host = () => {
    const [, setTick] = React.useState(0);
    bump = () => setTick((n) => n + 1);
    return (
      <React.Profiler id="tile" onRender={() => { commits += 1; }}>
        <DataTable schema={schema} />
      </React.Profiler>
    );
  };
  const utils = render(<Host />);
  return {
    ...utils,
    churn: (times: number) => {
      for (let i = 0; i < times; i += 1) act(() => { bump!(); });
    },
    get commits() { return commits; },
  };
}

describe('data-table survives host re-renders (#4618)', () => {
  it('does not exceed the update depth when the schema declares no columns', () => {
    // Pre-fix this threw on the FIRST host re-render, after ~50 nested commits:
    //   "Maximum update depth exceeded. This can happen when a component
    //    repeatedly calls setState inside componentWillUpdate or
    //    componentDidUpdate…"
    const tile = renderUnderHostChurn({ data: ROWS, searchable: false, pagination: false, className: 'border-0' });
    expect(() => tile.churn(3)).not.toThrow();
    // Bounded, not merely finite: one commit per host render (plus the mount
    // pair). A regression that re-introduced a per-render state write would
    // still "not throw" while doubling this.
    expect(tile.commits).toBeLessThanOrEqual(6);
  });

  it('keeps syncing declared columns — the negative control stays flat too', () => {
    const tile = renderUnderHostChurn({
      data: ROWS,
      columns: [{ header: 'Name', accessorKey: 'name' }, { header: 'Amount', accessorKey: 'amount' }],
      searchable: false,
      pagination: false,
    });
    expect(() => tile.churn(3)).not.toThrow();
    expect(tile.commits).toBeLessThanOrEqual(6);
    // Declared columns still reach the DOM — the sync was hardened, not removed.
    const headers = Array.from(tile.container.querySelectorAll('th')).map((th) => th.textContent);
    expect(headers.join('|')).toContain('Name');
    expect(headers.join('|')).toContain('Amount');
    expect(tile.container.textContent).toContain('INV-1');
  });

  it('re-syncs when the host actually changes the declared columns', () => {
    const DataTable = ComponentRegistry.get('data-table') as React.ComponentType<{ schema: unknown }>;
    let setCols: ((c: Array<Record<string, unknown>>) => void) | null = null;
    const Host = () => {
      const [cols, set] = React.useState<Array<Record<string, unknown>>>([
        { header: 'Name', accessorKey: 'name' },
      ]);
      setCols = set;
      return <DataTable schema={{ data: ROWS, columns: cols, searchable: false, pagination: false }} />;
    };
    const { container } = render(<Host />);
    expect(container.textContent).toContain('Name');
    expect(container.textContent).not.toContain('Amount');
    act(() => { setCols!([{ header: 'Name', accessorKey: 'name' }, { header: 'Amount', accessorKey: 'amount' }]); });
    expect(container.textContent).toContain('Amount');
    expect(container.textContent).toContain('200');
  });
});
