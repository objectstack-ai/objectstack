/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10814 — the `drillDown.report` arm of `DrillDownDrawer` (the drill
 * of the `object-pivot` and `object-metric` blocks) renders a `report` node
 * wrapping the report (`spec-report` until objectui#11440) through
 * `SchemaRenderer`, so the dataset report it draws re-reads on the
 * data-invalidation bus with the reader the report renderer carries itself. The
 * drawer needs no reader of its own.
 *
 * Here, not beside the drawer: the drawer lives in `@object-ui/plugin-dashboard`
 * and the `report` it dispatches to is registered by
 * `@object-ui/plugin-report`, which that package does not depend on. The
 * console depends on both, which is the pairing a real drill runs in.
 *
 * The drawer is mounted open with a dataset-bound matrix report (the shape the
 * drawer's report arm takes: a report bound to a `dataset`, objectui#11506), under a
 * provider whose adapter counts `queryDataset` calls. The bare
 * `useDataInvalidation` reader beside it is the positive control.
 *
 * Every `queryDataset` returns a promise the test settles INSIDE `act`, so the
 * answer's render and its effects (the report's bus subscription among them)
 * are flushed before the test emits the next change. An adapter that answered
 * on its own resolved outside `act`: the DOM could show the report while the
 * subscription effect was still pending, and an event emitted in that window
 * was missed, which read as "never re-read" under load.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { SchemaRendererProvider, notifyDataChanged, useDataInvalidation } from '@object-ui/react';
import { DrillDownDrawer } from '@object-ui/plugin-dashboard';
// Registers `report`, the type the drawer's report arm renders (objectui#11440).
import '@object-ui/plugin-report';

beforeEach(() => {
  // The report's dimension-label probe is best-effort; answer it empty.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ item: { fields: {} } }) })));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

function makeDataSource() {
  const pending: Array<(value: unknown) => void> = [];
  return {
    pending,
    find: vi.fn(async () => ({ data: [], total: 0 })),
    queryDataset: vi.fn(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    ),
  };
}

/** Answer the `n`-th query (1-based) inside `act`, and let the answer's render and effects flush. */
async function answer(ds: ReturnType<typeof makeDataSource>, n: number, amount: number) {
  await act(async () => {
    ds.pending[n - 1]({
      rows: [{ stage: 'Won', owner: 'Ada', amount_sum: amount }],
      fields: [
        { name: 'stage', type: 'string', label: 'Stage' },
        { name: 'owner', type: 'string', label: 'Owner' },
        { name: 'amount_sum', type: 'number', label: 'Amount' },
      ],
      object: 'deal',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function BusControl() {
  const nonce = useDataInvalidation('deal');
  return <span data-testid="bus-control">{nonce}</span>;
}

const REPORT = {
  name: 'deals_by_stage_and_owner',
  type: 'matrix',
  dataset: 'deals_ds',
  rows: ['stage'],
  columns: ['owner'],
  values: ['amount_sum'],
};

const renderDrawer = (ds: ReturnType<typeof makeDataSource>) =>
  render(
    <SchemaRendererProvider dataSource={ds as any}>
      <BusControl />
      <DrillDownDrawer open onClose={() => {}} title="Deals" objectName="deal" report={REPORT} />
    </SchemaRendererProvider>,
  );

async function emit(change: { objectName: string; recordId?: string }) {
  await act(async () => {
    notifyDataChanged(change);
    await Promise.resolve();
  });
}

describe('a drill-down drawer’s `drillDown.report` re-reads on the data-invalidation bus (objectui#10814)', () => {
  it('re-reads after "*" and after its own object, not after another object, in place', async () => {
    const ds = makeDataSource();
    const { getByTestId } = renderDrawer(ds);
    expect(ds.queryDataset).toHaveBeenCalledTimes(1);
    await answer(ds, 1, 100);
    const matrix = document.querySelector('[data-testid="dataset-matrix"]');
    expect(matrix, 'the drawer drew no report').not.toBeNull();
    expect(ds.find, 'the drawer drew its record list instead of the report').not.toHaveBeenCalled();

    await emit({ objectName: '*' });
    expect(getByTestId('bus-control').textContent, 'control: the event never reached a subscriber').toBe('1');
    expect(ds.queryDataset, 'the drill report never re-read').toHaveBeenCalledTimes(2);
    await answer(ds, 2, 250);
    expect(document.querySelector('[data-testid="dataset-matrix"]')?.textContent).toContain('250');
    expect(document.querySelector('[data-testid="dataset-matrix"]'), 'the re-read remounted the report').toBe(matrix);

    await emit({ objectName: 'some_other_object' });
    expect(ds.queryDataset, 'a change to another object re-read the drill report').toHaveBeenCalledTimes(2);

    await emit({ objectName: 'deal' });
    expect(ds.queryDataset).toHaveBeenCalledTimes(3);
  });
});
