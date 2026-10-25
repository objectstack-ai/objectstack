/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectChart` reads its `find()` answers as `QueryResult` DECLARES them — and
 * does NOT read `records` (objectui#6839).
 *
 * ⭐ This module has TWO call sites into the shared reader, and they behave
 * differently — objectui#6839's own table names only one of them, so the second
 * is re-derived here rather than inherited:
 *
 *   1. THE ROWS — `ds.find(objectName)` -> `extractRecords`. A refused envelope
 *      paints the empty state.
 *   2. THE GROUP-BY LABEL DOMAIN — `dataSource.find(referenceTo)` ->
 *      `extractRecords`, inside the exported `resolveGroupByLabels`. A refused
 *      envelope here does NOT empty the chart: every bar still draws, and the
 *      only casualty is that a lookup dimension keeps its RAW FOREIGN KEY as
 *      its axis label. A chart of `a1f3c…` instead of `Apollo` is a chart that
 *      looks like it worked, which is exactly the failure a rows-only pin
 *      cannot see. Site 2 is asserted through the exported function directly —
 *      it is public API of this module, and calling it is a sharper instrument
 *      than inferring the axis text through a full chart mount.
 *
 * MEASURED for this module: no `find()` in `plugin-charts`, nor in any app or
 * example mounting a chart, emits a `records` envelope — the package's single
 * `records:` occurrence is an `aggregateRecords(records: any[], …)` parameter
 * name. CONTROL, so the zero is a reading: the same sweep finds a live `find()`
 * double emitting `{ records: [...] }` at `plugin-list`'s ObjectGallery, a
 * consumer with its own unwrap ladder.
 *
 * ⚠️ Every refusal case is ALSO satisfied by an `extractRecords` that returns
 * `[]` for everything — an implementation strictly worse than the bug. The
 * `data` and bare-array cases refuse it, on BOTH sites.
 *
 * NOTE: `plugin-charts` also RE-EXPORTS `extractRecords`
 * (`export { extractRecords } from '@object-ui/core'`), so this package's
 * published surface carries the behaviour change too. That re-export is
 * identity-pinned by `ObjectChart.humanizeLabelReexport.test.ts`'s family and
 * is not re-asserted here.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

let lastSchema: any = null;

vi.mock('./ChartRenderer', () => ({
  ChartRenderer: (props: any) => {
    lastSchema = props.schema;
    return null;
  },
}));

import { ObjectChart, resolveGroupByLabels } from './ObjectChart';

const ROWS = [
  { stage: 'p1', amount: 10 },
  { stage: 'p1', amount: 20 },
];

/** The referenced object's rows — the id→label domain site 2 resolves. */
const PROJECTS = [{ id: 'p1', name: 'Apollo' }];

/** How one case wraps its rows on the way back out of `find()`. */
type Envelope = (rows: unknown[]) => unknown;

const asData: Envelope = (rows) => ({ data: rows, total: rows.length });
const asBareArray: Envelope = (rows) => rows;
const asRecords: Envelope = (rows) => ({ records: rows, total: rows.length });

const schema = {
  type: 'object-chart' as const,
  chartType: 'bar' as const,
  objectName: 'crm_opportunity',
  xAxisKey: 'stage',
  series: [{ dataKey: 'amount', label: 'Amount' }],
  isAnimationActive: false,
};

/** A plain text dimension — site 2 stays out of the way of site 1's cases. */
const TEXT_SCHEMA = {
  name: 'crm_opportunity',
  fields: { stage: { type: 'text' }, amount: { type: 'number' } },
};

/** A lookup dimension — this is what puts site 2 on the path. */
const LOOKUP_FIELD = { type: 'lookup', reference: 'projects' };

beforeEach(() => {
  lastSchema = null;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  lastSchema = null;
});

/**
 * Mount the chart over a `find()` answering `envelope`, and hand back what it
 * settled on: the number of rows that reached `ChartRenderer`, or
 * `'empty-state'` when it drew objectui#7130's "No data yet" tile instead.
 *
 * The two outcomes are DIFFERENT DOM, not a count of 0 — `ObjectChart` returns
 * the empty tile on an empty result set and never mounts the renderer at all.
 * Reporting which one happened keeps a refused envelope distinguishable from a
 * mount that never rendered.
 *
 * ⛔ Call ONCE per case, never inside a `waitFor` predicate (objectui#7802):
 * it renders, and `waitFor` re-runs its callback on DOM mutations, so a
 * predicate that renders feeds itself and leaks a container div per run.
 */
async function settledOn(envelope: Envelope): Promise<number | 'empty-state'> {
  const find = vi.fn(async () => envelope(ROWS));
  const ds: any = { find, getObjectSchema: vi.fn(async () => TEXT_SCHEMA) };
  render(<ObjectChart schema={schema} dataSource={ds} />);
  await waitFor(() => expect(find).toHaveBeenCalled());
  // `find`'s OWN answer, settled — a pure read of the mock's call record that
  // touches no DOM. Without it "no rows" is satisfied by the loading state,
  // which every arm passes through identically.
  await find.mock.results[0].value;
  await waitFor(() =>
    expect(lastSchema ?? screen.queryByTestId('chart-empty-state')).not.toBeNull(),
  );
  return lastSchema ? (lastSchema.data ?? []).length : 'empty-state';
}

/**
 * Run site 2 directly: resolve one `lookup` dimension's labels over a `find()`
 * answering `envelope`, and hand back the axis label the row ended up with.
 *
 * `'Apollo'` means the domain was read; `'p1'` — the raw foreign key, verbatim
 * — is the silent-looking failure. MEASURED, not assumed: the lookup branch
 * ends `[groupByField]: idToName[rawValue] || rawValue`, so an unresolved key
 * falls through UNTOUCHED. `humanizeLabel` is not on this path and never
 * uppercases it; a pin written for `'P1'` reddens on a correct refusal.
 */
async function labelThrough(envelope: Envelope): Promise<string> {
  const ds: any = { find: vi.fn(async () => envelope(PROJECTS)) };
  const out = await resolveGroupByLabels(
    [{ stage: 'p1', amount: 10 }],
    'stage',
    { name: 'crm_opportunity', fields: { stage: LOOKUP_FIELD } },
    ds,
  );
  return String(out[0].stage);
}

describe('ObjectChart — the find() envelopes it reads (objectui#6839)', () => {
  describe('site 1 — the chart rows', () => {
    it("still reads the contract's `data` member", async () => {
      expect(await settledOn(asData), 'the declared rows member must still draw').toBe(2);
    });

    it('still reads a bare array — the live non-envelope shape fakes answer with', async () => {
      expect(await settledOn(asBareArray), 'the bare-array arm must still draw').toBe(2);
    });

    it('does NOT read `records` — not a QueryResult member', async () => {
      // Before the fix these two rows drew off a key `QueryResult` does not
      // declare, and did so AHEAD of `data`. The chart now settles on
      // objectui#7130's empty tile — a DIFFERENT node from the renderer, which
      // is what makes this a reading of the refusal rather than of a mount
      // that never happened.
      expect(
        await settledOn(asRecords),
        'a `records` envelope must reach the chart as no rows at all, not as the rows it names',
      ).toBe('empty-state');
    });
  });

  describe('site 2 — the group-by label domain (resolveGroupByLabels)', () => {
    it("still reads the contract's `data` member", async () => {
      expect(await labelThrough(asData), 'the lookup label must still resolve').toBe('Apollo');
    });

    it('still reads a bare array', async () => {
      expect(await labelThrough(asBareArray)).toBe('Apollo');
    });

    it('does NOT read `records` — and the chart is NOT how you would notice', async () => {
      // The sharp half. The bar count is identical either way; what changes is
      // that the axis now carries the raw foreign key. A rows-only pin would
      // have called this module green.
      //
      // ⭐ ASSERT THE POSITIVE (objectui#8708). This arm read `.not.toBe(
      // 'Apollo')` — a negation over an OPEN codomain, so it also accepted
      // `String(undefined)`, `''`, `'null'` and every other value a resolver
      // emits once it has stopped resolving anything. ABLATION, on this file:
      // deleting the `|| rawValue` fallback in `resolveGroupByLabels` — so an
      // unresolved key reaches the axis as the literal string `undefined` —
      // left ALL SIX cases green under the old pin. Naming the one value a
      // correct refusal settles on closes that: `'p1'` is the FK verbatim, the
      // raw-foreign-key axis the docblock above describes.
      expect(
        await labelThrough(asRecords),
        'a `records` envelope must leave the axis on the raw foreign key, unresolved',
      ).toBe('p1');
    });
  });
});
