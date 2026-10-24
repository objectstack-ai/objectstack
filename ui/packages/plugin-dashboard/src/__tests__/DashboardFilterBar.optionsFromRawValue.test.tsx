/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `optionsFrom` filters commit the RAW value, not the display label
 * (objectui#4465).
 *
 * A dashboard global filter sourced from `optionsFrom` builds its options from
 * a server GROUP BY. That response carries both forms of every grouped value:
 * `rows` holds the server-RESOLVED DISPLAY LABELS (`{status: 'In Review'}`) and
 * the index-aligned `drillRawRows` holds the RAW stored values
 * (`{status: 'in_review'}`). The filter bar read the value off `rows`, so
 * picking "In Review" broadcast `runtimeFilter {status: 'In Review'}` into every
 * bound widget — a value no record carries — and each widget repainted to
 * "No rows".
 *
 * The gate is the COMMITTED value, which is why these tests assert what the
 * widget re-queries with and what `onChange` hands the host. The existing
 * `DashboardFilterBar.options.test.tsx` asserts only that the option list
 * renders — true both before and after the defect, which is what let it live.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { DashboardComponentSchema } from '@object-ui/types';
import type { DashboardFilterDef } from '@object-ui/core';
import { DashboardFilterBar } from '../DashboardFilterBar';
import { DashboardRenderer } from '../DashboardRenderer';

// Radix Select opens on pointer events jsdom does not implement — the same
// shim `packages/components`' option-value round-trip test uses.
beforeAll(() => {
  class MockPointerEvent extends Event {
    button: number;
    ctrlKey: boolean;
    pointerType: string;
    constructor(type: string, props: any = {}) {
      super(type, props);
      this.button = props.button ?? 0;
      this.ctrlKey = props.ctrlKey ?? false;
      this.pointerType = props.pointerType ?? 'mouse';
    }
  }
  (window as any).PointerEvent = MockPointerEvent;
  (HTMLElement.prototype as any).hasPointerCapture = vi.fn();
  (HTMLElement.prototype as any).releasePointerCapture = vi.fn();
  (HTMLElement.prototype as any).scrollIntoView = vi.fn();
});

afterEach(cleanup);

/** The card's reproduction: a `showcase_task.status` option source. */
const STATUS_DEF: DashboardFilterDef = {
  name: 'st',
  field: 'status',
  label: 'Status',
  type: 'select',
  optionsFrom: { object: 'showcase_task', valueField: 'status', labelField: 'status' },
} as DashboardFilterDef;

/** Display labels, exactly as the server resolves them (ordered by raw value). */
const LABEL_ROWS = [
  { status: 'Backlog', option_count: 1 },
  { status: 'Done', option_count: 4 },
  { status: 'In Progress', option_count: 3 },
  { status: 'In Review', option_count: 2 },
  { status: 'To Do', option_count: 5 },
];
/** The index-aligned raw values the same response carries. */
const RAW_ROWS = [
  { status: 'backlog' },
  { status: 'done' },
  { status: 'in_progress' },
  { status: 'in_review' },
  { status: 'todo' },
];

/** Open the filter's Select and pick the item with this visible text. */
async function pick(testId: string, optionText: string) {
  fireEvent.pointerDown(screen.getByTestId(testId), { button: 0 });
  const option = await screen.findByRole('option', { name: optionText });
  fireEvent.click(option);
}

/**
 * The bar is a controlled component; the host owns the value. This wrapper is
 * that host, so the COMMITTED value and the DISPLAYED label can both be read
 * from one interaction.
 */
function ControlledBar({ defs, dataSource, onCommit }: { defs: DashboardFilterDef[]; dataSource?: any; onCommit: (name: string, v: any) => void }) {
  const [values, setValues] = React.useState<Record<string, any>>({});
  return (
    <DashboardFilterBar
      defs={defs}
      values={values}
      dataSource={dataSource}
      onChange={(name, v) => {
        onCommit(name, v);
        setValues((s) => ({ ...s, [name]: v }));
      }}
    />
  );
}

/** A dataset source whose option-source answer is `optionsResponse`. */
const makeSource = (optionsResponse: any) => ({
  // The filter bar passes an inline dataset DRAFT (an object); widgets pass the
  // dataset NAME (a string) — one mock serves both.
  // `selection` is declared (though unread) so the mock's call tuple has both
  // arguments — reading `calls[i][1]` off a one-element tuple is a type error.
  queryDataset: vi.fn(async (dataset: any, _selection?: any) =>
    typeof dataset === 'string'
      ? { rows: [{ status: 'In Review', task_count: 2 }], fields: [] }
      : optionsResponse,
  ),
});

describe('optionsFrom — the committed value is the raw value (#4465)', () => {
  it('broadcasts the RAW value into a bound widget\'s runtimeFilter', async () => {
    const dataSource = makeSource({ rows: LABEL_ROWS, drillRawRows: RAW_ROWS });
    const schema: DashboardComponentSchema = {
      type: 'dashboard',
      globalFilters: [STATUS_DEF as any],
      widgets: [
        { id: 'w1', type: 'bar', dataset: 'showcase_task_metrics', dimensions: ['status'], values: ['task_count'] } as any,
      ],
    };
    render(<DashboardRenderer schema={schema} dataSource={dataSource} />);

    // The widget queries unfiltered first…
    await waitFor(() => expect(dataSource.queryDataset).toHaveBeenCalledWith('showcase_task_metrics', expect.anything()));
    // …and the option source has answered, so the dropdown has its items.
    await pick('dashboard-filter-st', 'In Review');

    await waitFor(() => {
      const calls = dataSource.queryDataset.mock.calls.filter((c: any[]) => c[0] === 'showcase_task_metrics');
      // PRE-FIX this was `{ status: 'In Review' }` — the display label, which
      // no record carries, so the widget rendered "No rows" (the card's
      // `runtimeFilter {"status":"In Review"}` → `{"rows":[]}`).
      expect((calls[calls.length - 1][1] as any).runtimeFilter).toEqual({ status: 'in_review' });
    });
  });

  it('hands the host the raw value', async () => {
    const onCommit = vi.fn();
    const dataSource = makeSource({ rows: LABEL_ROWS, drillRawRows: RAW_ROWS });
    render(<ControlledBar defs={[STATUS_DEF]} dataSource={dataSource} onCommit={onCommit} />);

    await waitFor(() => expect(dataSource.queryDataset).toHaveBeenCalledTimes(1));
    await pick('dashboard-filter-st', 'In Review');

    // The committed value — PRE-FIX 'In Review'.
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith('st', 'in_review'));
  });

  it('pairs BY INDEX — a second position resolves to its own raw value', async () => {
    const onCommit = vi.fn();
    const dataSource = makeSource({ rows: LABEL_ROWS, drillRawRows: RAW_ROWS });
    render(<ControlledBar defs={[STATUS_DEF]} dataSource={dataSource} onCommit={onCommit} />);

    await waitFor(() => expect(dataSource.queryDataset).toHaveBeenCalledTimes(1));
    // Last row (index 4): an off-by-one pairing would commit 'in_review'.
    await pick('dashboard-filter-st', 'To Do');
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith('st', 'todo'));
    // First row (index 0): an off-by-one the other way would commit 'done'.
    await pick('dashboard-filter-st', 'Backlog');
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith('st', 'backlog'));
  });

  it('reads the label from `labelField` and the value from the raw row when they differ', async () => {
    const onCommit = vi.fn();
    const def = {
      ...STATUS_DEF,
      optionsFrom: { object: 'showcase_task', valueField: 'owner', labelField: 'owner_name' },
    } as DashboardFilterDef;
    const dataSource = makeSource({
      rows: [
        { owner: 'Ada Lovelace', owner_name: 'Ada Lovelace', option_count: 2 },
        { owner: 'Alan Turing', owner_name: 'Alan Turing', option_count: 1 },
      ],
      drillRawRows: [{ owner: 'usr_001', owner_name: 'Ada Lovelace' }, { owner: 'usr_002', owner_name: 'Alan Turing' }],
    });
    render(<ControlledBar defs={[def]} dataSource={dataSource} onCommit={onCommit} />);

    await waitFor(() => expect(dataSource.queryDataset).toHaveBeenCalledTimes(1));
    await pick('dashboard-filter-st', 'Alan Turing');
    // The lookup ID, not the resolved name — the case `buildDatasetDrillFilter`
    // names as "a select/lookup label would mis-filter".
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith('st', 'usr_002'));
  });
});

