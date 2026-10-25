/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * DashboardFilterBar — `optionsFrom` dynamic options, server-side first
 * (#2578 item 5): with a dataset-capable data source, distinct option values
 * come from a server GROUP BY (inline dataset draft over the source object);
 * the original client-side top-200 dedupe is only the fallback.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { DashboardFilterBar } from '../DashboardFilterBar';
import type { DashboardFilterDef } from '@object-ui/core';

// Radix Select opens on pointer events jsdom does not implement — the same shim
// `DashboardFilterBar.optionsFromRawValue.test.tsx` uses. Needed because the
// option list only exists in the DOM once the popup is open, so any assertion
// about WHICH options were derived has to open it.
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

const defs: DashboardFilterDef[] = [
  {
    name: 'industry',
    field: 'industry',
    type: 'select',
    optionsFrom: { object: 'accounts', valueField: 'industry', labelField: 'industry' },
  } as DashboardFilterDef,
];

function renderBar(dataSource: any) {
  return render(
    <DashboardFilterBar defs={defs} values={{}} onChange={vi.fn()} dataSource={dataSource} />,
  );
}

describe('DashboardFilterBar — optionsFrom fetching', () => {
  it('uses a server-side dataset query (GROUP BY distinct) when available', async () => {
    const queryDataset = vi.fn().mockResolvedValue({
      rows: [
        { industry: 'finance', option_count: 3 },
        { industry: 'retail', option_count: 2 },
      ],
    });
    const find = vi.fn();
    renderBar({ queryDataset, find });

    await waitFor(() => expect(queryDataset).toHaveBeenCalledTimes(1));
    const [draft, selection] = queryDataset.mock.calls[0];
    expect(draft).toMatchObject({
      object: 'accounts',
      dimensions: [{ name: 'industry', field: 'industry' }],
      measures: [{ name: 'option_count', aggregate: 'count' }],
    });
    expect(selection).toMatchObject({
      dimensions: ['industry'],
      measures: ['option_count'],
      order: { industry: 'asc' },
    });
    // The server path won — no record scan needed.
    expect(find).not.toHaveBeenCalled();
    expect(screen.getByTestId('dashboard-filter-industry')).toBeInTheDocument();
  });

  it('falls back to the client-side top-200 dedupe when the dataset query fails', async () => {
    const queryDataset = vi.fn().mockRejectedValue(new Error('datasets unsupported'));
    const find = vi.fn().mockResolvedValue([
      { industry: 'finance' },
      { industry: 'finance' },
      { industry: 'retail' },
    ]);
    renderBar({ queryDataset, find });

    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    // The EXACT params, not `objectContaining` (objectui#5458). This assertion
    // read `{ top: 200 }` until that card: `top` and `fields` are not
    // `QueryParams` keys, `convertQueryParams` copies only the `$`-prefixed
    // ones, so BOTH were dropped and this "top-200 dedupe" in fact scanned
    // every row and every column of `accounts`. A partial matcher is what let
    // the dead spelling sit here looking asserted, so the whole object is
    // pinned now and a re-introduced bare key fails.
    expect(find).toHaveBeenCalledWith('accounts', { $select: ['industry'], $top: 200 });
  });

  it('reads options off a QueryResult envelope, not a bare array', async () => {
    // The shape a REAL adapter returns: `find()` resolves to `QueryResult`,
    // whose records live under `data`. This path used to read `records.items`
    // — not a member of the contract — so with any real data source the
    // fallback resolved to `[]` and the filter offered NO options at all
    // (objectui#5458). Every other case in this file mocks a bare array, which
    // took the `Array.isArray` arm and never exercised this one.
    const queryDataset = vi.fn().mockRejectedValue(new Error('datasets unsupported'));
    const find = vi.fn().mockResolvedValue({
      data: [{ industry: 'finance' }, { industry: 'retail' }],
      total: 2,
    });
    renderBar({ queryDataset, find });

    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));

    fireEvent.pointerDown(screen.getByTestId('dashboard-filter-industry'), { button: 0 });
    // PRE-FIX these two `findByRole` calls both time out: `records.items` was
    // `undefined` on a `QueryResult`, so `rows` fell to `[]` and the dropdown
    // opened empty. Reading the option list is what discriminates — asserting
    // that the control renders passes either way.
    expect(await screen.findByRole('option', { name: 'finance' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'retail' })).toBeInTheDocument();
  });

  it('uses the client-side path directly when the data source has no queryDataset', async () => {
    const find = vi.fn().mockResolvedValue([{ industry: 'retail' }]);
    renderBar({ find });
    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
  });
});
