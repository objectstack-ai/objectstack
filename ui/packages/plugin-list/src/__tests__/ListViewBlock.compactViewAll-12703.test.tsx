/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12703, part 2 — the compact list's "View all" link.
 *
 * A `list-view` block in a narrow page region draws the compact list (part 1).
 * Under its rows it now draws a real link to the rest of the list, whose
 * destination the HOST builds through `RelatedRecordActionsValue.listHref` /
 * `openList`: the block's bound saved view when it binds `dataSource.view`, the
 * object's own list otherwise. The block's own filter, columns and sort are
 * never handed to the host, so they cannot reach the URL.
 *
 * Rendered through the REAL page renderer and the REAL `list-view`
 * registration, with the stand-in `ResizeObserver` the part-1 pin beside this
 * file uses for the region widths. The host is a recording stand-in: it answers
 * `/apps/crm/OBJECT` or `/apps/crm/OBJECT/view/VIEW` for exactly the arguments
 * it was handed, so what the link carries is what the block asked for. The
 * host's own route building is pinned in app-shell
 * (`PageView.listHref-12703.test.tsx`).
 *
 * What is pinned:
 *  (a) a compact block bound to a saved view: the link's href is that view's
 *      destination, it is named "View all", and a plain left click opens it
 *      through the host's SPA open (a modifier click is left to the browser);
 *  (b) a compact block with an inline filter only: the host is asked for the
 *      object's list with no view, and the href carries no query;
 *  (c) CONTROL — a host without `listHref`, and no host at all: no link;
 *  (d) CONTROL — the block in a wide region draws the full list and no link,
 *      with the same host.
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
// Registers the REAL page renderer and `page:card` (module scope, AGENTS.md §测试纪律).
import '@object-ui/components';
// Registers the REAL `list-view`.
import '../index';

const OBJECT = 'crm_event';

const rows = [
  { id: 'e-1', subject: 'Renewal review', location: 'Room 4', status: 'planned' },
  { id: 'e-2', subject: 'Discovery call', location: 'Zoom', status: 'planned' },
];

const objectDef = {
  name: OBJECT,
  label: 'Event',
  fields: {
    id: { name: 'id', type: 'text', label: 'Id' },
    subject: { name: 'subject', type: 'text', label: 'Subject' },
    location: { name: 'location', type: 'text', label: 'Location' },
    status: { name: 'status', type: 'text', label: 'Status' },
  },
  // The saved view case (a) binds by name.
  listViews: {
    upcoming: { name: 'upcoming', label: 'Upcoming', type: 'grid', columns: ['subject', 'location'] },
  },
};

ComponentRegistry.register(
  'object-grid',
  () => <div data-testid="grid-spy" />,
  { namespace: 'test', label: 'Grid spy', category: 'view' },
);

const makeDataSource = () =>
  ({
    find: vi.fn(async () => rows),
    findOne: vi.fn(async () => null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(async () => rows.length),
    getObjectSchema: vi.fn(async () => objectDef),
    getObjects: vi.fn(async () => []),
    onMutation: () => () => {},
  });

/** A host that records what it was asked and answers the console's route shapes. */
function makeHost() {
  const listHref = vi.fn((objectName: string, viewName?: string) =>
    viewName ? `/apps/crm/${objectName}/view/${viewName}` : `/apps/crm/${objectName}`,
  );
  const openList = vi.fn();
  const value: RelatedRecordActionsValue = { resolve: () => ({}), listHref, openList };
  return { value, listHref, openList };
}

/** A page with a wide `main` and a narrow `aside`, each holding this block. */
const pageWith = (block: Record<string, unknown>) => ({
  type: 'home',
  template: 'three-column',
  regions: [
    { name: 'main', components: [{ ...block, id: 'main_list' }] },
    { name: 'aside', width: 'medium', components: [{ ...block, id: 'aside_list' }] },
  ],
});

/** (a) bound to a saved view of the object. */
const boundBlock = {
  type: 'list-view',
  label: 'Upcoming',
  dataSource: { object: OBJECT, view: 'upcoming' },
};

/** (b) an inline filter, columns and sort, and no saved view. */
const inlineBlock = {
  type: 'list-view',
  label: 'Planned',
  properties: {
    data: { provider: 'object', object: OBJECT },
    columns: ['subject', 'location'],
    filter: [['status', '=', 'planned']],
    sort: [{ field: 'subject', order: 'asc' }],
  },
};

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

function renderPage(page: Record<string, unknown>, host: RelatedRecordActionsValue | null) {
  stubWidths({ page: 1200, regions: { main: 856, aside: 320 } });
  const tree = <SchemaRenderer schema={page as never} />;
  // The real English pack, so the link is found by the name a user hears.
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <ActionProvider>
        <SchemaRendererProvider dataSource={makeDataSource() as never}>
          {host ? <RelatedRecordActionsProvider value={host}>{tree}</RelatedRecordActionsProvider> : tree}
        </SchemaRendererProvider>
      </ActionProvider>
    </I18nProvider>,
  );
}

