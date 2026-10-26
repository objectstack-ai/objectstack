/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Regression: a dataset-bound chart's aggregate MEASURE (e.g. `task_count`)
 * rendered as its raw field name in the legend/tooltip — even though the
 * dataset's `queryDataset()` response carries a human `label` ("Tasks") for
 * every measure field, and `buildChartSeries()` already resolves that label
 * when given a `fields` array (see chart-series.test.ts). `ObjectChart`'s
 * dataset-bound fetch path discarded `res.fields` before it ever reached
 * `buildChartSeries()`, so the lookup always fell back to the raw name.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 480, height: 320 }),
  };
});

import { ObjectChart } from './ObjectChart';

/**
 * objectui#4106 — answer ObjectChart's dataset-definition probe from a double.
 *
 * A `dataset`-bound chart resolves its category dimension's option colors by
 * first reading `GET /api/v1/meta/dataset/<dataset>` off the GLOBAL `fetch`
 * (ObjectChart.tsx:344) to learn the underlying object. Under happy-dom that
 * was a REAL request — 1 live escape per run from this file, failing
 * fire-and-forget into `connect ECONNREFUSED 127.0.0.1:3000` while the test
 * stayed green because the effect is best-effort by design.
 *
 * `{}` reproduces the failure's observable outcome exactly: with no `object`
 * on the definition the effect returns early having set no colors and no
 * dimension labels — the same state the swallowed rejection produced, and the
 * same single request. The measure-label assertion below reads `queryDataset`'s
 * `fields`, which this never touches. The two-hop path that a REAL definition
 * unlocks is covered in `ObjectChart.optionColors.test.tsx`.
 */
function installMetaFetchDouble(routes: Record<string, unknown> = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      calls.push(url);
      return { ok: true, json: async () => routes[url] ?? {} };
    }),
  );
  return calls;
}

let metaCalls: string[] = [];

beforeEach(() => {
  metaCalls = installMetaFetchDouble();
});

afterEach(() => {
  // Anything other than the dataset-definition probe is a NEW escape.
  expect(metaCalls.filter((u) => u !== '/api/v1/meta/dataset/showcase_task_metrics')).toEqual([]);
  vi.unstubAllGlobals();
  cleanup();
});

const makeDS = () => ({
  queryDataset: vi.fn().mockResolvedValue({
    rows: [{ status: 'todo', task_count: 3 }],
    fields: [
      { name: 'status', label: 'Status' },
      { name: 'task_count', label: 'Tasks' },
    ],
  }),
});

describe('ObjectChart — dataset-bound measure label resolution', () => {
  it('renders the resolved measure label ("Tasks"), not the raw field name ("task_count")', async () => {
    const ds = makeDS();
    const { container } = render(
      <ObjectChart
        schema={{
          type: 'object-chart',
          chartType: 'bar',
          dataset: 'showcase_task_metrics',
          dimensions: ['status'],
          values: ['task_count'],
        }}
        dataSource={ds}
      />,
    );

    await waitFor(() => expect(ds.queryDataset).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toContain('Tasks'));
    // Exclude the injected scoped-style <style> tag: it legitimately declares
    // a `--color-task_count` CSS custom property keyed by the raw field name
    // (harmless, invisible) — the regression this guards is the raw name
    // leaking into user-visible text (legend/tooltip), not into CSS var names.
    const visible = container.cloneNode(true) as HTMLElement;
    visible.querySelectorAll('style').forEach((el) => el.remove());
    expect(visible.textContent).not.toContain('task_count');
  });
});
