/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The mapping half of `PageComponentSchema.dataSource` (objectstack#6953).
 *
 * `useElementDataSource` resolves the binding; this module writes the composed
 * result onto the schema keys a given block reads. Two properties are pinned
 * here because every block wiring depends on them and none of the per-block
 * suites can see them:
 *
 *  1. **The precedence table is one table.** Binding beats component key, view
 *     is only a baseline, `filter` AND-combines instead of replacing. Eight
 *     blocks share it, so it is asserted once at the source rather than eight
 *     times through eight renderers.
 *  2. **An unmapped key is never written.** A mapping names only the keys its
 *     block actually reads; writing a composed value onto a key the block
 *     ignores would recreate the defect this wiring removes — a value accepted
 *     and silently dropped — one layer deeper, where nothing reports it. The
 *     `object-kanban` / `object-chart` / `object-metric` wirings are exactly
 *     that case, so "does not write what it was not told to" is a pin, not a
 *     nicety.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';
import { elementDataSourceRefusedLimitMessage } from '@object-ui/core';
import {
  ElementDataSourceGate,
  noDataSourceMessage,
  useElementDataSourceSchema,
  useResolvedDataSource,
  type ElementDataSourceMapping,
} from '../ElementDataSourceGate';
import { SchemaRendererProvider } from '../../context/SchemaRendererContext';

const HOT_VIEW = {
  name: 'hot',
  label: 'Hot accounts',
  type: 'kanban',
  columns: ['name', 'rating'],
  filter: [['rating', '=', 'hot']],
  sort: [{ field: 'name', order: 'desc' }],
  pagination: { pageSize: 7 },
};

/** An adapter that can answer "what saved views does this object have?". */
const makeAdapter = (listViews: Record<string, unknown> = { hot: HOT_VIEW }) => ({
  find: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'account', listViews }),
});

const FULL: ElementDataSourceMapping = {
  columns: true,
  filter: true,
  sort: true,
  limit: 'pagination.pageSize',
  viewType: true,
};

function useBound(schema: unknown, mapping: ElementDataSourceMapping, adapter: unknown) {
  return useElementDataSourceSchema(schema as Record<string, any>, mapping, adapter);
}

const resolved = async (schema: unknown, mapping: ElementDataSourceMapping, adapter?: unknown) => {
  const { result } = renderHook(() => useBound(schema, mapping, adapter ?? makeAdapter()));
  await waitFor(() => expect(result.current.status).not.toBe('loading'));
  return result;
};

describe('useElementDataSourceSchema — no binding', () => {
  it('returns the schema BY REFERENCE so the block is not remounted', () => {
    const schema = { type: 'object-grid', objectName: 'task' };
    const { result } = renderHook(() => useBound(schema, FULL, makeAdapter()));
    expect(result.current.status).toBe('absent');
    // Identity, not deep equality: a fresh object every render would give the
    // block a new schema each time — remount, refetch, lost scroll.
    expect(result.current.schema).toBe(schema);
  });

  it('never mistakes the spec BINDING passed as the adapter for an adapter', async () => {
    // The name collision, from the other side: a host (or an older cached
    // bundle) handing the gate the binding under the adapter argument used to
    // make a real saved view report as unresolvable ("this data source cannot
    // list the saved views"). The context adapter is used instead.
    const { result } = renderHook(() =>
      useBound(
        { dataSource: { object: 'account', view: 'hot' } },
        FULL,
        { object: 'account', view: 'hot' },
      ),
    );
    await waitFor(() => expect(result.current.status).not.toBe('loading'));
    // No context provider in this harness, so the honest answer is "nobody here
    // can list views" — but crucially NOT via the binding-as-adapter path, and
    // the message names that fact rather than claiming the view is absent.
    expect(result.current.status).toBe('missing');
    expect(result.current.error).toContain('cannot list the saved views');
  });

  it('treats a runtime ADAPTER parked under `dataSource` as no binding', () => {
    // The two collide by name; `isElementDataSourceConfig` is what tells them
    // apart, and a host handing us the adapter must not be read as metadata.
    const schema = { type: 'object-grid', objectName: 'task', dataSource: { find: () => [] } };
    const { result } = renderHook(() => useBound(schema, FULL, makeAdapter()));
    expect(result.current.status).toBe('absent');
    expect(result.current.schema).toBe(schema);
  });
});

describe('useElementDataSourceSchema — binding without a view', () => {
  it('maps `object` onto `objectName` and needs no fetch to do it', () => {
    const { result } = renderHook(() =>
      useBound({ type: 'object-grid', dataSource: { object: 'account' } }, FULL, makeAdapter()),
    );
    expect(result.current.status).toBe('ready');
    expect(result.current.schema.objectName).toBe('account');
  });

  it('maps `object` onto a block-specific key when the mapping names one', () => {
    const { result } = renderHook(() =>
      useBound({ dataSource: { object: 'account' } }, { object: 'api' }, makeAdapter()),
    );
    expect(result.current.schema.api).toBe('account');
    expect(result.current.schema.objectName).toBeUndefined();
  });

  it('maps nothing for `object: false` (the block reads the binding itself)', () => {
    const { result } = renderHook(() =>
      useBound({ dataSource: { object: 'account' } }, { object: false }, makeAdapter()),
    );
    expect(result.current.schema.objectName).toBeUndefined();
  });

  it('AND-combines the binding filter with the component filter', () => {
    const { result } = renderHook(() =>
      useBound(
        {
          filter: [['owner', '=', 'me']],
          dataSource: { object: 'account', filter: [['rating', '=', 'hot']] },
        },
        FULL,
        makeAdapter(),
      ),
    );
    // Two sources ⇒ one `and` node. The binding NARROWS the component's filter;
    // it can never widen it, which is the direction the spec's "additional
    // filter criteria" fixes.
    expect(JSON.stringify(result.current.schema.filter)).toContain('and');
    expect(JSON.stringify(result.current.schema.filter)).toContain('rating');
    expect(JSON.stringify(result.current.schema.filter)).toContain('owner');
  });
});

