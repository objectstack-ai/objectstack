/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10664 (the census row for the dashboard filter bar) — a filter's
 * option list is re-read when its `optionsFrom.filter` changes, and only then.
 *
 * The options effect sends `optionsFrom.filter` on both of its reads (the
 * dataset query's `runtimeFilter` and the client-side fallback's `$filter`),
 * but its dependency list named only `object`, `valueField`, `labelField` and
 * the data source. A mounted bar whose option filter changed kept offering the
 * previous filter's options. The filter is now keyed by CONTENT, so an equal
 * filter in a fresh object is not a change (AGENTS.md #10).
 *
 * The CONTROL (an equal filter in a fresh object) is green before and after; it
 * goes red for a fix that keys on the filter's identity.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';
import { DashboardFilterBar } from '../DashboardFilterBar';
import type { DashboardFilterDef } from '@object-ui/core';

afterEach(cleanup);

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

const ACTIVE = { status: 'active' };
const CHURNED = { status: 'churned' };

const defsFor = (filter: unknown): DashboardFilterDef[] => [
  {
    name: 'industry',
    field: 'industry',
    type: 'select',
    optionsFrom: { object: 'accounts', valueField: 'industry', labelField: 'industry', filter },
  } as DashboardFilterDef,
];

type Path = 'dataset' | 'fallback';

function makeDataSource(path: Path) {
  const find = vi.fn().mockResolvedValue({ data: [{ industry: 'finance' }] });
  const queryDataset =
    path === 'dataset'
      ? vi.fn().mockResolvedValue({ rows: [{ industry: 'finance', option_count: 1 }] })
      : vi.fn().mockRejectedValue(new Error('datasets unsupported'));
  return { find, queryDataset };
}

/** The filter each option read carried, whichever of the two reads served it. */
const filtersSent = (ds: ReturnType<typeof makeDataSource>, path: Path) =>
  path === 'dataset'
    ? ds.queryDataset.mock.calls.map((c: any[]) => c[1]?.runtimeFilter)
    : ds.find.mock.calls.map((c: any[]) => c[1]?.$filter);

function mount(path: Path) {
  const ds = makeDataSource(path);
  const view = render(
    <DashboardFilterBar defs={defsFor(ACTIVE)} values={{}} onChange={vi.fn()} dataSource={ds} />,
  );
  const rerender = (filter: unknown) =>
    view.rerender(<DashboardFilterBar defs={defsFor(filter)} values={{}} onChange={vi.fn()} dataSource={ds} />);
  return { ds, rerender };
}

describe('the dashboard filter bar keys its option read on the filter it sends (objectui#10664)', () => {
  for (const path of ['dataset', 'fallback'] as const) {
    it(`SUBJECT: a changed \`optionsFrom.filter\` re-reads the options (${path} read)`, async () => {
      const { ds, rerender } = mount(path);
      await waitFor(() => expect(filtersSent(ds, path)).toHaveLength(1));
      await settle();
      expect(filtersSent(ds, path)).toEqual([ACTIVE]);

      await act(async () => { rerender(CHURNED); });
      await settle();

      expect(filtersSent(ds, path), 'the changed filter never reached an option read').toEqual([ACTIVE, CHURNED]);
    });
  }

  it('CONTROL: an equal filter in a fresh object does not re-read', async () => {
    const { ds, rerender } = mount('dataset');
    await waitFor(() => expect(ds.queryDataset).toHaveBeenCalledTimes(1));
    await settle();

    await act(async () => { rerender({ status: 'active' }); });
    await settle();

    expect(ds.queryDataset, 'an equal filter re-read the options').toHaveBeenCalledTimes(1);
  });
});
