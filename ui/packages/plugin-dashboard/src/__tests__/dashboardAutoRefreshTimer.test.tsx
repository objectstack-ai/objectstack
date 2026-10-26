/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The dashboard auto-refresh timer FIRES, on both mount points (objectui#8820).
 *
 * ## Why the assertion is a call count
 *
 * When this file was written, every other test for `refreshIntervalSeconds`
 * pinned a DECLARATION: that `inputs` publishes the key, that the config panel
 * carries a field for it, that a locale has a label for it. None of those goes
 * red if the timer never runs. So the claim here is `onRefresh` being CALLED, a counted number of
 * times, after the fake time the fixture's own period asks for, on real
 * mounted components. Nothing spies on `setInterval` to prove firing: a test
 * that asserted `setInterval` was called with `30000` would stay green if the
 * callback it scheduled never reached `onRefresh`.
 *
 * ## Both mount points, deliberately
 *
 * `DashboardGridLayout` and `DashboardRenderer` each carried their own copy of
 * this timer until objectui#8820 moved both onto `useDashboardAutoRefresh`.
 * Each component is mounted and driven on its own, so a surface that stops
 * wiring the hook fails under its own name. ⛔ Do not collapse the cases into
 * one parameterised case over the hook: the hook working is not the claim; the
 * claim is that both components still wire it.
 *
 * The last case of each block is the de-duplication pin: it goes red for a
 * surface that carries its own timer instead of calling the shared hook.
 *
 * ## The forced memo discard (objectui#11004)
 *
 * AGENTS.md #10: an interval keyed on a `useCallback` identity re-arms, and
 * loses its phase, whenever React throws that memo away. React does not do so
 * on its own in this tree, so a case that merely re-renders passes on the
 * defect and on the fix alike. The phase-under-identity-change case therefore
 * FORCES a discard, with the module-level `react` proxy below. It is the same
 * technique as `providerCtxIdentity.discarded.test.tsx` in `packages/permissions`,
 * which says why a `vi.spyOn` on the module namespace cannot do it. The proxy
 * is inert unless a case arms it, so every other case runs on plain React.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import type { DashboardComponentSchema } from '@object-ui/types';
import { DashboardGridLayout } from '../DashboardGridLayout';
import { DashboardRenderer } from '../DashboardRenderer';
import { useDashboardAutoRefresh } from '../useDashboardAutoRefresh';

const memoProxy = vi.hoisted(() => ({ armed: false, epoch: 0 }));

vi.mock('react', async (importOriginal) => {
  // `<any>` as in the sibling pins: a precise module type makes the real
  // hooks' deps parameter `DependencyList`, which the patched signatures below
  // cannot satisfy.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = await importOriginal<any>();
  const realUseMemo = actual.useMemo;
  const realUseCallback = actual.useCallback;
  const patchedUseMemo = (factory: () => unknown, deps?: unknown[]) =>
    memoProxy.armed && Array.isArray(deps)
      ? realUseMemo(factory, [...deps, memoProxy.epoch])
      : realUseMemo(factory, deps);
  const patchedUseCallback = (fn: unknown, deps?: unknown[]) =>
    memoProxy.armed && Array.isArray(deps)
      ? realUseCallback(fn, [...deps, memoProxy.epoch])
      : realUseCallback(fn, deps);
  return {
    ...actual,
    useMemo: patchedUseMemo,
    useCallback: patchedUseCallback,
    default: {
      ...(actual.default ?? actual),
      useMemo: patchedUseMemo,
      useCallback: patchedUseCallback,
    },
  };
});

/** Put every memo and callback mounted from now on under this file's control. */
function armDiscardProxy(): void {
  memoProxy.armed = true;
}
/** Throw away every armed cache: one discard event, on demand. */
function discardNow(): void {
  memoProxy.epoch += 1;
}

// The real hook, wrapped so each surface's call to it can be observed. The
// timer under test is still the real one.
vi.mock('../useDashboardAutoRefresh', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../useDashboardAutoRefresh')>();
  return { ...actual, useDashboardAutoRefresh: vi.fn(actual.useDashboardAutoRefresh) };
});

const sharedHook = vi.mocked(useDashboardAutoRefresh);

