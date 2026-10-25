/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8944 — the widget's OWN filter survives into the drill-down query,
 * for BOTH arms of `ObjectChartSchema.filter`.
 *
 * ## The defect
 *
 * `ObjectChartSchema.filter` admits a spec `FilterArray`
 * (`[['region','=','emea']]`) and the ObjectQL `$filter` object
 * (`{ region: 'emea' }`), and both are read — both travel verbatim to
 * `ds.aggregate` / `ds.find`. The drill seam composed them by SPREADING the
 * widget's filter into an object literal:
 *
 *     { ...(schema.filter || {}), ...computeDrillFilter(…) }
 *
 * Spreading an ARRAY yields index keys, so an authored `FilterArray` drilled as
 * `{ '0': ['region','=','emea'], stage: 'won' }` — the widget's conditions
 * replaced by a key the query layer ignores. Nothing errored; the drawer opened
 * and looked right, scoped by the clicked category ALONE.
 *
 * ⚠️ The direction matters: the widget's filter is what NARROWS. Dropping it
 * makes the drilled list a SUPERSET — it shows records the chart itself was
 * scoped to exclude.
 *
 * ## What these cases assert, and why not the index keys
 *
 * Asserting that `'0'` is absent from the composed object would pin the SYMPTOM.
 * These cases assert the SEMANTICS instead: the composed filter is run through
 * `ValueDataSource` — a real matcher for both `$filter` dialects — over a
 * fixture built so the three possible outcomes are three different row sets.
 *
 *   widget filter alone  (`region = emea`)  → a, c
 *   click context alone  (`stage  = won`)   → a, b     ← the pre-fix superset
 *   both, conjoined                          → a        ← the only correct answer
 *
 * So a dropped widget filter reads as `['a','b']` (the card's exact failure) and
 * a dropped click context as `['a','c']`, rather than both reading as "not the
 * expected object". The two single-source answers are asserted as live controls,
 * so the fixture cannot go vacuous without saying so.
 *
 * ## Why the observation point is `openRecordList`
 *
 * `target: 'navigate'` hands the composed filter to the host verbatim — one spy,
 * no DOM archaeology over a drilled table. The drawer arm is pinned through the
 * same spy via its "Open in list" escape hatch, which passes the drawer's own
 * `merged` value; the two are the one hoisted `drillFilter` memo, and the last
 * case proves they agree rather than assuming it.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { DrillNavigationProvider } from '@object-ui/react';
import { ValueDataSource } from '@object-ui/core';
import type { ObjectChartSchema } from '@object-ui/types';

vi.mock('../ChartRenderer', () => ({
  ChartRenderer: ({ onChartClick }: any) => (
    <button
      type="button"
      data-testid="fake-segment"
      onClick={() => onChartClick?.({ category: 'won', series: 'count', value: 1 })}
    >
      segment
    </button>
  ),
}));

import { ObjectChart } from '../ObjectChart';

const OBJECT = 'crm_opportunity';

/**
 * Three rows chosen so each source excludes a DIFFERENT one: `b` survives only
 * if the widget filter is lost, `c` only if the click context is lost.
 */
const ROWS = [
  { id: 'a', stage: 'won', region: 'emea' },
  { id: 'b', stage: 'won', region: 'apac' },
  { id: 'c', stage: 'lost', region: 'emea' },
];

/** Run a composed filter through a real matcher and project the ids it selects. */
async function selectedIds(filter: unknown): Promise<string[]> {
  const ds = new ValueDataSource({ items: ROWS });
  const result = await ds.find(OBJECT, { $filter: filter as any });
  return result.data.map((r: any) => r.id as string);
}

let metaCalls: string[] = [];
beforeEach(() => {
  metaCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      metaCalls.push(String(input));
      return { ok: true, json: async () => ({}) };
    }),
  );
});
afterEach(() => {
  expect(metaCalls.filter((u) => u !== `/api/v1/meta/object/${OBJECT}`)).toEqual([]);
  vi.unstubAllGlobals();
  cleanup();
});

function renderChart(
  filter: ObjectChartSchema['filter'],
  drillDown: Record<string, unknown>,
) {
  const openRecordList = vi.fn();
  render(
    <DrillNavigationProvider value={{ openRecordList }}>
      <ObjectChart
        schema={{
          type: 'object-chart',
          chartType: 'bar',
          objectName: OBJECT,
          xAxisKey: 'stage',
          data: [{ stage: 'won', count: 2 }],
          isAnimationActive: false,
          filter,
          drillDown,
        } as ObjectChartSchema}
        dataSource={{ find: async () => ({ data: [] }) }}
      />
    </DrillNavigationProvider>,
  );
  return openRecordList;
}

