/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-metric.aggregate` and `object-metric.filter` — the MEMBER SHAPES the
 * renderer reads to build the query behind the number (objectui#8071).
 *
 * The member pins for the two keys objectui#8071's eighth slice takes on the
 * QUERY half of `object-metric`. Both are asserted through the registered block
 * (`type: 'object-metric'` mounted by `SchemaRenderer`, registered by this
 * package's own side-effect import) rather than on `ObjectMetricWidget`
 * directly, so the pin covers the path an author actually reaches: the block's
 * `ElementDataSourceGate` shell forwards every key but `objectName` / `filter`
 * untouched, and this file is what says so.
 *
 * ## `aggregate` — a three-member options bag, and a result readback keyed on
 * two of them
 *
 * `ObjectMetricWidget.computeOne` turns the authored object into the adapter
 * call:
 *
 *     ds.aggregate(objectName, {
 *       field: aggregate.field,
 *       function: aggregate.function,
 *       groupBy: aggregate.groupBy || '_all',
 *       filter: filterForRun,
 *     })
 *
 * so the member shape is (a) which authored members become which call members,
 * (b) that `groupBy` is OPTIONAL with a defined default (`'_all'` — one bucket),
 * and (c) that the two other members are read a SECOND time on the way back:
 * `function: 'count'` sums `<field>_count` across EVERY returned row, while any
 * other function reads the FIRST row's `<field>_<function>`. A `field` or a
 * `function` that reached the query but not the readback would paint `0` from a
 * response that carried the right number — the silent-wrong-number failure this
 * whole direction (objectui#8068) exists to make loud.
 *
 * The bag is asserted AS A WHOLE (`toEqual`, not per-key), so a member silently
 * added to or dropped from the call is red in either direction. The
 * aggregate-side bag assertions author NO `filter` on purpose: that keeps them
 * independent of the `filter` spelling pinned below, so the two ablations these
 * pins were verified with fail for their own reasons rather than as a pair.
 *
 * The key's ABSENCE is a member semantic too, not merely a control: with no
 * `aggregate` the renderer changes the query VERB — `find()` instead of
 * `aggregate()` — and paints the row COUNT. That row is also this file's
 * non-vacuity floor, because it is the one case whose green requires the
 * adapter to have been asked for something.
 *
 * ## `filter` — one authored predicate, two wire spellings, read by value
 *
 * `filter` carries no named member set of its own; the renderer never inspects
 * it. Its member shape is therefore the SPELLING it arrives under, and there
 * are two, chosen by an adapter capability the author cannot see:
 *
 *   - `aggregate(object, { …, filter })` — FLAT, under its own name.
 *   - `find(object, { $filter })` — WRAPPED, on the no-`aggregate()` fallback.
 *
 * Collapsing the two into one spelling drops the predicate on whichever path
 * lost, and a metric scoped to "hot accounts" then counts every row — the same
 * shape `element:number.filter` was pinned for (objectui#8071 slice 7) on a
 * different renderer.
 *
 * Two more halves, both load-bearing:
 *
 *   - Placeholders are resolved BEFORE the query, not by the server: an
 *     authored `{current_quarter_start}` must reach the adapter as a real date.
 *     A macro that survives into the wire is not a filter, it is a literal
 *     nobody matches, and the metric reads 0 with no diagnostic.
 *   - The predicate is read BY VALUE (`JSON.stringify` memo), not by identity.
 *     A parent that rebuilds a deep-equal filter literal every render must NOT
 *     re-query; a parent that changes one comparand MUST, and must carry the new
 *     predicate. Each arm is the other's control: a dependency "simplified" to
 *     the raw object passes the second and turns the first into a fetch storm.
 *
 * ## Nothing pre-existing covered either key
 *
 * Measured, then read end to end rather than dismissed on greps. Twelve
 * collected test files name `object-metric` at all, which is the locator's own
 * precondition. `ObjectMetric.elementDataSource.test.tsx` authors an
 * `aggregate` in every case, but as a FIXTURE — its subject is the
 * `dataSource` binding, and it asserts nothing about which members reach the
 * call or how the response is read (it is credited here for `dataSource`
 * instead). `public-block-binding-reach.test.tsx` states its own narrowness in
 * prose — one question per block, "did any call carry the object name" — and
 * lists `aggregate` only as a plausible sample value.
 * `widget-dom-leak-sweep.test.tsx` is the DOM-attribute canary: its
 * `aggregate` is a stub returning `[]` and `object-metric` is one render
 * target among many. `ObjectMetricWidget.i18nLabel.test.tsx` authors
 * `aggregate` and `filter`-adjacent props purely to make the drill-down
 * reachable; its subject is `I18nLabel` resolution. The remaining seven name
 * `object-metric` in prose, in a membership list, or in a designer-inspector
 * fixture.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-metric` (the `ObjectMetricBlock` shell under test) at