/** The `handleRefresh` identity the hook returned on its latest render. */
function latestHandleRefresh(): unknown {
  const { results } = sharedHook.mock;
  const last = results[results.length - 1];
  return last?.type === 'return' ? last.value.handleRefresh : undefined;
}

interface SurfaceProps {
  schema: DashboardComponentSchema;
  onRefresh?: () => void;
}

/** The two components under test, each named, so a failure says which one. */
const SURFACES: ReadonlyArray<readonly [string, React.ComponentType<SurfaceProps>]> = [
  ['DashboardGridLayout', DashboardGridLayout],
  ['DashboardRenderer', DashboardRenderer],
];

const dash = (root: Record<string, unknown>): DashboardComponentSchema =>
  ({ type: 'dashboard', name: 'ops', widgets: [], ...root }) as unknown as DashboardComponentSchema;

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  sharedHook.mockClear();
});

afterEach(() => {
  cleanup();
  memoProxy.armed = false;
  vi.useRealTimers();
});

/** Mount `Surface` with `schema`, run `ms` of fake time, report the call count. */
function refreshesWithin(
  Surface: React.ComponentType<SurfaceProps>,
  schema: DashboardComponentSchema,
  ms: number,
): number {
  const onRefresh = vi.fn();
  render(<Surface schema={schema} onRefresh={onRefresh} />);
  // Nothing may have fired yet: a timer that ran on mount would be a
  // different bug, and this is the control for it.
  expect(onRefresh, 'refreshed before its first period elapsed').not.toHaveBeenCalled();
  advance(ms);
  return onRefresh.mock.calls.length;
}

/** Pending fake timers right after mounting `Surface` on a clean clock. */
function timersArmedOnMount(
  Surface: React.ComponentType<SurfaceProps>,
  schema: DashboardComponentSchema,
  onRefresh?: () => void,
): number {
  vi.clearAllTimers();
  const view = render(<Surface schema={schema} onRefresh={onRefresh} />);
  const pending = vi.getTimerCount();
  view.unmount();
  return pending;
}

