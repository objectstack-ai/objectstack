/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-kanban` consumes `PageComponentSchema.dataSource` (objectstack#6953).
 *
 * The board gates its fetch on `schema.objectName` and nothing mapped the spec's
 * `dataSource.object` onto it, so a board authored with the binding the spec
 * documents rendered its declared lanes with no cards, no request and no error.
 *
 * ## Why `columns` is NOT taken from the view
 *
 * A board's `columns` are its SWIMLANES (`{ id, title }` per `groupBy` value),
 * not a field projection. A saved view's `columns: ['name','rating']` written
 * there would render two empty lanes named after fields — a wrong answer that
 * looks like a rendered board. The mapping therefore takes `object`, `filter`,
 * `sort` and `limit`, and the third test pins that the authored lanes survive.
 *
 * ## The row cap (objectui#4025)
 *
 * The board's cap was written `{ options: { $top: 100 } }`: `$filter` at the top
 * level where the adapters read it, the cap one level down under `options`, which
 * is not a `QueryParams` key and which no adapter in this repo reads. So the
 * board had no row cap at all, and `limit` stayed unmapped on the strength of a
 * "fixed window" that did not exist. The last describe block below pins the cap
 * as a real top-level `$top` and pins every source that can set it.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { DEFAULT_KANBAN_FETCH_BATCH_SIZE } from './ObjectKanban';
// Registers `object-kanban` (and the ElementDataSourceGate wiring under test).
import './index';
// The lane titles asserted below render INSIDE `KanbanRenderer`'s `React.lazy`
// boundary. Importing the chunk at module scope bills the cold transform to the
// import phase (unbounded) instead of racing a `waitFor` budget under full
// parallelism — the objectui#3010 rule, same specifier as `index.tsx`'s factory
// so ESM's module cache makes that factory resolve immediately.
import './KanbanImpl';

const HOT_VIEW = {
  name: 'hot',
  label: 'Hot accounts',
  columns: ['name', 'rating'],
  filter: [['rating', '=', 'hot']],
  sort: [{ field: 'name', order: 'desc' }],
  pagination: { pageSize: 7 },
};

const LANES = [
  { id: 'open', title: 'Open' },
  { id: 'won', title: 'Won' },
];

function makeAdapter(listViews: Record<string, unknown> = { hot: HOT_VIEW }) {
  return {
    find: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'Acme', status: 'open' }] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'account',
      fields: { name: { type: 'text' }, status: { type: 'text' }, rating: { type: 'text' } },
      listViews,
    }),
  };
}

const renderBlock = (schema: Record<string, unknown>, adapter: ReturnType<typeof makeAdapter>) =>
  render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );

describe('object-kanban — dataSource: { object, view } (objectstack#6953)', () => {
  it('queries the bound object with the saved view’s filter', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-kanban',
        groupBy: 'status',
        columns: LANES,
        dataSource: { object: 'account', view: 'hot' },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const [object, params] = adapter.find.mock.calls[0] as [string, any];
    expect(object).toBe('account');
    expect(params.$filter).toEqual([['rating', '=', 'hot']]);
  });

  it('keeps the authored SWIMLANES — the view’s field list is not a lane list', async () => {
    const adapter = makeAdapter();
    const { container } = renderBlock(
      {
        type: 'object-kanban',
        groupBy: 'status',
        columns: LANES,
        dataSource: { object: 'account', view: 'hot' },
      },
      adapter,
    );

    // Lane titles, not field names: `rating` must never become a lane on a
    // board. `waitFor` because the lanes render past a Suspense boundary.
    await waitFor(() => expect(container.textContent).toContain('Open'));
    expect(container.textContent).toContain('Won');
    expect(container.textContent).not.toContain('rating');
  });

  it('reports an unresolvable `view` instead of fetching the whole object', async () => {
    const adapter = makeAdapter();
    const { container } = renderBlock(
      {
        type: 'object-kanban',
        groupBy: 'status',
        columns: LANES,
        dataSource: { object: 'account', view: 'nope' },
      },
      adapter,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="object-kanban-datasource-error"]')).not.toBeNull(),
    );
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('leaves a board with NO dataSource querying its own object and filter', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-kanban',
        objectName: 'account',
        groupBy: 'status',
        columns: LANES,
        filter: [['owner', '=', 'me']],
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const [object, params] = adapter.find.mock.calls[0] as [string, any];
    expect(object).toBe('account');
    expect(params.$filter).toEqual([['owner', '=', 'me']]);
  });
});

/**
 * The row cap (objectui#4025).
 *
 * Every assertion here also pins the ABSENCE of `params.options`: the defect was
 * not a wrong number, it was a right number written where nothing reads it, and
 * a test that only checked `$top` would stay green if someone re-added the dead
 * nesting beside it.
 */
describe('object-kanban — the row cap reaches the wire (objectui#4025)', () => {
  const firstQuery = async (adapter: ReturnType<typeof makeAdapter>) => {
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    return adapter.find.mock.calls[0] as [string, any];
  };

  it('caps an uncapped board at the default window, as a REAL $top', async () => {
    const adapter = makeAdapter();
    renderBlock(
      { type: 'object-kanban', objectName: 'account', groupBy: 'status', columns: LANES },
      adapter,
    );

    const [object, params] = await firstQuery(adapter);
    expect(object).toBe('account');
    // The number is the one the board always intended; it just reaches the
    // adapter now (`convertQueryParams` in `@object-ui/data-objectstack` and
    // `ApiDataSource` both read `params.$top`, neither reads `params.options`).
    expect(params.$top).toBe(DEFAULT_KANBAN_FETCH_BATCH_SIZE);
    expect(params.$top).toBe(100);
    expect(params.options).toBeUndefined();
  });

  it('honours a `limit` authored directly on the block', async () => {
    const adapter = makeAdapter();
    renderBlock(
      { type: 'object-kanban', objectName: 'account', groupBy: 'status', columns: LANES, limit: 20 },
      adapter,
    );

    const [, params] = await firstQuery(adapter);
    expect(params.$top).toBe(20);
    expect(params.options).toBeUndefined();
  });

  it('takes a named view’s page size as the board’s window', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-kanban',
        groupBy: 'status',
        columns: LANES,
        dataSource: { object: 'account', view: 'hot' },
      },
      adapter,
    );

    const [object, params] = await firstQuery(adapter);
    expect(object).toBe('account');
    // `hot` declares `pagination: { pageSize: 7 }` — a view's row cap.
    expect(params.$top).toBe(7);
    // The view's filter still arrives: the cap did not displace it.
    expect(params.$filter).toEqual([['rating', '=', 'hot']]);
    expect(params.options).toBeUndefined();
  });

  it('lets the binding’s own `limit` override the view’s page size', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-kanban',
        groupBy: 'status',
        columns: LANES,
        dataSource: { object: 'account', view: 'hot', limit: 3 },
      },
      adapter,
    );

    const [, params] = await firstQuery(adapter);
    // `limit` overrides rather than combines — the binding is the narrower,
    // more local statement (see `composeElementDataSource`).
    expect(params.$top).toBe(3);
    expect(params.options).toBeUndefined();
  });
});

/**
 * objectui#8071 — the MEMBER shape of `object-kanban`.`dataSource`.
 *
 * ## Why this block was added to a pre-existing file
 *
 * `dataSource` is not written by this block at all: `Registry.register` INJECTS
 * `ELEMENT_DATA_SOURCE_INPUT` into every registration that wraps the runtime
 * gate, so the declaration says `type: 'object'` and nothing whatever about
 * members. The member contract is therefore entirely the read site, and the
 * read site is one line of this package —
 * `OBJECT_KANBAN_DATA_SOURCE = { filter: true, sort: true, limit: 'limit' }` — read by
 * `ElementDataSourceGate` in `@object-ui/react`.
 *
 * The three describe blocks above were read end to end before being credited as
 * the pin's base. They already cover `object` (the bound object is queried),
 * `view` (its filter and page size arrive, an unresolvable one REPORTS rather
 * than widening) and the deliberate non-mapping of `columns`. They do not cover
 * the rest of the binding's five members, and the five are NOT alike: they are
 * mapped, and some are then contested by other sources. That is what this
 * block adds.
 *
 * | member    | disposition on THIS block                                      |
 * |-----------|----------------------------------------------------------------|
 * | `object`  | mapped, and it OUTRANKS an authored `objectName`               |
 * | `view`    | the baseline every other member is contested against           |
 * | `filter`  | mapped, and AND-combined with the block's own `filter` too     |
 * | `limit`   | mapped onto the block's `limit`; binding > block > view         |
 * | `sort`    | mapped onto `$orderby`; binding > view; orders cards in a lane |
 *
 * ⚠️ `sort` was the inert member until objectui#10068: the binding declared it
 * and this block silently dropped it (no `$orderby`). It is now lowered onto
 * `$orderby` through `convertSortToQueryParams`, and because lanes bucket
 * records in fetch order, the declared order is also the in-lane order. The
 * rows below pin the wire, the lane order, and an absent-sort control.
 */
describe('object-kanban — the binding’s five members, each with its disposition (objectui#8071)', () => {
  const firstQuery = async (adapter: ReturnType<typeof makeAdapter>) => {
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    return adapter.find.mock.calls[0] as [string, any];
  };

  it('⭐ `object` OUTRANKS an `objectName` the board authored itself', async () => {
    // `next[objectKey] = composed.object` is UNCONDITIONAL. The `??=` spelling
    // a contributor would write to "not clobber the author" would leave a
    // rebound board querying the old object with the same lanes, the same
    // groupBy and no diagnostic — invisible whenever both objects exist.
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-kanban',
        objectName: 'contact',
        groupBy: 'status',
        columns: LANES,
        dataSource: { object: 'account' },
      },
      adapter,
    );

    const [object] = await firstQuery(adapter);
    expect(object).toBe('account');
  });

  it('⭐ `filter` is ADDITIONAL to the board’s OWN filter, not a replacement', async () => {
    // `mergeFilterNodes(base.filter, composed.filter)`: the block's own
    // `schema.filter` survives and the binding narrows it further. A mapping
    // that assigned instead of merging would silently WIDEN the board past the
    // rows its own filter admitted.
    const adapter = makeAdapter({});
    renderBlock(
      {
        type: 'object-kanban',
        groupBy: 'status',
        columns: LANES,
        filter: [['owner', '=', 'me']],
        dataSource: { object: 'account', filter: [['rating', '=', 'hot']] },
      },
      adapter,
    );

    const [, params] = await firstQuery(adapter);
    // ⚠️ MEASURED, not predicted: each source keeps its own RULE-LIST nesting
    // under the `and`, so the combined node is `['and', <list>, <list>]` and
    // not a flattened three-element node. A pin that asserted the flattened
    // spelling would be asserting a shape this repo does not produce.
    expect(params.$filter).toEqual(['and', [['owner', '=', 'me']], [['rating', '=', 'hot']]]);
  });

  it('a binding filter with NO view and no board filter passes through verbatim', async () => {
    // The lone-source case: combining is what forces the AST lowering, so a
    // single source must keep the shape it was authored in.
    const adapter = makeAdapter({});
    renderBlock(
      {
        type: 'object-kanban',
        groupBy: 'status',
        columns: LANES,
        dataSource: { object: 'account', filter: [['rating', '=', 'hot']] },
      },
      adapter,
    );

    const [, params] = await firstQuery(adapter);
    expect(params.$filter).toEqual([['rating', '=', 'hot']]);
  });

  it('⭐ `sort` reaches the query as `$orderby` (objectui#10068)', async () => {
    // It used to be accepted and dropped: the binding declared it and the fetch
    // carried no ordering. `convertSortToQueryParams` lowers it onto the
    // `field -> direction` map every sibling block sends.
    const adapter = makeAdapter({});
    renderBlock(
      {
        type: 'object-kanban',
        groupBy: 'status',
        columns: LANES,
        dataSource: { object: 'account', sort: [{ field: 'name', order: 'desc' }], limit: 4 },
      },
      adapter,
    );

    const [, params] = await firstQuery(adapter);
    expect(params.$orderby).toEqual({ name: 'desc' });
    // LIT CONTROL, same binding and same query: the member mapped before this
    // change still moves.
    expect(params.$top).toBe(4);
  });

  it('`sort` from a named VIEW reaches `$orderby` too, and the binding’s own `sort` beats it', async () => {
    // `hot` declares `sort: [{ field: 'name', order: 'desc' }]`.
    const fromView = makeAdapter();
    renderBlock(
      { type: 'object-kanban', groupBy: 'status', columns: LANES, dataSource: { object: 'account', view: 'hot' } },
      fromView,
    );
    const [, viewParams] = await firstQuery(fromView);
    expect(viewParams.$orderby).toEqual({ name: 'desc' });

    const bound = makeAdapter();
    renderBlock(
      {
        type: 'object-kanban',
        groupBy: 'status',
        columns: LANES,
        dataSource: { object: 'account', view: 'hot', sort: [{ field: 'rating', order: 'asc' }] },
      },
      bound,
    );
    const [, boundParams] = await firstQuery(bound);
    expect(boundParams.$orderby).toEqual({ rating: 'asc' });
  });

  it('CONTROL — no declared `sort` leaves the query without an ordering', async () => {
    const adapter = makeAdapter({});
    renderBlock(
      { type: 'object-kanban', groupBy: 'status', columns: LANES, dataSource: { object: 'account', limit: 4 } },
      adapter,
    );

    const [, params] = await firstQuery(adapter);
    expect(params.$orderby).toBeUndefined();
    expect(params.sort).toBeUndefined();
    // Same query moved on a mapped member, so the absence above is a reading.
    expect(params.$top).toBe(4);
  });

  it('cards inside a lane keep the order the sorted fetch returned', async () => {
    // The server applies `$orderby`; the board must not re-sort a lane. The
    // adapter answers in the order a `name desc` query would, interleaving two
    // lanes, and each lane must draw its own cards in that same order.
    const adapter = makeAdapter({});
    adapter.find.mockResolvedValue({
      data: [
        { id: '1', name: 'Zeta', status: 'open' },
        { id: '2', name: 'Yankee', status: 'won' },
        { id: '3', name: 'Mike', status: 'open' },
        { id: '4', name: 'Alpha', status: 'open' },
        { id: '5', name: 'Bravo', status: 'won' },
      ],
    });
    const { container } = renderBlock(
      {
        type: 'object-kanban',
        groupBy: 'status',
        columns: LANES,
        cardTitle: 'name',
        dataSource: { object: 'account', sort: [{ field: 'name', order: 'desc' }] },
      },
      adapter,
    );

    const [, params] = await firstQuery(adapter);
    expect(params.$orderby).toEqual({ name: 'desc' });
    await waitFor(() => expect(container.textContent).toContain('Zeta'));
    const text = container.textContent ?? '';
    const at = (name: string) => text.indexOf(name);
    for (const name of ['Zeta', 'Yankee', 'Mike', 'Alpha', 'Bravo']) expect(at(name)).toBeGreaterThanOrEqual(0);
    // Lane `open`: Zeta, Mike, Alpha — fetch order, NOT alphabetical.
    expect(at('Zeta')).toBeLessThan(at('Mike'));
    expect(at('Mike')).toBeLessThan(at('Alpha'));
    // Lane `won`: Yankee, Bravo.
    expect(at('Yankee')).toBeLessThan(at('Bravo'));
  });

  it('⭐ `limit` — the binding beats the block, and the block beats the VIEW', async () => {
    // Two different branches of one rule, and either alone is consistent with a
    // renderer that simply takes the last writer.
    const authored = makeAdapter();
    renderBlock(
      {
        type: 'object-kanban',
        groupBy: 'status',
        columns: LANES,
        limit: 11,
        // `hot` declares `pagination: { pageSize: 7 }`.
        dataSource: { object: 'account', view: 'hot' },
      },
      authored,
    );
    const [, authoredParams] = await firstQuery(authored);
    expect(authoredParams.$top).toBe(11);

    const bound = makeAdapter();
    renderBlock(
      {
        type: 'object-kanban',
        groupBy: 'status',
        columns: LANES,
        limit: 11,
        dataSource: { object: 'account', view: 'hot', limit: 3 },
      },
      bound,
    );
    const [, boundParams] = await firstQuery(bound);
    expect(boundParams.$top).toBe(3);
  });
});

describe('object-kanban — the unresolvable-view panel title reads the bundle (objectui#12920)', () => {
  it('under zh-CN the panel is titled in Chinese, not the English literal', async () => {
    const adapter = makeAdapter();
    const { container } = render(
      <I18nProvider persistLanguage={false} config={{ defaultLanguage: 'zh-CN', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={adapter as any}>
          <SchemaRenderer schema={{ type: 'object-kanban', groupBy: 'status', columns: LANES, dataSource: { object: 'account', view: 'nope' } } as any} />
        </SchemaRendererProvider>
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="object-kanban-datasource-error"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="object-kanban-datasource-error"] p.font-medium')?.textContent).toBe(
      '无法解析此看板的数据源',
    );
  });
});