// MODULE scope, never inside a hook — object-ui/no-dynamic-import-in-test-hook.
import '../index';

afterEach(cleanup);

/** The adapter call signature both paths share: `(object, params)`. */
type Params = Record<string, unknown>;

/** An adapter that can aggregate — the primary path. */
const aggregatingAdapter = (rows: Record<string, unknown>[]) => ({
  aggregate: vi.fn(async (_object: string, _params: Params) => rows),
  find: vi.fn(async (_object: string, _params: Params) => ({ data: [] as unknown[] })),
});

/** An adapter that CANNOT aggregate — the `find()` fallback path. */
const countingAdapter = (records: unknown[]) => ({
  find: vi.fn(async (_object: string, _params: Params) => ({ data: records })),
});

const mount = (schema: Record<string, unknown>, adapter: unknown) =>
  render(
    <SchemaRendererProvider dataSource={adapter as never}>
      <SchemaRenderer schema={{ type: 'object-metric', label: 'Pipeline', ...schema } as never} />
    </SchemaRendererProvider>,
  );

/** The options bag of the nth (default first) `aggregate()` call. */
const bagOf = (adapter: ReturnType<typeof aggregatingAdapter>, nth = 0): Params =>
  adapter.aggregate.mock.calls[nth][1];

describe('object-metric — the `aggregate` member shape (objectui#8071)', () => {
  it('maps its members onto the call and defaults `groupBy` to one bucket', async () => {
    const adapter = aggregatingAdapter([{ amount_sum: 120 }]);
    mount({ objectName: 'deal', aggregate: { field: 'amount', function: 'sum' } }, adapter);

    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalled());
    expect(adapter.aggregate.mock.calls[0][0]).toBe('deal');
    // The WHOLE bag, so a member added or dropped is red in either direction.
    // No `filter` is authored here on purpose — see the docblock.
    expect(bagOf(adapter)).toEqual({
      field: 'amount',
      function: 'sum',
      groupBy: '_all',
      filter: undefined,
    });
  });

  it('lets an authored `groupBy` outrank that default', async () => {
    const adapter = aggregatingAdapter([{ amount_sum: 120 }]);
    mount(
      { objectName: 'deal', aggregate: { field: 'amount', function: 'sum', groupBy: 'stage' } },
      adapter,
    );

    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalled());
    expect(bagOf(adapter)).toEqual({
      field: 'amount',
      function: 'sum',
      groupBy: 'stage',
      filter: undefined,
    });
  });

  it('reads a `count` back across EVERY row, under `<field>_count`', async () => {
    // Two rows, and the count arm sums them: 3 + 4.
    const adapter = aggregatingAdapter([{ amount_count: 3 }, { amount_count: 4 }]);
    mount({ objectName: 'deal', aggregate: { field: 'amount', function: 'count' } }, adapter);

    expect(await screen.findByText('7')).toBeTruthy();
  });

  it('reads any other function back off the FIRST row, under `<field>_<function>`', async () => {
    // Same two-row response as the count case above, which is what makes the
    // pair discriminate: only a readback that reads BOTH members can answer 120
    // here and 7 there. A readback that ignored `function` would sum to 1119.
    const adapter = aggregatingAdapter([{ amount_sum: 120 }, { amount_sum: 999 }]);
    mount({ objectName: 'deal', aggregate: { field: 'amount', function: 'sum' } }, adapter);

    expect(await screen.findByText('120')).toBeTruthy();
    expect(screen.queryByText('1,119')).toBeNull();
  });

  it('reads the response under `<field>` when the adapter does not suffix it', async () => {
    // The second limb of the same readback chain, and the reason `field` is a
    // member of the RESPONSE contract and not only of the request.
    const adapter = aggregatingAdapter([{ amount: 42 }]);
    mount({ objectName: 'deal', aggregate: { field: 'amount', function: 'sum' } }, adapter);

    expect(await screen.findByText('42')).toBeTruthy();
  });

  it('with NO `aggregate` the query verb changes to `find()` and the value is the row count', async () => {
    // The key's absence is a member semantic, and this row is the file's
    // non-vacuity floor: its green requires the adapter to have been asked.
    const adapter = countingAdapter([{ id: 1 }, { id: 2 }, { id: 3 }]);
    mount({ objectName: 'deal' }, adapter);

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(await screen.findByText('3')).toBeTruthy();
  });
});