describe('optionsFrom — must-not-change', () => {
  it('the trigger keeps DISPLAYING the label, never the raw token', async () => {
    const onCommit = vi.fn();
    const def = {
      ...STATUS_DEF,
      optionsFrom: { object: 'showcase_task', valueField: 'owner', labelField: 'owner_name' },
    } as DashboardFilterDef;
    const dataSource = makeSource({
      rows: [
        { owner: 'Ada Lovelace', owner_name: 'Ada Lovelace', option_count: 2 },
        { owner: 'Alan Turing', owner_name: 'Alan Turing', option_count: 1 },
      ],
      drillRawRows: [{ owner: 'usr_001', owner_name: 'Ada Lovelace' }, { owner: 'usr_002', owner_name: 'Alan Turing' }],
    });
    render(<ControlledBar defs={[def]} dataSource={dataSource} onCommit={onCommit} />);

    await waitFor(() => expect(dataSource.queryDataset).toHaveBeenCalledTimes(1));
    await pick('dashboard-filter-st', 'Alan Turing');

    // Green on BOTH sides of the fix, and deliberately its own test: swapping
    // the committed value must not push the raw token into the UI — the user
    // reads "Alan Turing", never "usr_002". Asserted here rather than after a
    // red-first assertion, where it would never run pre-fix.
    await waitFor(() => expect(screen.getByTestId('dashboard-filter-st')).toHaveTextContent('Alan Turing'));
    expect(screen.getByTestId('dashboard-filter-st')).not.toHaveTextContent('usr_002');
  });
});

