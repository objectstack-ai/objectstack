/**
 * ObjectUI — useOffline sync-config ref timing pins (objectui#6797)
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * `useOffline` kept `config.sync` in a ref written in the RENDER BODY, which is
 * what `react-hooks/refs` reported:
 *
 *   packages/react/src/hooks/useOffline.ts:262:3
 *     react-hooks/refs  Cannot update ref during render
 *
 * Who reads that ref, measured on this base: exactly ONE reader —
 * `sync`, at `const batchSize = syncConfigRef.current?.batchSize ?? queue.length`.
 * That made this hook the odd one of the three: `sync` was NOT a stable
 * callback (deps `[enabled, queue]`), so the ref was not protecting an identity
 * the way the other two hooks' refs are. What it protects is RETAINED closures:
 * a config-only change keeps the same `sync` alive, and the auto-sync effect
 * deliberately captures one and fires it 100ms later. Pin 1 is that exact
 * property — the ref's only job — and it is what rules out the alternative fix
 * of dropping the ref and adding `syncConfig?.batchSize` to `sync`'s deps.
 *
 * objectui#6818 then gave the QUEUE the same commit-phase mirror, which took
 * `queue` out of `sync`'s deps: `sync` is keyed `[enabled]` today and is stable
 * across queued mutations. Every pin below still measures what it measured —
 * a retained closure reading the newest `batchSize` — and pin 1 still fails
 * under the rejected `syncConfig?.batchSize`-in-deps alternative, because that
 * alternative is exactly what would make `sync` unstable again. The dep lists
 * quoted below are updated where they would otherwise mislead.
 *
 * The write now happens in `useInsertionEffect`. Pin 3 is the discriminating
 * one: the `batchSize` read is SYNCHRONOUS, before `sync`'s first `await`, so a
 * child layout effect of the same commit fails under BOTH `useEffect` and
 * `useLayoutEffect`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useLayoutEffect, useRef } from 'react';
import { render, renderHook, act, screen } from '@testing-library/react';
import { useOffline, type OfflineConfig, type OfflineResult } from '../useOffline';

function queueN(result: { current: OfflineResult }, n: number) {
  act(() => {
    for (let i = 0; i < n; i += 1) {
      result.current.queueMutation({ operation: 'create', resource: 'account', data: { i } });
    }
  });
}

/** Parent holds the hook; the child reaches `sync` from its own layout effect. */
function Harness({ config, trigger }: { config: OfflineConfig; trigger: number }) {
  const offline = useOffline(config);
  return (
    <>
      <span data-testid="pending">{offline.pendingCount}</span>
      <CommitPhaseCaller sync={offline.sync} trigger={trigger} />
      <Seeder queueMutation={offline.queueMutation} />
    </>
  );
}

function CommitPhaseCaller({ sync, trigger }: { sync: () => Promise<void>; trigger: number }) {
  // Fire EXACTLY once. On the base this pin was written against, `sync` drains
  // the queue, which re-renders and hands this effect a new `sync` (it was
  // keyed on `[enabled, queue]`), so an unguarded effect re-fires and drains
  // the queue batch-by-batch until it is empty — the end state is then 0
  // whatever `batchSize` the first call read, and the pin measures nothing
  // about timing. Measured: with no guard this test passed even with the ref
  // write moved to `useEffect`. The guard stays now that `sync` is stable
  // (objectui#6818): it is what keeps this pin honest if the deps move back.
  const fired = useRef(false);
  useLayoutEffect(() => {
    if (trigger > 0 && !fired.current) {
      fired.current = true;
      void sync();
    }
  }, [trigger, sync]);
  return null;
}

function Seeder({
  queueMutation,
}: {
  queueMutation: OfflineResult['queueMutation'];
}) {
  return (
    <button
      type="button"
      data-testid="seed"
      onClick={() => {
        for (let i = 0; i < 5; i += 1) {
          queueMutation({ operation: 'create', resource: 'account', data: { i } });
        }
      }}
    />
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('useOffline — sync config ref is refreshed in the commit, not in render (#6797)', () => {
  // ---- pin 1: a RETAINED sync closure reads the newest batchSize -----------
  // This is the ref's entire job. It also fails under the ref-free alternative
  // (`batchSize` in `sync`'s deps), which is why that alternative was rejected.
  it('lets an already-created sync closure use the batchSize of the latest render', async () => {
    const { result, rerender } = renderHook(
      ({ batchSize }: { batchSize: number }) => useOffline({ sync: { batchSize } }),
      { initialProps: { batchSize: 2 } },
    );

    queueN(result, 5);
    expect(result.current.pendingCount).toBe(5);

    const syncBefore = result.current.sync;
    rerender({ batchSize: 5 });
    // `sync` is keyed on [enabled]; it did not move, so the SAME closure
    // survived the config change. That is the precondition of this pin — and
    // the assertion still fails under the rejected alternative, which would put
    // `batchSize` in those deps.
    expect(result.current.sync).toBe(syncBefore);

    await act(async () => {
      await syncBefore();
    });

    expect(result.current.pendingCount).toBe(0);
  });

  // ---- pin 2: the baseline it replaces — old batchSize drains only its slice
  it('drains exactly batchSize mutations per sync', async () => {
    const { result } = renderHook(() => useOffline({ sync: { batchSize: 2 } }));

    queueN(result, 5);
    await act(async () => {
      await result.current.sync();
    });

    expect(result.current.pendingCount).toBe(3);
  });

  // ---- pin 3: DISCRIMINATING — a child layout effect of the SAME commit ----
  it('has the swap in place before a child layout effect of the same commit syncs', async () => {
    const { rerender } = render(<Harness config={{ sync: { batchSize: 2 } }} trigger={0} />);

    act(() => {
      screen.getByTestId('seed').click();
    });
    expect(screen.getByTestId('pending').textContent).toBe('5');

    await act(async () => {
      rerender(<Harness config={{ sync: { batchSize: 5 } }} trigger={1} />);
    });
    // The layout effect fires `sync()` and forgets it; `sync` awaits a real
    // `setTimeout(0)`, so let one macrotask through before reading the result.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    expect(screen.getByTestId('pending').textContent).toBe('0');
  });

  // ---- pin 4: no sync config at all still means "whole queue" --------------
  // `AppHeader.tsx` calls `useOffline()` with no argument, so `syncConfig` is
  // permanently `undefined` there; the `?? queue.length` fallback is its path.
  it('falls back to the whole queue when no sync config is supplied', async () => {
    const { result } = renderHook(() => useOffline());

    queueN(result, 4);
    await act(async () => {
      await result.current.sync();
    });

    expect(result.current.pendingCount).toBe(0);
  });
});