describe('useElementDataSourceSchema — binding with a saved view', () => {
  it('applies the view’s columns, filter, sort, row cap and kind', async () => {
    const result = await resolved({ type: 'list-view', dataSource: { object: 'account', view: 'hot' } }, FULL);
    expect(result.current.status).toBe('resolved');
    const bound = result.current.schema;
    expect(bound.objectName).toBe('account');
    expect(bound.columns).toEqual(['name', 'rating']);
    expect(bound.filter).toEqual([['rating', '=', 'hot']]);
    expect(bound.sort).toEqual([{ field: 'name', order: 'desc' }]);
    expect(bound.pagination).toEqual({ pageSize: 7 });
    expect(bound.viewType).toBe('kanban');
  });

  it('still resolves a view served under snake `list_views` (stored-data compatibility, #5362)', async () => {
    // `listViews` (camelCase) is the canonical spelling — @objectstack/spec
    // declares nothing else, and every fixture above uses it. This pin is the
    // OTHER half of that settlement: stored app data published before the
    // canonization has never been censused (objectstack#7917), so the snake
    // READ fallback in `useElementDataSource` must survive until that census
    // exists. If this test is failing because the fallback was removed, the
    // removal needs the census as evidence, not a cleanup rationale.
    const snakeAdapter = {
      find: vi.fn(),
      getObjectSchema: vi.fn().mockResolvedValue({ name: 'account', list_views: { hot: HOT_VIEW } }),
    };
    const result = await resolved(
      { type: 'list-view', dataSource: { object: 'account', view: 'hot' } },
      FULL,
      snakeAdapter,
    );
    expect(result.current.status).toBe('resolved');
    expect(result.current.schema.columns).toEqual(['name', 'rating']);
    expect(result.current.schema.filter).toEqual([['rating', '=', 'hot']]);
  });

  it('lets an authored key win over the same key from the view', async () => {
    const result = await resolved(
      {
        columns: ['id'],
        sort: [{ field: 'created', order: 'asc' }],
        pagination: { pageSize: 25 },
        viewType: 'grid',
        dataSource: { object: 'account', view: 'hot' },
      },
      FULL,
    );
    const bound = result.current.schema;
    // A `view` is a reference; a key written on the component itself is more
    // specific than the view it points at.
    expect(bound.columns).toEqual(['id']);
    expect(bound.sort).toEqual([{ field: 'created', order: 'asc' }]);
    expect(bound.pagination).toEqual({ pageSize: 25 });
    expect(bound.viewType).toBe('grid');
  });

  it('treats an authored EMPTY `columns` as not authored', async () => {
    // `[]` is what the designer emits for an unconfigured column list, and
    // supplying the columns is exactly why a view was named.
    const result = await resolved({ columns: [], dataSource: { object: 'account', view: 'hot' } }, FULL);
    expect(result.current.schema.columns).toEqual(['name', 'rating']);
  });

  it('lets an explicit BINDING key override the view (not just the component)', async () => {
    const result = await resolved(
      {
        sort: [{ field: 'created', order: 'asc' }],
        pagination: { pageSize: 25 },
        dataSource: { object: 'account', view: 'hot', sort: [{ field: 'amount', order: 'asc' }], limit: 3 },
      },
      FULL,
    );
    const bound = result.current.schema;
    expect(bound.sort).toEqual([{ field: 'amount', order: 'asc' }]);
    expect(bound.pagination).toEqual({ pageSize: 3 });
  });

  it('ANDs the view filter, the binding filter and the component filter', async () => {
    const result = await resolved(
      {
        filter: [['owner', '=', 'me']],
        dataSource: { object: 'account', view: 'hot', filter: [['amount', '>', 100]] },
      },
      FULL,
    );
    const json = JSON.stringify(result.current.schema.filter);
    expect(json).toContain('rating'); // the view's
    expect(json).toContain('amount'); // the binding's
    expect(json).toContain('owner'); // the component's
  });

  it('writes the row cap to the flat `limit` key when that is what the block reads', async () => {
    const result = await resolved(
      { dataSource: { object: 'account', view: 'hot' } },
      { limit: 'limit' },
    );
    expect(result.current.schema.limit).toBe(7);
    expect(result.current.schema.pagination).toBeUndefined();
  });
});

describe('useElementDataSourceSchema — an unmapped key is never written', () => {
  it('writes ONLY the object name for the default mapping', async () => {
    // `object-form`'s wiring: one record, no collection query, so the binding's
    // remaining keys have no read site. They must not be parked on the schema —
    // a key written where nothing reads it is the defect, not the fix.
    const result = await resolved(
      { type: 'object-form', dataSource: { object: 'account', view: 'hot', limit: 10, sort: [{ field: 'x', order: 'asc' }] } },
      {},
    );
    const bound = result.current.schema;
    expect(bound.objectName).toBe('account');
    expect(bound.columns).toBeUndefined();
    expect(bound.filter).toBeUndefined();
    expect(bound.sort).toBeUndefined();
    expect(bound.limit).toBeUndefined();
    expect(bound.pagination).toBeUndefined();
    expect(bound.viewType).toBeUndefined();
  });

  it('writes the filter but not the view’s columns for a filter-only mapping', async () => {
    // `object-kanban`'s wiring. Its `columns` are SWIMLANES, not fields: the
    // view's `['name','rating']` written there would render two empty lanes.
    const lanes = [{ id: 'open', title: 'Open' }];
    const result = await resolved(
      { type: 'object-kanban', columns: lanes, groupBy: 'status', dataSource: { object: 'account', view: 'hot' } },
      { filter: true },
    );
    const bound = result.current.schema;
    expect(bound.objectName).toBe('account');
    expect(bound.filter).toEqual([['rating', '=', 'hot']]);
    expect(bound.columns).toBe(lanes);
    expect(bound.sort).toBeUndefined();
  });
});