/** Click a segment through the navigate arm and hand back the composed filter. */
async function drillViaNavigate(filter: ObjectChartSchema['filter']): Promise<unknown> {
  const openRecordList = renderChart(filter, { enabled: true, target: 'navigate' });
  fireEvent.click(screen.getByTestId('fake-segment'));
  await waitFor(() => expect(openRecordList).toHaveBeenCalled());
  const [objectName, composed] = openRecordList.mock.calls[0];
  expect(objectName).toBe(OBJECT);
  return composed;
}

describe('objectui#8944 — the fixture discriminates (live controls)', () => {
  it('each source alone selects a DIFFERENT row set, so a dropped source is visible', async () => {
    // Green before and after the fix. Its job is to prove the rows and the
    // matcher work, so a red below is about the composition rather than the
    // harness — and to name the pre-fix superset explicitly.
    expect(await selectedIds({ region: 'emea' })).toEqual(['a', 'c']);
    expect(await selectedIds({ stage: 'won' })).toEqual(['a', 'b']);
    expect(await selectedIds(undefined)).toEqual(['a', 'b', 'c']);
  });
});

describe('objectui#8944 — the ARRAY arm survives the drill', () => {
  it('conjoins a spec FilterArray with the click context, and the result still CONSTRAINS', async () => {
    const composed = await drillViaNavigate([['region', '=', 'emea']]);

    // The semantics: only the intersection. `['a','b']` here would be the
    // pre-fix answer — the widget's filter dropped, the list widened to the
    // clicked category alone.
    expect(await selectedIds(composed)).toEqual(['a']);

    // The spelling the repo's single filter sink produces for two sources.
    expect(composed).toEqual({ $and: [{ region: 'emea' }, { stage: 'won' }] });
  });

  it('carries EVERY condition of a multi-condition FilterArray, not just the first', async () => {
    // A second condition the click context does not mention: if the array arm
    // were being lowered one-condition-deep, `c` would come back.
    const composed = await drillViaNavigate([
      ['region', '=', 'emea'],
      ['stage', '!=', 'lost'],
    ]);
    expect(await selectedIds(composed)).toEqual(['a']);
  });
});

describe('objectui#8944 — the OBJECT arm still composes (no regression)', () => {
  it('conjoins the ObjectQL $filter object with the click context', async () => {
    const composed = await drillViaNavigate({ region: 'emea' });
    expect(await selectedIds(composed)).toEqual(['a']);
    expect(composed).toEqual({ $and: [{ region: 'emea' }, { stage: 'won' }] });
  });

  it('a chart with NO filter of its own drills exactly as it did before', async () => {
    // One surviving source lowers back to the flat object the spread produced,
    // so this path is byte-identical to the pre-fix behaviour.
    const composed = await drillViaNavigate(undefined);
    expect(composed).toEqual({ stage: 'won' });
    expect(await selectedIds(composed)).toEqual(['a', 'b']);
  });
});

describe('objectui#8944 — both filter sources together', () => {
  it('conjoins the widget ARRAY arm with an authored drillDown.filter', async () => {
    // `drillDown.filter` replaces the derived click context, so this composes
    // two independently authored sources in two different dialects.
    const openRecordList = renderChart([['region', '=', 'emea']], {
      enabled: true,
      target: 'navigate',
      filter: { stage: '${event.category}' },
    });
    fireEvent.click(screen.getByTestId('fake-segment'));
    await waitFor(() => expect(openRecordList).toHaveBeenCalled());
    const composed = openRecordList.mock.calls[0][1];

    expect(await selectedIds(composed)).toEqual(['a']);
    expect(composed).toEqual({ $and: [{ region: 'emea' }, { stage: 'won' }] });
  });
});

describe('objectui#8944 — the drawer sink drills by the SAME composed filter', () => {
  it("the drawer's 'Open in list' hands the host what the navigate arm hands it", async () => {
    // The drawer builds `merged` from the same hoisted memo. Pinning it through
    // the escape hatch keeps the assertion on the composed VALUE rather than on
    // rows rendered by a table this package does not own.
    const openRecordList = renderChart([['region', '=', 'emea']], { enabled: true });
    fireEvent.click(screen.getByTestId('fake-segment'));

    await waitFor(() => expect(screen.getByTestId('chart-drill-body')).toBeTruthy());
    fireEvent.click(screen.getByTestId('drill-open-in-list'));

    await waitFor(() => expect(openRecordList).toHaveBeenCalled());
    const composed = openRecordList.mock.calls[0][1];
    expect(composed).toEqual({ $and: [{ region: 'emea' }, { stage: 'won' }] });
    expect(await selectedIds(composed)).toEqual(['a']);
  });
});
