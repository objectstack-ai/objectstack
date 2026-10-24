/**
 * ObjectUI — useSchemaPersistence adapter-tracking pins (objectui#6745)
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * The hook keeps the live adapter in a ref so that `save`/`load`/`list`/
 * `remove` can be created once (`[]` deps) and still reach the newest adapter
 * at call time. That ref used to be written in the RENDER BODY:
 *
 *   const adapterRef = useRef(adapter ?? defaultAdapter.current);
 *   adapterRef.current = adapter ?? defaultAdapter.current;   // during render
 *
 * which `react-hooks/refs` flags: a render React discards or replays still
 * performed the write, so a save could be routed through an adapter belonging
 * to a render that never committed.
 *
 * Moving that write to `useEffect` would have been a BEHAVIOUR change, not a
 * cleanup — the assignment would land after paint, so anything calling `save()`
 * earlier in the same commit would reach the PREVIOUS adapter. It now lives in
 * `useInsertionEffect`, which runs in the mutation phase: before every layout
 * effect in the tree, before paint, and before any event handler can fire.
 *
 * These pins hold BOTH halves. Pin 2 is the one that discriminates: it fails
 * against a `useEffect` write (fires after paint) and against a
 * `useLayoutEffect` write (a child's layout effect runs before its parent's),
 * and passes only while the write happens no later than the mutation phase.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useLayoutEffect } from 'react';
import { render, renderHook, act } from '@testing-library/react';
import {
  useSchemaPersistence,
  type SchemaPersistenceAdapter,
} from '../useSchemaPersistence';

const SCHEMA = { type: 'page:list' } as const;
const KEY = 'objectui-schema:design-1';

/** An adapter that records every id handed to `save`, tagged with its name. */
function recordingAdapter(name: string, log: string[]): SchemaPersistenceAdapter {
  return {
    save: vi.fn(async (id: string) => {
      log.push(`${name}:${id}`);
      return id;
    }),
    load: vi.fn(async () => null),
    list: vi.fn(async () => []),
    delete: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('useSchemaPersistence — adapter tracking (#6745)', () => {
  // ---- pin 1: a changed `adapter` prop is what the next save reaches --------
  it('routes a save through the adapter from the latest render, not the first', async () => {
    const log: string[] = [];
    const first = recordingAdapter('first', log);
    const second = recordingAdapter('second', log);

    const hook = renderHook(({ adapter }) => useSchemaPersistence(adapter), {
      initialProps: { adapter: first },
    });

    await act(async () => {
      await hook.result.current.save('before-swap', { ...SCHEMA });
    });

    hook.rerender({ adapter: second });

    await act(async () => {
      await hook.result.current.save('after-swap', { ...SCHEMA });
    });

    expect(log).toEqual(['first:before-swap', 'second:after-swap']);
    expect(first.save).toHaveBeenCalledTimes(1);
    expect(second.save).toHaveBeenCalledTimes(1);
  });

  // ---- pin 2: the swap is in place BEFORE that commit's layout effects ------
  //
  // The child's layout effect runs inside the very commit that introduced the
  // new adapter, and before the parent's own layout effects. Whatever it calls
  // must already be routed to the new adapter — that is the timing the old
  // render-body write gave, and the reason this write is an insertion effect.
  it('has the new adapter in place before a child layout effect of the same commit', async () => {
    const log: string[] = [];
    const first = recordingAdapter('first', log);
    const second = recordingAdapter('second', log);

    type Save = (id: string, schema: Record<string, unknown>) => Promise<string | null>;

    function Child({ save, token }: { save: Save; token: string }) {
      // `save` is created once (`[]` deps) and never changes identity, so this
      // fires exactly once per adapter — on mount, and again in the commit that
      // swapped it. (Depending on a fresh closure instead re-fires on every
      // commit, and `save`'s own `setLoading` then loops the test forever.)
      useLayoutEffect(() => {
        void save(`from-layout-${token}`, { ...SCHEMA });
      }, [token, save]);
      return null;
    }

    function Host({ adapter, token }: { adapter: SchemaPersistenceAdapter; token: string }) {
      const persistence = useSchemaPersistence(adapter);
      return <Child token={token} save={persistence.save} />;
    }

    const view = render(<Host adapter={first} token="first" />);
    await act(async () => {});

    expect(log).toEqual(['first:from-layout-first']);

    await act(async () => {
      view.rerender(<Host adapter={second} token="second" />);
    });

    // Under a `useEffect` or `useLayoutEffect` write this second entry reads
    // `first:from-layout-second` — the call is routed to the stale adapter.
    expect(log).toEqual(['first:from-layout-first', 'second:from-layout-second']);
  });

  // ---- pin 3: the default localStorage adapter still works across renders ---
  //
  // The default adapter moved from `useRef(createLocalStorageAdapter())` (which
  // re-ran the factory on every render and threw the result away) to a
  // `useMemo`. It must still be the adapter a save lands in when no `adapter`
  // prop is given, including after a re-render.
  it('keeps persisting through the default adapter after a re-render', async () => {
    const hook = renderHook(() => useSchemaPersistence());

    hook.rerender();
    hook.rerender();

    await act(async () => {
      await hook.result.current.save('design-1', { ...SCHEMA });
    });

    const raw = localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).schema).toEqual({ ...SCHEMA });
  });

  // ---- pin 4: an explicit adapter takes over from the default --------------
  it('switches from the default adapter to an explicit one handed in later', async () => {
    const log: string[] = [];
    const explicit = recordingAdapter('explicit', log);

    const hook = renderHook(
      ({ adapter }: { adapter?: SchemaPersistenceAdapter }) => useSchemaPersistence(adapter),
      { initialProps: { adapter: undefined as SchemaPersistenceAdapter | undefined } },
    );

    await act(async () => {
      await hook.result.current.save('design-1', { ...SCHEMA });
    });
    expect(localStorage.getItem(KEY)).not.toBeNull();

    hook.rerender({ adapter: explicit });

    await act(async () => {
      await hook.result.current.save('design-2', { ...SCHEMA });
    });

    expect(log).toEqual(['explicit:design-2']);
    // The explicit adapter does not write localStorage, so the default's entry
    // is the only one there.
    expect(localStorage.getItem('objectui-schema:design-2')).toBeNull();
  });
});
