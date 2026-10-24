/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-calendar` consumes `PageComponentSchema.dataSource` (objectstack#6953).
 *
 * The calendar gates its fetch on `schema.objectName`, and nothing mapped the
 * spec's `dataSource.object` onto it: a calendar authored with the binding the
 * spec documents rendered an empty month with no request and no error.
 *
 * `filter` and `sort` DO map here (`$filter` / `$orderby` on the fetch), while a
 * column list and a row cap do not — a calendar projects the fields its
 * `calendar` config names and fetches the whole window rather than a page. Those
 * keys are left unmapped rather than parked on a key nothing reads.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Registers `object-calendar` (and the ElementDataSourceGate wiring under test).
import './index';

const HOT_VIEW = {
  name: 'hot',
  label: 'Hot accounts',
  columns: ['name', 'rating'],
  filter: [['rating', '=', 'hot']],
  sort: [{ field: 'name', order: 'desc' }],
  pagination: { pageSize: 7 },
};

/**
 * A sort entry that omits `order` — reachable only through UNTYPED saved-view
 * metadata (`ElementSavedView` is `Record< string, unknown >`; `SortConfig.order`
 * is required in objectui's own types). See objectui#4022.
 */
const PARTIAL_SORT_VIEW = {
  name: 'partial',
  label: 'Partially ordered',
  sort: [{ field: 'starts_at' }, { field: 'name', order: 'desc' }],
};

const CALENDAR = { startDateField: 'starts_at', endDateField: 'ends_at', titleField: 'name' };

function makeAdapter(listViews: Record<string, unknown> = { hot: HOT_VIEW }) {
  return {
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'account',
      fields: {
        name: { type: 'text' },
        rating: { type: 'text' },
        starts_at: { type: 'datetime' },
        ends_at: { type: 'datetime' },
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

describe('object-calendar — dataSource: { object, view } (objectstack#6953)', () => {
  it('queries the bound object with the saved view’s filter and sort', async () => {
    const adapter = makeAdapter();
    renderBlock(
      { type: 'object-calendar', calendar: CALENDAR, dataSource: { object: 'account', view: 'hot' } },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const [object, params] = adapter.find.mock.calls[0] as [string, any];
    expect(object).toBe('account');
    expect(params.$filter).toEqual([['rating', '=', 'hot']]);
    // Was `toBeTruthy()`, which an EMPTY object also satisfies — the one value the
    // old private copy produced when it had dropped every entry. Pinned to the
    // actual map so this case can still fail for the right reason (objectui#4022).
    expect(params.$orderby).toEqual({ name: 'desc' });
  });

  it('reports an unresolvable `view` instead of fetching the whole object', async () => {
    const adapter = makeAdapter();
    const { container } = renderBlock(
      { type: 'object-calendar', calendar: CALENDAR, dataSource: { object: 'account', view: 'nope' } },
      adapter,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="object-calendar-datasource-error"]')).not.toBeNull(),
    );
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('leaves a calendar with NO dataSource exactly as it was', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-calendar',
        objectName: 'account',
        calendar: CALENDAR,
        filter: [['owner', '=', 'me']],
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const [object, params] = adapter.find.mock.calls[0] as [string, any];
    expect(object).toBe('account');
    expect(params.$filter).toEqual([['owner', '=', 'me']]);
  });

  it('orders by a sort entry that omits `order` instead of dropping it', async () => {
    const adapter = makeAdapter({ partial: PARTIAL_SORT_VIEW });
    renderBlock(
      { type: 'object-calendar', calendar: CALENDAR, dataSource: { object: 'account', view: 'partial' } },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const [, params] = adapter.find.mock.calls[0] as [string, any];
    // The private copy required BOTH keys and silently dropped `starts_at`,
    // sending `{ name: 'desc' }`. The shared sink reads a missing `order` as
    // ascending — what `QueryParams.$orderby`'s member shape declares.
    expect(params.$orderby).toEqual({ starts_at: 'asc', name: 'desc' });
  });
});

describe('object-calendar — the unresolvable-view panel title reads the bundle (objectui#12920)', () => {
  it('under zh-CN the panel is titled in Chinese, not the English literal', async () => {
    const adapter = makeAdapter();
    const { container } = render(
      <I18nProvider persistLanguage={false} config={{ defaultLanguage: 'zh-CN', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={adapter as any}>
          <SchemaRenderer schema={{ type: 'object-calendar', calendar: CALENDAR, dataSource: { object: 'account', view: 'nope' } } as any} />
        </SchemaRendererProvider>
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="object-calendar-datasource-error"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="object-calendar-datasource-error"] p.font-medium')?.textContent).toBe(
      '无法解析此日历的数据源',
    );
  });
});
