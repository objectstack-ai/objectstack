/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-pivot` consumes `PageComponentSchema.dataSource` (objectstack#7121).
 *
 * `ObjectPivotTable` gates its fetch effect on `schema.objectName`, and nothing
 * mapped the spec's `dataSource.object` onto it: a pivot authored the way the
 * spec documents rendered an empty cross-tab with no request and no diagnostic —
 * the same shape its sibling `object-metric` had before objectstack#6953.
 *
 * `object` and `filter` are the only mapped keys: a cross-tab orders itself by
 * its own `rowField` / `columnField` grouping, issues no `$top` (a total over a
 * truncated page would be wrong), and its "columns" are `columnField` VALUES, not
 * a field projection a saved view could supply.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Registers `object-pivot` via `ObjectPivotBlock` (the wiring under test).
import './index';

const HOT_VIEW = {
  name: 'hot',
  label: 'Hot deals',
  columns: ['stage', 'region'],
  filter: [['rating', '=', 'hot']],
  sort: [{ field: 'stage', order: 'desc' }],
  pagination: { pageSize: 7 },
};

function makeAdapter(listViews: Record<string, unknown> = { hot: HOT_VIEW }) {
  return {
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'opportunity',
      fields: {
        stage: { type: 'text' },
        region: { type: 'text' },
        rating: { type: 'text' },
        amount: { type: 'number' },
      },
      listViews,
    }),
  };
}

const PIVOT = {
  rowField: 'stage',
  columnField: 'region',
  valueField: 'amount',
  aggregation: 'sum',
};

const renderBlock = (schema: Record<string, unknown>, adapter: ReturnType<typeof makeAdapter>) =>
  render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );

describe('object-pivot — dataSource: { object, view } (objectstack#7121)', () => {
  it('queries the bound object with the saved view’s filter', async () => {
    const adapter = makeAdapter();
    renderBlock(
      { type: 'object-pivot', ...PIVOT, dataSource: { object: 'opportunity', view: 'hot' } },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const [object, params] = adapter.find.mock.calls[0] as [string, any];
    expect(object).toBe('opportunity');
    expect(params.$filter).toEqual([['rating', '=', 'hot']]);
  });

  it('narrows, never widens: the binding’s own filter ANDs with the view’s', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-pivot',
        ...PIVOT,
        dataSource: { object: 'opportunity', view: 'hot', filter: [['owner', '=', 'me']] },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const [, params] = adapter.find.mock.calls[0] as [string, any];
    expect(JSON.stringify(params.$filter)).toContain('rating');
    expect(JSON.stringify(params.$filter)).toContain('owner');
  });

  it('reports an unresolvable `view` instead of cross-tabbing the whole object', async () => {
    const adapter = makeAdapter();
    const { container } = renderBlock(
      { type: 'object-pivot', ...PIVOT, dataSource: { object: 'opportunity', view: 'nope' } },
      adapter,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="object-pivot-datasource-error"]')).not.toBeNull(),
    );
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('writes no ordering and no row cap — a cross-tab reads neither', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-pivot',
        ...PIVOT,
        dataSource: { object: 'opportunity', view: 'hot', sort: [{ field: 'amount', order: 'asc' }], limit: 3 },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const [, params] = adapter.find.mock.calls[0] as [string, any];
    // Deliberately unmapped, not overlooked: the pivot's query carries only the
    // filter. Pinned so adding either mapping has to be a deliberate edit.
    expect(params.$orderby).toBeUndefined();
    expect(params.$top).toBeUndefined();
  });

  it('leaves a pivot with NO dataSource exactly as it was', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-pivot',
        objectName: 'opportunity',
        ...PIVOT,
        filter: [['owner', '=', 'me']],
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const [object, params] = adapter.find.mock.calls[0] as [string, any];
    expect(object).toBe('opportunity');
    expect(params.$filter).toEqual([['owner', '=', 'me']]);
  });
});

describe('object-pivot — the unresolvable-view panel title reads the bundle (objectui#12920)', () => {
  it('under zh-CN the panel is titled in Chinese, not the English literal', async () => {
    const adapter = makeAdapter();
    const { container } = render(
      <I18nProvider persistLanguage={false} config={{ defaultLanguage: 'zh-CN', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={adapter as any}>
          <SchemaRenderer schema={{ type: 'object-pivot', ...PIVOT, dataSource: { object: 'opportunity', view: 'nope' } } as any} />
        </SchemaRendererProvider>
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="object-pivot-datasource-error"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="object-pivot-datasource-error"] p.font-medium')?.textContent).toBe(
      '无法解析此数据透视表的数据源',
    );
  });
});