describe('ElementDataSourceGate — resolution states', () => {
  const Block = ({ schema }: { schema: any }) => (
    <div data-testid="block">{String(schema?.objectName)}</div>
  );

  it('renders the block once the view resolves', async () => {
    const { getByTestId } = render(
      <ElementDataSourceGate
        schema={{ dataSource: { object: 'account', view: 'hot' } }}
        mapping={FULL}
        dataSource={makeAdapter()}
        testId="probe"
      >
        {(bound) => <Block schema={bound} />}
      </ElementDataSourceGate>,
    );
    await waitFor(() => expect(getByTestId('block').textContent).toBe('account'));
  });

  it('reports an unresolvable `view` instead of rendering the block unfiltered', async () => {
    // The failure this whole binding exists to remove: falling back to the
    // object's default scope turns a typo into a WIDER answer on a page that
    // still looks like it works.
    const { getByTestId, queryByTestId } = render(
      <ElementDataSourceGate
        schema={{ dataSource: { object: 'account', view: 'nope' } }}
        mapping={FULL}
        dataSource={makeAdapter()}
        testId="probe"
      >
        {(bound) => <Block schema={bound} />}
      </ElementDataSourceGate>,
    );
    await waitFor(() => expect(queryByTestId('probe-datasource-error')).not.toBeNull());
    expect(queryByTestId('block')).toBeNull();
    // The known-view list is the part that actually gets an author unstuck.
    expect(getByTestId('probe-datasource-error').textContent).toContain('hot');
  });

  it('shows a placeholder — not the error — while the views are being fetched', () => {
    let release: (v: unknown) => void = () => {};
    const adapter = {
      getObjectSchema: vi.fn().mockReturnValue(new Promise((r) => { release = r; })),
    };
    const { queryByTestId } = render(
      <ElementDataSourceGate
        schema={{ dataSource: { object: 'account', view: 'hot' } }}
        mapping={FULL}
        dataSource={adapter}
        testId="probe"
      >
        {(bound) => <Block schema={bound} />}
      </ElementDataSourceGate>,
    );
    // "Not resolved yet" is not "does not exist" — conflating them would flash a
    // configuration error on every mount.
    expect(queryByTestId('probe-resolving-view')).not.toBeNull();
    expect(queryByTestId('probe-datasource-error')).toBeNull();
    release({ name: 'account', listViews: { hot: HOT_VIEW } });
  });

  it('renders the block untouched when there is no binding at all', () => {
    const { getByTestId } = render(
      <ElementDataSourceGate schema={{ objectName: 'task' }} mapping={FULL} testId="probe">
        {(bound) => <Block schema={bound} />}
      </ElementDataSourceGate>,
    );
    expect(getByTestId('block').textContent).toBe('task');
  });
});

describe('ElementDataSourceGate — no adapter resolved (objectui#5378 item 2)', () => {
  const Block = ({ schema }: { schema: any }) => (
    <div data-testid="block">{String(schema?.objectName)}</div>
  );

  const gate = (props: Record<string, unknown>) => (
    <ElementDataSourceGate
      schema={{ objectName: 'account' }}
      testId="probe"
      requiresDataSource
      noDataSourceMessage={noDataSourceMessage('probe-block', 'account')}
      {...props}
    >
      {(bound) => <Block schema={bound} />}
    </ElementDataSourceGate>
  );

  it('renders the panel instead of the block when no adapter resolves', () => {
    const { getByTestId, queryByTestId } = render(gate({}));
    const panel = getByTestId('probe-no-data-source');
    expect(panel).toHaveAttribute('role', 'alert');
    expect(queryByTestId('block')).toBeNull();
  });

  it('names the block, the object and the ancestor that injects the adapter', () => {
    // The message has to be an ADDRESS. "Nothing rendered" is what the author
    // already had; what they did not have is where to look.
    const { getByTestId } = render(gate({}));
    const text = getByTestId('probe-no-data-source').textContent ?? '';
    expect(text).toContain('probe-block');
    expect(text).toContain('account');
    expect(text).toContain('SchemaRendererProvider');
  });

  it('is satisfied by the provider context, not only by an explicit adapter', () => {
    const { getByTestId, queryByTestId } = render(
      <SchemaRendererProvider dataSource={makeAdapter() as any}>
        {gate({})}
      </SchemaRendererProvider>,
    );
    expect(queryByTestId('probe-no-data-source')).toBeNull();
    expect(getByTestId('block').textContent).toBe('account');
  });

  it('never fires when the call site did not opt in', () => {
    // Every other block that uses this gate is untouched: the check is opt-IN
    // because "needs an adapter" is a statement about the block's own
    // fallbacks, and a wrong guess paints a configuration error over a
    // component that is working.
    const { getByTestId, queryByTestId } = render(
      <ElementDataSourceGate schema={{ objectName: 'account' }} testId="probe">
        {(bound) => <Block schema={bound} />}
      </ElementDataSourceGate>,
    );
    expect(queryByTestId('probe-no-data-source')).toBeNull();
    expect(getByTestId('block').textContent).toBe('account');
  });

  it('answers "which data source?" before "which view?"', async () => {
    // With no adapter, the view cannot resolve EITHER — so the view panel would
    // fire too, reporting "this data source cannot list the saved views", which
    // is true and points at the view name instead of at the missing injection.
    const { findByTestId, queryByTestId } = render(
      <ElementDataSourceGate
        schema={{ objectName: 'account', dataSource: { object: 'account', view: 'hot' } }}
        testId="probe"
        requiresDataSource
        noDataSourceMessage={noDataSourceMessage('probe-block', 'account')}
      >
        {(bound) => <Block schema={bound} />}
      </ElementDataSourceGate>,
    );
    await findByTestId('probe-no-data-source');
    expect(queryByTestId('probe-datasource-error')).toBeNull();
  });
});

