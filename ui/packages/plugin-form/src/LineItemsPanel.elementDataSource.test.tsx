/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:line_items` consumes `PageComponentSchema.dataSource` (objectstack#7121),
 * and since objectstack#7137 it consumes `filter` / `sort` / `limit` too.
 *
 * This is the one block in the #7121 batch whose object does NOT live under
 * `objectName`: the collection it lists, fetches and writes is
 * `schema.childObject`, so the binding's `object` maps THERE — the same way it
 * maps onto `record:related_list`'s `objectName`, which likewise names the CHILD
 * object the panel is bound to. Authored with the binding and no `childObject`,
 * the panel used to query the object `undefined`.
 *
 * #7137 gave the fetch the three missing read sites. The composed filter is
 * AND-combined with the parent relationship condition, never substituted for it —
 * pinned below, because "additional criteria" that REPLACED the parent scope would
 * show another record's line items, the worst possible reading of the spec.
 *
 * `columns` is still NOT mapped, and the last case keeps pinning that: here they
 * are `GridColumn[]` driving an EDITABLE grid, not a field-name projection a saved
 * view could fill.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Registers `record:line_items` (and the ElementDataSourceGate wiring under test).
import './index';

const HOT_VIEW = {
  name: 'hot',
  label: 'Billable lines',
  // Deliberately DIFFERENT from the authored grid columns below, so the
  // "columns are not mapped" pin has something to observe.
  columns: ['qty', 'price'],
  filter: [['billable', '=', true]],
  sort: [{ field: 'qty', order: 'desc' }],
  pagination: { pageSize: 7 },
};

const COLUMNS = [{ name: 'qty', label: 'Qty', type: 'number' as const }];

function makeAdapter(listViews: Record<string, unknown> = { hot: HOT_VIEW }) {
  return {
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'invoice_line',
      fields: {
        qty: { name: 'qty', type: 'number', label: 'Qty' },
        price: { name: 'price', type: 'currency', label: 'Price' },
        billable: { name: 'billable', type: 'boolean', label: 'Billable' },
      },
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

const headerTexts = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent ?? '');

const firstQuery = async (adapter: ReturnType<typeof makeAdapter>) => {
  await waitFor(() => expect(adapter.find).toHaveBeenCalled());
  return adapter.find.mock.calls[0] as [string, any];
};

describe('record:line_items — dataSource: { object } (objectstack#7121)', () => {
  it('lists the CHILD object named by the binding, scoped to the parent record', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'record:line_items',
        relationshipField: 'invoice',
        parentId: 'inv-1',
        columns: COLUMNS,
        dataSource: { object: 'invoice_line' },
      },
      adapter,
    );

    const [object, params] = await firstQuery(adapter);
    expect(object).toBe('invoice_line');
    // The parent relationship is still what scopes the list — the binding named
    // the object, not the scope. With nothing else authored the filter is the
    // untouched MongoDB-style object it has always been.
    expect(params.$filter).toEqual({ invoice: 'inv-1' });
    expect(params.$orderby).toBeUndefined();
    expect(params.$top).toBe(500);
  });

  it('reports an unresolvable `view` instead of listing the whole child object', async () => {
    const adapter = makeAdapter();
    const { container } = renderBlock(
      {
        type: 'record:line_items',
        relationshipField: 'invoice',
        parentId: 'inv-1',
        columns: COLUMNS,
        dataSource: { object: 'invoice_line', view: 'nope' },
      },
      adapter,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="record-line-items-datasource-error"]')).not.toBeNull(),
    );
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('leaves a panel with NO dataSource exactly as it was', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'record:line_items',
        childObject: 'invoice_line',
        relationshipField: 'invoice',
        parentId: 'inv-1',
        columns: COLUMNS,
      },
      adapter,
    );

    const [object, params] = await firstQuery(adapter);
    expect(object).toBe('invoice_line');
    expect(params.$filter).toEqual({ invoice: 'inv-1' });
    expect(params.$orderby).toBeUndefined();
    expect(params.$top).toBe(500);
  });
});

describe('record:line_items — parent scope AND the authored criteria (objectstack#7137)', () => {
  it('applies a named view’s filter, sort and page size WITHOUT dropping the parent scope', async () => {
    const adapter = makeAdapter();
    const { container } = renderBlock(
      {
        type: 'record:line_items',
        relationshipField: 'invoice',
        parentId: 'inv-1',
        columns: COLUMNS,
        dataSource: {
          object: 'invoice_line',
          view: 'hot',
          sort: [{ field: 'price', order: 'asc' }],
          limit: 3,
        },
      },
      adapter,
    );

    const [object, params] = await firstQuery(adapter);
    expect(object).toBe('invoice_line');
    // BOTH conditions, ANDed: the parent FK first (it is never negotiable), the
    // view's criteria as their own child. An override here would show another
    // invoice's lines.
    expect(params.$filter).toEqual(['and', ['invoice', '=', 'inv-1'], [['billable', '=', true]]]);
    // Binding `sort` / `limit` override the view's.
    expect(params.$orderby).toEqual({ price: 'asc' });
    expect(params.$top).toBe(3);

    // And the editable grid still keeps the authored GridColumn list — a view's
    // bare field names would arrive with no `name`/`type` and render
    // header-less, type-less cells. Wrong SHAPE, not merely a wider answer.
    await waitFor(() => expect(headerTexts(container)).toContain('Qty'));
    expect(headerTexts(container).join('|')).not.toContain('price');
  });

  it('honours filter / sort / limit authored directly on the panel', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'record:line_items',
        childObject: 'invoice_line',
        relationshipField: 'invoice',
        parentId: 'inv-1',
        columns: COLUMNS,
        filter: [['billable', '=', true]],
        sort: [{ field: 'qty', order: 'desc' }],
        limit: 25,
      },
      adapter,
    );

    const [object, params] = await firstQuery(adapter);
    expect(object).toBe('invoice_line');
    expect(params.$filter).toEqual(['and', ['invoice', '=', 'inv-1'], [['billable', '=', true]]]);
    expect(params.$orderby).toEqual({ qty: 'desc' });
    expect(params.$top).toBe(25);
  });

  it('AND-combines the panel’s own filter with the view’s and the binding’s — the parent scope survives all three', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'record:line_items',
        relationshipField: 'invoice',
        parentId: 'inv-1',
        columns: COLUMNS,
        filter: [['void', '=', false]],
        dataSource: { object: 'invoice_line', view: 'hot', filter: [['qty', '>', 0]] },
      },
      adapter,
    );

    const [, params] = await firstQuery(adapter);
    expect(params.$filter).toEqual([
      'and',
      ['invoice', '=', 'inv-1'],
      ['and', [['void', '=', false]], ['and', [['billable', '=', true]], [['qty', '>', 0]]]],
    ]);
    // The view supplied the ordering and the cap; nothing on the binding overrode
    // them.
    expect(params.$orderby).toEqual({ qty: 'desc' });
    expect(params.$top).toBe(7);
  });
});

describe('record:line_items — the unresolvable-view panel title reads the bundle (objectui#12920)', () => {
  it('under zh-CN the panel is titled in Chinese, not the English literal', async () => {
    const adapter = makeAdapter();
    const { container } = render(
      <I18nProvider persistLanguage={false} config={{ defaultLanguage: 'zh-CN', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={adapter as any}>
          <SchemaRenderer schema={{ type: 'record:line_items', relationshipField: 'invoice', parentId: 'inv-1', columns: COLUMNS, dataSource: { object: 'invoice_line', view: 'nope' } } as any} />
        </SchemaRendererProvider>
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="record-line-items-datasource-error"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="record-line-items-datasource-error"] p.font-medium')?.textContent).toBe(
      '无法解析此明细行面板的数据源',
    );
  });
});
