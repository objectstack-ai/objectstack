/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression: dashboard bar charts render EMPTY on first mount and only draw
 * bars after an unrelated re-render (theme toggle / resize).
 *
 * Root cause: Recharts' entrance animation is a requestAnimationFrame tween that
 * starts at height 0; when the chart mounts while its react-grid-layout box is
 * still settling, that tween is interrupted before it advances and the bars stay
 * stuck at 0. `ChartContainer` fixes this by re-mounting the chart ONCE — via a
 * `settleNonce` keyed on the ResponsiveContainer — after the ResizeObserver
 * reports that size changes have stopped at a positive box, so the entrance
 * animation replays in a quiet window.
 *
 * These tests drive a controllable ResizeObserver to prove:
 *  1. a settled, non-zero box triggers exactly one clean re-mount, and
 *  2. a 0×0 (headless) box never re-mounts — so real DOM-less tests are
 *     unaffected and there is no re-mount loop.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

// A ResizeObserver we can trigger by hand. Only one is created per ChartContainer.
let roCallback: ResizeObserverCallback | null = null;
class ControllableResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    roCallback = cb;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

const fireResize = (width: number, height: number) => {
  act(() => {
    roCallback?.(
      [{ contentRect: { width, height } } as ResizeObserverEntry],
      null as unknown as ResizeObserver,
    );
  });
};

// ResponsiveContainer measures 0×0 under happy-dom, so replace it with a
// passthrough. Keying it (as ChartContainer does) re-mounts this subtree — which
// is exactly what we assert via the child's mount counter.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => children,
  };
});

import { ChartContainer } from './ChartContainerImpl';

let mountCount = 0;
function MountProbe() {
  React.useEffect(() => {
    mountCount += 1;
  }, []);
  return <div data-testid="probe" />;
}

let originalRO: typeof ResizeObserver | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  roCallback = null;
  mountCount = 0;
  originalRO = globalThis.ResizeObserver;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ControllableResizeObserver;
});

afterEach(() => {
  cleanup();
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = originalRO;
  vi.useRealTimers();
});

describe('ChartContainer — settle re-mount (dashboard-chart-empty-first-render)', () => {
  it('re-mounts the chart once after the container settles at a non-zero size', () => {
    act(() => {
      render(
        <ChartContainer config={{}}>
          <MountProbe />
        </ChartContainer>,
      );
    });
    expect(mountCount).toBe(1); // initial mount (settleNonce = 0)

    // The grid settles: a positive box, then no further changes.
    fireResize(320, 240);
    act(() => {
      vi.advanceTimersByTime(100); // debounce window elapses
    });

    // Exactly one clean re-mount → the Recharts entrance animation replays.
    expect(mountCount).toBe(2);
  });

  it('debounces mid-settle resizes into a single re-mount', () => {
    act(() => {
      render(
        <ChartContainer config={{}}>
          <MountProbe />
        </ChartContainer>,
      );
    });
    expect(mountCount).toBe(1);

    // Several resizes arrive faster than the debounce while the grid settles.
    fireResize(100, 200);
    act(() => vi.advanceTimersByTime(40));
    fireResize(280, 220);
    act(() => vi.advanceTimersByTime(40));
    fireResize(320, 240);
    act(() => vi.advanceTimersByTime(100)); // now let it settle

    expect(mountCount).toBe(2); // still only one re-mount, not one per resize
  });

  it('never re-mounts under a 0×0 (headless) layout', () => {
    act(() => {
      render(
        <ChartContainer config={{}}>
          <MountProbe />
        </ChartContainer>,
      );
    });
    expect(mountCount).toBe(1);

    fireResize(0, 0); // happy-dom / jsdom report no layout
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(mountCount).toBe(1); // no re-mount, no loop
  });

  // #2756: dashboard charts render with `isAnimationActive={false}`, so there is
  // no entrance-animation tween to heal. `disableSettleRemount` must fully
  // suppress the settle re-mount — even at a positive, stable box — so the first
  // paint is never followed by a needless ResponsiveContainer reflow.
  it('never re-mounts when disableSettleRemount is set, even after settling at a non-zero box', () => {
    act(() => {
      render(
        <ChartContainer config={{}} disableSettleRemount>
          <MountProbe />
        </ChartContainer>,
      );
    });
    expect(mountCount).toBe(1);

    // A real, settled positive box would normally trigger exactly one re-mount…
    fireResize(320, 240);
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // …but the flag opts out of it entirely: the observer never even armed.
    expect(mountCount).toBe(1);
    expect(roCallback).toBeNull(); // no ResizeObserver was created
  });
});
