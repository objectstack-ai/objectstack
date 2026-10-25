/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `element:number`'s filter — the MEMBER SHAPE this metric reads (objectui#8071).
 *
 * ⚠️ objectui#11880 moved the door: the metric reads its filter from the
 * node-level `dataSource.filter` only (objectstack#11509, ruled A-narrow), and
 * the flat `properties.filter` this file first pinned stays published (until
 * the spec's v18 retirement) and is not read. Every row below drives the
 * binding. What changed on the wire is the
 * SHAPE of the value: the binding's filter is lowered to the ObjectQL AST
 * (`toFilterNodeSafely`) before it reaches either spelling, where the flat key
 * used to arrive verbatim. The two spellings and the by-value rule are
 * unchanged.
 *
 * The member pin for this key. Unlike the other keys this card has pinned,
 * `filter` carries no NAMED member set of its own: it is a query predicate
 * `ElementNumberRenderer` (`renderers/basic/elements.tsx`) never inspects. So
 * the member shape here is the SPELLING it arrives under downstream, and the
 * renderer uses TWO different ones on its two paths:
 *
 *   - `adapter.aggregate(object, { field, function, groupBy: '_all', filter })`
 *     — flat, under its own name, beside the three keys that make the call an
 *     aggregate at all.
 *   - `adapter.find(object, { $filter: filter })` — the fallback when the
 *     adapter carries no `aggregate()`, WRAPPED under `$filter`.
 *
 * One authored key, two wire spellings, chosen by a capability check the author
 * cannot see. That is precisely the kind of thing that gets "tidied" into one
 * spelling, and either direction silently drops the predicate: a metric that
 * should read "open opportunities" then counts EVERY row and paints a
 * confidently wrong number. No diagnostic, no empty state — the failure mode
 * this whole direction (objectui#8068) exists to make loud.
 *
 * The third member semantic is the re-query rule. The effect keys on the
 * resolved filter's CONTENT (`filterKey`, a `JSON.stringify` of it), not on
 * the object identity,
 *
 * so the predicate is read BY VALUE. A parent that rebuilds an equal filter
 * literal every render must NOT re-probe the server, and a parent that changes
 * one comparand MUST. Both arms are asserted, because a dependency array
 * "simplified" to the raw filter object passes the second and turns the first
 * into a per-render fetch storm.
 *
 * ## Nothing pre-existing covered this
 *
 * Measured before writing: exactly two test files name `element:number` and
 * touch this area, and neither can be credited.
 * `element-number.contractEnvelope-6726.test.tsx` (read end to end) drives the
 * SAME `find()` fallback branch but authors no `filter` at all — the word does
 * not occur in it, so the locator itself would refuse it ("pin file never names
 * the key"). `data-objectstack`'s `aggregate-filter-lowering.test.ts` mentions
 * `element:number` once, in a comment, and tests the adapter's own lowering
 * below this seam rather than what the renderer hands it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { AdapterCtx, SchemaRenderer } from '@object-ui/react';
// Registers every `element:*` renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../../renderers';

afterEach(cleanup);

const OPEN_ONLY = [{ field: 'stage', operator: 'not_equals', value: 'closed' }];
/** {@link OPEN_ONLY} as the metric hands it on: lowered to the ObjectQL AST. */
const OPEN_ONLY_NODE = [['stage', 'not_equals', 'closed']];

const metric = (filter?: unknown) => ({
  type: 'element:number',
  id: 'metric',
  // The query is the node-level `dataSource` binding (objectui#11880); the
  // aggregate's own keys live in the `properties` bag (`readProps`).
  dataSource: { object: 'opportunity', ...(filter ? { filter } : {}) },
  properties: { field: 'amount', aggregate: 'sum' },
});

/** An adapter that CAN aggregate — the primary path. */
const aggregating = () => ({
  aggregate: vi.fn(async () => [{ amount_sum: 42 }]),
  find: vi.fn(async () => ({ data: [] })),
});

/** An adapter that cannot — `find()` is the only way to a number. */
const findingOnly = () => ({ find: vi.fn(async () => ({ data: [{ id: 'r1' }] })) });

function mount(adapter: unknown, filter?: unknown) {
  return render(
    <AdapterCtx.Provider value={adapter as never}>
      <SchemaRenderer schema={metric(filter) as never} />
    </AdapterCtx.Provider>,
  );
}

describe('element:number filter — member shape (objectui#8071)', () => {
  it('reaches `aggregate()` FLAT, under its own name, beside the aggregate members', async () => {
    const adapter = aggregating();
    mount(adapter, OPEN_ONLY);

    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalledOnce());
    // The whole options bag, not just the filter — `groupBy: '_all'` and
    // `function` are what make this an aggregate rather than a query, and a
    // filter that arrived without them would be counting something else.
    expect(adapter.aggregate).toHaveBeenCalledWith('opportunity', {
      field: 'amount',
      function: 'sum',
      groupBy: '_all',
      filter: OPEN_ONLY_NODE,
    });
    // Lowered, and otherwise as authored: the renderer does not wrap or
    // re-key the predicate on this path.
    expect((adapter.aggregate as any).mock.calls[0][1].filter).toEqual(OPEN_ONLY_NODE);
  });

  it('reaches the `find()` fallback WRAPPED as `$filter` — the other spelling', async () => {
    // Same authored key, same value, different adapter capability. This is the
    // row that makes "two spellings" a reading rather than an assumption.
    const adapter = findingOnly();
    mount(adapter, OPEN_ONLY);

    await waitFor(() => expect(adapter.find).toHaveBeenCalledOnce());
    expect(adapter.find).toHaveBeenCalledWith('opportunity', { $filter: OPEN_ONLY_NODE });
  });

  it('sends NO options at all to `find()` when no filter is authored', async () => {
    // `queryFilter ? { $filter: queryFilter } : undefined`. The control for
    // the row above: an unfiltered metric must not ship an empty envelope,
    // which some adapters read as "match nothing".
    const adapter = findingOnly();
    mount(adapter);

    await waitFor(() => expect(adapter.find).toHaveBeenCalledOnce());
    expect(adapter.find).toHaveBeenCalledWith('opportunity', undefined);
  });

  it('is read BY VALUE — an equal filter rebuilt with a new identity does NOT re-probe', async () => {
    // The re-query rule. A parent re-rendering with a fresh object literal is
    // the normal case, not an exotic one, and a dependency on the reference
    // would turn every such render into a server round trip.
    const adapter = aggregating();
    const view = mount(adapter, [{ field: 'stage', operator: 'not_equals', value: 'closed' }]);
    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalledOnce());

    view.rerender(
      <AdapterCtx.Provider value={adapter as never}>
        {/* Deep-equal, freshly allocated — a different object, the same predicate. */}
        <SchemaRenderer schema={metric([{ field: 'stage', operator: 'not_equals', value: 'closed' }]) as never} />
      </AdapterCtx.Provider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(adapter.aggregate).toHaveBeenCalledOnce();
  });

  it('…and a filter whose VALUE changes does re-probe, with the new predicate', async () => {
    // The other arm, and the non-vacuity control for the row above: without it
    // a renderer that never re-probed at all would pass that assertion.
    const adapter = aggregating();
    const view = mount(adapter, [{ field: 'stage', operator: 'not_equals', value: 'closed' }]);
    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalledOnce());

    view.rerender(
      <AdapterCtx.Provider value={adapter as never}>
        <SchemaRenderer schema={metric([{ field: 'stage', operator: 'not_equals', value: 'won' }]) as never} />
      </AdapterCtx.Provider>,
    );

    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalledTimes(2));
    expect((adapter.aggregate as any).mock.calls[1][1].filter).toEqual([['stage', 'not_equals', 'won']]);
  });
});