describe('object-metric — the `filter` member shape (objectui#8071)', () => {
  const HOT = [['rating', '=', 'hot']];

  it('reaches the aggregate FLAT, under its own name, beside the aggregate members', async () => {
    const adapter = aggregatingAdapter([{ amount_sum: 120 }]);
    mount(
      { objectName: 'deal', aggregate: { field: 'amount', function: 'sum' }, filter: HOT },
      adapter,
    );

    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalled());
    // The whole bag again, now WITH the predicate — this is the assertion that
    // a "tidy the two spellings into one" change has to get past.
    expect(bagOf(adapter)).toEqual({
      field: 'amount',
      function: 'sum',
      groupBy: '_all',
      filter: HOT,
    });
  });

  it('reaches the `find()` fallback WRAPPED as `$filter`', async () => {
    // Same authored key, adapter without `aggregate()`, different spelling.
    // Neither row can be satisfied by the other's spelling, which is the point.
    const adapter = countingAdapter([{ id: 1 }]);
    mount({ objectName: 'deal', filter: HOT }, adapter);

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(adapter.find.mock.calls[0][0]).toBe('deal');
    expect(adapter.find.mock.calls[0][1]).toEqual({ $filter: HOT });
  });

  it('resolves date placeholders BEFORE the query, not on the wire', async () => {
    const quarterStart = new Date();
    quarterStart.setMonth(Math.floor(quarterStart.getMonth() / 3) * 3, 1);
    const expected = `${quarterStart.getFullYear()}-${String(quarterStart.getMonth() + 1).padStart(2, '0')}-01`;

    const adapter = aggregatingAdapter([{ amount_sum: 120 }]);
    mount(
      {
        objectName: 'deal',
        aggregate: { field: 'amount', function: 'sum' },
        filter: { close_date: { $gte: '{current_quarter_start}' } },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalled());
    const sent = (bagOf(adapter).filter as { close_date: { $gte: string } }).close_date.$gte;
    expect(sent).toBe(expected);
    // Stated separately: a macro that survives onto the wire is a literal
    // nobody matches, and the metric then reads 0 with no diagnostic.
    expect(String(sent)).not.toContain('{');
  });

  it('is read BY VALUE — a deep-equal rebuild does not re-query, a changed comparand does', async () => {
    const adapter = aggregatingAdapter([{ amount_sum: 120 }]);
    const aggregate = { field: 'amount', function: 'sum' };
    const view = (filter: unknown) => (
      <SchemaRendererProvider dataSource={adapter as never}>
        <SchemaRenderer
          schema={{ type: 'object-metric', label: 'Pipeline', objectName: 'deal', aggregate, filter } as never}
        />
      </SchemaRendererProvider>
    );

    const { rerender } = render(view([['rating', '=', 'hot']]));
    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalledTimes(1));

    // A fresh, deep-equal literal — a re-rendering parent, not a new question.
    rerender(view([['rating', '=', 'hot']]));
    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalledTimes(1));

    // …and a changed comparand IS a new question, carrying the new predicate.
    rerender(view([['rating', '=', 'cold']]));
    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalledTimes(2));
    expect(bagOf(adapter, 1).filter).toEqual([['rating', '=', 'cold']]);
  });
});
