/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6419 — the object schema GATES `ObjectView`'s non-grid record query.
 *
 * ## What this replaces
 *
 * The non-grid fetch effect built its expand set from a REF
 * (`objectSchemaRef.current`), assigned in the render body, and deliberately
 * omitted `objectSchema` from its dependency list. That bought exactly one
 * effect run per mount — and paid for it with the expansion, permanently: on
 * that one run the ref was still `null`, `buildExpandFields` saw no fields, and
 * the query went out as
 *
 *     ['task', { $top: 100 }]                       ← no `$expand`, ever
 *
 * `ObjectView` hands those rows to the child as `data={data}`, which suppresses
 * the child's own fetch, so every lookup / master_detail / user / tree field in
 * the six non-grid views it hosts (kanban, calendar, gallery, timeline, gantt,
 * map) rendered from raw foreign-key ids — blank on the kanban via
 * `isOpaqueId`, potentially the raw id on the other five.
 *
 * ## Why gating, and why the kanban's numbers did not decide it
 *
 * objectui#6271 settled the same trade for `ObjectKanban`, but this effect has
 * five more dependencies (`currentViewType`, `currentNamedViewConfig`,
 * `activeView`, `renderListView`, `refreshKey`), so what an extra re-run costs
 * HERE was measured separately. Instrumented adapter, `getObjectSchema` and
 * `find` both resolving in 30ms, four host regimes (bare, named `listViews`,
 * `views` prop, `views` prop with a re-rendering parent):
 *
 *   before             1 find, `{$top:100}`; `$expand` NEVER sent. Child gets
 *                      one delivery — raw rows.
 *   `objectSchema`     2 finds, `[{$top:100}, {$top:100,$expand:[…]}]`. Child
 *   added to the deps  gets TWO deliveries: `raw`, then `expanded`.
 *   gated (this file)  1 find, carrying `$expand` the first time. One
 *                      delivery — `expanded`.
 *
 * The middle row is where this component parts company with the board. On the
 * kanban the unexpanded first response was DISCARDED on arrival (`isMounted`
 * flipped false before it landed): a wasted round trip, no visible artefact.
 * Here the measured order is `schema:settled -> find:settled -> find:issued` —
 * the raw rows settle into `setData` BEFORE the re-run's cleanup, reach the
 * child, and paint. An extra re-run on THIS effect therefore costs a visible
 * two-step render (~40ms of blank-or-raw relation fields, then a swap), which
 * is precisely the "duplicate events in child views like the calendar" the
 * removed ref-comment cited. Gating avoids the wasted query AND the wrong
 * paint; correct rows land at the same wall clock either way (66.8–69.1ms
 * gated vs 68.3–69.3ms via the deps).
 *
 * ## ⚠️ What "gated" must mean — the trap this file exists to hold shut
 *
 * The gate is on the schema read having **settled**, NOT on `objectSchema`
 * being truthy. Those differ for exactly the views least able to report it: an
 * adapter exposing no `getObjectSchema`, and a read that throws. Under a
 * truthy-value gate both wait forever and the view renders empty, with no error
 * and no request — the third and fourth tests below go red the moment anyone
 * writes that.
 *
 * ## ⚠️ Ghost-assertion guard
 *
 * A query count, or an `$expand` presence check, would ALSO pass if this view
 * stopped fetching altogether. So: every count here is reached only after
 * waiting for a real call; the first test's `waitFor` targets the EXPANDED call
 * specifically, so zero fetches times out rather than reading as success; one
 * test asserts rows actually reach the child; and `$expand` is asserted against
 * the expandable fields DERIVED FROM THE FIXTURE SCHEMA, never a bare
 * `toBeDefined()`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { EXPANDABLE_FIELD_TYPES } from '@object-ui/core';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema } from '@object-ui/types';

/** Every non-empty row array `ObjectView` hands the child view, in order. */
const deliveries: any[][] = [];

vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    // Records the `data` prop, which is the seam the defect is visible at:
    // ObjectView passes `data={data}` down, suppressing the child's own fetch.
    SchemaRenderer: ({ schema, data }: any) => {
      if (Array.isArray(data) && data.length > 0) {
        const g = (globalThis as any).__objectViewDeliveries as any[][] | undefined;
        if (g && g[g.length - 1] !== data) g.push(data);
      }
      return <div data-testid="schema-renderer">{schema?.type}</div>;
    },
    SchemaRendererContext: React.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: () => <div data-testid="object-grid" />,
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

/**
 * One field of every expandable type, plus non-expandable neighbours. The
 * expectation below is DERIVED from this map rather than written out, so the
 * assertion is on `$expand`'s contents against the schema — a field added here
 * with an expandable type must show up in the query or the test fails.
 */
