/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26613 — a `list-view` block in a page region half the page or
 * wider takes the CAPPED posture: its first rows, at most `dataSource.limit`
 * of them and 5 when none is stated, in a short table of the view's first four
 * columns, ending with 「View all N →」 to the object list on the block's view.
 * No toolbar, no `#` column (the grid's), no pager. A `page:tabs` strip whose
 * tabs hold list blocks caps each tab's list and badges each tab with the
 * count its list's own query answered.
 *
 * Everything renders through the REAL page renderer, the REAL `page:tabs` and
 * the REAL `list-view` registration, with the stand-in `ResizeObserver` the
 * objectui#12703 pins beside this file use for the region widths. The data
 * source honours `$top` / `$skip` and answers the full match `total`, as the
 * server does; the grid is a spy, so "the grid was mounted" is what the full
 * list looks like.
 *
 * What is pinned:
 *  (a) a full-width block over 21 records draws 5 rows, asks the server for 5,
 *      draws the view's first four of its five columns, no toolbar and no grid,
 *      and ends with "View all 21" to the bound view's destination;
 *  (b) `dataSource.limit` caps the block at its own number;
 *  (c) a tabbed block caps each tab's list and badges each tab with its count,
 *      the inactive tabs included;
 *  (d) CONTROL — the aside block on the same page stays compact, and a page
 *      whose width is not known keeps the full list.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup, within, fireEvent } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import {
  ActionProvider,
  I18nProvider,
  RelatedRecordActionsProvider,
  SchemaRenderer,
  SchemaRendererProvider,
  type RelatedRecordActionsValue,
} from '@object-ui/react';
// Registers the REAL page renderer, `page:card` and `page:tabs` (module scope, AGENTS.md §测试纪律).
import '@object-ui/components';
// Registers the REAL `list-view`.
import '../index';

const LEAD = 'crm_lead';
const DEAL = 'crm_opportunity';
const TASK = 'crm_task';

const makeRows = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    name: `${prefix} ${i + 1}`,
    company: `Company ${i + 1}`,
    email: `${prefix}${i + 1}@example.com`,
    status: 'open',
    rating: 'hot',
  }));

const TABLES: Record<string, Record<string, unknown>[]> = {
  [LEAD]: makeRows('lead', 21),
  [DEAL]: makeRows('deal', 8),
  [TASK]: makeRows('task', 3),
};

const fieldsOf = () => ({
  id: { name: 'id', type: 'text', label: 'Id' },
  name: { name: 'name', type: 'text', label: 'Name' },
  company: { name: 'company', type: 'text', label: 'Company' },
  email: { name: 'email', type: 'text', label: 'Email' },
  status: { name: 'status', type: 'text', label: 'Status' },
  rating: { name: 'rating', type: 'text', label: 'Rating' },
});

const objectDefOf = (name: string) => ({
  name,
  label: name,
  fields: fieldsOf(),
  listViews: {
    mine: { name: 'mine', label: 'Mine', type: 'grid', columns: ['name', 'company', 'email', 'status', 'rating'] },
  },
});

// The full list is "the grid was mounted"; the capped list never mounts it.
ComponentRegistry.register(
  'object-grid',
  () => <div data-testid="grid-spy" />,
  { namespace: 'test', label: 'Grid spy', category: 'view' },
);

