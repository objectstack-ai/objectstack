/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-grid` consumes `PageComponentSchema.dataSource` (objectstack#6953).
 *
 * The spec declares this binding on EVERY page component, and objectstack#5576
 * wired it to `list-view` only. On `object-grid` nothing mapped
 * `dataSource.object` onto the `objectName` this block requires, so a page that
 * declared the binding the spec documents — and no separate `objectName` —
 * rendered an EMPTY grid: `getDataConfig` returned `null`, the fetch effect
 * never ran, and no error was reported anywhere. "Spec-valid metadata renders
 * nothing" is the objectstack#4413 shape.
 *
 * `object-grid` is the one block the binding maps onto without a gap — it reads
 * every key the binding carries — so both directions are asserted end to end
 * here: what reaches `dataSource.find`, and that a grid with no binding is
 * untouched.
 *
 * ## GROWN into this block's member pin (objectui#8071 slice 14)
 *
 * The four cases above cover `object`, `view` and `filter`. What they could not
 * state is the PRECEDENCE the remaining members are read through, which is the
 * half an author collides with: the binding carries five members
 * (`{ object, view, filter, sort, limit }`), a named `view` supplies a baseline
 * for four of them, and the block's own flat keys are a third source. Three
 * sources, one value, and the winner is different depending on which two are
 * present — none of it visible in the `type: 'object'` the registry publishes
 * or in the `binding: 'object'` marker beside it.
 *
 * The rule the second describe block pins, in one sentence: **a `dataSource.*`
 * member beats the block's own key, and the block's own key beats the view the
 * binding named.** Each row below is therefore a PAIR — the same member, once
 * written on the binding and once supplied by the view — because either half
 * alone is consistent with a renderer that simply takes the last writer.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Registers `object-grid` (and the ElementDataSourceGate wiring under test).
import '../index';

const HOT_VIEW = {
  name: 'hot',
  label: 'Hot accounts',
  columns: ['name', 'rating'],
  filter: [['rating', '=', 'hot']],
  sort: [{ field: 'name', order: 'desc' }],
  pagination: { pageSize: 7 },
};

function makeAdapter(listViews: Record<string, unknown> = { hot: HOT_VIEW }) {
  return {
    find: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'Acme', rating: 'hot' }], total: 1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'account',
      fields: { id: { type: 'text' }, name: { type: 'text' }, rating: { type: 'text' } },
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

describe('object-grid — dataSource: { object, view } (objectstack#6953)', () => {
  it('queries the bound object with the saved view’s filter, sort and row cap', async () => {
    const adapter = makeAdapter();
    renderBlock({ type: 'object-grid', dataSource: { object: 'account', view: 'hot' } }, adapter);

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());

    const [object, params] = adapter.find.mock.calls[0] as [string, any];
    // `object` → `objectName`: the mapping that did not exist. Without it there
    // was no query at all, not a wrong one.
    expect(object).toBe('account');
    expect(params.$filter).toEqual([['rating', '=', 'hot']]);
    // `ObjectGrid` lowers a declared sort to the string form on the wire.
    expect(params.$orderby).toBe('name desc');
    // The view's page size is the fetch window, not just a display setting.
    expect(params.$top).toBe(7);
  });

  it('AND-combines the binding’s own filter with the view’s', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-grid',
        dataSource: { object: 'account', view: 'hot', filter: [['amount', '>', 100]] },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const json = JSON.stringify((adapter.find.mock.calls[0] as any[])[1].$filter);
    // "Additional filter criteria" (spec): the binding may only narrow the view.
    expect(json).toContain('rating');
    expect(json).toContain('amount');
  });

  it('reports an unresolvable `view` instead of querying the whole object', async () => {
    const adapter = makeAdapter();
    const { container } = renderBlock(
      { type: 'object-grid', dataSource: { object: 'account', view: 'nope' } },
      adapter,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="object-grid-datasource-error"]')).not.toBeNull(),
    );
    // The point of failing loudly: a typo must not become a wider answer.
    expect(adapter.find).not.toHaveBeenCalled();
    expect(container.textContent).toContain('hot');
  });

  it('leaves a grid with NO dataSource exactly as it was', async () => {
    // The other direction of the single-variable reproduction. Nothing about the
    // flat-key path may move: same object, same filter, same window.
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-grid',
        objectName: 'account',
        columns: [{ field: 'name' }],
        filter: [['owner', '=', 'me']],
        pagination: { pageSize: 25 },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const [object, params] = adapter.find.mock.calls[0] as [string, any];
    expect(object).toBe('account');
    expect(params.$filter).toEqual([['owner', '=', 'me']]);
    expect(params.$top).toBe(25);
    // No view was named, so nothing may be fetched about views either.
    expect(adapter.getObjectSchema).toHaveBeenCalledWith('account');
  });
});

describe('object-grid — the binding\u2019s OWN members, and who they beat (objectui#8071)', () => {
  it('`sort` on the binding OVERRIDES the block\u2019s own `sort`', async () => {
    // Both authored and disagreeing, with no view in play: the binding is
    // written on THIS placement, so it wins.
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-grid',
        objectName: 'account',
        sort: [{ field: 'name', order: 'desc' }],
        dataSource: { object: 'account', sort: [{ field: 'rating', order: 'asc' }] },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect((adapter.find.mock.calls[0] as any[])[1].$orderby).toBe('rating asc');
  });

  it('…but a VIEW\u2019s `sort` LOSES to the block\u2019s own `sort`', async () => {
    // The pair for the row above, and the direction a reader is least likely to
    // guess: the same value, arriving from the named view instead of from the
    // binding, does NOT win. A `view` is a reference; a key written on the block
    // is more specific than the view it points at.
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-grid',
        sort: [{ field: 'rating', order: 'asc' }],
        dataSource: { object: 'account', view: 'hot' },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    // `HOT_VIEW.sort` is `name desc` and is the control for this being a real
    // contest rather than a view that supplied nothing.
    expect((adapter.find.mock.calls[0] as any[])[1].$orderby).toBe('rating asc');
  });

  it('`limit` on the binding OVERRIDES the block\u2019s own `pagination.pageSize`', async () => {
    // `limit` is the spec\u2019s spelling and `pagination.pageSize` is this block\u2019s;
    // the mapping names the second as where the first lands, so the two are one
    // value with two names and the binding\u2019s name wins.
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-grid',
        pagination: { pageSize: 25 },
        dataSource: { object: 'account', limit: 3 },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect((adapter.find.mock.calls[0] as any[])[1].$top).toBe(3);
  });

  it('…and it REPLACES only `pageSize`, leaving the object\u2019s other members', async () => {
    // The sharp half: the limit is written back into a COPY of the authored
    // `pagination` object. A renderer that assigned `{ pageSize: limit }` would
    // pass this row\u2019s `$top` assertion above and silently delete the
    // rows-per-page list the author configured beside it.
    const adapter = makeAdapter();
    // Enough rows for the cap to produce more than one page: the rows-per-page
    // selector is only drawn when there is paging to do, so a single-row answer
    // would make this row unfalsifiable rather than red.
    adapter.find = vi.fn().mockResolvedValue({
      data: Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), name: `Row ${i + 1}` })),
      total: 10,
    }) as never;
    renderBlock(
      {
        type: 'object-grid',
        pagination: { pageSize: 25, pageSizeOptions: [3, 200] },
        dataSource: { object: 'account', limit: 3 },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const trigger = await waitFor(() => screen.getAllByRole('combobox')[0]);
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const offered = await waitFor(() => {
      const options = screen.getAllByRole('option').map((o) => o.textContent);
      expect(options.length, 'the rows-per-page dropdown never opened').toBeGreaterThan(0);
      return options;
    });
    expect(offered).toEqual(['3', '200']);
  });

  it('a VIEW\u2019s page size LOSES to the block\u2019s own `pagination.pageSize`', async () => {
    // Same asymmetry as `sort`, on the other member, and with the view reading
    // its cap from a DIFFERENT key than the one it lands on (`pagination.pageSize`
    // on both sides here, but the view is also allowed a flat `limit`).
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-grid',
        pagination: { pageSize: 25 },
        dataSource: { object: 'account', view: 'hot' },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    // `HOT_VIEW.pagination.pageSize` is 7 — the number the first case in this
    // file reads when the block authors no page size of its own.
    expect((adapter.find.mock.calls[0] as any[])[1].$top).toBe(25);
  });

  it('`object` OVERRIDES an `objectName` the block authored itself', async () => {
    // The binding "overrides page-level object context" (spec), and this block
    // reads its object from a key the author can also write. A renderer filling
    // the key only when absent would query the wrong object here — and would
    // look entirely correct, because the other object exists.
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-grid',
        objectName: 'contact',
        dataSource: { object: 'account' },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect((adapter.find.mock.calls[0] as any[])[0]).toBe('account');
  });

  it('a binding with NO `view` carries its own members verbatim', async () => {
    // Nothing to compose against, so the three members pass through unchanged —
    // and the filter is NOT lowered to an AST on the way, which is what the
    // single-source path exists to preserve.
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-grid',
        dataSource: {
          object: 'account',
          filter: [['rating', '=', 'warm']],
          sort: [{ field: 'name', order: 'asc' }],
          limit: 4,
        },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const params = (adapter.find.mock.calls[0] as any[])[1];
    expect(params.$filter).toEqual([['rating', '=', 'warm']]);
    expect(params.$orderby).toBe('name asc');
    expect(params.$top).toBe(4);
  });
});

describe('object-grid — the unresolvable-view panel title reads the bundle (objectui#12920)', () => {
  it('under zh-CN the panel is titled in Chinese, not the English literal', async () => {
    const adapter = makeAdapter();
    const { container } = render(
      <I18nProvider persistLanguage={false} config={{ defaultLanguage: 'zh-CN', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={adapter as any}>
          <SchemaRenderer schema={{ type: 'object-grid', dataSource: { object: 'account', view: 'nope' } } as any} />
        </SchemaRendererProvider>
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="object-grid-datasource-error"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="object-grid-datasource-error"] p.font-medium')?.textContent).toBe(
      '无法解析此表格的数据源',
    );
  });
});
