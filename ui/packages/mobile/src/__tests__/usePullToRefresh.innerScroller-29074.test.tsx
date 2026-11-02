/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29074 — a pull starts only when every scroll box between the
 * touched node and the bound element sits at its top.
 *
 * The list binds the gesture to its root, which clips its body and never
 * scrolls; the rows scroll in a box inside it. The hook used to read only
 * the root's own `scrollTop`, which is always 0 there, so a downward drag
 * half-way down the list (the reader scrolling back up) drew the indicator
 * and refetched.
 *
 * `Host` is that shape: a bound root with an inner scroll box. The control
 * case, the inner box at its top, has to keep refreshing, so a repair that
 * disarms the gesture cannot pass. The gesture is the native event sequence
 * on the touched node, as `usePullToRefresh.lateHost-10105.test.tsx` fires it.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { usePullToRefresh } from '../usePullToRefresh';

afterEach(() => {
  cleanup();
});

function Host({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const { ref, pullDistance } = usePullToRefresh<HTMLDivElement>({ onRefresh });
  return (
    <div ref={ref} data-testid="host">
      {pullDistance > 0 ? <span data-testid="indicator">{pullDistance}</span> : null}
      <div data-testid="scroller" style={{ overflowY: 'auto', height: 100 }}>
        <div data-testid="row">row</div>
      </div>
    </div>
  );
}

const touch = (type: string, clientY: number) => {
  const event = new Event(type, { bubbles: true });
  (event as unknown as { touches: Array<{ clientY: number }> }).touches = [{ clientY }];
  return event;
};

async function drag(node: HTMLElement) {
  await act(async () => {});
  fireEvent(node, touch('touchstart', 10));
  fireEvent(node, touch('touchmove', 110));
}

describe('usePullToRefresh with an inner scroll box (objectstack#29074)', () => {
  it('control: the inner box at its top, a downward drag on a row pulls and refreshes', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<Host onRefresh={onRefresh} />);
    await drag(screen.getByTestId('row'));
    await waitFor(() => expect(screen.getByTestId('indicator').textContent).toBe('100'));
    fireEvent(screen.getByTestId('row'), new Event('touchend', { bubbles: true }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it('the inner box scrolled down: the same drag is a scroll, with no indicator and no refresh', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<Host onRefresh={onRefresh} />);
    const scroller = screen.getByTestId('scroller');
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: 600 });

    await drag(screen.getByTestId('row'));
    await act(async () => {});
    expect(screen.queryByTestId('indicator')).toBeNull();
    fireEvent(screen.getByTestId('row'), new Event('touchend', { bubbles: true }));
    await act(async () => {});
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('a touch outside the inner box reads only the boxes it is in', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<Host onRefresh={onRefresh} />);
    Object.defineProperty(screen.getByTestId('scroller'), 'scrollTop', { configurable: true, value: 600 });

    // The touch lands on the host itself, above the scrolled box.
    await drag(screen.getByTestId('host'));
    await waitFor(() => expect(screen.getByTestId('indicator').textContent).toBe('100'));
  });
});