const TASK_FIELDS: Record<string, { type: string; label: string; reference?: string }> = {
  name: { type: 'text', label: 'Name' },
  amount: { type: 'currency', label: 'Amount' },
  due_date: { type: 'date', label: 'Due' },
  owner: { type: 'user', label: 'Owner' },
  account: { type: 'lookup', label: 'Account', reference: 'account' },
  // No target key. It carried the retired snake_case spelling, which
  // `FieldSchema` refuses BY NAME (measured: `unrecognized_keys` plus a
  // rename hint, where a nonsense key draws the same refusal without one), so
  // the line annotated nothing and the `$expand` expectation is derived from
  // the declared TYPE. On a `tree` the target is optional; this map's object
  // is `task` and the value named it, so renaming would turn a refused key
  // into an accepted self-annotation this fixture never made (objectui#8031).
  parent_task: { type: 'tree', label: 'Parent' },
  line_item: { type: 'master_detail', label: 'Line item', reference: 'line_item' },
};

const TASK_SCHEMA = { name: 'task', label: 'Task', fields: TASK_FIELDS };

/** The four expandable types, read from core's own set — not a copy of it. */
const EXPECTED_EXPAND = Object.entries(TASK_FIELDS)
  .filter(([, def]) => EXPANDABLE_FIELD_TYPES.has(def.type))
  .map(([fieldName]) => fieldName);

const NON_EXPANDABLE = Object.entries(TASK_FIELDS)
  .filter(([, def]) => !EXPANDABLE_FIELD_TYPES.has(def.type))
  .map(([fieldName]) => fieldName);

const ROWS = [{ id: 't1', name: 'Ship it', account: 'acc-1' }];

/**
 * `getObjectSchema` deliberately resolves a tick LATER than a bare
 * `mockResolvedValue` would, so a view that queries before the schema settles
 * is caught rather than passing on scheduling luck.
 */
