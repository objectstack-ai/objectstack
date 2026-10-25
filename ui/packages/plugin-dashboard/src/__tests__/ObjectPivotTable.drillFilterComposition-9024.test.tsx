/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9024 — the pivot's OWN filter survives into the drill-down query,
 * for BOTH dialects `ObjectPivotTable` reads at `schema.filter`.
 *
 * ## The defect
 *
 * The drill seam composed the pivot's filter with the click context by
 * SPREADING the first into an object literal:
 *
 *     { ...(schema.filter || {}), ...computeDrillFilter(…) }
 *
 * Spreading an ARRAY yields index keys, so an authored `[['region','=','emea']]`
 * drilled as `{ '0': ['region','=','emea'], stage: 'won', source: 'web' }` — the
 * pivot's conditions replaced by a key the query layer ignores. Nothing errored;
 * the drawer opened and looked right, scoped by the clicked cell ALONE. The same
 * statement objectui#8944 removed from `ObjectChart` one block over.
 *
 * ⚠️ The direction matters: the pivot's filter is what NARROWS. Dropping it
 * makes the drilled list a SUPERSET — it shows records the pivot itself was
 * scoped to exclude.
 *
 * ## Why the array arm is reachable here, measured rather than assumed
 *
 * `PivotTableSchema` declares no `filter` at all (the type that admits the value
 * is a local props-intersection `filter?: any`, which is strictly MORE
 * permissive than the chart's union), so nothing refuses the array form. And it
 * is not only a hand author who can produce it:
 *
 *   - `object-pivot`'s registry entry advertises `{ name: 'filter', type:
 *     'array' }` in its designer `inputs` (`plugin-dashboard/src/index.tsx`);
 *   - `ElementDataSourceGate` WRITES the array arm mechanically. Binding a pivot
 *     the way the spec documents (`dataSource: { object, view }`) sets
 *     `schema.filter` to `mergeFilterNodes(schema.filter, view.filter)` — an
 *     ObjectQL AST node — for every saved view that carries a filter
 *     (`ObjectPivot.elementDataSource.test.tsx` pins that binding).
 *
 * So the pre-fix drill dropped the scope of every view-bound pivot, not just of
 * a pivot whose author happened to pick the array spelling.
 *
 * ## What these cases assert, and why not the index keys
 *
 * Asserting that `'0'` is absent from the composed object would pin the SYMPTOM.
 * These cases assert the SEMANTICS instead — the composed filter is run through
 * `ValueDataSource`, a real matcher for the `$filter` dialect, over a fixture
 * built so the three possible outcomes are three different row sets:
 *
 *   pivot filter alone  (`region = emea`)             → a, c
 *   click context alone (`stage = won, source = web`) → a, b
 *   both, conjoined                                   → a      ← the only correct answer
 *
 * The pivot's filter is deliberately on a field that is NEITHER axis, so losing
 * it changes the row set; a filter on `rowField`/`columnField` would be
 * re-stated by the click context and could not discriminate. The two
 * single-source answers are asserted as live controls, so the fixture cannot go
 * vacuous without saying so.
 *
 * ## What the pre-fix value did at each sink — measured, not assumed
 *
 * The spread produced `{ '0': ['region','=','emea'], stage: 'won', source:
 * 'web' }`. The pivot's conditions are not absent in ONE way; each sink resolves
 * the stray index key differently and both answers are wrong:
 *
 *   - this repo's in-memory matcher — `ValueDataSource`, the one these cases run
 *     the composed filter through — REFUSES an array comparand outside
 *     `$in`/`$nin`/`$between` and excludes every row. Ablating the routing turns
 *     the array cases below into `[]`, with that diagnostic on stderr.
 *   - the URL sink drops it silently: `serializeDrillFilterParams` skips a bare
 *     array comparand rather than stringifying it (its own pin in
 *     `app-shell/src/views/drillUrlFilters.test.ts`), so no `filter[0]` is ever
 *     written and the list lands scoped by the clicked cell ALONE — the SUPERSET
 *     this defect is named for, and the `a, b` row above.
 *
 * Either way the pivot's own conditions never reach the drilled query. These
 * cases assert the conjunction, so a red names the drop whichever sink resolved
 * it — rather than depending on one sink's treatment of a key nobody meant to
 * send.
 *
 * ## Why the observation point is `openRecordList`
 *
 * `DrillDownDrawer`'s `target: 'navigate'` hands the composed filter to the host
 * verbatim — one spy, no DOM archaeology over a drilled table. The in-place
 * drawer arm is pinned through the same spy via its "Open in list" escape hatch,
 * which passes the drawer's own `filter` prop; the last case proves the two
 * agree rather than assuming it.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { DrillNavigationProvider } from '@object-ui/react';
import { ValueDataSource } from '@object-ui/core';

import { ObjectPivotTable } from '../ObjectPivotTable';

const OBJECT = 'crm_opportunity';

/**
 * Three rows chosen so each source excludes a DIFFERENT one: `b` survives only
 * if the pivot's filter is lost, `c` only if the click context is lost.
 */
const ROWS = [
  { id: 'a', stage: 'won', source: 'web', region: 'emea', amount: 10 },
  { id: 'b', stage: 'won', source: 'web', region: 'apac', amount: 20 },
  { id: 'c', stage: 'lost', source: 'web', region: 'emea', amount: 30 },
];

/** Run a composed filter through a real matcher and project the ids it selects. */
async function selectedIds(filter: unknown): Promise<string[]> {
  const ds = new ValueDataSource({ items: ROWS });
  const result = await ds.find(OBJECT, { $filter: filter as any });
  return result.data.map((r: any) => r.id as string);
}

/** A data source the drawer can hold without reaching the network. */
const inertDataSource = () => ({ find: vi.fn(async () => ({ data: [] })) });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderPivot(filter: unknown, drillDown: Record<string, unknown>) {
  const openRecordList = vi.fn();
  const utils = render(
    <DrillNavigationProvider value={{ openRecordList }}>
      <ObjectPivotTable
        schema={{
          type: 'pivot',
          objectName: OBJECT,
          rowField: 'stage',
          columnField: 'source',
          valueField: 'amount',
          aggregation: 'sum',
          showRowTotals: true,
          showColumnTotals: true,
          data: ROWS,
          filter,
          drillDown,
        } as any}
        dataSource={inertDataSource()}
      />
    </DrillNavigationProvider>,
  );
  return { openRecordList, ...utils };
}

/** Click the `won x web` cell through the navigate arm; hand back the composed filter. */
async function drillCellViaNavigate(filter: unknown): Promise<unknown> {
  const { openRecordList } = renderPivot(filter, { enabled: true, target: 'navigate' });
  fireEvent.click(screen.getByLabelText('Drill into stage=won, source=web'));
  await waitFor(() => expect(openRecordList).toHaveBeenCalled());
  const [objectName, composed] = openRecordList.mock.calls[0];
  expect(objectName).toBe(OBJECT);
  return composed;
}

describe('objectui#9024 — the fixture discriminates (live controls)', () => {
  it('each source alone selects a DIFFERENT row set, so a dropped source is visible', async () => {
    // Green before and after the fix. Its job is to prove the rows and the
    // matcher work, so a red below is about the composition rather than the
    // harness — and to name the pre-fix superset explicitly.
    expect(await selectedIds({ region: 'emea' })).toEqual(['a', 'c']);
    expect(await selectedIds({ stage: 'won', source: 'web' })).toEqual(['a', 'b']);
    expect(await selectedIds(undefined)).toEqual(['a', 'b', 'c']);
  });
});

describe('objectui#9024 — the ARRAY arm survives the drill', () => {
  it('conjoins a spec FilterArray with the click context, and the result still CONSTRAINS', async () => {
    const composed = await drillCellViaNavigate([['region', '=', 'emea']]);

    // The semantics: only the intersection. `['a','b']` here would be the
    // pre-fix answer — the pivot's filter dropped, the list widened to the
    // clicked cell alone.
    expect(await selectedIds(composed)).toEqual(['a']);

    // The spelling the repo's single filter sink produces. The click context's
    // own two conditions (rowField AND columnField) are a conjunction in their
    // own right, so they lower to a NESTED `$and` rather than to one flat
    // object — the sink states each source as its OWN child, at every level.
    // `serializeDrillFilterParams` walks that nesting (pinned in
    // `app-shell/src/views/drillUrlFilters.test.ts`), and the row set above is
    // the assertion that matters.
    expect(composed).toEqual({
      $and: [{ region: 'emea' }, { $and: [{ stage: 'won' }, { source: 'web' }] }],
    });
  });

  it('carries EVERY condition of a multi-condition FilterArray, not just the first', async () => {
    // A second condition the click context does not mention: if the array arm
    // were being lowered one-condition-deep, `c` would come back.
    const composed = await drillCellViaNavigate([
      ['region', '=', 'emea'],
      ['stage', '!=', 'lost'],
    ]);
    expect(await selectedIds(composed)).toEqual(['a']);
  });

  it('survives a ROW-header drill too — the scope narrows, the pivot filter stays', async () => {
    const { openRecordList } = renderPivot([['region', '=', 'emea']], { enabled: true, target: 'navigate' });
    fireEvent.click(screen.getByLabelText('Drill into stage: won'));
    await waitFor(() => expect(openRecordList).toHaveBeenCalled());
    const composed = openRecordList.mock.calls[0][1];

    expect(await selectedIds(composed)).toEqual(['a']);
    expect(composed).toEqual({ $and: [{ region: 'emea' }, { stage: 'won' }] });
  });
});

describe('objectui#9024 — the OBJECT arm still composes (no regression)', () => {
  it('conjoins the ObjectQL $filter object with the click context', async () => {
    // ⭐ The regression guard. Ablating the routing leaves THIS row-set assertion
    // GREEN — measured — and reds only the shape assertion below it: spreading is
    // already correct for the object arm, so routing through the seam changes the
    // composed value's SHAPE here and not the rows it selects.
    const composed = await drillCellViaNavigate({ region: 'emea' });
    expect(await selectedIds(composed)).toEqual(['a']);
    expect(composed).toEqual({
      $and: [{ region: 'emea' }, { $and: [{ stage: 'won' }, { source: 'web' }] }],
    });
  });

  it('a pivot with NO filter of its own drills the SAME ROWS as it did before', async () => {
    // ⚠️ Measured, not assumed, and NOT byte-identical: a pivot cell click
    // derives TWO conditions (rowField and columnField), which are themselves a
    // conjunction, so the lone surviving source lowers to `$and` where the
    // spread produced one flat object. `ObjectChart`'s equivalent case stayed
    // flat only because its click context is a single `groupByField` key.
    //
    // The difference is inert at every sink, and that is asserted rather than
    // asserted-about: the same matcher selects the same rows from the nested
    // form and from the exact object the pre-fix spread produced.
    const composed = await drillCellViaNavigate(undefined);
    expect(composed).toEqual({ $and: [{ stage: 'won' }, { source: 'web' }] });

    const preFixSpread = { stage: 'won', source: 'web' };
    expect(await selectedIds(composed)).toEqual(await selectedIds(preFixSpread));
    expect(await selectedIds(composed)).toEqual(['a', 'b']);
  });
});

describe('objectui#9024 — a TOTAL drill, where the click context is empty', () => {
  it('keeps the pivot filter when the click contributes nothing', async () => {
    // `scope: 'total'` is drill-through to the whole set, so `computeDrillFilter`
    // answers `{}`. The pivot's own scope must still apply — this is the case the
    // old spread got right for the object arm and silently wrong for the array
    // one, and the reason it is asserted for the ARRAY arm here.
    const { openRecordList, container } = renderPivot([['region', '=', 'emea']], {
      enabled: true,
      target: 'navigate',
    });
    fireEvent.click(container.querySelector('tfoot tr td:last-child') as Element);
    await waitFor(() => expect(openRecordList).toHaveBeenCalled());
    const composed = openRecordList.mock.calls[0][1];

    expect(await selectedIds(composed)).toEqual(['a', 'c']);
    expect(composed).toEqual({ region: 'emea' });
  });

  it('sends NO filter when neither source carries anything', async () => {
    // Both sources empty: the seam answers `undefined` so the caller can omit
    // the key, where the spread answered `{}`. Same unscoped row set, and
    // `DrillDownDrawer.filter` is optional, so the two are interchangeable at
    // every sink — recorded here rather than left to be rediscovered.
    const { openRecordList, container } = renderPivot(undefined, {
      enabled: true,
      target: 'navigate',
    });
    fireEvent.click(container.querySelector('tfoot tr td:last-child') as Element);
    await waitFor(() => expect(openRecordList).toHaveBeenCalled());
    const composed = openRecordList.mock.calls[0][1];

    expect(composed).toBeUndefined();
    expect(await selectedIds(composed)).toEqual(['a', 'b', 'c']);
  });
});

describe('objectui#9024 — the in-place drawer drills by the SAME composed filter', () => {
  it("the drawer's 'Open in list' hands the host what the navigate arm hands it", async () => {
    // Both arms read the one `merged` value this component computes. Pinning the
    // drawer through the escape hatch keeps the assertion on the composed VALUE
    // rather than on rows rendered by a table this file does not own.
    const { openRecordList } = renderPivot([['region', '=', 'emea']], { enabled: true });
    fireEvent.click(screen.getByLabelText('Drill into stage=won, source=web'));

    await waitFor(() => expect(screen.getByTestId('drill-open-in-list')).toBeTruthy());
    fireEvent.click(screen.getByTestId('drill-open-in-list'));

    await waitFor(() => expect(openRecordList).toHaveBeenCalled());
    const composed = openRecordList.mock.calls[0][1];
    expect(await selectedIds(composed)).toEqual(['a']);
    expect(composed).toEqual({
      $and: [{ region: 'emea' }, { $and: [{ stage: 'won' }, { source: 'web' }] }],
    });
  });
});
