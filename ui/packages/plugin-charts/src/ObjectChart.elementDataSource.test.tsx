/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-chart` consumes `PageComponentSchema.dataSource` (objectstack#6953).
 *
 * `ObjectChart` gates BOTH its fetch and its initial loading state on
 * `schema.objectName` (`!schema.objectName && !schema.dataset` returns early),
 * and nothing mapped the spec's `dataSource.object` onto it — so a chart authored
 * with the binding the spec documents rendered an empty frame with no request and
 * no error.
 *
 * The wiring lives in `ObjectChartBlock`, the registry shell beside the
 * registration, not in the chart's container internals: consuming the binding is
 * a registry-boundary concern.
 *
 * Only `object` and `filter` are mapped. A chart projects the `aggregate` /
 * `xAxisKey` fields it declares, the engine decides the row order, and there is
 * no page to cap — so a view's columns, sort and page size have no read site
 * here and are deliberately left unmapped rather than written where nothing
 * reads them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Registers `object-chart` via `ObjectChartBlock` (the wiring under test).
import './index';

/**
 * objectui#4106 — answer ObjectChart's option-color probe from a double.
 *
 * Once `dataSource.object` maps onto `objectName`, ObjectChart resolves the
 * category dimension's option colors via `GET /api/v1/meta/object/account` on
 * the GLOBAL `fetch` (ObjectChart.tsx:352) — 3 live requests per run here (the
 * unresolvable-`view` test never resolves an objectName, so it makes none).
 *
 * Note this file mounts a real `SchemaRendererProvider`: the host IS present
 * and still does not intercept the probe, because ObjectChart reads the global
 * `fetch` rather than the context's `apiFetch`. That gap is a product concern
 * filed separately — this file only stops the escape.
 *
 * `{}` reproduces the failed request's observable outcome exactly (no options
 * → `buildOptionColorMap` returns null, the same state the swallowed rejection
 * produced), so no assertion below changes meaning.
 */
function installMetaFetchDouble(routes: Record<string, unknown> = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      calls.push(url);
      return { ok: true, json: async () => routes[url] ?? {} };
    }),
  );
  return calls;
}

let metaCalls: string[] = [];

beforeEach(() => {
  metaCalls = installMetaFetchDouble();
});

afterEach(() => {
  // Anything other than the option-color probe is a NEW escape — fail here.
  expect(metaCalls.filter((u) => u !== '/api/v1/meta/object/account')).toEqual([]);
  vi.unstubAllGlobals();
  cleanup();
});

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
    find: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'Acme', amount: 5 }] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    aggregate: vi.fn().mockResolvedValue([]),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'account',
      fields: { name: { type: 'text' }, rating: { type: 'text' }, amount: { type: 'number' } },
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

describe('object-chart — dataSource: { object, view } (objectstack#6953)', () => {
  it('queries the bound object with the saved view’s filter', async () => {
    const adapter = makeAdapter();
    renderBlock(
      { type: 'object-chart', chartType: 'bar', xAxisKey: 'name', dataSource: { object: 'account', view: 'hot' } },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const [object, params] = adapter.find.mock.calls[0] as [string, any];
    expect(object).toBe('account');
    expect(params.$filter).toEqual([['rating', '=', 'hot']]);
  });

  it('AND-combines the binding’s own filter with the view’s', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-chart',
        chartType: 'bar',
        xAxisKey: 'name',
        dataSource: { object: 'account', view: 'hot', filter: [['amount', '>', 100]] },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const json = JSON.stringify((adapter.find.mock.calls[0] as any[])[1].$filter);
    expect(json).toContain('rating');
    expect(json).toContain('amount');
  });

  it('reports an unresolvable `view` instead of charting the whole object', async () => {
    const adapter = makeAdapter();
    const { container } = renderBlock(
      { type: 'object-chart', chartType: 'bar', xAxisKey: 'name', dataSource: { object: 'account', view: 'nope' } },
      adapter,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="object-chart-datasource-error"]')).not.toBeNull(),
    );
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('leaves a chart with NO dataSource exactly as it was', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-chart',
        objectName: 'account',
        chartType: 'bar',
        xAxisKey: 'name',
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

describe('object-chart — the unresolvable-view panel title reads the bundle (objectui#12920)', () => {
  it('under zh-CN the panel is titled in Chinese, not the English literal', async () => {
    const adapter = makeAdapter();
    const { container } = render(
      <I18nProvider persistLanguage={false} config={{ defaultLanguage: 'zh-CN', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={adapter as any}>
          <SchemaRenderer schema={{ type: 'object-chart', chartType: 'bar', xAxisKey: 'name', dataSource: { object: 'account', view: 'nope' } } as any} />
        </SchemaRendererProvider>
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="object-chart-datasource-error"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="object-chart-datasource-error"] p.font-medium')?.textContent).toBe(
      '无法解析此图表的数据源',
    );
  });
});