/** Honours the window it is asked for and answers the full match count, as the server does. */
const makeDataSource = () =>
  ({
    find: vi.fn(async (object: string, params: { $top?: number; $skip?: number } = {}) => {
      const all = TABLES[object] ?? [];
      const skip = params.$skip ?? 0;
      const top = params.$top ?? all.length;
      return { data: all.slice(skip, skip + top), total: all.length };
    }),
    findOne: vi.fn(async () => null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(async (object: string) => (TABLES[object] ?? []).length),
    getObjectSchema: vi.fn(async (object: string) => objectDefOf(object)),
    getObjects: vi.fn(async () => []),
    onMutation: () => () => {},
  });

/** A host answering the console's route shapes for exactly what it is handed. */
function makeHost(): RelatedRecordActionsValue {
  return {
    resolve: () => ({}),
    listHref: (objectName: string, viewName?: string) =>
      viewName ? `/apps/crm/${objectName}/view/${viewName}` : `/apps/crm/${objectName}`,
    openList: vi.fn(),
  };
}

/** Installs a `ResizeObserver` that reports these widths for the page body and each region. */
function stubWidths(widths: { page: number; regions: Record<string, number> }) {
  class WidthReportingObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      const region = target.getAttribute('data-region');
      const width = region != null
        ? widths.regions[region]
        : target.matches('[data-page-type] > div') ? widths.page : undefined;
      if (width === undefined) return;
      this.callback([{ target, contentRect: { width } } as unknown as ResizeObserverEntry], this as never);
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', WidthReportingObserver);
}

function renderPage(page: Record<string, unknown>) {
  const dataSource = makeDataSource();
  // The real English pack, so the link and the badges read as a user hears them.
  const view = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <ActionProvider>
        <SchemaRendererProvider dataSource={dataSource as never}>
          <RelatedRecordActionsProvider value={makeHost()}>
            <SchemaRenderer schema={page as never} />
          </RelatedRecordActionsProvider>
        </SchemaRendererProvider>
      </ActionProvider>
    </I18nProvider>,
  );
  return { dataSource, ...view };
}

