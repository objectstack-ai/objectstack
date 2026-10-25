/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10105 — `usePullToRefresh` arms on the element the ref points at
 * AFTER EACH COMMIT, not only on the element present at mount.
 *
 * The hook returns an object ref, so it cannot see when a consumer attaches
 * it. Consumers attach it late in practice: a view whose first commit is a
 * loading screen mounts its host only after the data arrives, and a refresh
 * that goes back through the loading screen mounts a NEW host. The hook used
 * to bind in an effect keyed only on its handlers and `enabled`, so it
 * missed both cases, and the gesture silently did nothing.
 *
 * `Host` below is the smallest consumer with that shape. The case that mounts
 * the host on the first commit is the control. It was green before the repair
 * and has to stay green, so a repair that disarms every consumer cannot pass.
 *
 * The gesture is the hook's own native event sequence (`touchstart` →
 * `touchmove` → `touchend`) on the element, because the listeners are what
 * this file is about. happy-dom does not build a `TouchList` from an init
 * object, so `touches` is attached by hand. The start point is y=10 because
 * the move handler ignores a falsy start point.
 *
 * Every gesture, including the ones that must reach nothing, starts with
 * `await act(async () => {})`. The hook binds in a passive effect, and a
 * gesture fired before that effect runs is lost whatever the hook does. So a
 * positive case would be flaky and a negative one would pass for the wrong
 * reason. Flushing cannot rescue the defect, because the old binding effect
 * did not re-run however often effects were flushed.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { usePullToRefresh } from '../usePullToRefresh';

afterEach(() => {
  cleanup();
});

function Host({
  ready,
  generation = 0,
  enabled = true,
  onRefresh,
}: {
  ready: boolean;
  generation?: number;
  enabled?: boolean;
  onRefresh: () => Promise<void>;
}) {
  const { ref, pullDistance } = usePullToRefresh<HTMLDivElement>({ onRefresh, enabled });
  if (!ready) return <p>Loading…</p>;
  // `key` forces a NEW host element when `generation` changes, which is what a
  // refresh through the loading screen does to a real consumer.
  return (
    <div key={generation} ref={ref} data-testid="host">
      {pullDistance > 0 ? <span data-testid="indicator">{pullDistance}</span> : null}
    </div>
  );
}

const touch = (type: string, clientY: number) => {
  const event = new Event(type, { bubbles: true });
  (event as unknown as { touches: Array<{ clientY: number }> }).touches = [{ clientY }];
  return event;
};

/** Pull 100px (past the default 80px threshold), wait for the indicator, release. */
async function pullAndRelease(host: HTMLElement) {
  await act(async () => {});
  fireEvent(host, touch('touchstart', 10));
  fireEvent(host, touch('touchmove', 110));
  await waitFor(() => expect(screen.getByTestId('indicator').textContent).toBe('100'));
  fireEvent(host, touch('touchend', 110));
}

