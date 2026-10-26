/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12554 — a host can draw the dashboard's "Refresh All" control
 * itself, while the renderer keeps the one auto-refresh timer.
 *
 * The console's dashboard page draws the button among its page header's
 * actions. It could not just drop `onRefresh` to stop the renderer drawing a
 * second one: the same handler arms the authored `refreshIntervalSeconds`
 * timer (objectui#11062). So the renderer takes one host option,
 * `onRefreshStateChange`: set, the renderer draws no button of its own and
 * reports the state of its one refresh implementation (`refreshing` and the
 * `handleRefresh` its button would call); unset, nothing changes.
 *
 * What this file pins, on the real `DashboardRenderer`:
 *   - with the option, no refresh button is drawn, and the report arrives on
 *     mount with `refreshing: false`;
 *   - the reported `handleRefresh` calls `onRefresh` once and reports the
 *     indicator on and then off, as the renderer's own button does;
 *   - the authored timer still runs `onRefresh`, and its runs are reported too;
 *   - `null` is reported with no `onRefresh`, and on unmount;
 *   - a host that keeps the report in state through an inline arrow renders a
 *     bounded number of times (the report is keyed on values, AGENTS.md #10);
 *   - the rows the button shared collapse when nothing else is in them, and
 *     the filter bar and the record-count badge stay;
 *   - CONTROL: the same mounts without the option draw the renderer's button.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import type { DashboardComponentSchema } from '@object-ui/types';
import { DashboardRenderer } from '../DashboardRenderer';

type RefreshState = Parameters<
  NonNullable<React.ComponentProps<typeof DashboardRenderer>['onRefreshStateChange']>
>[0];

function dashboard(extra: Record<string, unknown> = {}): DashboardComponentSchema {
  return {
    type: 'dashboard',
    name: 'ops',
    label: 'Delivery Operations',
    columns: 12,
    widgets: [],
    ...extra,
  } as unknown as DashboardComponentSchema;
}

const FILTERS = { dateRange: { field: 'created_at', defaultRange: 'last_90_days', allowCustomRange: true } };

const refreshButtons = () => screen.queryAllByRole('button', { name: 'Refresh dashboard' });

/** The latest report the host received. */
function last(report: ReturnType<typeof vi.fn>): RefreshState | undefined {
  const { calls } = report.mock;
  return calls.length ? (calls[calls.length - 1][0] as RefreshState) : undefined;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('DashboardRenderer onRefreshStateChange — the host draws Refresh All (objectui#12554)', () => {
  it('draws no refresh button, and reports the idle state on mount', () => {
    const report = vi.fn();
    render(<DashboardRenderer schema={dashboard()} onRefresh={vi.fn()} onRefreshStateChange={report} hideHeaderText />);

    expect(refreshButtons(), 'the renderer drew its own button beside the host one').toHaveLength(0);
    expect(report).toHaveBeenCalled();
    expect(last(report)?.refreshing).toBe(false);
    expect(typeof last(report)?.handleRefresh).toBe('function');
  });

  it('the reported handleRefresh calls onRefresh once and reports the indicator on, then off', () => {
    const onRefresh = vi.fn();
    const report = vi.fn();
    render(<DashboardRenderer schema={dashboard()} onRefresh={onRefresh} onRefreshStateChange={report} />);

    act(() => {
      last(report)!.handleRefresh();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(last(report)?.refreshing, 'the indicator was not reported on').toBe(true);

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(last(report)?.refreshing, 'the indicator was not reported off').toBe(false);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('the authored timer still runs onRefresh, and its run is reported', () => {
    const onRefresh = vi.fn();
    const report = vi.fn();
    render(
      <DashboardRenderer
        schema={dashboard({ refreshIntervalSeconds: 30 })}
        onRefresh={onRefresh}
        onRefreshStateChange={report}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(onRefresh, 'the timer stopped when the host took the button').toHaveBeenCalledTimes(1);
    expect(last(report)?.refreshing).toBe(true);

    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(onRefresh).toHaveBeenCalledTimes(3);
  });

  it('reports null with no onRefresh wired, and draws nothing', () => {
    const report = vi.fn();
    render(<DashboardRenderer schema={dashboard()} onRefreshStateChange={report} />);

    expect(report).toHaveBeenCalled();
    expect(last(report)).toBeNull();
    expect(refreshButtons()).toHaveLength(0);
  });

  it('reports null on unmount', () => {
    const report = vi.fn();
    const view = render(<DashboardRenderer schema={dashboard()} onRefresh={vi.fn()} onRefreshStateChange={report} />);
    expect(last(report)).not.toBeNull();

    view.unmount();
    expect(last(report)).toBeNull();
  });

  it('a host that stores the report through an inline arrow renders a bounded number of times', () => {
    let hostRenders = 0;
    function Host() {
      hostRenders += 1;
      const [state, setState] = React.useState<RefreshState>(null);
      return (
        <>
          <span data-testid="host-refreshing">{String(state?.refreshing)}</span>
          <DashboardRenderer schema={dashboard()} onRefresh={() => {}} onRefreshStateChange={(s) => setState(s)} />
        </>
      );
    }
    render(<Host />);

    expect(screen.getByTestId('host-refreshing').textContent).toBe('false');
    // Mount, then the one report. A report keyed on the callback's identity
    // would re-run on every host render and never settle.
    expect(hostRenders).toBeLessThanOrEqual(3);
  });

  it('collapses the console chrome row the button stood alone in', () => {
    const { container } = render(
      <DashboardRenderer
        schema={dashboard({ header: { showTitle: true } })}
        onRefresh={vi.fn()}
        onRefreshStateChange={vi.fn()}
        hideHeaderText
      />,
    );
    const root = container.firstElementChild!;
    expect(root.children.length, 'a row with nothing in it stayed above the widgets').toBe(0);
    expect(root.className).not.toContain('grid-rows-');
  });

  it('keeps the filter bar row, without the button', () => {
    const { container } = render(
      <DashboardRenderer schema={dashboard(FILTERS)} onRefresh={vi.fn()} onRefreshStateChange={vi.fn()} hideHeaderText />,
    );
    const root = container.firstElementChild!;
    expect(screen.getByTestId('dashboard-filter-bar')).toBeTruthy();
    expect(refreshButtons()).toHaveLength(0);
    expect(root.children.length).toBe(1);
    expect(root.className).toContain('grid-rows-[auto]');
  });

  it('keeps the record-count badge where the renderer draws it', () => {
    render(
      <DashboardRenderer schema={dashboard()} onRefresh={vi.fn()} recordCount={12} onRefreshStateChange={vi.fn()} hideHeaderText />,
    );
    expect(screen.getByText('12 records')).toBeTruthy();
    expect(refreshButtons()).toHaveLength(0);
  });

  describe('CONTROL: a host without the option', () => {
    it('gets the renderer-drawn button, alone in its row under the console chrome', () => {
      const { container } = render(
        <DashboardRenderer schema={dashboard({ header: { showTitle: true } })} onRefresh={vi.fn()} hideHeaderText />,
      );
      expect(refreshButtons()).toHaveLength(1);
      expect(container.firstElementChild!.children.length).toBe(1);
    });

    it('gets the renderer-drawn button in the filter bar row', () => {
      render(<DashboardRenderer schema={dashboard(FILTERS)} onRefresh={vi.fn()} hideHeaderText />);
      expect(refreshButtons()).toHaveLength(1);
    });
  });
});