const regionOf = (container: HTMLElement, name: string): HTMLElement => {
  const el = container.querySelector(`[data-region="${name}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`no region ${name}`);
  return el;
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the compact list links to the rest through the host (objectui#12703 part 2)', () => {
  it('(a) a block bound to a saved view links to that view, and a left click opens it in the SPA', async () => {
    const host = makeHost();
    const { container } = renderPage(pageWith(boundBlock), host.value);
    const aside = regionOf(container, 'aside');

    await waitFor(() => expect(within(aside).getAllByTestId('list-compact-row')).toHaveLength(2));
    const link = within(aside).getByRole('link', { name: /^View all/ });
    expect(link.getAttribute('href')).toBe(`/apps/crm/${OBJECT}/view/upcoming`);
    expect(host.listHref).toHaveBeenCalledWith(OBJECT, 'upcoming');

    // A modifier click is the browser's (a new tab): no SPA open.
    fireEvent.click(link, { button: 0, metaKey: true });
    expect(host.openList).not.toHaveBeenCalled();

    // A plain left click opens the same destination in the SPA.
    fireEvent.click(link, { button: 0 });
    expect(host.openList).toHaveBeenCalledTimes(1);
    expect(host.openList).toHaveBeenCalledWith(OBJECT, 'upcoming');
  });

  it('(b) a block with an inline filter only links to the object list, with no query', async () => {
    const host = makeHost();
    const { container } = renderPage(pageWith(inlineBlock), host.value);
    const aside = regionOf(container, 'aside');

    await waitFor(() => expect(within(aside).getAllByTestId('list-compact-row')).toHaveLength(2));
    const href = within(aside).getByRole('link', { name: /^View all/ }).getAttribute('href');
    expect(href).toBe(`/apps/crm/${OBJECT}`);
    expect(href).not.toContain('?');
    // The host was asked for the object and nothing else: no view, and no
    // filter, columns or sort, which the seam has no argument for.
    for (const call of host.listHref.mock.calls) {
      expect(call).toEqual([OBJECT, undefined]);
    }
  });

  it('(c) CONTROL: a host without `listHref`, or no host, draws no link', async () => {
    const bare = renderPage(pageWith(boundBlock), { resolve: () => ({}) });
    const aside = regionOf(bare.container, 'aside');
    await waitFor(() => expect(within(aside).getAllByTestId('list-compact-row')).toHaveLength(2));
    expect(within(aside).queryByTestId('list-compact-footer')).toBeNull();
    expect(within(aside).queryByRole('link', { name: /^View all/ })).toBeNull();
    cleanup();

    const none = renderPage(pageWith(boundBlock), null);
    const aside2 = regionOf(none.container, 'aside');
    await waitFor(() => expect(within(aside2).getAllByTestId('list-compact-row')).toHaveLength(2));
    expect(within(aside2).queryByTestId('list-compact-footer')).toBeNull();
  });

  it('(d) CONTROL: the same block in the wide region draws the full list and no link', async () => {
    const host = makeHost();
    const { container } = renderPage(pageWith(boundBlock), host.value);
    const main = regionOf(container, 'main');

    await waitFor(() => expect(within(main).getByTestId('grid-spy')).toBeTruthy());
    expect(within(main).getByTestId('toolbar-filter-trigger')).toBeTruthy();
    expect(within(main).queryByTestId('list-compact-footer')).toBeNull();
    expect(within(main).queryByRole('link', { name: /^View all/ })).toBeNull();
  });
});
