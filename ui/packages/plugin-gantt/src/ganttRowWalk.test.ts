/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The gantt's stepped read (`fetchGanttRows`): no single read asks for more
 * than `GANTT_FETCH_STEP` rows, a set that fits one step is one read answered
 * as is, and a set walked in steps is read under a unique order and kept once
 * per `id`, so offset steps over tied sort keys can neither repeat nor drop a
 * row.
 */

import { describe, it, expect, vi } from 'vitest';
import { GANTT_ROW_CEILING, applyNonGridRowCeiling } from '@object-ui/core';
import { GANTT_FETCH_STEP, fetchGanttRows, withIdTieBreak } from './ganttRowWalk';

type Row = { id: string; stage: string };

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: String(i + 1), stage: i % 2 ? 'b' : 'a' }));
}

/** Honours `$top` / `$skip`; sorts by `$orderby` only when it names `id`. */
function adapter(store: Row[]) {
  return vi.fn(async (params: Record<string, any>) => {
    const ordered = params.$orderby && 'id' in params.$orderby
      ? [...store].sort((x, y) => Number(x.id) - Number(y.id))
      : store;
    const skip = params.$skip ?? 0;
    return { data: ordered.slice(skip, skip + params.$top), total: store.length };
  });
}

describe('fetchGanttRows', () => {
  it('a set that fits one step is ONE read, answered as is, with the authored order untouched', async () => {
    const find = adapter(rows(7));
    const answer = await fetchGanttRows(find, { $orderby: { stage: 'desc' } });
    expect(find).toHaveBeenCalledTimes(1);
    expect(find.mock.calls[0][0]).toEqual({ $orderby: { stage: 'desc' }, $top: GANTT_FETCH_STEP });
    expect(answer).toEqual({ data: rows(7), total: 7 });
  });

  it('never asks one read for more than a step, and stops one row past the ceiling', async () => {
    const find = adapter(rows(GANTT_ROW_CEILING + 300));
    const answer = await fetchGanttRows(find, {});
    for (const [params] of find.mock.calls) expect(params.$top).toBeLessThanOrEqual(GANTT_FETCH_STEP);
    const capped = applyNonGridRowCeiling(answer, GANTT_ROW_CEILING);
    expect(capped.rows).toHaveLength(GANTT_ROW_CEILING);
    expect(capped.truncated).toBe(true);
    expect(capped.total).toBe(GANTT_ROW_CEILING + 300);
  });

  it('walks under a unique order: the authored keys, then `id` in the last key’s direction', async () => {
    const find = adapter(rows(GANTT_FETCH_STEP + 5));
    await fetchGanttRows(find, { $orderby: { stage: 'desc' } });
    const walk = find.mock.calls.slice(1).map(([params]) => params);
    expect(walk.length).toBeGreaterThan(0);
    for (const params of walk) expect(params.$orderby).toEqual({ stage: 'desc', id: 'desc' });
    expect(walk[0].$skip).toBeUndefined();
  });

  it('keeps a row once when tied keys move it across a step boundary', async () => {
    const store = rows(GANTT_FETCH_STEP + 10);
    // An adapter that breaks ties differently on each read: every step answers
    // the row just before its window again, as an unstable order can.
    const find = vi.fn(async (params: Record<string, any>) => {
      const skip = params.$skip ?? 0;
      const from = Math.max(0, skip - 1);
      return { data: store.slice(from, from + params.$top), total: store.length };
    });
    const answer = (await fetchGanttRows(find, {})) as { data: Row[] };
    const ids = answer.data.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stops asking once a newer reload owns the screen', async () => {
    const find = adapter(rows(GANTT_ROW_CEILING + 300));
    let current = true;
    find.mockImplementation(async (params: Record<string, any>) => {
      if (find.mock.calls.length === 2) current = false;
      const skip = params.$skip ?? 0;
      const store = rows(GANTT_ROW_CEILING + 300);
      return { data: store.slice(skip, skip + params.$top), total: store.length };
    });
    await fetchGanttRows(find, {}, () => current);
    expect(find).toHaveBeenCalledTimes(2);
  });
});

describe('withIdTieBreak', () => {
  it('appends `id` ascending when nothing was authored', () => {
    expect(withIdTieBreak(undefined)).toEqual({ id: 'asc' });
  });
  it('leaves an order that already names `id` alone', () => {
    expect(withIdTieBreak({ id: 'desc', stage: 'asc' })).toEqual({ id: 'desc', stage: 'asc' });
  });
});
