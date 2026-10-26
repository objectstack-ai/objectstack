// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12688 — on a zh-CN session the dashboard property panel's component
 * list draws the widget titles the server's `/meta` boundary localized, while
 * every editor keeps the authored title.
 *
 * The list (`DashboardDefaultInspector`) drew each widget's title from the
 * leaf's buffer: the dashboard's pending draft, else its `/layers` code layer.
 * No server localizes either, so the list read "Task Count vs Avg Progress"
 * beside a served dashboard reading 任务数与平均进度. The console's metadata
 * store already holds the `/meta` dashboard list, which the server answers
 * translated (`translateDashboard`). The list now draws that answer's title for
 * every widget whose authored title still equals the published one.
 *
 * The pillar is the real `InterfacesPillar`, with the real
 * `DashboardDefaultInspector` and `DashboardWidgetInspector`, over a mocked
 * metadata client answering as objectstack does: `layered('dashboard')` is the
 * authored English layer. The metadata store (`MetadataCtx`) serves the
 * dashboard list as the server answers it for the session's language. The
 * canvas is a stub: the list and the inspectors are what is pinned, and the
 * canvas's own pass is not this card's.
 *
 *  - zh: the list draws 任务数与平均进度 for `combo_count_vs_progress`, and a
 *    widget the bundle leaves alone reads as authored;
 *  - zh: a widget whose title was edited in the draft, and one added there,
 *    draw their authored title beside a served sibling, and the published
 *    layer is read for that draft;
 *  - zh: the widget inspector's Title input keeps the authored title;
 *  - en: the served list repeats the authored titles, and the list reads as
 *    before.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardSchema } from '@objectstack/spec/ui';
import { I18nProvider } from '@object-ui/i18n';
import { MetadataCtx } from '@object-ui/react';

const PKG = 'com.example.showcase';
const DASH = 'showcase_chart_gallery';

const NAV = [{ id: 'nav_charts', type: 'dashboard', label: 'Chart Gallery', dashboardName: DASH }];

const widget = (id: string, title: string) => ({
  id,
  type: 'metric',
  title,
  dataset: 'tasks_ds',
  values: ['task_count'],
  layout: { x: 0, y: 0, w: 3, h: 2 },
});

/** The published layer, as `/layers` serves it: authored, never localized. */
const CODE = {
  name: DASH,
  label: 'Chart Gallery',
  widgets: [
    widget('kpi_total', 'Total Tasks'),
    widget('kpi_progress', 'Avg Progress'),
    widget('combo_count_vs_progress', 'Task Count vs Avg Progress'),
  ],
};

/** The same dashboard as the `/meta` dashboard list answers a zh-CN request (`translateDashboard`). */
const SERVED_ZH = {
  ...CODE,
  widgets: [
    widget('kpi_total', '任务总数'),
    widget('kpi_progress', 'Avg Progress'),
    widget('combo_count_vs_progress', '任务数与平均进度'),
  ],
};

/** What the server answers an en-US request: the showcase's English bundle repeats the authored title. */
const SERVED_EN = JSON.parse(JSON.stringify(CODE)) as typeof CODE;

/** The dashboard's pending draft: one translated widget retitled, one widget added. */
function editedDraft() {
  const draft = JSON.parse(JSON.stringify(CODE)) as typeof CODE;
  draft.widgets[2] = { ...draft.widgets[2], title: 'Count vs Progress' };
  draft.widgets.push(widget('kpi_spent', 'Total Spent'));
  return draft;
}

const state: { served: unknown; draft: unknown } = { served: SERVED_ZH, draft: null };

const mockClient = {
  list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'showcase_app', label: 'Showcase' }] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string) => {
    if (type === 'app') return { effective: { name: 'showcase_app', label: 'Showcase', navigation: NAV } };
    if (type === 'dashboard') return { effective: JSON.parse(JSON.stringify(CODE)) };
    return { code: null, overlay: null, overlayScope: null, effective: null };
  }),
  getDraft: vi.fn(async (type: string) =>
    type === 'dashboard' && state.draft ? { item: JSON.parse(JSON.stringify(state.draft)) } : null,
  ),
  save: vi.fn(async () => ({ success: true, version: 'v1', state: 'draft' })),
  get: vi.fn(async () => undefined),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

