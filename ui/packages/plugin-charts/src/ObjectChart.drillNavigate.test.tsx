/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * `DrillDownConfig.target` on ObjectChart (objectui#3354).
 *
 * The shared `DrillDownConfig` promises three targets, and `DrillDownDrawer`
 * (plugin-dashboard) delivers all three for the table / pivot / metric widgets.
 * ObjectChart draws its OWN drawer and used to branch on `'dialog'` only, so
 * `target: 'navigate'` fell through to the default Sheet — silently identical
 * to `'drawer'`, even with a host navigation handler wired. These pins hold the
 * chart to the same contract:
 *
 *  - `'navigate'` + host handler → the host's list page, no drawer at all;
 *  - `'navigate'` without a host handler → the documented fallback to a drawer;
 *  - `'dialog'` / default `'drawer'` → unchanged.
 *
 * The chart renderer is mocked down to a click surface on purpose. What is
 * under test is ObjectChart's drill routing, not recharts' hit-testing — a real
 * segment click in jsdom would test the SVG geometry instead of the branch.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { DrillNavigationProvider } from '@object-ui/react';

vi.mock('./ChartRenderer', () => ({
  ChartRenderer: ({ onChartClick }: any) => (
    <button
      type="button"
      data-testid="fake-segment"
      onClick={() => onChartClick?.({ category: 'won', series: 'amount', value: 42 })}
    >
      segment
    </button>
  ),
}));

import { ObjectChart } from './ObjectChart';

/**
 * objectui#4106 — answer ObjectChart's option-color probe from a double.
 *
 * Any schema carrying `objectName` makes ObjectChart resolve the category
 * dimension's option colors, which reads `GET /api/v1/meta/object/<objectName>`
 * off the GLOBAL `fetch` (ObjectChart.tsx:352). Under happy-dom that is a REAL
 * request to the default origin, so this file fired 4 live requests per run —
 * one per test. The effect swallows the rejection by design (best-effort: a
 * failure just leaves the theme palette in place), which is why the suite
 * stayed green while stderr filled with `connect ECONNREFUSED 127.0.0.1:3000`.
 *
 * The `{}` answer reproduces the failed request's observable outcome EXACTLY:
 * `buildOptionColorMap(undefined)` returns null for a schema with no options,
 * which is the same state the rejection's catch branch set. No assertion below
 * changes meaning.
 *
 * Deliberately NOT a global error sink: it records every URL it is handed, so
 * an escape to some OTHER endpoint fails the `afterEach` guard instead of
 * vanishing into a swallowed rejection. The probe's own shape is asserted in
 * `ObjectChart.optionColors.test.tsx`.
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
  // Every request this file makes must be the option-color probe. Anything
  // else is a NEW escape to the real network — fail here rather than let it
  // fail open into stderr noise again.
  expect(metaCalls.filter((u) => u !== '/api/v1/meta/object/opportunity')).toEqual([]);
  vi.unstubAllGlobals();
  cleanup();
});

const schema = (drillDown: Record<string, unknown>) => ({
  type: 'object-chart' as const,
  chartType: 'bar' as const,
  objectName: 'opportunity',
  xAxisKey: 'stage',
  data: [{ stage: 'won', amount: 42 }],
  filter: { owner: 'me' },
  drillDown,
});

function renderChart(
  drillDown: Record<string, unknown>,
  openRecordList?: (objectName: string, filter?: Record<string, unknown>) => void,
) {
  return render(
    <DrillNavigationProvider value={{ openRecordList }}>
      <ObjectChart schema={schema(drillDown)} dataSource={{ find: async () => ({ data: [] }) }} />
    </DrillNavigationProvider>,
  );
}

/**
 * Which overlay the drill body landed in. Radix gives Sheet and Dialog the same
 * `role="dialog"`, so the two are told apart by the primitive's own positioning
 * classes: the side sheet is pinned to an edge (`inset-y-0`), the modal is
 * centre-translated (`translate-x-[-50%]`). Both come from
 * `packages/components/src/ui/*` — upstream shadcn files, not ours to churn.
 */
function drillSurface(): 'drawer' | 'dialog' {
  const body = screen.getByTestId('chart-drill-body');
  const surface = body.closest('[role="dialog"]');
  const cls = surface?.className ?? '';
  if (cls.includes('inset-y-0')) return 'drawer';
  if (cls.includes('translate-x-[-50%]')) return 'dialog';
  throw new Error(`drill body is in neither a sheet nor a dialog: "${cls}"`);
}

describe("ObjectChart — DrillDownConfig.target: 'navigate' (objectui#3354)", () => {
  it("navigates to the object's list page with the drill filter and renders no drawer", async () => {
    const openRecordList = vi.fn();
    renderChart({ enabled: true, target: 'navigate' }, openRecordList);

    fireEvent.click(screen.getByTestId('fake-segment'));

    // Widget filter ∧ click context — the same composition the drawer would have
    // used. The conjunction was always the intent this comment stated; since
    // objectui#8944 it is spelled by the repo's single filter sink
    // (`composeDrillFilter`) instead of by spreading the widget's filter into an
    // object literal, which only worked when that filter was the object arm.
    await waitFor(() =>
      expect(openRecordList).toHaveBeenCalledWith('opportunity', {
        $and: [{ owner: 'me' }, { stage: 'won' }],
      }),
    );
    expect(screen.queryByTestId('chart-drill-body')).toBeNull();
    // …and it does not fire again on subsequent renders.
    expect(openRecordList).toHaveBeenCalledTimes(1);
  });

  it("falls back to the drawer when the host provides no navigation (the JSDoc's promise)", async () => {
    renderChart({ enabled: true, target: 'navigate' }, undefined);

    fireEvent.click(screen.getByTestId('fake-segment'));

    await waitFor(() => expect(screen.getByTestId('chart-drill-body')).toBeTruthy());
    expect(drillSurface()).toBe('drawer');
  });

  it('still opens the in-place drawer for the default target, even with navigation wired', async () => {
    const openRecordList = vi.fn();
    renderChart({ enabled: true }, openRecordList);

    fireEvent.click(screen.getByTestId('fake-segment'));

    await waitFor(() => expect(screen.getByTestId('chart-drill-body')).toBeTruthy());
    expect(drillSurface()).toBe('drawer');
    expect(openRecordList).not.toHaveBeenCalled();
    // The header escape hatch is independent of `target` — it stays available.
    expect(screen.getByTestId('drill-open-in-list')).toBeTruthy();
  });

  it("still opens the dialog for target: 'dialog', even with navigation wired", async () => {
    const openRecordList = vi.fn();
    renderChart({ enabled: true, target: 'dialog' }, openRecordList);

    fireEvent.click(screen.getByTestId('fake-segment'));

    await waitFor(() => expect(screen.getByTestId('chart-drill-body')).toBeTruthy());
    expect(drillSurface()).toBe('dialog');
    expect(openRecordList).not.toHaveBeenCalled();
  });
});
