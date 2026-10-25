/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7231 — `reload()`'s `finally` must belong to the CURRENT reload.
 *
 * `reload()` sequences concurrent runs with `reloadSeqRef` and guards every
 * result write with `isCurrent()` (`setData` on three branches, `setError` on
 * the error branch). The `finally` used to carry no guard, so a SUPERSEDED
 * reload still flipped `loading` / `refreshing` off — clearing the loading
 * placeholder while the fresh query was still in flight. The user saw an
 * empty chart: placeholder gone, no rows arrived yet.
 *
 * Note which ordering produces it: NOT an exotic out-of-order response, but
 * the plain in-issue-order one. The stale reload merely has to FINISH FIRST,
 * which is the ordinary case whenever a second reload is issued while the
 * first is still in flight. The out-of-order case (fresh finishes first) is
 * the one the pre-existing `setData` guard already covered, and it is kept
 * below as the control.
 *
 * The guard shape matters, hence the third case. The flags are per-MODE
 * (in place → `refreshing`, otherwise `loading`; a silent reload is always in
 * place), so a `finally` that clears
 * only its own mode's flag when current leaks the other one: a silent reload
 * superseded by a non-silent one would never clear `refreshing`, leaving the
 * toolbar's refresh button stuck busy for the life of the component. What
 * makes clearing BOTH correct is that "I am current AND I am finishing"
 * means nothing is in flight any more — a newer reload would have made this
 * one stale, and an older one has no claim on the flags.
 *
 * Scope: this is the reload guard only. The overlapping-reload pairs it
 * covers include the toolbar refresh and the write-readback paths, where two
 * reloads legitimately overlap and no schema gating is involved — see the
 * card for why this must not be folded into the gating work.
 *
 * ⚠️ HOW THE OVERLAP IS PRODUCED changed with objectui#7225's gating, and the
 * property under test did not. This file used to generate its two in-flight
 * reloads out of the gantt's DUPLICATE mount query: `getObjectSchema` resolved,
 * re-keyed `reload`, and issued a second `find` while the first was still
 * pending — so every case opened with
 * `expect(find.mock.calls.length).toBe(2)`. That duplicate is exactly what
 * objectui#7225 ask 2 removed: the record query is now GATED on the settled
 * schema, so a mount issues ONE `find`, and a test that waits for two would
 * wait forever.
 *
 * So the overlap is now generated from a pair that is real, is the reason the
 * guard exists, and is untouched by gating: a SILENT toolbar refresh
 * superseded by a non-silent filter-change reload. That is what case 3 always
 * used; cases 1 and 2 now use it too. Not one assertion about the guard has
 * been weakened — the orderings (stale-first, fresh-first), the flags and the
 * outcomes are the same. The `finally` guard itself is not modified by that
 * card or this one.
 *
 * ⚠️ …and it changed again with objectui#7237 (ruling A′). A filter change
 * on a chart that has already PAINTED now refreshes in place: it sets
 * `refreshing`, not `loading`, and never swaps in the placeholder. So "a
 * toolbar refresh superseded by a filter change" no longer holds `loading` at
 * all, and the cases that asserted the placeholder over it were asserting the
 * teardown that ruling removed. The guard is unchanged; the pairs that still
 * put each flag in play are these:
 *
 *   - `loading`: two NON-silent reloads, i.e. a query change BEFORE the first
 *     paint (the mount's load superseded by it). Case 1.
 *   - `refreshing` held by two runs: the toolbar refresh superseded by an
 *     in-place filter change AFTER the paint. Case 1b, the post-paint twin of
 *     case 1, and case 2, the fresh-first control.
 *   - the mixed-mode pair case 3 needs (a silent run superseded by a
 *     non-silent one): only before the first paint, where an invalidation
 *     reload (silent) is overtaken by a query change (non-silent).
 *
 * Each assertion about the guard is kept, and each case still fails with the
 * `finally` guard removed or narrowed to its own mode.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notifyDataChanged } from '@object-ui/react';
import { ObjectGantt } from './ObjectGantt';
import type { DataSource } from '@object-ui/types';

let instanceSeq = 0;

// Probe stand-in: the real chart is irrelevant here, but `refreshing` is not —
// cases 1b and 3 read it back off the DOM. The instance id (a `useState`
// initializer, once per mount) is what shows the post-paint pair stays in
// place.
vi.mock('./GanttView', () => ({
  GanttView: ({ tasks, onRefresh, refreshing }: any) => {
    const [id] = React.useState(() => ++instanceSeq);
    return (
      <div data-testid="gantt-view" data-instance={id} data-refreshing={String(!!refreshing)}>
        {tasks.map((t: any) => (
          <div key={t.id} data-testid="gantt-task">{t.title}</div>
        ))}
        <button data-testid="gv-refresh" onClick={() => onRefresh?.()}>refresh</button>
      </div>
    );
  },
}));