describe('optionsFrom — the abstentions, all landing on the pre-#4465 read', () => {
  it('falls back to `rows` when the response carries NO drillRawRows', async () => {
    const onCommit = vi.fn();
    const dataSource = makeSource({ rows: LABEL_ROWS });
    render(<ControlledBar defs={[STATUS_DEF]} dataSource={dataSource} onCommit={onCommit} />);

    await waitFor(() => expect(dataSource.queryDataset).toHaveBeenCalledTimes(1));
    await pick('dashboard-filter-st', 'In Review');
    // Deliberate: with no raw form on offer there is nothing better to commit,
    // and this is byte-identically what the call site did before the fix.
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith('st', 'In Review'));
  });

  it('abstains to `rows` when the two arrays DISAGREE IN LENGTH', async () => {
    const onCommit = vi.fn();
    const dataSource = makeSource({
      rows: LABEL_ROWS,
      // One short — index i no longer means the same bucket in both arrays.
      drillRawRows: RAW_ROWS.slice(0, 4),
    });
    render(<ControlledBar defs={[STATUS_DEF]} dataSource={dataSource} onCommit={onCommit} />);

    await waitFor(() => expect(dataSource.queryDataset).toHaveBeenCalledTimes(1));
    await pick('dashboard-filter-st', 'In Review');
    // Pairing anyway would commit 'in_progress' here — a DIFFERENT bucket's raw
    // value, indistinguishable from a correct filter that matched nothing.
    // The label is visibly wrong instead of silently wrong.
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith('st', 'In Review'));
    expect(onCommit).not.toHaveBeenCalledWith('st', 'in_progress');
  });

  it('abstains to `rows` when the raw rows carry no such field at all', async () => {
    const onCommit = vi.fn();
    const dataSource = makeSource({
      // A date-bucketed dimension is excluded from `drillRawRows` by the server
      // (it sends `drillRanges` instead) — raw rows that speak another field
      // are the server saying "no raw form of this dimension", not a defect.
      rows: LABEL_ROWS,
      drillRawRows: LABEL_ROWS.map(() => ({ other_dim: 'x' })),
    });
    render(<ControlledBar defs={[STATUS_DEF]} dataSource={dataSource} onCommit={onCommit} />);

    await waitFor(() => expect(dataSource.queryDataset).toHaveBeenCalledTimes(1));
    await pick('dashboard-filter-st', 'In Review');
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith('st', 'In Review'));
  });

  it('leaves the client-side `find` fallback untouched (records already carry raw values)', async () => {
    const onCommit = vi.fn();
    const dataSource = {
      queryDataset: vi.fn().mockRejectedValue(new Error('datasets unsupported')),
      find: vi.fn().mockResolvedValue([{ status: 'in_review' }, { status: 'in_review' }, { status: 'todo' }]),
    };
    render(<ControlledBar defs={[STATUS_DEF]} dataSource={dataSource} onCommit={onCommit} />);

    await waitFor(() => expect(dataSource.find).toHaveBeenCalledTimes(1));
    // A record's field IS the stored value, so value and label are the same
    // string here — deduped to two options, exactly as before.
    await pick('dashboard-filter-st', 'in_review');
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith('st', 'in_review'));
  });
});

describe('static metadata-declared options are untouched (#4465 must-not-change)', () => {
  it('commits the authored value and shows the authored label (Revenue Pulse `region`)', async () => {
    const onCommit = vi.fn();
    const def = {
      name: 'region',
      field: 'region',
      label: 'Region',
      type: 'select',
      // Already normalized to pairs by `resolveDashboardFilterDefs`.
      options: [{ value: 'emea', label: 'EMEA' }, { value: 'apac', label: 'APAC' }],
    } as DashboardFilterDef;
    // A dataset-capable source is present and must stay unconsulted: static
    // options never reach the option-source path this fix changed.
    const dataSource = makeSource({ rows: LABEL_ROWS, drillRawRows: RAW_ROWS });
    render(<ControlledBar defs={[def]} dataSource={dataSource} onCommit={onCommit} />);

    await pick('dashboard-filter-region', 'EMEA');
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith('region', 'emea'));
    expect(screen.getByTestId('dashboard-filter-region')).toHaveTextContent('EMEA');
    expect(dataSource.queryDataset).not.toHaveBeenCalled();
  });
});