const regionOf = (container: HTMLElement, name: string): HTMLElement => {
  const el = container.querySelector(`[data-region="${name}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`no region ${name}`);
  return el;
};

/** The `$top` of every list query for `object`. */
const topsFor = (dataSource: ReturnType<typeof makeDataSource>, object: string) =>
  dataSource.find.mock.calls
    .filter(([name]) => name === object)
    .map(([, params]) => (params as { $top?: number } | undefined)?.$top);

const leadBlock = (id: string, binding: Record<string, unknown> = {}) => ({
  type: 'list-view',
  id,
  label: 'My Leads',
  dataSource: { object: LEAD, view: 'mine', ...binding },
});

const pageWith = (main: unknown[], aside: unknown[] = []) => ({
  type: 'home',
  template: 'three-column',
  regions: [
    { name: 'main', components: main },
    { name: 'aside', width: 'medium', components: aside },
  ],
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a list block half the page or wider is capped (objectstack#26613)', () => {
  it('(a) draws 5 of 21 rows, the view\'s first four columns, no toolbar or grid, and "View all 21"', async () => {
    stubWidths({ page: 1200, regions: { main: 856, aside: 320 } });
    const { container, dataSource } = renderPage(pageWith([leadBlock('main_leads')]));
    const main = regionOf(container, 'main');

    await waitFor(() => expect(within(main).getAllByTestId('list-capped-row')).toHaveLength(5));
    // The cap is the query's window, not a slice of a bigger page.
    expect(topsFor(dataSource, LEAD)).toContain(5);
    expect(topsFor(dataSource, LEAD)).not.toContain(undefined);

    // The view declares five columns; the table draws the first four, in order.
    expect(within(main).getAllByTestId('list-capped-header').map((th) => th.textContent)).toEqual([
      'Name',
      'Company',
      'Email',
      'Status',
    ]);
    expect(within(main).queryByText('lead1@example.com')).toBeTruthy();
    expect(within(main).queryByText('Rating')).toBeNull();

    // None of the object list's chrome: no toolbar, no grid (so no `#` column), no count bar.
    expect(within(main).queryByTestId('toolbar-filter-trigger')).toBeNull();
    expect(within(main).queryByTestId('grid-spy')).toBeNull();
    expect(within(main).queryByTestId('record-count-bar')).toBeNull();

    // The link to the rest: the whole match count, to the bound view.
    const link = within(main).getByRole('link', { name: /^View all 21/ });
    expect(link.getAttribute('href')).toBe(`/apps/crm/${LEAD}/view/mine`);
  });

  it('(b) `dataSource.limit` caps the block at its own number', async () => {
    stubWidths({ page: 1200, regions: { main: 856, aside: 320 } });
    const { container, dataSource } = renderPage(pageWith([leadBlock('main_leads', { limit: 3 })]));
    const main = regionOf(container, 'main');

    await waitFor(() => expect(within(main).getAllByTestId('list-capped-row')).toHaveLength(3));
    expect(topsFor(dataSource, LEAD)).toContain(3);
    expect(within(main).getByRole('link', { name: /^View all 21/ })).toBeTruthy();
  });

  it('(c) a tabbed block caps each tab and badges each tab with its own count', async () => {
    stubWidths({ page: 1200, regions: { main: 856, aside: 320 } });
    const tab = (label: string, object: string) => ({
      label,
      children: [{ type: 'list-view', id: `tab_${object}`, label, dataSource: { object, view: 'mine' } }],
    });
    const { container, dataSource } = renderPage(pageWith([
      {
        type: 'page:tabs',
        id: 'home_tabs',
        properties: { items: [tab('My Leads', LEAD), tab('My Open Deals', DEAL), tab('My Open Tasks', TASK)] },
      },
    ]));
    const main = regionOf(container, 'main');

    // Every tab's list ran its capped query, the two inactive tabs included,
    // and each badge says its own list's count.
    await waitFor(() => {
      const triggers = within(main).getAllByRole('tab');
      expect(triggers.map((t) => t.textContent)).toEqual(['My Leads21', 'My Open Deals8', 'My Open Tasks3']);
    });
    for (const object of [LEAD, DEAL, TASK]) expect(topsFor(dataSource, object)).toContain(5);

    // The active tab: 5 of its 21 rows. The inactive panels stay mounted,
    // hidden by a `data-state` class this DOM has no stylesheet for, so the
    // active one is found by its state.
    const activePanel = (): HTMLElement => {
      const panel = main.querySelector('[role="tabpanel"][data-state="active"]');
      if (!(panel instanceof HTMLElement)) throw new Error('no active tab panel');
      return panel;
    };
    expect(main.querySelectorAll('[role="tabpanel"]')).toHaveLength(3);
    expect(within(activePanel()).getAllByTestId('list-capped-row')).toHaveLength(5);
    expect(within(activePanel()).getByRole('link', { name: /^View all 21/ })).toBeTruthy();

    // The second tab: 5 of its 8 rows.
    fireEvent.mouseDown(within(main).getByRole('tab', { name: /My Open Deals/ }), { button: 0 });
    await waitFor(() => expect(within(activePanel()).getByRole('link', { name: /^View all 8/ })).toBeTruthy());
    expect(within(activePanel()).getAllByTestId('list-capped-row')).toHaveLength(5);

    // The third: all 3 of its rows, under the cap.
    fireEvent.mouseDown(within(main).getByRole('tab', { name: /My Open Tasks/ }), { button: 0 });
    await waitFor(() => expect(within(activePanel()).getByRole('link', { name: /^View all 3/ })).toBeTruthy());
    expect(within(activePanel()).getAllByTestId('list-capped-row')).toHaveLength(3);
  });
});

describe('the other postures are unchanged (objectstack#26613)', () => {
  it('(d) CONTROL: the aside block on the same page stays compact', async () => {
    stubWidths({ page: 1200, regions: { main: 856, aside: 320 } });
    const { container } = renderPage(pageWith([leadBlock('main_leads')], [leadBlock('aside_leads')]));
    const aside = regionOf(container, 'aside');
    await waitFor(() => expect(within(aside).getAllByTestId('list-compact-row').length).toBeGreaterThan(0));
    expect(within(aside).queryByTestId('list-capped-table')).toBeNull();
  });

  it('(d) CONTROL: a page whose width is not known keeps the full list', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const { container } = renderPage(pageWith([leadBlock('main_leads')]));
    const main = regionOf(container, 'main');
    await waitFor(() => expect(within(main).getByTestId('grid-spy')).toBeTruthy());
    expect(within(main).queryByTestId('list-capped-table')).toBeNull();
    expect(within(main).getByTestId('toolbar-filter-trigger')).toBeTruthy();
  });
});
