/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12526 — a dashboard is named by the console's one page header, the
 * one an object list draws: icon chip, title, the description beside the
 * title, in one row. `DashboardView` drew its own `h1` and a description line
 * beneath it before.
 *
 * What this file pins, through the real `DashboardView` and the real
 * `DashboardRenderer` under a real `I18nProvider`:
 *   - the view renders `page-header`, whose `h1` is the dashboard's label and
 *     whose secondary line, in the same row, is its description; the chip holds
 *     an icon;
 *   - the page has ONE `h1`, the header's, and the label and the description
 *     each appear once on the page: the renderer's own header, declared on the
 *     document, draws neither (`hideHeaderText`);
 *   - there is one "Refresh All" control on the page;
 *   - a dashboard with no description draws no secondary line.
 *
 * jsdom applies no stylesheet, so structure is what is asserted; the one-row
 * shape and its `sm` breakpoint are `PageHeader.oneRow-12423`'s pins.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { MetadataCtx } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';

const meta = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => meta.value }));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ dashboardName: 'ops_board' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/apps/crm/dashboard/ops_board', search: '' }),
}));

vi.mock('./useOpenRecordList', () => ({ useOpenRecordList: () => vi.fn() }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => ({}) }));
vi.mock('../providers/ExpressionProvider', () => ({ useExpressionContext: () => ({ app: undefined }) }));

import { DashboardView } from './DashboardView';

afterEach(cleanup);

const LABEL = 'Operations (12526)';
const DESCRIPTION = 'What the ops team watches (12526)';

/** One served dashboard, its renderer header declared with both toggles on. */
function dashboard(extra: Record<string, unknown> = {}) {
  return {
    name: 'ops_board',
    label: LABEL,
    description: DESCRIPTION,
    header: { showTitle: true, showDescription: true },
    widgets: [
      { id: 'widget_total', type: 'kpi', title: 'Total (12526)', options: { value: 42 } },
    ],
    ...extra,
  };
}

async function mount(doc: Record<string, unknown>) {
  meta.value = {
    apps: [],
    objects: [],
    dashboards: [doc],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: vi.fn(async () => null),
    getItemsByType: () => [],
    getTypeStatus: () => 'ready',
  };
  const view = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MetadataCtx.Provider value={meta.value as React.ContextType<typeof MetadataCtx>}>
        <DashboardView />
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
  // A skeleton first; the header exists once loading ends.
  const header = await screen.findByTestId('page-header');
  return { ...view, header };
}

/** Elements whose own text is exactly `text`. */
function elementsReading(text: string): Element[] {
  return [...document.body.querySelectorAll('*')].filter(
    (el) => el.children.length === 0 && el.textContent?.trim() === text,
  );
}

describe('DashboardView — the console page header names the dashboard (objectui#12526)', () => {
  it('renders `page-header`: the label as its h1, the description beside it, an icon in the chip', async () => {
    const { header } = await mount(dashboard());

    const h1 = header.querySelector('h1');
    expect(h1?.textContent).toBe(LABEL);
    const line = within(header).getByText(DESCRIPTION);
    expect(line.tagName).toBe('P');
    // Beside the title: the same row, after it.
    expect(line.parentElement).toBe(h1?.parentElement);
    expect(Boolean(h1!.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    // The chip: an icon ahead of the title, in that row.
    const chipIcon = h1!.parentElement!.querySelector('svg');
    expect(chipIcon).not.toBeNull();
    expect(Boolean(chipIcon!.compareDocumentPosition(h1!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('one h1 on the page — the header\'s — and the label and description each appear once', async () => {
    const { container, header } = await mount(dashboard());
    // The renderer has mounted: its widget drew.
    await waitFor(() => expect(screen.getAllByText('Total (12526)').length).toBeGreaterThan(0));

    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(header.contains(h1s[0])).toBe(true);
    expect(elementsReading(LABEL)).toHaveLength(1);
    expect(elementsReading(DESCRIPTION)).toHaveLength(1);
    expect(header.contains(elementsReading(DESCRIPTION)[0])).toBe(true);
  });

  it('one "Refresh All" control on the page', async () => {
    await mount(dashboard());
    expect(await screen.findAllByRole('button', { name: 'Refresh dashboard' })).toHaveLength(1);
  });

  it('a dashboard with no description draws no secondary line', async () => {
    const { header } = await mount(dashboard({ description: undefined }));
    expect(header.querySelector('h1')?.textContent).toBe(LABEL);
    expect(header.querySelector('p')).toBeNull();
  });
});