describe('objectui#10105 — usePullToRefresh follows the element, not the mount', () => {
  it('control: a host present on the first commit arms and refreshes', async () => {
    const onRefresh = vi.fn(async () => {});
    render(<Host ready onRefresh={onRefresh} />);
    await pullAndRelease(screen.getByTestId('host'));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it('a host that mounts after a loading-screen first commit arms and refreshes', async () => {
    const onRefresh = vi.fn(async () => {});
    const { rerender } = render(<Host ready={false} onRefresh={onRefresh} />);
    expect(screen.queryByTestId('host')).toBeNull();
    rerender(<Host ready onRefresh={onRefresh} />);
    await pullAndRelease(screen.getByTestId('host'));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it('a REPLACED host is armed, and the detached one is released', async () => {
    const onRefresh = vi.fn(async () => {});
    const { rerender } = render(<Host ready generation={0} onRefresh={onRefresh} />);
    const first = screen.getByTestId('host');
    // Back through the loading screen, then a new host, as a refresh does.
    rerender(<Host ready={false} generation={0} onRefresh={onRefresh} />);
    rerender(<Host ready generation={1} onRefresh={onRefresh} />);
    const second = screen.getByTestId('host');
    expect(second, 'the host was not replaced').not.toBe(first);

    await pullAndRelease(second);
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));

    // The first element is detached. A gesture on it must reach nothing:
    // listeners left on it would call a handler for an element that is gone.
    await act(async () => {});
    fireEvent(first, touch('touchstart', 10));
    fireEvent(first, touch('touchmove', 110));
    fireEvent(first, touch('touchend', 110));
    expect(screen.queryByTestId('indicator')).toBeNull();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('under StrictMode, a host present at mount arms, and refreshes exactly once', async () => {
    // On MOUNT (not on updates), StrictMode runs every effect, runs its
    // cleanup, and runs it again. So the host has to be there at mount for
    // this case to test anything. The unmount effect releases the binding in
    // that simulated unmount, and the per-commit effect has to bind again. It
    // must not bind twice either: two bindings would call `onRefresh` twice
    // for one gesture.
    const onRefresh = vi.fn(async () => {});
    render(
      <React.StrictMode>
        <Host ready onRefresh={onRefresh} />
      </React.StrictMode>,
    );
    await pullAndRelease(screen.getByTestId('host'));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    await act(async () => {});
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('unmount releases the listeners', async () => {
    const onRefresh = vi.fn(async () => {});
    const { unmount } = render(<Host ready onRefresh={onRefresh} />);
    const host = screen.getByTestId('host');
    const removed = vi.spyOn(host, 'removeEventListener');
    unmount();
    const types = removed.mock.calls.map(([type]) => type).sort();
    expect(types).toEqual(['touchend', 'touchmove', 'touchstart']);
  });

  it('`enabled: false` does not arm; turning it on arms the host that is already there', async () => {
    const onRefresh = vi.fn(async () => {});
    const { rerender } = render(<Host ready enabled={false} onRefresh={onRefresh} />);
    const host = screen.getByTestId('host');
    await act(async () => {});
    fireEvent(host, touch('touchstart', 10));
    fireEvent(host, touch('touchmove', 110));
    fireEvent(host, touch('touchend', 110));
    expect(screen.queryByTestId('indicator')).toBeNull();
    expect(onRefresh).not.toHaveBeenCalled();

    rerender(<Host ready enabled onRefresh={onRefresh} />);
    await pullAndRelease(host);
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });
});

/**
 * Nested pull hosts: one gesture, one owner, the OUTERMOST armed host
 * (objectui#10105, the seat's ruling on the card).
 *
 * A touch on an inner host bubbles to an outer one, so both hooks receive it.
 * The inner one yields when an ARMED pull host is its ancestor. "Armed" is
 * what the second case checks: an outer host that exists but is disabled does
 * not take the gesture away from the inner one, and turning the outer off
 * after it was armed hands the gesture back. A marker left behind on unbind
 * would fail that case.
 */
function Inner({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const { ref, pullDistance } = usePullToRefresh<HTMLDivElement>({ onRefresh });
  return (
    <div ref={ref} data-testid="inner">
      {pullDistance > 0 ? <span data-testid="inner-indicator" /> : null}
    </div>
  );
}

function Nest({
  outerEnabled = true,
  onOuter,
  onInner,
}: {
  outerEnabled?: boolean;
  onOuter: () => Promise<void>;
  onInner: () => Promise<void>;
}) {
  const { ref, pullDistance } = usePullToRefresh<HTMLDivElement>({
    onRefresh: onOuter,
    enabled: outerEnabled,
  });
  return (
    <div ref={ref} data-testid="outer">
      {pullDistance > 0 ? <span data-testid="outer-indicator" /> : null}
      <Inner onRefresh={onInner} />
    </div>
  );
}

/** Pull 100px on `el` and wait until exactly `expectIndicator` shows, then release. */
async function pullOn(el: HTMLElement, expectIndicator: 'outer-indicator' | 'inner-indicator') {
  await act(async () => {});
  fireEvent(el, touch('touchstart', 10));
  fireEvent(el, touch('touchmove', 110));
  await waitFor(() => expect(screen.getByTestId(expectIndicator)).toBeTruthy());
  const indicators = [
    screen.queryByTestId('outer-indicator'),
    screen.queryByTestId('inner-indicator'),
  ].filter(Boolean);
  expect(indicators, 'one pull must draw exactly one indicator').toHaveLength(1);
  fireEvent(el, touch('touchend', 110));
}

describe('objectui#10105 — nested pull hosts: the outermost armed host owns the gesture', () => {
  it('a pull on the inner host is taken by the armed outer host: one indicator, one refresh', async () => {
    const onOuter = vi.fn(async () => {});
    const onInner = vi.fn(async () => {});
    render(<Nest onOuter={onOuter} onInner={onInner} />);
    await pullOn(screen.getByTestId('inner'), 'outer-indicator');
    await waitFor(() => expect(onOuter).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(onInner).not.toHaveBeenCalled();
  });

  it('a disabled outer host does not take the gesture, and disarming an armed one hands it back', async () => {
    const onOuter = vi.fn(async () => {});
    const onInner = vi.fn(async () => {});
    const { rerender } = render(<Nest outerEnabled={false} onOuter={onOuter} onInner={onInner} />);
    await pullOn(screen.getByTestId('inner'), 'inner-indicator');
    await waitFor(() => expect(onInner).toHaveBeenCalledTimes(1));

    rerender(<Nest outerEnabled onOuter={onOuter} onInner={onInner} />);
    await pullOn(screen.getByTestId('inner'), 'outer-indicator');
    await waitFor(() => expect(onOuter).toHaveBeenCalledTimes(1));

    rerender(<Nest outerEnabled={false} onOuter={onOuter} onInner={onInner} />);
    await pullOn(screen.getByTestId('inner'), 'inner-indicator');
    await waitFor(() => expect(onInner).toHaveBeenCalledTimes(2));
    expect(onOuter).toHaveBeenCalledTimes(1);
  });

  it('a pull on the outer host itself is the outer host\'s, as before', async () => {
    const onOuter = vi.fn(async () => {});
    const onInner = vi.fn(async () => {});
    render(<Nest onOuter={onOuter} onInner={onInner} />);
    await pullOn(screen.getByTestId('outer'), 'outer-indicator');
    await waitFor(() => expect(onOuter).toHaveBeenCalledTimes(1));
    expect(onInner).not.toHaveBeenCalled();
  });
});
