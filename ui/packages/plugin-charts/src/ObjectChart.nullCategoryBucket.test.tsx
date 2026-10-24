/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#4466 — the null bucket reaches a REAL dataset-bound `ObjectChart`,
 * with its label taken from the i18n channel.
 *
 * `AdvancedChartImpl.nullCategoryBucket.test.tsx` pins the transform → renderer
 * seam; this pins the wiring on the consumer side, which is the half a shared
 * fix can silently miss: `@object-ui/core` is React-free and cannot read the
 * locale bundle, so it applies its English floor unless the renderer passes the
 * resolved label down. Nothing else fails when that argument goes missing — the
 * chart still draws a bar, just never a translated one.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { NULL_CATEGORY_LABEL } from '@object-ui/core';

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
 * A dataset-bound chart probes `GET /api/v1/meta/dataset/<name>` off the GLOBAL
 * fetch before it can resolve option colours. `{}` answers it without a live
 * request — see the same double, and the reasoning behind it, in
 * `ObjectChart.datasetMeasureLabel.test.tsx` (objectui#4106).
 */
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

/** The card's own first-boot shape: audit events written with `user_id = NULL`. */
const makeDS = (rows: Array<Record<string, unknown>>) => ({
  queryDataset: vi.fn().mockResolvedValue({
    rows,
    fields: [
      { name: 'user_id', label: 'User' },
      { name: 'event_count', label: 'Events' },
    ],
  }),
});

const renderChart = (ds: ReturnType<typeof makeDS>) =>
  render(
    <ObjectChart
      schema={{
        type: 'object-chart',
        chartType: 'bar',
        dataset: 'sys_audit_events_by_user',
        dimensions: ['user_id'],
        values: ['event_count'],
        isAnimationActive: false,
      }}
      dataSource={ds}
    />,
  );

describe('ObjectChart — dataset-bound null-keyed group (objectui#4466)', () => {
  it('draws the null group as a labelled bucket instead of an empty axis', async () => {
    const ds = makeDS([{ user_id: null, event_count: 50 }]);
    const { container } = renderChart(ds);

    await waitFor(() => expect(ds.queryDataset).toHaveBeenCalled());
    // Pre-fix: `.recharts-bar` = 1 with `.recharts-bar-rectangle` = 0 — an axis
    // frame, gridlines and no mark, for a server response of 50 real events.
    await waitFor(() =>
      expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBe(1),
    );
    expect(container.textContent).toContain(NULL_CATEGORY_LABEL);
  });

  it('keeps the dominant null group when a named group is present too', async () => {
    const ds = makeDS([
      { user_id: null, event_count: 51 },
      { user_id: 'Dev Admin', event_count: 2 },
    ]);
    const { container } = renderChart(ds);

    await waitFor(() => expect(ds.queryDataset).toHaveBeenCalled());
    // Pre-fix this was ONE bar: 51 of 53 events silently dropped.
    await waitFor(() =>
      expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBe(2),
    );
    expect(container.textContent).toContain(NULL_CATEGORY_LABEL);
    expect(container.textContent).toContain('Dev Admin');
  });

  it('renders no bucket bar for a genuinely empty result set', async () => {
    const ds = makeDS([]);
    const { container } = renderChart(ds);

    await waitFor(() => expect(ds.queryDataset).toHaveBeenCalled());
    expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBe(0);
    expect(container.textContent).not.toContain(NULL_CATEGORY_LABEL);
  });
});
