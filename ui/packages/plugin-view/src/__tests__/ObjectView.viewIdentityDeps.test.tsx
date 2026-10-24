/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6460 — `ObjectView`'s non-grid fetch effect re-ran once per PARENT
 * render whenever the host built its `views` array inline.
 *
 * ## The defect
 *
 * `activeView` is an ELEMENT of the `views` prop array
 * (`viewsPropResolved?.find(...) || viewsPropResolved?.[0]`), and it was listed
 * in the effect's dependency array. A host writing
 * `views={[{ id: 'cal', type: 'calendar', label: … }]}` builds a fresh element
 * object on every one of its own renders, so the dependency changed identity
 * every render and a new `find()` went out each time. Measured on the merge
 * base of this branch with the harness below (3 parent re-renders after the
 * first query settles):
 *
 *   FRESH `views` array literal   find calls: 4
 *   STABLE (hoisted) array        find calls: 1   ← control
 *
 * The control is what makes this a defect rather than a property of
 * re-rendering. Beyond the query count it also matters downstream:
 * `ObjectView` hands rows to the child as `data={data}`, so every extra
 * `find()` re-delivers a fresh row array — the "duplicate events in child
 * views like the calendar" hazard.
 *
 * ## ⚠️ The dependency that a fix written from the card's text would drop
 *
 * objectui#6460's body claims the effect "only ever reads `activeView?.filter`
 * and `activeView?.type`". It does not. Measured inside the effect body,
 * `activeView` is read at exactly two sites and the second is **`sort`**:
 *
 *   currentNamedViewConfig?.filter || activeView?.filter || schema.table?.…
 *   currentNamedViewConfig?.sort   || activeView?.sort   || schema.table?.…
 *
 * A fix built on that sentence would depend on `id` + filter and silently drop
 * `sort`, so a host changing only a view's sort would stop re-fetching — a
 * worse defect than the churn, and one that passes every test written from the
 * card's own wording. `re-fetches when only the view's SORT changes` below is
 * the pin that holds that shut; it is a control, not a nice-to-have.
 *
 * ## ⚠️ Ghost-assertion guard
 *
 * "Exactly 1 query" would also pass if the view stopped fetching altogether.
 * So every count here is reached only after waiting for a real call, the
 * controls assert the query PARAMS that came back (not merely that a call
 * happened), and one test asserts rows really reach the child view.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema } from '@object-ui/types';

const deliveries: any[][] = [];

vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema, data }: any) => {
      if (Array.isArray(data) && data.length > 0) {
        const g = (globalThis as any).__objectViewChurnDeliveries as any[][] | undefined;
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

const TASK_SCHEMA = {
  name: 'task',
  label: 'Task',
  fields: { name: { type: 'text', label: 'Name' } },
};

const ROWS = [{ id: 't1', name: 'Ship it' }];

function makeAdapter(): Record<string, any> {
  return {
    getObjectSchema: vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return TASK_SCHEMA;
    }),
    // A FRESH array per response, as the wire produces: one shared array would
    // make `setData` a reference-equal no-op and hide every extra delivery.
    find: vi.fn(async () => ({ data: ROWS.map((r) => ({ ...r })), total: ROWS.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

/** The schema object is HOISTED, so the only moving part is the `views` array. */
const SCHEMA = {
  type: 'object-view',
  objectName: 'task',
  defaultViewType: 'calendar',
} as ObjectViewSchema;

/** The control: one array, one element object, for the whole test. */
const STABLE_VIEWS = [{ id: 'cal', label: 'Calendar', type: 'calendar' as const }];

/** What a host that writes the array inline produces — a fresh object each call. */
const freshViews = () => [{ id: 'cal', label: 'Calendar', type: 'calendar' as const }];

const paramsOf = (adapter: Record<string, any>) =>
  adapter.find.mock.calls.map((c: any[]) => c[1] ?? {});

beforeEach(() => {
  vi.clearAllMocks();
  deliveries.length = 0;
  (globalThis as any).__objectViewChurnDeliveries = deliveries;
});

/**
 * Drive N parent re-renders through the SAME element factory, so a factory that
 * builds `views` inline hands `ObjectView` a fresh array every time and a
 * hoisted one hands it the same array every time. `tick` exists only to make
 * each render a real one.
 */
async function reRender(rerender: (ui: React.ReactElement) => void, ui: (tick: number) => React.ReactElement, times: number) {
  for (let i = 1; i <= times; i++) {
    await act(async () => {
      rerender(ui(i));
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

describe('ObjectView non-grid fetch does not churn on an inline `views` array (objectui#6460)', () => {
  it('issues ONE query across three parent re-renders with a FRESH `views` array', async () => {
    const adapter = makeAdapter();
    const ui = (tick: number) => (
      <div data-tick={tick}>
        <ObjectView schema={SCHEMA} dataSource={adapter as any} views={freshViews()} />
      </div>
    );
    const { rerender } = render(ui(0));

    // Targets a real call, so "stopped fetching" times out rather than reading
    // as success.
    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(1));
    await reRender(rerender, ui, 3);

    // RED before the fix: 4.
    expect(adapter.find).toHaveBeenCalledTimes(1);
    // And the child view was handed exactly one row array.
    expect(deliveries).toHaveLength(1);
  });

  it('issues ONE query across three parent re-renders with a STABLE `views` array (control)', async () => {
    const adapter = makeAdapter();
    const ui = (tick: number) => (
      <div data-tick={tick}>
        <ObjectView schema={SCHEMA} dataSource={adapter as any} views={STABLE_VIEWS} />
      </div>
    );
    const { rerender } = render(ui(0));

    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(1));
    await reRender(rerender, ui, 3);

    expect(adapter.find).toHaveBeenCalledTimes(1);
    expect(deliveries).toHaveLength(1);
  });

  it('re-fetches when the view’s FILTER changes, and the new query carries it', async () => {
    const adapter = makeAdapter();
    const ui = (filter: any[]) => (
      <ObjectView
        schema={SCHEMA}
        dataSource={adapter as any}
        views={[{ id: 'cal', label: 'Calendar', type: 'calendar' as const, filter }]}
      />
    );
    const { rerender } = render(ui([['status', '=', 'open']]));
    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender(ui([['status', '=', 'closed']]));
      await new Promise((r) => setTimeout(r, 20));
    });

    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(2));
    // Params, not just a count: the second query must carry the NEW filter.
    expect(JSON.stringify(paramsOf(adapter)[1].$filter)).toContain('closed');
    expect(JSON.stringify(paramsOf(adapter)[0].$filter)).toContain('open');
  });

  it('re-fetches when only the view’s SORT changes — the dependency the card’s wording would have dropped', async () => {
    const adapter = makeAdapter();
    const ui = (order: 'asc' | 'desc') => (
      <ObjectView
        schema={SCHEMA}
        dataSource={adapter as any}
        views={[{ id: 'cal', label: 'Calendar', type: 'calendar' as const, sort: [{ field: 'name', order }] }]}
      />
    );
    const { rerender } = render(ui('asc'));
    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender(ui('desc'));
      await new Promise((r) => setTimeout(r, 20));
    });

    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(2));
    expect(paramsOf(adapter)[0].$orderby).toEqual({ name: 'asc' });
    expect(paramsOf(adapter)[1].$orderby).toEqual({ name: 'desc' });
  });

  it('re-fetches when the ACTIVE VIEW ID changes, even between two views of the same type', async () => {
    const adapter = makeAdapter();
    const VIEWS = [
      { id: 'cal-a', label: 'A', type: 'calendar' as const },
      { id: 'cal-b', label: 'B', type: 'calendar' as const },
    ];
    const ui = (activeViewId: string) => (
      <ObjectView schema={SCHEMA} dataSource={adapter as any} views={VIEWS} activeViewId={activeViewId} />
    );
    const { rerender } = render(ui('cal-a'));
    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender(ui('cal-b'));
      await new Promise((r) => setTimeout(r, 20));
    });

    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(2));
  });

  it('keeps the named-view config outranking the view’s own filter and sort', async () => {
    const adapter = makeAdapter();
    render(
      <ObjectView
        schema={{
          ...SCHEMA,
          listViews: {
            // objectui#7928: the protocol's named view — `columns`, and
            // `filter` as rule objects rather than the ObjectQL tuple dialect.
            named: {
              label: 'Named',
              type: 'calendar',
              columns: ['name'],
              filter: [{ field: 'status', operator: 'equals', value: 'named-wins' }],
              sort: [{ field: 'created', order: 'desc' }],
            },
          },
          defaultListView: 'named',
        } as ObjectViewSchema}
        dataSource={adapter as any}
        views={[{
          id: 'cal',
          label: 'Calendar',
          type: 'calendar' as const,
          filter: [['status', '=', 'view-loses']],
          sort: [{ field: 'name', order: 'asc' }],
        }]}
      />,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(1));
    const p = paramsOf(adapter)[0];
    expect(JSON.stringify(p.$filter)).toContain('named-wins');
    expect(JSON.stringify(p.$filter)).not.toContain('view-loses');
    expect(p.$orderby).toEqual({ created: 'desc' });
  });

  it('issues ONE query when the inline view carries a FILTER and a SORT rebuilt every render', async () => {
    // The case a fix keyed on `activeView?.id` alone would MISS: the id is a
    // string and stable, but a host that inlines the array also inlines the
    // filter and sort objects inside it, so an identity-only dependency churns
    // exactly as before. This is why the dependency compares by structure.
    const adapter = makeAdapter();
    const ui = (tick: number) => (
      <div data-tick={tick}>
        <ObjectView
          schema={SCHEMA}
          dataSource={adapter as any}
          views={[{
            id: 'cal',
            label: 'Calendar',
            type: 'calendar' as const,
            filter: [['status', '=', 'open'], ['due', '>=', new Date('2026-01-01')]],
            sort: [{ field: 'name', order: 'asc' as const }],
          }]}
        />
      </div>
    );
    const { rerender } = render(ui(0));

    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(1));
    await reRender(rerender, ui, 3);

    expect(adapter.find).toHaveBeenCalledTimes(1);
    // And the one query it did issue still carried the authored filter and sort.
    const p = paramsOf(adapter)[0];
    expect(JSON.stringify(p.$filter)).toContain('open');
    expect(p.$orderby).toEqual({ name: 'asc' });
  });

  it('re-fetches when a filter’s DATE moves to a different instant', async () => {
    // The other half of the test above: holding the reference steady must not
    // blind the effect to a real change in a value that has no stable
    // stringification.
    const adapter = makeAdapter();
    const ui = (day: string) => (
      <ObjectView
        schema={SCHEMA}
        dataSource={adapter as any}
        views={[{
          id: 'cal',
          label: 'Calendar',
          type: 'calendar' as const,
          filter: [['due', '>=', new Date(day)]],
        }]}
      />
    );
    const { rerender } = render(ui('2026-01-01'));
    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender(ui('2026-02-01'));
      await new Promise((r) => setTimeout(r, 20));
    });

    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(2));
  });
});
