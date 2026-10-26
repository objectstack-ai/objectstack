/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-gantt` consumes `PageComponentSchema.dataSource` (objectstack#7121).
 *
 * The gantt derives its whole data config from `schema.objectName`
 * (`getDataConfig`), and nothing mapped the spec's `dataSource.object` onto it:
 * a gantt authored with the binding the spec documents got a NULL data config,
 * so `resolveDataSource` had nothing to read through — an empty chart, no
 * request, no error.
 *
 * `filter` and `sort` DO map here (`$filter` / `$orderby` on the reload), while a
 * column list and a row cap do not — a gantt projects the fields its `gantt`
 * config names and takes its `$top` from the PLATFORM, never from the binding.
 * Those keys are left unmapped rather than parked on a key nothing reads.
 *
 * ⚠️ The row-cap case below changed shape with objectui#7210's ruling a′ and
 * kept its point. It used to assert `$top` was absent entirely; the reload now
 * always carries the platform ceiling. What it pins is unchanged: an AUTHORED
 * `limit: 3` still does not reach the wire — the ceiling is "a named constant
 * in the renderer, not an authorable view key", so no binding can be the thing
 * that decides how many rows a chart draws.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { nonGridRowCeilingQuery } from '@object-ui/core';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

// The bar canvas is irrelevant here — every assertion is about the QUERY. Same
// stub the sibling ObjectGantt tests use, for the same reason.
vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => <div data-testid="gantt-view">{tasks.length}</div>,
}));

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

// Registers `object-gantt` (and the ElementDataSourceGate wiring under test).
import './index';

const HOT_VIEW = {
  name: 'hot',
  label: 'Hot tasks',
  columns: ['name', 'priority'],
  filter: [['priority', '=', 'high']],
  sort: [{ field: 'name', order: 'desc' }],
  pagination: { pageSize: 7 },
};

/**
 * A sort entry that omits `order` is only reachable through UNTYPED saved-view
 * metadata: `SortConfig.order` / `ElementDataSourceSort.order` are REQUIRED in
 * objectui's own types, so a typed caller cannot spell this, while
 * `ElementSavedView` is `Record< string, unknown >` by design. That is the
 * authoring surface this fixture stands in for (objectui#4022).
 */
const PARTIAL_SORT_VIEW = {
  name: 'partial',
  label: 'Partially ordered',
  sort: [{ field: 'end_date' }, { field: 'name', order: 'desc' }],
};

const GANTT = { startDateField: 'start_date', endDateField: 'end_date', titleField: 'name' };

function makeAdapter(listViews: Record<string, unknown> = { hot: HOT_VIEW }) {
  return {
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'task',
      fields: {
        name: { type: 'text' },
        priority: { type: 'text' },
        start_date: { type: 'datetime' },
        end_date: { type: 'datetime' },
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

describe('object-gantt — dataSource: { object, view } (objectstack#7121)', () => {
  it('queries the bound object with the saved view’s filter and sort', async () => {
    const adapter = makeAdapter();
    renderBlock(
      { type: 'object-gantt', gantt: GANTT, dataSource: { object: 'task', view: 'hot' } },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const [object, params] = adapter.find.mock.calls[0] as [string, any];
    expect(object).toBe('task');
    expect(params.$filter).toEqual([['priority', '=', 'high']]);
    expect(params.$orderby).toEqual({ name: 'desc' });
  });

  it('narrows, never widens: the binding’s own filter ANDs with the view’s', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-gantt',
        gantt: GANTT,
        dataSource: {
          object: 'task',
          view: 'hot',
          filter: [['owner', '=', 'me']],
        },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const [, params] = adapter.find.mock.calls[0] as [string, any];
    // Both sources survive — the binding is "additional filter criteria", so it
    // cannot drop the view's restriction.
    expect(JSON.stringify(params.$filter)).toContain('priority');
    expect(JSON.stringify(params.$filter)).toContain('owner');
  });

  it('reports an unresolvable `view` instead of fetching the whole object', async () => {
    const adapter = makeAdapter();
    const { container } = renderBlock(
      { type: 'object-gantt', gantt: GANTT, dataSource: { object: 'task', view: 'nope' } },
      adapter,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="object-gantt-datasource-error"]')).not.toBeNull(),
    );
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('writes NO row cap: an authored `limit` never reaches the $top, which is the platform ceiling', async () => {
    const adapter = makeAdapter();
    renderBlock(
      { type: 'object-gantt', gantt: GANTT, dataSource: { object: 'task', view: 'hot', limit: 3 } },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const [, params] = adapter.find.mock.calls[0] as [string, any];
    // Not an oversight — `limit` is unmapped because there is no read site. The
    // assertion is here so a future mapping addition has to be deliberate.
    expect(params.$top).not.toBe(3);
    expect(params.$top).toBe(nonGridRowCeilingQuery().$top);
    expect(params.options).toBeUndefined();
  });

  it('leaves a gantt with NO dataSource exactly as it was', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-gantt',
        objectName: 'task',
        gantt: GANTT,
        filter: [['owner', '=', 'me']],
        sort: [{ field: 'end_date', order: 'asc' }],
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const [object, params] = adapter.find.mock.calls[0] as [string, any];
    expect(object).toBe('task');
    expect(params.$filter).toEqual([['owner', '=', 'me']]);
    expect(params.$orderby).toEqual({ end_date: 'asc' });
  });

  it('orders by a sort entry that omits `order` instead of dropping it', async () => {
    const adapter = makeAdapter({ partial: PARTIAL_SORT_VIEW });
    renderBlock(
      { type: 'object-gantt', gantt: GANTT, dataSource: { object: 'task', view: 'partial' } },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const [, params] = adapter.find.mock.calls[0] as [string, any];
    // The private copy this block used to inline required BOTH keys and silently
    // dropped `end_date`, sending `{ name: 'desc' }` — an authored sort key lost
    // on the way to the wire. The shared sink reads a missing `order` as
    // ascending, which is what `QueryParams.$orderby`'s own member shape
    // (`{ field: string; order?: 'asc' | 'desc' }`) declares, and what the string
    // spelling (`"end_date"`) already meant in the very same copy.
    expect(params.$orderby).toEqual({ end_date: 'asc', name: 'desc' });
  });

  it('sends NO $orderby when nothing orderable was authored', async () => {
    const adapter = makeAdapter();
    renderBlock(
      { type: 'object-gantt', objectName: 'task', gantt: GANTT, sort: [] },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const [, params] = adapter.find.mock.calls[0] as [string, any];
    // The private copy reduced an empty array to `{}` — a TRUTHY value that only
    // means "no ordering" by accident of the adapter serializer. `undefined` says
    // it outright, so the query simply carries no `$orderby`.
    expect(params.$orderby).toBeUndefined();
  });
});

describe('object-gantt — the unresolvable-view panel title reads the bundle (objectui#12920)', () => {
  it('under zh-CN the panel is titled in Chinese, not the English literal', async () => {
    const adapter = makeAdapter();
    const { container } = render(
      <I18nProvider persistLanguage={false} config={{ defaultLanguage: 'zh-CN', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={adapter as any}>
          <SchemaRenderer schema={{ type: 'object-gantt', gantt: GANTT, dataSource: { object: 'task', view: 'nope' } } as any} />
        </SchemaRendererProvider>
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="object-gantt-datasource-error"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="object-gantt-datasource-error"] p.font-medium')?.textContent).toBe(
      '无法解析此甘特图的数据源',
    );
  });
});