function makeAdapter(getObjectSchema?: () => Promise<unknown>): Record<string, any> {
  const order: string[] = [];
  const adapter: Record<string, any> = {
    order,
    find: vi.fn(async (_object: string, params: any) => {
      order.push('find');
      // A FRESH array per response, as the wire produces, tagged with the query
      // that produced it. Returning one shared array would make `setData` a
      // reference-equal no-op and hide every extra delivery.
      const tag = Array.isArray(params?.$expand) && params.$expand.length > 0 ? 'expanded' : 'raw';
      return { data: ROWS.map((r) => ({ ...r, _from: tag })), total: ROWS.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  if (getObjectSchema) {
    adapter.getObjectSchema = vi.fn(async (objectName: string) => {
      order.push('schema:issued');
      try {
        return await getObjectSchema();
      } finally {
        order.push('schema:settled');
        void objectName;
      }
    });
  }
  return adapter;
}

const resolvesSchema = () =>
  makeAdapter(async () => {
    await new Promise((r) => setTimeout(r, 10));
    return TASK_SCHEMA;
  });

/**
 * Render the REAL `ObjectView` on a NON-grid path. `defaultViewType` is
 * anything but `grid`: the grid path delegates its fetch to `ObjectGrid` and
 * never reaches the effect under test.
 */
function renderView(adapter: Record<string, any>, extra: Partial<ObjectViewSchema> = {}) {
  return render(
    <ObjectView
      schema={{
        type: 'object-view',
        objectName: 'task',
        defaultViewType: 'calendar',
        ...extra,
      } as ObjectViewSchema}
      dataSource={adapter as any}
    />,
  );
}

const paramsOf = (adapter: Record<string, any>) =>
  adapter.find.mock.calls.map((c: any[]) => c[1] ?? {});
const expandedCalls = (adapter: Record<string, any>) =>
  paramsOf(adapter).filter((p: any) => Array.isArray(p.$expand) && p.$expand.length > 0);
const unexpandedCalls = (adapter: Record<string, any>) =>
  paramsOf(adapter).filter((p: any) => !Array.isArray(p.$expand) || p.$expand.length === 0);

beforeEach(() => {
  vi.clearAllMocks();
  deliveries.length = 0;
  (globalThis as any).__objectViewDeliveries = deliveries;
});

describe('ObjectView gates its non-grid query on the object schema (objectui#6419)', () => {
  it('issues ONE query, and it carries the object’s `$expand`', async () => {
    const adapter = resolvesSchema();
    renderView(adapter);

    // Control — this `waitFor` targets the EXPANDED call, not "any call" and
    // not "the mock exists". If the gate ever stops opening, no such call is
    // recorded, this times out, and the file goes red: "0 queries" can never
    // read as success here.
    await waitFor(() => expect(expandedCalls(adapter)).toHaveLength(1));

    // RED before the fix: this read `[{ $top: 100 }]` — the query that never
    // carried an expansion at all.
    expect(unexpandedCalls(adapter)).toEqual([]);
    expect(adapter.find).toHaveBeenCalledTimes(1);
    expect(adapter.find.mock.calls[0][0]).toBe('task');
  });

  it('sends exactly the schema’s expandable fields — asserted against the fixture, not merely present', async () => {
    const adapter = resolvesSchema();
    renderView(adapter);

    await waitFor(() => expect(expandedCalls(adapter)).toHaveLength(1));
    const $expand: string[] = expandedCalls(adapter)[0].$expand;

    // Contents, both directions. `EXPECTED_EXPAND` is derived from the fixture
    // through core's own `EXPANDABLE_FIELD_TYPES`, so this covers all four
    // relation types (`user`, `lookup`, `tree`, `master_detail`) and fails if
    // one stops being expanded.
    expect(EXPECTED_EXPAND.length).toBe(4);
    expect([...$expand].sort()).toEqual([...EXPECTED_EXPAND].sort());
    for (const plain of NON_EXPANDABLE) {
      expect($expand).not.toContain(plain);
    }
  });

  it('issues that query only AFTER the schema read settles', async () => {
    const adapter = resolvesSchema();
    renderView(adapter);

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    // Ordering, not just counting: a fix that merely deduplicated a second
    // query would satisfy the count above while still querying too early.
    expect(adapter.order).toEqual(['schema:issued', 'schema:settled', 'find']);
  });

  it('hands the child view ONE delivery, and it is the expanded one', async () => {
    // The measured user-visible cost of an extra re-run on THIS effect: with
    // `objectSchema` in the dependency list the child received `raw` then
    // `expanded` — a two-step paint in which every relation field is blank or a
    // raw id for ~40ms. This pins the single-delivery outcome, and doubles as
    // the control that rows really reach the child rather than the query
    // vanishing.
    const adapter = resolvesSchema();
    renderView(adapter);

    await waitFor(() => expect(deliveries.length).toBeGreaterThan(0));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0][0]._from).toBe('expanded');
  });

  it('still queries — and paints — when the adapter exposes NO `getObjectSchema`', async () => {
    // The gate is on the read having settled, not on a truthy schema. An
    // adapter without the method settles with nothing to report, and the view
    // must fall through to an unexpanded query rather than wait forever.
    const adapter = makeAdapter();
    renderView(adapter);

    await waitFor(() => expect(deliveries.length).toBeGreaterThan(0));
    expect(adapter.find).toHaveBeenCalledTimes(1);
    // Nothing declared any field, so there is no expand set to derive.
    expect(unexpandedCalls(adapter)).toHaveLength(1);
    expect(deliveries[0][0]._from).toBe('raw');
  });

  it('still queries — and paints — when the schema read REJECTS', async () => {
    const adapter = makeAdapter(async () => {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error('metadata endpoint down');
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderView(adapter);

      await waitFor(() => expect(deliveries.length).toBeGreaterThan(0));
      expect(adapter.find).toHaveBeenCalledTimes(1);
      expect(unexpandedCalls(adapter)).toHaveLength(1);
      expect(adapter.order).toEqual(['schema:issued', 'schema:settled', 'find']);
    } finally {
      err.mockRestore();
    }
  });

  it('a grid view still delegates its fetch — the gate did not start one', async () => {
    // Control in the other direction: the gate must not have turned the grid
    // path (which owns its own fetching, via ObjectGrid) into a fetching one.
    const adapter = resolvesSchema();
    renderView(adapter, { defaultViewType: 'grid' });

    await waitFor(() => expect(adapter.getObjectSchema).toHaveBeenCalled());
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('re-gates when the object changes, so no query carries the previous object’s expand set', async () => {
    // The resolution is KEYED by object name and compared during render, so
    // switching objects closes the gate in the same commit that changes it.
    const adapter = resolvesSchema();
    const { rerender } = renderView(adapter);
    await waitFor(() => expect(expandedCalls(adapter)).toHaveLength(1));

    adapter.getObjectSchema.mockImplementation(async () => {
      adapter.order.push('schema:issued');
      await new Promise((r) => setTimeout(r, 10));
      adapter.order.push('schema:settled');
      return { name: 'note', label: 'Note', fields: { body: { type: 'text', label: 'Body' } } };
    });

    rerender(
      <ObjectView
        schema={{ type: 'object-view', objectName: 'note', defaultViewType: 'calendar' } as ObjectViewSchema}
        dataSource={adapter as any}
      />,
    );

    await waitFor(() => expect(adapter.find.mock.calls.length).toBeGreaterThan(1));
    const noteCalls = adapter.find.mock.calls.filter((c: any[]) => c[0] === 'note');
    expect(noteCalls).toHaveLength(1);
    // `note` declares no expandable field. A stale resolution would have sent
    // `task`'s expand set against `note`.
    const noteParams = noteCalls[0][1] ?? {};
    expect(noteParams.$expand === undefined || noteParams.$expand.length === 0).toBe(true);
  });
});