describe('useResolvedDataSource — one resolution rule for the family', () => {
  const read = (explicit: unknown, ambient?: unknown) => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      ambient === undefined
        ? <>{children}</>
        : <SchemaRendererProvider dataSource={ambient as any}>{children}</SchemaRendererProvider>;
    return renderHook(() => useResolvedDataSource(explicit), { wrapper }).result.current;
  };

  it('prefers the explicit adapter over the ambient one', () => {
    const explicit = makeAdapter();
    const ambient = makeAdapter();
    expect(read(explicit, ambient)).toBe(explicit);
  });

  it('falls back to the provider context', () => {
    const ambient = makeAdapter();
    expect(read(undefined, ambient)).toBe(ambient);
  });

  it('is undefined — not a throw — when there is no provider at all', () => {
    // `useSchemaContext()` throws here, which is how "this page never wired a
    // data source" used to surface as an error boundary over a React hook
    // message instead of as the panel above.
    expect(read(undefined)).toBeUndefined();
  });

  it('never mistakes the spec BINDING for an adapter', () => {
    // Same guard `useElementDataSourceSchema` applies: counting the binding as
    // an adapter is how "no data source" reads as "resolved".
    const ambient = makeAdapter();
    expect(read({ object: 'account', view: 'hot' }, ambient)).toBe(ambient);
  });
});

/**
 * objectui#9899 — "did the component author its own cap?" was decided by
 * PRESENCE, while the sibling `columns` branch twenty lines above already
 * decided the same question by CONTENT.
 *
 * ## The two branches disagreed about the same question
 *
 * `columns` rules an authored-but-EMPTY list as NOT authored, and its own
 * comment says why: "supplying the columns is the reason a view was named".
 * That sentence transfers to the row cap word for word. The `limit` branch
 * nevertheless asked only whether a value was THERE, so a cap the contract
 * refuses counted as authored and the bound view's legitimate cap was never
 * written.
 *
 * ## Why "refuses" is not this file inventing a meaning
 *
 * The predicate is objectui#9925's, restated here rather than imported: the
 * spec's view pagination config declares `pageSize` a positive integer with a
 * default, every component `limit` in `@objectstack/spec`'s component props map
 * is `z.number().int().positive()`, and those are the two keys this branch
 * writes. So `0`, `-10` and `25.5` are not spellings this relay may assign a
 * meaning to.
 *
 * ## Each refusal is paired with a control that must NOT fire
 *
 * A branch that stopped counting ANY authored cap would pass every refusal row
 * below and be badly wrong, so a legitimate authored cap winning over the view
 * is asserted beside each one. The binding's own cap beating a legitimate
 * authored cap is asserted too — that precedence is not what this card moves.
 */
