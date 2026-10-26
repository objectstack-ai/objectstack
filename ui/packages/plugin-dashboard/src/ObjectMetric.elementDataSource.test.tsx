/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-metric` consumes `PageComponentSchema.dataSource` (objectstack#6953).
 *
 * This widget is registered directly and takes `objectName` / `filter` as PROPS
 * (`SchemaRenderer` spreads the schema's own keys onto it), so the spec's
 * per-element binding had no path in at all. Its no-object branch is the reason
 * the gap is worth a pin: with no `objectName` the widget does not error, it
 * renders its STATIC fallback value — a number that looks real and answers
 * nothing.
 *
 * `object` and `filter` are the only mapped keys: a metric is one aggregated
 * number, so there is no projection, no ordering and no page for the binding's
 * remaining keys to act on.
 *
 * ## Promoted to the member pin for `object-metric.dataSource` (objectui#8071)
 *
 * objectui#8071's eighth slice registers this file as the pin for that key. The
 * member set it asserts is a WHITELIST in both directions: `object` and `view`
 * are the members that act — the bound object is what gets aggregated and the
 * named view's own `filter` becomes the metric's scope — while the view's
 * `columns`, `sort` and `pagination` are carried in the fixture and asserted
 * ABSENT from the call, because `OBJECT_METRIC_DATA_SOURCE` names only
 * `filter`. Without that second direction the pin would be satisfied by a
 * mapping that forwarded everything, which for this block would mean a metric
 * silently ordered and paged by a list view's presentation settings.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Registers `object-metric` via `ObjectMetricBlock` (the wiring under test).
import './index';

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
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    aggregate: vi.fn().mockResolvedValue([{ amount: 42 }]),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'account',
      fields: { name: { type: 'text' }, rating: { type: 'text' }, amount: { type: 'number' } },
      listViews,
    }),
  };
}

const AGGREGATE = { field: 'amount', function: 'sum' };

const renderBlock = (schema: Record<string, unknown>, adapter: ReturnType<typeof makeAdapter>) =>
  render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );

describe('object-metric — dataSource: { object, view } (objectstack#6953)', () => {
  it('aggregates over the bound object with the saved view’s filter', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-metric',
        label: 'Pipeline',
        aggregate: AGGREGATE,
        dataSource: { object: 'account', view: 'hot' },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalled());
    const [object, params] = adapter.aggregate.mock.calls[0] as [string, any];
    expect(object).toBe('account');
    // `ObjectMetricWidget` passes the filter as the aggregate's own `filter`
    // key, not as an OData `$filter`.
    expect(params.filter).toEqual([['rating', '=', 'hot']]);
  });

  it('reports an unresolvable `view` instead of showing a number for the whole object', async () => {
    const adapter = makeAdapter();
    const { container } = renderBlock(
      {
        type: 'object-metric',
        label: 'Pipeline',
        aggregate: AGGREGATE,
        dataSource: { object: 'account', view: 'nope' },
      },
      adapter,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="object-metric-datasource-error"]')).not.toBeNull(),
    );
    expect(adapter.aggregate).not.toHaveBeenCalled();
  });

  it('maps `object` and the view’s `filter` and NOTHING else the view carries', async () => {
    // The whitelist direction. `HOT_VIEW` declares `columns`, `sort` and
    // `pagination`; none of the three is a member this block reads, so none may
    // appear in the aggregate call. Asserted on the WHOLE options bag rather
    // than key by key, so a mapping widened to forward the rest is red here.
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-metric',
        label: 'Pipeline',
        aggregate: AGGREGATE,
        dataSource: { object: 'account', view: 'hot' },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalled());
    const [, params] = adapter.aggregate.mock.calls[0] as [string, any];
    expect(params).toEqual({
      field: 'amount',
      function: 'sum',
      groupBy: '_all',
      filter: [['rating', '=', 'hot']],
    });
  });

  it('leaves a metric with NO dataSource exactly as it was', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-metric',
        objectName: 'account',
        label: 'Pipeline',
        aggregate: AGGREGATE,
        filter: [['owner', '=', 'me']],
      },
      adapter,
    );

    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalled());
    const [object, params] = adapter.aggregate.mock.calls[0] as [string, any];
    expect(object).toBe('account');
    expect(params.filter).toEqual([['owner', '=', 'me']]);
  });
});

describe('object-metric — the unresolvable-view panel title reads the bundle (objectui#12920)', () => {
  it('under zh-CN the panel is titled in Chinese, not the English literal', async () => {
    const adapter = makeAdapter();
    const { container } = render(
      <I18nProvider persistLanguage={false} config={{ defaultLanguage: 'zh-CN', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={adapter as any}>
          <SchemaRenderer schema={{ type: 'object-metric', label: 'Pipeline', aggregate: AGGREGATE, dataSource: { object: 'account', view: 'nope' } } as any} />
        </SchemaRendererProvider>
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="object-metric-datasource-error"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="object-metric-datasource-error"] p.font-medium')?.textContent).toBe(
      '无法解析此指标的数据源',
    );
  });
});