import { InterfacesPillar } from './StudioDesignSurface';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { registerMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry';
import { DashboardDefaultInspector } from '../metadata-admin/inspectors/DashboardDefaultInspector';
import { DashboardWidgetInspector } from '../metadata-admin/inspectors/DashboardWidgetInspector';

// A stub canvas: the leaf needs a registered preview to be draft-editable,
// and the canvas's own drawing is not what this file pins.
registerMetadataPreview('dashboard', () => null);
registerMetadataDefaultInspector('dashboard', DashboardDefaultInspector);
registerMetadataInspector('dashboard', DashboardWidgetInspector);

/** The console's metadata store: the `/meta` dashboard list as served for the session's language. */
function metadataStore(served: unknown) {
  return {
    apps: [],
    objects: [],
    dashboards: [served],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready' as const,
  };
}

beforeEach(() => {
  state.served = SERVED_ZH;
  state.draft = null;
  for (const fn of Object.values(mockClient)) fn.mockClear();
});

afterEach(() => {
  cleanup();
});

/** Render the pillar in `language`, and return the dashboard's component list once `firstRow` is in it. */
async function componentList(language: 'en' | 'zh', firstRow: string): Promise<HTMLElement> {
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <MetadataCtx.Provider value={metadataStore(state.served) as never}>
        <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
          <InterfacesPillar packageId={PKG} />
        </MemoryRouter>
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
  const inspector = await screen.findByTestId('if-inspector', undefined, { timeout: 8000 });
  await within(inspector).findByRole('button', { name: firstRow }, { timeout: 8000 });
  return inspector;
}

/** The component list's rows, by the text of each row's title button (the one before its kind tag), in order. */
function rows(inspector: HTMLElement): string[] {
  return Array.from(inspector.querySelectorAll('[data-widget-kind]')).map(
    (kind) => kind.previousElementSibling?.textContent ?? '',
  );
}

describe('the objectui#12688 dashboard fixture is what the spec accepts', () => {
  it('the authored layer, the zh-CN answer and the edited draft all parse against DashboardSchema', () => {
    expect(DashboardSchema.safeParse(CODE).success).toBe(true);
    expect(DashboardSchema.safeParse(SERVED_ZH).success).toBe(true);
    expect(DashboardSchema.safeParse(editedDraft()).success).toBe(true);
  });
});

describe('objectui#12688 — the zh-CN component list draws the served widget titles', () => {
  it('combo_count_vs_progress reads 任务数与平均进度, and a widget the bundle leaves alone reads as authored', async () => {
    const inspector = await componentList('zh', '任务数与平均进度');

    expect(rows(inspector)).toEqual(['任务总数', 'Avg Progress', '任务数与平均进度']);
    expect(within(inspector).getByRole('button', { name: '任务数与平均进度' })).toHaveAttribute('title', '任务数与平均进度');
    expect(inspector).not.toHaveTextContent('Task Count vs Avg Progress');
  });
});

describe('objectui#12688 — a widget changed or added in the draft draws its authored title', () => {
  it('the retitled widget and the added one read as authored, beside a served sibling', async () => {
    state.draft = editedDraft();
    // The served sibling is the row to wait for: it can draw only after the
    // published layer, read once the draft is the buffer, has been paired.
    const inspector = await componentList('zh', '任务总数');

    expect(rows(inspector)).toEqual(['任务总数', 'Avg Progress', 'Count vs Progress', 'Total Spent']);
    expect(inspector).not.toHaveTextContent('任务数与平均进度');
    // The draft is the buffer, so the published layer was read to pair with.
    expect(mockClient.layered.mock.calls.filter((c) => c[0] === 'dashboard')).toHaveLength(1);
  });
});

describe('objectui#12688 — every editor keeps the authored widget title on the same zh-CN session', () => {
  it("the widget inspector's Title input reads the authored title", async () => {
    const inspector = await componentList('zh', '任务数与平均进度');

    fireEvent.click(within(inspector).getByRole('button', { name: '任务数与平均进度' }));

    expect(await screen.findByDisplayValue('Task Count vs Avg Progress', undefined, { timeout: 8000 })).toHaveAttribute(
      'id',
      'widget-title',
    );
    expect(screen.queryByDisplayValue('任务数与平均进度')).toBeNull();
  });
});

describe('objectui#12688 — an English session reads as before', () => {
  it('the en-US answer repeats the authored titles, and the list draws them unchanged', async () => {
    state.served = SERVED_EN;
    const inspector = await componentList('en', 'Task Count vs Avg Progress');

    expect(rows(inspector)).toEqual(['Total Tasks', 'Avg Progress', 'Task Count vs Avg Progress']);
  });
});