describe('useElementDataSourceSchema — a cap the contract refuses is not "authored" (objectui#9899)', () => {
  const warn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

  describe('carrier `pagination.pageSize`', () => {
    for (const refused of [0, -10, 25.5]) {
      it(`takes the view's cap over an authored pageSize: ${refused}`, async () => {
        const spy = warn();
        const result = await resolved(
          { type: 'list-view', pagination: { pageSize: refused }, dataSource: { object: 'account', view: 'hot' } },
          FULL,
        );
        expect(result.current.schema.pagination).toEqual({ pageSize: 7 });
        spy.mockRestore();
      });
    }

    it('CONTROL — a legitimate authored cap still wins over the view', async () => {
      const spy = warn();
      const result = await resolved(
        { type: 'list-view', pagination: { pageSize: 25 }, dataSource: { object: 'account', view: 'hot' } },
        FULL,
      );
      expect(result.current.schema.pagination).toEqual({ pageSize: 25 });
      // The silence control: a usable cap is not a mistake, so nothing is said.
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('CONTROL — other keys on the authored `pagination` survive the write', async () => {
      // `writeLimit` spreads the authored object; a refused pageSize must not
      // cost the author their `mode`.
      const spy = warn();
      const result = await resolved(
        {
          type: 'list-view',
          pagination: { mode: 'server', pageSize: 0 },
          dataSource: { object: 'account', view: 'hot' },
        },
        FULL,
      );
      expect(result.current.schema.pagination).toEqual({ mode: 'server', pageSize: 7 });
      spy.mockRestore();
    });
  });

  describe('carrier flat `limit`', () => {
    for (const refused of [0, -10, 25.5]) {
      it(`takes the view's cap over an authored limit: ${refused}`, async () => {
        const spy = warn();
        const result = await resolved(
          { type: 'object-kanban', limit: refused, dataSource: { object: 'account', view: 'hot' } },
          { limit: 'limit' },
        );
        expect(result.current.schema.limit).toBe(7);
        spy.mockRestore();
      });
    }

    it('CONTROL — a legitimate authored cap still wins over the view', async () => {
      const spy = warn();
      const result = await resolved(
        { type: 'object-kanban', limit: 50, dataSource: { object: 'account', view: 'hot' } },
        { limit: 'limit' },
      );
      expect(result.current.schema.limit).toBe(50);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('CONTROL — the BINDING’s own cap still beats a legitimate authored cap', async () => {
      const spy = warn();
      const result = await resolved(
        { type: 'object-kanban', limit: 50, dataSource: { object: 'account', view: 'hot', limit: 3 } },
        { limit: 'limit' },
      );
      expect(result.current.schema.limit).toBe(3);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('the loud half', () => {
    it('states the displacement once, naming the refused value and the cap used', async () => {
      const spy = warn();
      await resolved(
        { type: 'list-view', pagination: { pageSize: 0 }, dataSource: { object: 'account', view: 'hot' } },
        FULL,
      );
      const said = spy.mock.calls.map((c) => String(c[0]));
      expect(said).toHaveLength(1);
      expect(said[0]).toContain('pagination.pageSize: 0');
      expect(said[0]).toContain('account');
      expect(said[0]).toContain('7');
      spy.mockRestore();
    });

    it('SILENCE CONTROL — says nothing when no cap was authored at all', async () => {
      const spy = warn();
      const result = await resolved(
        { type: 'list-view', dataSource: { object: 'account', view: 'hot' } },
        FULL,
      );
      expect(result.current.schema.pagination).toEqual({ pageSize: 7 });
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('SILENCE CONTROL — says nothing when the view supplies no cap to displace WITH', async () => {
      // Nothing is written, the refused value stays, and the RENDERER's own
      // diagnostic is the one that fires. Two messages for one declaration is
      // the failure this control exists to catch.
      const spy = warn();
      const capless = {
        find: vi.fn(),
        getObjectSchema: vi
          .fn()
          .mockResolvedValue({ name: 'account', listViews: { hot: { name: 'hot', columns: ['name'] } } }),
      };
      const result = await resolved(
        { type: 'list-view', pagination: { pageSize: 0 }, dataSource: { object: 'account', view: 'hot' } },
        FULL,
        capless,
      );
      expect(result.current.schema.pagination).toEqual({ pageSize: 0 });
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});

/**
 * objectui#10015 — a saved VIEW's refused row cap, on the renderer path.
 *
 * objectui#10014 made `composeElementDataSource` DROP a view cap the contract
 * refuses. On this path that turned the node's key from `0` into ABSENT, and
 * the consuming renderer's own diagnostic treats an absent key as "not a
 * mistake" — so the one message the author used to get went silent, and the
 * gate had never said anything about a VIEW cap. The builder it left behind,
 * `elementDataSourceRefusedLimitMessage`, is pure (the composer runs inside a
 * `useMemo`), so the gate is the caller that reports it, from an effect.
 *
 * ## When the gate speaks — and when it must not
 *
 * The view's refusal is reported exactly when it CHANGED what this block
 * receives: the block reads a row cap, the binding declared no `limit` of its
 * own, and the component's own cap is not a usable one. Had the view's cap been
 * usable, the gate would have written it in each of those cases; because it
 * was refused, the block falls back to its own default — which is what the
 * builder's sentence says. Everywhere else the view's cap was never going to
 * land (a usable component cap wins, a binding cap wins, a block with no row
 * cap reads none), so the refusal changed nothing here and the sentence would
 * not be true. Each of those is a SILENCE control below.
 *
 * ## One message per mistake
 *
 * objectui#10009's message and this one are never both emitted: #10009's
 * speaks only when the gate WROTE a usable cap over a refused component cap,
 * and the one case where that coincides with a refused view cap is a binding
 * that declared its own `limit` — where the view's cap was never a candidate,
 * so this one stays silent and #10009's is the one that fires. When the view
 * AND the component both carry a refused cap and nothing else supplies one,
 * the gate writes nothing, #10009's stays silent under its own pinned control,
 * and this one reports the VIEW's value; the component's value stays on the
 * node for the renderer's own diagnostic. Two declarations, one message each.
 */
describe('ElementDataSourceGate — a saved view’s refused row cap is reported once (objectui#10015)', () => {
  const warn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
  const said = (spy: ReturnType<typeof warn>) => spy.mock.calls.map((c) => String(c[0]));
  // A red row never reaches its own `mockRestore()`, and `vi.spyOn` on a method
  // that is still spied returns the SAME spy — calls and all — so one failure
  // would redden every silence control after it. Restore unconditionally.
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const BINDING = { object: 'account', view: 'hot' };
  const viewWith = (cap: Record<string, unknown>) => ({ name: 'hot', columns: ['name', 'rating'], ...cap });
  const adapterFor = (view: Record<string, unknown>) => makeAdapter({ hot: view });

  describe('the view carries a refused cap and nothing else supplies one', () => {
    for (const refused of [0, -10, 25.5]) {
      it(`reports the view's pagination.pageSize: ${refused} once, in the builder's words`, async () => {
        const spy = warn();
        const view = viewWith({ pagination: { pageSize: refused } });
        const result = await resolved({ type: 'list-view', dataSource: BINDING }, FULL, adapterFor(view));
        // The objectui#10014 drop is what made the renderer go quiet: no cap
        // reaches the node, so there is nothing left for it to refuse.
        expect(result.current.schema.pagination).toBeUndefined();
        const expected = elementDataSourceRefusedLimitMessage(view, 'hot', 'account');
        expect(expected).not.toBeNull();
        await waitFor(() => expect(said(spy)).toEqual([expected]));
        expect(said(spy)[0]).toContain('hot');
        expect(said(spy)[0]).toContain('account');
        spy.mockRestore();
      });
    }

    it('reports a legacy flat view `limit` for a block that reads the flat `limit` key', async () => {
      const spy = warn();
      const view = viewWith({ limit: 0 });
      const result = await resolved({ type: 'record:related_list', dataSource: BINDING }, { limit: 'limit' }, adapterFor(view));
      expect(result.current.schema.limit).toBeUndefined();
      await waitFor(() => expect(said(spy)).toEqual([elementDataSourceRefusedLimitMessage(view, 'hot', 'account')]));
      spy.mockRestore();
    });

    it('does not repeat on a re-render of the same declaration', async () => {
      const spy = warn();
      const adapter = adapterFor(viewWith({ pagination: { pageSize: 0 } }));
      const Block = ({ schema }: { schema: Record<string, unknown> }) => <div data-testid="block">{String(schema.objectName)}</div>;
      // A FRESH schema object each render, equal in content: the memo recomputes,
      // the declaration does not change, so the message must not fire again.
      const gate = () => (
        <ElementDataSourceGate schema={{ type: 'list-view', dataSource: { ...BINDING } }} mapping={FULL} dataSource={adapter} testId="probe">
          {(bound) => <Block schema={bound} />}
        </ElementDataSourceGate>
      );
      const { getByTestId, rerender } = render(gate());
      await waitFor(() => expect(getByTestId('block').textContent).toBe('account'));
      await waitFor(() => expect(said(spy)).toHaveLength(1));
      rerender(gate());
      rerender(gate());
      expect(getByTestId('block').textContent).toBe('account');
      expect(said(spy)).toHaveLength(1);
      spy.mockRestore();
    });
  });

  describe('one message per mistake — never objectui#10009’s AND this one', () => {
    it('the component ALSO authored a refused cap: the VIEW’s refusal is the one the gate reports', async () => {
      const spy = warn();
      const view = viewWith({ pagination: { pageSize: 0 } });
      const result = await resolved(
        { type: 'list-view', pagination: { pageSize: 0 }, dataSource: BINDING },
        FULL,
        adapterFor(view),
      );
      // Nothing usable to write: the component's value stays for the renderer's
      // own diagnostic, which is about THAT declaration, not this one.
      expect(result.current.schema.pagination).toEqual({ pageSize: 0 });
      await waitFor(() => expect(said(spy)).toEqual([elementDataSourceRefusedLimitMessage(view, 'hot', 'account')]));
      spy.mockRestore();
    });

    it('a binding `limit` displaced a refused component cap: objectui#10009’s is the one, not this one', async () => {
      const spy = warn();
      const view = viewWith({ pagination: { pageSize: 0 } });
      const result = await resolved(
        { type: 'list-view', pagination: { pageSize: 0 }, dataSource: { ...BINDING, limit: 3 } },
        FULL,
        adapterFor(view),
      );
      expect(result.current.schema.pagination).toEqual({ pageSize: 3 });
      await waitFor(() => expect(said(spy)).toHaveLength(1));
      expect(said(spy)[0]).not.toBe(elementDataSourceRefusedLimitMessage(view, 'hot', 'account'));
      expect(said(spy)[0]).toContain('pagination.pageSize: 0');
      spy.mockRestore();
    });
  });

  describe('SILENCE controls — the view’s refusal changed nothing here, or there is none', () => {
    const quiet = async (schema: Record<string, unknown>, mapping: ElementDataSourceMapping, view: Record<string, unknown>) => {
      const spy = warn();
      const result = await resolved(schema, mapping, adapterFor(view));
      // Let the gate's effects flush before reading the silence.
      await waitFor(() => expect(result.current.status).toBe('resolved'));
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
      return result;
    };

    it('SILENCE — the view carries no cap at all', async () => {
      const result = await quiet({ type: 'list-view', dataSource: BINDING }, FULL, viewWith({}));
      expect(result.current.schema.pagination).toBeUndefined();
    });

    it('SILENCE — the view carries a usable cap', async () => {
      const result = await quiet({ type: 'list-view', dataSource: BINDING }, FULL, viewWith({ pagination: { pageSize: 7 } }));
      expect(result.current.schema.pagination).toEqual({ pageSize: 7 });
    });

    it('SILENCE — a usable component cap wins over the view whatever the view carries', async () => {
      const result = await quiet(
        { type: 'list-view', pagination: { pageSize: 50 }, dataSource: BINDING },
        FULL,
        viewWith({ pagination: { pageSize: 0 } }),
      );
      expect(result.current.schema.pagination).toEqual({ pageSize: 50 });
    });

    it('SILENCE — the binding’s own `limit` wins over the view whatever the view carries', async () => {
      const result = await quiet(
        { type: 'list-view', dataSource: { ...BINDING, limit: 3 } },
        FULL,
        viewWith({ pagination: { pageSize: 0 } }),
      );
      expect(result.current.schema.pagination).toEqual({ pageSize: 3 });
    });

    it('SILENCE — a block that reads no row cap is not told about one', async () => {
      const result = await quiet(
        { type: 'object-kanban', dataSource: BINDING },
        { filter: true },
        viewWith({ pagination: { pageSize: 0 } }),
      );
      expect(result.current.schema.pagination).toBeUndefined();
      expect(result.current.schema.limit).toBeUndefined();
    });
  });
});

/**
 * objectui#10016 — the BINDING's own refused row cap, on the renderer path.
 *
 * Maintainer ruling, option A: a binding `limit` the contract refuses is NOT
 * AUTHORED. `@object-ui/core` lets the view's usable cap through in its place,
 * and this gate treats that cap as what it is, a view-sourced BASELINE: a
 * usable component cap still wins over it. Before the ruling the refused value
 * was the binding's, so it was written over everything, the component's usable
 * cap included, and the consuming renderer then dropped it and drew its own
 * default.
 *
 * The truth table is binding {absent, usable, refused} × view {no cap, usable,
 * refused}, with the component's own cap as a third axis where the ruling moves
 * it. Only the rows with a refused binding may change what is written. The
 * binding's refusal is reported in the core builder's words for that operand,
 * once per declaration, from an effect.
 */
describe('ElementDataSourceGate — a refused binding `limit` is not authored (objectui#10016)', () => {
  const warn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
  const said = (spy: ReturnType<typeof warn>) => spy.mock.calls.map((c) => String(c[0]));
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const viewWith = (cap: Record<string, unknown>) => ({ name: 'hot', columns: ['name', 'rating'], ...cap });
  const adapterFor = (view: Record<string, unknown>) => makeAdapter({ hot: view });
  const bindingOf = (limit?: unknown) =>
    ({ object: 'account', view: 'hot', ...(limit === undefined ? {} : { limit }) });
  const bindingSentence = (bad: unknown) =>
    elementDataSourceRefusedLimitMessage(null, 'hot', 'account', { limit: bad }, 'binding');

  const VIEW_NO_CAP = viewWith({});
  const VIEW_USABLE = viewWith({ pagination: { pageSize: 7 } });
  const VIEW_REFUSED = viewWith({ pagination: { pageSize: 0 } });

  /** Resolve one row and let the gate's effects flush. */
  const row = async (
    schema: Record<string, unknown>,
    view: Record<string, unknown>,
    mapping: ElementDataSourceMapping = FULL,
  ) => {
    const spy = warn();
    const result = await resolved(schema, mapping, adapterFor(view));
    await waitFor(() => expect(result.current.status).toBe('resolved'));
    return { result, spy };
  };

  describe('refused binding rows — the ones the ruling moves', () => {
    for (const refused of [0, -10, 25.5]) {
      it(`binding ${refused} + usable view cap ⇒ the view's cap, and ONE binding warning`, async () => {
        const { result, spy } = await row({ type: 'list-view', dataSource: bindingOf(refused) }, VIEW_USABLE);
        expect(result.current.schema.pagination).toEqual({ pageSize: 7 });
        await waitFor(() => expect(said(spy)).toEqual([bindingSentence(refused)]));
      });
    }

    it('binding 0 + view with no cap ⇒ nothing written (the block’s own default), and ONE binding warning', async () => {
      const { result, spy } = await row({ type: 'list-view', dataSource: bindingOf(0) }, VIEW_NO_CAP);
      expect(result.current.schema.pagination).toBeUndefined();
      await waitFor(() => expect(said(spy)).toEqual([bindingSentence(0)]));
    });

    it('binding 0 + refused view cap ⇒ nothing written, and one warning per refused operand', async () => {
      const { result, spy } = await row({ type: 'list-view', dataSource: bindingOf(0) }, VIEW_REFUSED);
      expect(result.current.schema.pagination).toBeUndefined();
      const expected = [
        bindingSentence(0),
        elementDataSourceRefusedLimitMessage(VIEW_REFUSED, 'hot', 'account', bindingOf(0)),
      ];
      expect(expected[1]).not.toBeNull();
      await waitFor(() => expect([...said(spy)].sort()).toEqual([...expected].sort()));
    });

    it('binding 0 + usable view cap + usable COMPONENT cap ⇒ the component’s cap wins over the view baseline', async () => {
      const { result, spy } = await row(
        { type: 'list-view', pagination: { pageSize: 50 }, dataSource: bindingOf(0) },
        VIEW_USABLE,
      );
      expect(result.current.schema.pagination).toEqual({ pageSize: 50 });
      await waitFor(() => expect(said(spy)).toEqual([bindingSentence(0)]));
    });

    it('binding 0 + view with no cap + usable COMPONENT cap ⇒ the component’s cap stays', async () => {
      const { result, spy } = await row(
        { type: 'list-view', pagination: { pageSize: 50 }, dataSource: bindingOf(0) },
        VIEW_NO_CAP,
      );
      expect(result.current.schema.pagination).toEqual({ pageSize: 50 });
      await waitFor(() => expect(said(spy)).toEqual([bindingSentence(0)]));
    });

    it('binding 0 + usable view cap + refused COMPONENT cap ⇒ the view’s cap, one message per declaration', async () => {
      const { result, spy } = await row(
        { type: 'list-view', pagination: { pageSize: 0 }, dataSource: bindingOf(0) },
        VIEW_USABLE,
      );
      expect(result.current.schema.pagination).toEqual({ pageSize: 7 });
      await waitFor(() => expect(said(spy)).toHaveLength(2));
      expect(said(spy)).toContain(bindingSentence(0));
      // The other one is objectui#10009's, about the COMPONENT's declaration.
      expect(said(spy).find((s) => s !== bindingSentence(0))).toContain('pagination.pageSize: 0');
    });

    it('binding 0 + refused view cap + usable COMPONENT cap ⇒ the component’s cap, and the binding warning only', async () => {
      // The view's refusal changed nothing here: a usable component cap wins
      // over any view cap, so the view's sentence would not be true.
      const { result, spy } = await row(
        { type: 'list-view', pagination: { pageSize: 50 }, dataSource: bindingOf(0) },
        VIEW_REFUSED,
      );
      expect(result.current.schema.pagination).toEqual({ pageSize: 50 });
      await waitFor(() => expect(said(spy)).toEqual([bindingSentence(0)]));
    });

    it('binding 0 + view with no cap + refused COMPONENT cap ⇒ the component’s 0 stays, and the binding warning only', async () => {
      // Nothing usable to write, so the component's own value stays on the
      // node for the renderer's own diagnostic; the gate speaks only for the
      // binding.
      const { result, spy } = await row(
        { type: 'list-view', pagination: { pageSize: 0 }, dataSource: bindingOf(0) },
        VIEW_NO_CAP,
      );
      expect(result.current.schema.pagination).toEqual({ pageSize: 0 });
      await waitFor(() => expect(said(spy)).toEqual([bindingSentence(0)]));
    });

    it('binding 0 + refused view cap + refused COMPONENT cap ⇒ the component’s 0 stays, and the view + binding warnings', async () => {
      const { result, spy } = await row(
        { type: 'list-view', pagination: { pageSize: 0 }, dataSource: bindingOf(0) },
        VIEW_REFUSED,
      );
      expect(result.current.schema.pagination).toEqual({ pageSize: 0 });
      const expected = [
        bindingSentence(0),
        elementDataSourceRefusedLimitMessage(VIEW_REFUSED, 'hot', 'account', bindingOf(0)),
      ];
      expect(expected[1]).not.toBeNull();
      await waitFor(() => expect([...said(spy)].sort()).toEqual([...expected].sort()));
    });

    it('binding 0 + usable view cap ⇒ the view’s cap on the flat `limit` key too', async () => {
      const { result, spy } = await row(
        { type: 'object-kanban', dataSource: bindingOf(0) },
        VIEW_USABLE,
        { limit: 'limit' },
      );
      expect(result.current.schema.limit).toBe(7);
      await waitFor(() => expect(said(spy)).toEqual([bindingSentence(0)]));
    });

    it('does not repeat the binding warning on a re-render of the same declaration', async () => {
      const spy = warn();
      const adapter = adapterFor(VIEW_USABLE);
      const Block = ({ schema }: { schema: Record<string, unknown> }) => (
        <div data-testid="block">{String((schema.pagination as { pageSize?: number } | undefined)?.pageSize)}</div>
      );
      const gate = () => (
        <ElementDataSourceGate schema={{ type: 'list-view', dataSource: bindingOf(0) }} mapping={FULL} dataSource={adapter} testId="probe">
          {(boundSchema) => <Block schema={boundSchema} />}
        </ElementDataSourceGate>
      );
      const { getByTestId, rerender } = render(gate());
      await waitFor(() => expect(getByTestId('block').textContent).toBe('7'));
      await waitFor(() => expect(said(spy)).toHaveLength(1));
      rerender(gate());
      rerender(gate());
      expect(said(spy)).toEqual([bindingSentence(0)]);
    });
  });

  describe('the carried defect’s condition, read from the builder on this caller too', () => {
    // Not a CONTROL: this gate was already silent here, but the condition that
    // keeps it silent now lives in the core builder, shared with
    // `ViewDataProvider`, so ablating the builder's condition reddens this row.
    it('binding 3 + refused view cap ⇒ 3, and NO view warning', async () => {
      const { result, spy } = await row({ type: 'list-view', dataSource: bindingOf(3) }, VIEW_REFUSED);
      expect(result.current.schema.pagination).toEqual({ pageSize: 3 });
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('CONTROLS — rows the ruling does not move', () => {
    it('CONTROL — binding 3 + usable view cap ⇒ 3, and nothing said', async () => {
      const { result, spy } = await row({ type: 'list-view', dataSource: bindingOf(3) }, VIEW_USABLE);
      expect(result.current.schema.pagination).toEqual({ pageSize: 3 });
      expect(spy).not.toHaveBeenCalled();
    });

    it('CONTROL — binding 3 + view with no cap ⇒ 3, and nothing said', async () => {
      const { result, spy } = await row({ type: 'list-view', dataSource: bindingOf(3) }, VIEW_NO_CAP);
      expect(result.current.schema.pagination).toEqual({ pageSize: 3 });
      expect(spy).not.toHaveBeenCalled();
    });

    it('CONTROL — binding 3 still beats a usable component cap', async () => {
      const { result, spy } = await row(
        { type: 'list-view', pagination: { pageSize: 50 }, dataSource: bindingOf(3) },
        VIEW_USABLE,
      );
      expect(result.current.schema.pagination).toEqual({ pageSize: 3 });
      expect(spy).not.toHaveBeenCalled();
    });

    it('CONTROL — no binding cap + refused view cap ⇒ nothing written, and the view warning as before', async () => {
      const { result, spy } = await row({ type: 'list-view', dataSource: bindingOf() }, VIEW_REFUSED);
      expect(result.current.schema.pagination).toBeUndefined();
      await waitFor(() =>
        expect(said(spy)).toEqual([elementDataSourceRefusedLimitMessage(VIEW_REFUSED, 'hot', 'account')]),
      );
    });

    it('CONTROL — no binding cap + usable view cap ⇒ 7, and nothing said', async () => {
      const { result, spy } = await row({ type: 'list-view', dataSource: bindingOf() }, VIEW_USABLE);
      expect(result.current.schema.pagination).toEqual({ pageSize: 7 });
      expect(spy).not.toHaveBeenCalled();
    });

    it('CONTROL — no binding cap + view with no cap ⇒ nothing written, and nothing said', async () => {
      const { result, spy } = await row({ type: 'list-view', dataSource: bindingOf() }, VIEW_NO_CAP);
      expect(result.current.schema.pagination).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    });

    it('SILENCE — a block that reads no row cap is not told about the binding’s', async () => {
      const { result, spy } = await row({ type: 'object-kanban', dataSource: bindingOf(0) }, VIEW_USABLE, { filter: true });
      expect(result.current.schema.limit).toBeUndefined();
      expect(result.current.schema.pagination).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