beforeEach(() => {
  instanceSeq = 0;
});

const PLACEHOLDER = 'Loading Gantt chart...';

const ROWS_A = [
  { id: '1', name: 'From the stale query', start_date: '2024-01-01', end_date: '2024-01-05' },
];
const ROWS_B = [
  { id: '2', name: 'From the fresh query', start_date: '2024-02-01', end_date: '2024-02-05' },
];

const OBJECT_SCHEMA = {
  fields: {
    name: { type: 'text' },
    start_date: { type: 'date' },
    end_date: { type: 'date' },
  },
};

const GANTT_CONFIG = {
  titleField: 'name',
  startDateField: 'start_date',
  endDateField: 'end_date',
};

function schemaWith(filter?: unknown): any {
  return {
    type: 'gantt',
    gantt: GANTT_CONFIG,
    data: { provider: 'object', object: 'tasks' },
    ...(filter === undefined ? {} : { filter }),
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * A data source whose every `find()` hands back a promise the test resolves
 * by hand, so reload N and reload N+1 can be held in flight together and
 * completed in either order. `getObjectSchema` resolves immediately, which is
 * what opens the gate and lets the mount's single `find()` go out.
 */
function makeDeferredDataSource() {
  const finds: Deferred<any>[] = [];
  const dataSource = {
    find: vi.fn(() => {
      const d = deferred<any>();
      finds.push(d);
      return d.promise;
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
  } as unknown as DataSource;
  return { dataSource, finds };
}

/** Settle one held `find()` and let React flush the resulting commits. */
async function settle(d: Deferred<any>, rows: unknown[]) {
  await act(async () => {
    d.resolve({ data: rows });
    await Promise.resolve();
  });
}

/** Let pending microtasks/effects run without resolving anything. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * AFTER the paint: two reloads in flight at once — a SILENT toolbar refresh
 * (`finds[1]`) superseded by an IN-PLACE filter-change reload (`finds[2]`).
 * Both hold `refreshing` (objectui#7237: a query change on a painted chart
 * refreshes in place), so this pair puts that flag in play, and the chart must
 * stay mounted throughout.
 *
 * The mount issues exactly ONE `find` since objectui#7225's gate; that single
 * assertion is also this file's live control on the gate, because a
 * regression back to the duplicate query makes `toBe(1)` fail here loudly
 * instead of silently restoring the old overlap generator.
 */
async function paintThenOverlap(
  dataSource: DataSource,
  finds: Deferred<any>[],
  rerender: (ui: React.ReactElement) => void,
) {
  await waitFor(() => expect((dataSource.find as any).mock.calls.length).toBe(1));
  await settle(finds[0], ROWS_A);
  await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());

  fireEvent.click(screen.getByTestId('gv-refresh'));
  await waitFor(() => expect((dataSource.find as any).mock.calls.length).toBe(2));
  await waitFor(() =>
    expect(screen.getByTestId('gantt-view').getAttribute('data-refreshing')).toBe('true'),
  );

  rerender(<ObjectGantt schema={schemaWith({ status: 'open' })} dataSource={dataSource} />);
  await waitFor(() => expect((dataSource.find as any).mock.calls.length).toBe(3));
}

/**
 * BEFORE the paint: the mount's load (`finds[0]`) superseded by a filter
 * change (`finds[1]`). Nothing has painted, so both are the initial load and
 * both hold `loading` — the pair that still puts the placeholder in play.
 */
async function overlapBeforePaint(
  dataSource: DataSource,
  rerender: (ui: React.ReactElement) => void,
) {
  await waitFor(() => expect((dataSource.find as any).mock.calls.length).toBe(1));
  rerender(<ObjectGantt schema={schemaWith({ status: 'open' })} dataSource={dataSource} />);
  await waitFor(() => expect((dataSource.find as any).mock.calls.length).toBe(2));
}

const refreshIndicator = () => screen.queryByTestId('refresh-indicator');

describe('ObjectGantt — a superseded reload must not clear the loading state (objectui#7231)', () => {
  it('keeps the placeholder up when the STALE reload finishes first and the fresh one is still in flight', async () => {
    const { dataSource, finds } = makeDeferredDataSource();

    const { rerender } = render(<ObjectGantt schema={schemaWith()} dataSource={dataSource} />);
    await overlapBeforePaint(dataSource, rerender);

    // Both reloads own `loading`, so the placeholder is up and the chart is
    // not mounted while both are in flight.
    expect(screen.getByText(PLACEHOLDER)).toBeTruthy();

    // The superseded reload answers first — the ordinary ordering.
    await settle(finds[0], ROWS_A);

    // Its `finally` must NOT clear `loading`: the fresh query has not answered,
    // so releasing the placeholder here paints an empty chart.
    expect(screen.getByText(PLACEHOLDER)).toBeTruthy();
    expect(screen.queryByTestId('gantt-view')).toBeNull();

    // The current reload answers and owns the transition out of loading.
    await settle(finds[1], ROWS_B);

    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
    expect(screen.getByText('From the fresh query')).toBeTruthy();
    expect(screen.queryByText('From the stale query')).toBeNull();
  });

  it('keeps the refreshing state up when the STALE reload finishes first after the paint (the in-place twin)', async () => {
    const { dataSource, finds } = makeDeferredDataSource();

    const { rerender } = render(<ObjectGantt schema={schemaWith()} dataSource={dataSource} />);
    await paintThenOverlap(dataSource, finds, rerender);
    const mountedAs = screen.getByTestId('gantt-view').dataset.instance;

    // Both reloads are in place: no placeholder, the chart stays mounted, and
    // the refreshing state is up.
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();
    expect(screen.getByTestId('gantt-view').getAttribute('data-refreshing')).toBe('true');
    expect(refreshIndicator()).not.toBeNull();

    // The superseded (silent) reload answers first.
    await settle(finds[1], ROWS_A);

    // Its `finally` must NOT clear `refreshing`: the changed query has not
    // answered, so dropping the refreshing state here passes the previous
    // query's rows off as the answer to the new one.
    expect(screen.getByTestId('gantt-view').getAttribute('data-refreshing')).toBe('true');
    expect(refreshIndicator()).not.toBeNull();

    await settle(finds[2], ROWS_B);

    await waitFor(() => expect(screen.getByText('From the fresh query')).toBeTruthy());
    expect(screen.getByTestId('gantt-view').getAttribute('data-refreshing')).toBe('false');
    expect(refreshIndicator()).toBeNull();
    expect(screen.getByTestId('gantt-view').dataset.instance).toBe(mountedAs);
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();
  });

  it('control — the fresh reload finishing FIRST paints its rows, and the late stale answer changes nothing', async () => {
    const { dataSource, finds } = makeDeferredDataSource();

    const { rerender } = render(<ObjectGantt schema={schemaWith()} dataSource={dataSource} />);
    await paintThenOverlap(dataSource, finds, rerender);

    // Out-of-order: the current reload answers before the superseded one.
    await settle(finds[2], ROWS_B);

    await waitFor(() => expect(screen.getByText('From the fresh query')).toBeTruthy());

    // The late stale answer must neither clobber the data (the pre-existing
    // `setData` guard) nor put the placeholder or the refreshing state back.
    await settle(finds[1], ROWS_A);
    await flush();

    expect(screen.getByTestId('gantt-view')).toBeTruthy();
    expect(screen.getByText('From the fresh query')).toBeTruthy();
    expect(screen.queryByText('From the stale query')).toBeNull();
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();
    expect(screen.getByTestId('gantt-view').getAttribute('data-refreshing')).toBe('false');
  });

  it('does not strand `refreshing` when a SILENT reload is superseded by a non-silent one', async () => {
    const { dataSource, finds } = makeDeferredDataSource();

    const { rerender } = render(<ObjectGantt schema={schemaWith()} dataSource={dataSource} />);
    // Before the paint: the mount's load (`finds[0]`, `loading`), then an
    // invalidation for the object (`finds[1]`, silent, `refreshing`), then a
    // filter change (`finds[2]`, the initial load again, `loading`).
    await waitFor(() => expect((dataSource.find as any).mock.calls.length).toBe(1));
    await act(async () => {
      notifyDataChanged({ objectName: 'tasks' });
    });
    await waitFor(() => expect((dataSource.find as any).mock.calls.length).toBe(2));
    rerender(<ObjectGantt schema={schemaWith({ status: 'open' })} dataSource={dataSource} />);
    await waitFor(() => expect((dataSource.find as any).mock.calls.length).toBe(3));

    expect(screen.getByText(PLACEHOLDER)).toBeTruthy();

    // The superseded silent reload answers: it must touch neither flag.
    await settle(finds[1], ROWS_A);
    expect(screen.getByText(PLACEHOLDER)).toBeTruthy();

    // The current reload answers. Nothing current is in flight any more, so
    // BOTH flags must be honest — a guard that only cleared `loading` here
    // would leave the refreshing state up for the life of the component.
    await settle(finds[2], ROWS_B);

    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
    expect(screen.getByTestId('gantt-view').getAttribute('data-refreshing')).toBe('false');
    expect(refreshIndicator()).toBeNull();
    expect(screen.getByText('From the fresh query')).toBeTruthy();

    // The mount's own load, superseded twice, answering last changes nothing.
    await settle(finds[0], ROWS_A);
    await flush();
    expect(screen.getByText('From the fresh query')).toBeTruthy();
    expect(screen.getByTestId('gantt-view').getAttribute('data-refreshing')).toBe('false');
  });
});