// `_name` only feeds the `%s` in the title: the run output has to say WHICH
// surface failed, since the two blocks are otherwise identical.
describe.each(SURFACES)('%s: the auto-refresh timer fires (objectui#8820)', (_name, Surface) => {
  it('fires every `refreshIntervalSeconds` seconds', () => {
    // 30s period, 95s of time: three firings. The COUNT, not merely "was
    // called", is what separates a running interval from a one-shot: a
    // `setTimeout` mistaken for a `setInterval` returns 1 here.
    expect(refreshesWithin(Surface, dash({ refreshIntervalSeconds: 30 }), 95_000)).toBe(3);
  });

  it('does not start when no period is authored', () => {
    expect(refreshesWithin(Surface, dash({}), 95_000)).toBe(0);
  });

  it.each([0, -30])('does not start when the period is %d', (seconds) => {
    // `0` is an authored value meaning "off"; a negative one is off as well.
    expect(refreshesWithin(Surface, dash({ refreshIntervalSeconds: seconds }), 95_000)).toBe(0);
  });

  it('does not read the retired `refreshInterval` spelling', () => {
    // The spec's `DashboardSchema` refuses this key by name, so a renderer
    // fallback for it would be a second, unsanctioned contract (AGENTS.md #0.1).
    expect(refreshesWithin(Surface, dash({ refreshInterval: 30 }), 95_000)).toBe(0);
  });

  it('arms no interval without an `onRefresh` host handler', () => {
    const baseline = timersArmedOnMount(Surface, dash({}), vi.fn());
    const wired = timersArmedOnMount(Surface, dash({ refreshIntervalSeconds: 30 }), vi.fn());
    const unwired = timersArmedOnMount(Surface, dash({ refreshIntervalSeconds: 30 }));
    // The control: with a handler, the same period arms exactly one timer
    // more than no period does, so the count below can see an interval.
    expect(wired, 'control: a wired handler arms one interval').toBe(baseline + 1);
    expect(unwired, 'an interval was armed with no handler to call').toBe(baseline);
    // And the unwired surface survives the time passing.
    render(<Surface schema={dash({ refreshIntervalSeconds: 30 })} />);
    expect(() => advance(95_000)).not.toThrow();
  });

  it('stops when the dashboard unmounts', () => {
    const onRefresh = vi.fn();
    const view = render(
      <Surface schema={dash({ refreshIntervalSeconds: 30 })} onRefresh={onRefresh} />,
    );
    advance(30_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    view.unmount();
    advance(300_000);
    expect(onRefresh, 'the interval outlived the component').toHaveBeenCalledTimes(1);
  });

  it('re-arms on a changed period: the old interval is cleared, the new period used', () => {
    const onRefresh = vi.fn();
    const view = render(
      <Surface schema={dash({ refreshIntervalSeconds: 30 })} onRefresh={onRefresh} />,
    );
    advance(30_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    view.rerender(<Surface schema={dash({ refreshIntervalSeconds: 60 })} onRefresh={onRefresh} />);
    // Re-armed at 30s with a 60s period: the next firing is at 90s. A 30s
    // interval that survived the change would fire at 60s.
    advance(59_000);
    expect(onRefresh, 'the old 30s interval survived the change').toHaveBeenCalledTimes(1);
    advance(1_000);
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it('keeps its phase across a re-render that repeats the same period', () => {
    const onRefresh = vi.fn();
    const view = render(
      <Surface schema={dash({ refreshIntervalSeconds: 30 })} onRefresh={onRefresh} />,
    );
    advance(20_000);
    // A new schema object with the same period: the timer keys on the value,
    // so it is not restarted and still fires at 30s rather than at 50s.
    view.rerender(<Surface schema={dash({ refreshIntervalSeconds: 30 })} onRefresh={onRefresh} />);
    advance(10_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('calls the current `onRefresh` after the host swaps it, never the old one', () => {
    const first = vi.fn();
    const second = vi.fn();
    const schema = dash({ refreshIntervalSeconds: 30 });
    const view = render(<Surface schema={schema} onRefresh={first} />);
    advance(30_000);
    view.rerender(<Surface schema={schema} onRefresh={second} />);
    advance(60_000);
    expect(first, 'a stale handler kept firing').toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('keeps its phase when a handler identity changes at an equal period (objectui#11004)', () => {
    const first = vi.fn();
    const second = vi.fn();
    const schema = dash({ refreshIntervalSeconds: 30 });
    // Armed before the mount, so every memo carries the epoch from its first
    // render and a discard reads as a changed dependency, not a resized list.
    armDiscardProxy();
    const view = render(<Surface schema={schema} onRefresh={first} />);

    // 1. React discards its memos mid-period. Period and host handler are
    //    unchanged, so the only thing that moves is `handleRefresh`'s identity.
    advance(20_000);
    const beforeDiscard = latestHandleRefresh();
    discardNow();
    view.rerender(<Surface schema={schema} onRefresh={first} />);
    // The control: the discard reached the hook. Without it, a proxy that
    // patched nothing would leave the assertion below green for no reason.
    expect(beforeDiscard, 'control: the hook returned a handler').toBeTypeOf('function');
    expect(latestHandleRefresh(), 'control: the forced discard did not reach the hook').not.toBe(
      beforeDiscard,
    );
    // Still due at 30s. A re-armed interval would fire at 50s instead.
    advance(10_000);
    expect(first, 'a discarded memo re-armed the interval').toHaveBeenCalledTimes(1);

    // 2. The host passes a new handler identity mid-period, same period.
    advance(20_000);
    view.rerender(<Surface schema={schema} onRefresh={second} />);
    // Due at 60s. A re-armed interval would fire at 80s instead.
    advance(10_000);
    expect(second, 'a new host handler identity re-armed the interval').toHaveBeenCalledTimes(1);
    expect(first, 'the old handler ran after the swap').toHaveBeenCalledTimes(1);
  });

  it('takes its timer from the shared `useDashboardAutoRefresh` hook', () => {
    const onRefresh = vi.fn();
    render(<Surface schema={dash({ refreshIntervalSeconds: 30 })} onRefresh={onRefresh} />);
    expect(sharedHook).toHaveBeenCalledWith(
      expect.objectContaining({ refreshIntervalSeconds: 30 }),
      onRefresh,
    );
  });
});
