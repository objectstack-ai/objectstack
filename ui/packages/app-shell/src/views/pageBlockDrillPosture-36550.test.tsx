/**
 * objectstack-ai/objectstack#36550 (#36256) — a page block's drill draws the
 * standard list, not the page region's posture.
 *
 * A page region tells its blocks their posture (compact or capped), and React
 * context crosses the drill dialog's portal. So a metric block's drill, opened
 * from a region half the page or wider, drew its list capped: no toolbar, no
 * chips, no pager, and a 「View all N」 link to the object's list without the
 * drill's condition. The drill clears the posture for its own subtree.
 *
 * Everything renders through the REAL page renderer, the REAL `list-view` and
 * the REAL `object-metric`, with the stand-in `ResizeObserver` the
 * objectui#12703 / objectstack#26613 pins use for the region widths. CONTROL:
 * the page's own list block in the same region stays capped.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import {
  ActionProvider,
  I18nProvider,
  RelatedRecordActionsProvider,
  SchemaRenderer,
  SchemaRendererProvider,
  type RelatedRecordActionsValue,
} from '@object-ui/react';
import { ValueDataSource } from '@object-ui/core';
import '@object-ui/components';
import '@object-ui/plugin-dashboard';
import '@object-ui/plugin-list';

const OBJECT = 'opp_36550';
const DEFINITION = {
  name: OBJECT,
  label: 'Opportunity',
  nameField: 'name',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: { type: 'text', label: 'Stage' },
    amount: { type: 'number', label: 'Amount' },
  },
};
const ROWS = [
  { id: 'o1', name: 'Initech Phase 1', stage: 'closed_won', amount: 90000 },
  { id: 'o2', name: 'Wayne Q1 Expansion', stage: 'closed_won', amount: 380000 },
  { id: 'o3', name: 'Apex Logistics Data Hub', stage: 'needs_analysis', amount: 93000 },
];

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

const host = (): RelatedRecordActionsValue => ({
  resolve: () => ({}),
  listHref: (objectName: string) => `/apps/crm/${objectName}`,
  openList: vi.fn(),
});

function mount() {
  const matcher = new ValueDataSource({ items: ROWS });
  const ds = {
    find: vi.fn((object: string, params?: Record<string, unknown>) => matcher.find(object, params as never)),
    aggregate: vi.fn(async () => [{ amount_sum: 470000 }]),
    getObjectSchema: vi.fn(async () => structuredClone(DEFINITION)),
  };
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  stubWidths({ page: 1200, regions: { main: 856, aside: 320 } });
  const view = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <ActionProvider>
        <SchemaRendererProvider dataSource={ds as never}>
          <RelatedRecordActionsProvider value={host()}>
            <SchemaRenderer
              schema={{
                type: 'home',
                template: 'three-column',
                regions: [
                  {
                    name: 'main',
                    components: [
                      {
                        type: 'object-metric',
                        objectName: OBJECT,
                        label: 'Revenue won',
                        aggregate: { field: 'amount', function: 'sum' },
                        filter: [{ field: 'stage', operator: 'equals', value: 'closed_won' }],
                        drillDown: { enabled: true, target: 'dialog', columns: ['name', 'stage', 'amount'] },
                      },
                      { type: 'list-view', id: 'main_list', label: 'Opportunities', dataSource: { object: OBJECT } },
                    ],
                  },
                  { name: 'aside', width: 'medium', components: [] },
                ],
              } as never}
            />
          </RelatedRecordActionsProvider>
        </SchemaRendererProvider>
      </ActionProvider>
    </I18nProvider>,
  );
  return { ds, ...view };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a page block's drill draws the standard list, not the region's posture (#36550)", () => {
  it('shows its chips and its record count and no 「View all」, while the block list beside it stays capped', async () => {
    const { container } = mount();
    const main = container.querySelector('[data-region="main"]') as HTMLElement;

    // CONTROL: the page's own list block in the same region is capped.
    await waitFor(() => expect(within(main).getAllByTestId('list-capped-row')).toHaveLength(3));
    expect(within(main).getByRole('link', { name: /^View all 3/ })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /revenue won|470,000/i }));
    const dialog = await screen.findByTestId('drill-down-dialog');
    for (const name of ['Initech Phase 1', 'Wayne Q1 Expansion']) {
      expect(await within(dialog).findByText(name)).toBeInTheDocument();
    }
    // The standard list: the drill's condition as a chip, and its record count.
    expect(await within(dialog).findByTestId('filter-chip-stage')).toBeInTheDocument();
    expect(await within(dialog).findByText('2 records')).toBeInTheDocument();
    // Not the capped list, and no link to a list without the condition.
    expect(within(dialog).queryByTestId('list-capped-table')).toBeNull();
    expect(within(dialog).queryByRole('link', { name: /View all/ })).toBeNull();
    expect(within(dialog).queryByText('Apex Logistics Data Hub')).toBeNull();
  });
});
