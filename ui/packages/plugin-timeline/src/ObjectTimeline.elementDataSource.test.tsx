/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-timeline` consumes `PageComponentSchema.dataSource` (objectstack#7121),
 * and since objectstack#7137 it consumes ALL of it: `object`, `filter`, `sort`
 * and `limit`.
 *
 * Two defects met here. objectstack#7121: every branch of the timeline's fetch
 * effect is gated on `schema.objectName` and nothing mapped the spec's
 * `dataSource.object` onto it, so a timeline authored the way the spec documents
 * never fetched — an empty rail, no request, no error. objectstack#7137: the fetch
 * was `find(objectName, { options: { $top: 100 } })` — no `$filter`, no
 * `$orderby`, and `options` is not a `QueryParams` key, so even the window was
 * inert. A named `view` resolved (a typo reported) and then contributed NOTHING,
 * which is the failure this binding exists to remove: the rail was wider than the
 * view it named, and looked right.
 *
 * The two cases that used to pin the gap honestly ("no filter/orderby in the
 * query", "options is the whole query") were written to turn RED the day the read
 * sites landed — see the note they carried. They did; they are now the positive
 * assertions below.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Registers `object-timeline` (and the ElementDataSourceGate wiring under test).
import './index';

const HOT_VIEW = {
  name: 'hot',
  label: 'Hot campaigns',
  columns: ['name', 'stage'],
  filter: [['stage', '=', 'live']],
  sort: [{ field: 'name', order: 'desc' }],
  pagination: { pageSize: 7 },
};

const TIMELINE = { startDateField: 'start_date', endDateField: 'end_date', titleField: 'name' };

function makeAdapter(listViews: Record<string, unknown> = { hot: HOT_VIEW }) {
  return {
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'campaign',
      fields: {
        name: { type: 'text' },
        stage: { type: 'text' },
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

const firstQuery = async (adapter: ReturnType<typeof makeAdapter>) => {
  await waitFor(() => expect(adapter.find).toHaveBeenCalled());
  return adapter.find.mock.calls[0] as [string, any];
};

describe('object-timeline — dataSource: { object, view } (objectstack#7121)', () => {
  it('queries the object named by the binding', async () => {
    const adapter = makeAdapter();
    renderBlock(
      { type: 'object-timeline', timeline: TIMELINE, dataSource: { object: 'campaign', view: 'hot' } },
      adapter,
    );

    const [object] = await firstQuery(adapter);
    expect(object).toBe('campaign');
  });

  it('reports an unresolvable `view` instead of fetching the whole object', async () => {
    const adapter = makeAdapter();
    const { container } = renderBlock(
      { type: 'object-timeline', timeline: TIMELINE, dataSource: { object: 'campaign', view: 'nope' } },
      adapter,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="object-timeline-datasource-error"]')).not.toBeNull(),
    );
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('leaves a timeline with NO dataSource fetching the same rows as before', async () => {
    const adapter = makeAdapter();
    renderBlock({ type: 'object-timeline', objectName: 'campaign', timeline: TIMELINE }, adapter);

    const [object, params] = await firstQuery(adapter);
    expect(object).toBe('campaign');
    expect(params.$filter).toBeUndefined();
    expect(params.$orderby).toBeUndefined();
    // The default window is now a REAL `$top` rather than a `$top` nested under
    // `options`, which no adapter in this repo reads (`convertQueryParams` in
    // `@object-ui/data-objectstack` maps `params.$top`). The number is unchanged;
    // it just reaches the wire now.
    expect(params.$top).toBe(100);
    expect(params.options).toBeUndefined();
  });
});

describe('object-timeline — the view actually narrows the rail (objectstack#7137)', () => {
  it('applies a named view’s filter, sort and page size to the query', async () => {
    const adapter = makeAdapter();
    renderBlock(
      { type: 'object-timeline', timeline: TIMELINE, dataSource: { object: 'campaign', view: 'hot' } },
      adapter,
    );

    const [object, params] = await firstQuery(adapter);
    expect(object).toBe('campaign');
    // One surviving filter source passes through verbatim — no pointless `and`.
    expect(params.$filter).toEqual([['stage', '=', 'live']]);
    expect(params.$orderby).toEqual({ name: 'desc' });
    // The view's `pagination.pageSize` is its row cap.
    expect(params.$top).toBe(7);
  });

  it('AND-combines the binding’s additional filter with the view’s, and lets binding sort/limit win', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-timeline',
        timeline: TIMELINE,
        dataSource: {
          object: 'campaign',
          view: 'hot',
          filter: [['owner', '=', 'me']],
          sort: [{ field: 'end_date', order: 'asc' }],
          limit: 3,
        },
      },
      adapter,
    );

    const [, params] = await firstQuery(adapter);
    // Additional criteria NARROW the view — each source its own child of the
    // `and`, never a replacement (a binding filter can't widen a saved view).
    expect(params.$filter).toEqual(['and', [['stage', '=', 'live']], [['owner', '=', 'me']]]);
    // `sort` / `limit` override the view's rather than combining.
    expect(params.$orderby).toEqual({ end_date: 'asc' });
    expect(params.$top).toBe(3);
  });

  it('honours filter / sort / limit authored directly on the block', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-timeline',
        objectName: 'campaign',
        timeline: TIMELINE,
        filter: [['stage', '=', 'live']],
        sort: [{ field: 'end_date', order: 'desc' }],
        limit: 12,
      },
      adapter,
    );

    const [object, params] = await firstQuery(adapter);
    expect(object).toBe('campaign');
    expect(params.$filter).toEqual([['stage', '=', 'live']]);
    // The array arm — the ONE declared spelling since objectui#8221 — is lowered
    // the same way the sibling object-bound blocks lower theirs
    // (`convertSortToQueryParams`).
    expect(params.$orderby).toEqual({ end_date: 'desc' });
    expect(params.$top).toBe(12);
  });

  it('AND-combines the block’s own filter with the view’s and the binding’s', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-timeline',
        timeline: TIMELINE,
        filter: [['archived', '=', false]],
        dataSource: { object: 'campaign', view: 'hot', filter: [['owner', '=', 'me']] },
      },
      adapter,
    );

    const [, params] = await firstQuery(adapter);
    expect(params.$filter).toEqual([
      'and',
      [['archived', '=', false]],
      ['and', [['stage', '=', 'live']], [['owner', '=', 'me']]],
    ]);
  });
});

describe('object-timeline — the unresolvable-view panel title reads the bundle (objectui#12920)', () => {
  it('under zh-CN the panel is titled in Chinese, not the English literal', async () => {
    const adapter = makeAdapter();
    const { container } = render(
      <I18nProvider persistLanguage={false} config={{ defaultLanguage: 'zh-CN', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={adapter as any}>
          <SchemaRenderer schema={{ type: 'object-timeline', timeline: TIMELINE, dataSource: { object: 'campaign', view: 'nope' } } as any} />
        </SchemaRendererProvider>
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="object-timeline-datasource-error"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="object-timeline-datasource-error"] p.font-medium')?.textContent).toBe(
      '无法解析此时间线的数据源',
    );
  });
});
