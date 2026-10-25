// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11910 — Publish refuses while the Interfaces pillar holds a new
 * dashboard widget unsent.
 *
 * The pillar's leaf autosave now holds a dashboard with a widget not yet bound
 * to a dataset (`InterfacesPillar.heldWidget-11910.test.tsx`). A publish
 * promotes the drafts the SERVER holds, which do not carry that widget, so the
 * pillar reports its held edit to the surface as the Data and Automations
 * pillars do (objectui#11786), and the surface refuses the publish, naming the
 * widget, until it is bound. A publish with nothing held goes as before.
 *
 * Rendered through the REAL `StudioDesignSurface` on the real route shape, with
 * the real `DashboardPreview` / `DashboardWidgetInspector`. The pending-changes
 * sheet is replaced by a probe that keeps the props the surface hands it, so
 * its `onPublish` (the surface's publish) is called directly, as in
 * `StudioDesignSurface.heldPublish-11786.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
// Module-scope import of the lazily loaded canvas renderer (AGENTS.md,
// flaky-test discipline).
import '@object-ui/plugin-dashboard';

const PKG = 'com.acme.app';

const NAV = [{ id: 'nav_sales', type: 'dashboard', label: 'Sales', dashboardName: 'sales_dash' }];

const SALES_DASH = {
  name: 'sales_dash',
  label: 'Sales',
  widgets: [{ id: 'pipeline', type: 'metric', title: 'Pipeline', dataset: 'sales_ds', values: ['revenue'] }],
};

const DATASETS = [
  {
    name: 'sales_ds',
    label: 'Sales',
    object: 'opportunity',
    dimensions: [{ name: 'stage', label: 'Stage' }],
    measures: [{ name: 'revenue', label: 'Revenue', aggregate: 'sum' }],
  },
];

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async (type: string) => {
    if (type === 'app') return [{ name: 'acme_app', label: 'Acme' }];
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async (_type: string, _name: string) => null as unknown),
  references: vi.fn(async () => []),
  layered: vi.fn(async (_type: string) => ({ code: null, overlay: null, overlayScope: null, effective: null as unknown })),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({ success: true, version: 'v1', state: 'draft' })),
  publishDraft: vi.fn(async () => ({ success: true })),
  publishPackageDrafts: vi.fn(async () => ({ success: true, failed: [] })),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
}));

/** What the surface handed the pending-changes sheet, last render. */
const panel = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return {
    ...mod,
    fetchPackages: vi.fn(async () => [{ id: 'com.acme.app', name: 'Acme', writable: true, namespace: 'acme' }]),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));

vi.mock('../../preview/DraftChangesPanel', () => ({
  DraftChangesPanel: (props: Record<string, unknown>) => {
    panel.props = props;
    return null;
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { StudioDesignSurface } from './StudioDesignSurface';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { DashboardPreview } from '../metadata-admin/previews/DashboardPreview';
import { DashboardWidgetInspector } from '../metadata-admin/inspectors/DashboardWidgetInspector';
import { t, tFormat } from '../metadata-admin/i18n';

// The pending-drafts feed (`/meta/_drafts`) reports one pending dashboard
// draft, so there is something to publish.
vi.stubGlobal(
  'fetch',
  vi.fn(async (input: unknown) => {
    if (String(input).startsWith('/api/v1/meta/_drafts')) {
      return new Response(JSON.stringify({ drafts: [{ type: 'dashboard', name: 'sales_dash', packageId: PKG }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('null', { status: 404, headers: { 'content-type': 'application/json' } });
  }),
);

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

registerMetadataPreview('dashboard', DashboardPreview);
registerMetadataInspector('dashboard', DashboardWidgetInspector);

beforeEach(() => {
  panel.props = null;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  mockClient.list.mockImplementation(async (type: string) => {
    if (type === 'app') return [{ name: 'acme_app', label: 'Acme' }];
    if (type === 'dashboard') return [SALES_DASH];
    if (type === 'dataset') return DATASETS;
    return [];
  });
  mockClient.layered.mockImplementation(async (type: string) => {
    if (type === 'app') {
      return { code: null, overlay: null, overlayScope: null, effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
    }
    if (type === 'dashboard') {
      return { code: null, overlay: null, overlayScope: null, effective: JSON.parse(JSON.stringify(SALES_DASH)) };
    }
    return { code: null, overlay: null, overlayScope: null, effective: null };
  });
  mockClient.get.mockImplementation(async (type: string, name: string) =>
    type === 'dataset' ? DATASETS.find((d) => d.name === name) : null,
  );
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The surface's publish, as the pending-changes sheet's footer button calls it. */
async function publish(): Promise<void> {
  const onPublish = panel.props?.onPublish as (() => Promise<void>) | undefined;
  expect(onPublish, 'the sheet is handed a publish').toBeTypeOf('function');
  await act(async () => {
    await onPublish!();
  });
}

/** Past the autosave's 1.5 s debounce. */
async function outlastDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2300));
  });
}

function dashboardSaves(): unknown[] {
  return mockClient.save.mock.calls.filter((c) => (c as unknown[])[0] === 'dashboard');
}

async function openDashboard(): Promise<void> {
  renderAt(`/studio/${PKG}/interfaces`);
  await screen.findByTitle('dashboard · sales_dash', undefined, { timeout: 8000 });
  await screen.findByRole('button', { name: t('engine.inspector.add.widget', 'en') }, { timeout: 8000 });
}

async function addMetric(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: t('engine.inspector.add.widget', 'en') }));
  await userEvent.click(await screen.findByRole('button', { name: /^Metric \(KPI\)/ }));
  await screen.findByDisplayValue('New metric (kpi)', undefined, { timeout: 8000 });
}

describe('Publish refuses while a new widget is held, naming it (objectui#11910)', () => {
  it('a new widget not yet bound: Publish refuses naming the widget and its input, and publishes nothing', async () => {
    await openDashboard();
    await addMetric();
    await outlastDebounce();
    expect(dashboardSaves()).toEqual([]);
    expect(screen.getByTestId('studio-held')).toBeInTheDocument();

    await publish();
    expect(mockClient.publishPackageDrafts, 'Publish must not go around the held widget').not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      tFormat('engine.studio.held.publish', 'en', {
        clause: tFormat('engine.studio.held.widgetNeedsInput', 'en', {
          input: t('engine.inspector.widget.dataset', 'en'),
          widget: 'New metric (kpi)',
        }),
      }),
    );
  });

  it('once the widget is bound and saved, Publish goes', async () => {
    await openDashboard();
    await addMetric();
    // The surface folds the inspector beside its chat dock, so the widget's
    // inspector is read from the page rather than from an aside.
    await userEvent.click(screen.getByRole('combobox', { name: t('engine.inspector.widget.dataset', 'en') }));
    await userEvent.click(await screen.findByRole('option', { name: /sales_ds/ }));
    const adds = await screen.findAllByRole('button', { name: t('engine.form.addFieldPlain', 'en') });
    expect(adds.length, 'the dimensions and measures editors').toBe(2);
    fireEvent.click(adds[1]);
    fireEvent.click(within(await screen.findByRole('dialog')).getByText(/^Revenue/));
    await waitFor(() => expect(dashboardSaves()).toHaveLength(1), { timeout: 4000 });
    await waitFor(() => expect(screen.queryByTestId('studio-held')).toBeNull());

    await publish();
    expect(mockClient.publishPackageDrafts).toHaveBeenCalledWith(PKG);
    expect(toast.error).not.toHaveBeenCalled();
  });

  // CONTROL: nothing held, nothing refused.
  it('with no widget held, Publish publishes as before', async () => {
    await openDashboard();
    await publish();
    expect(mockClient.publishPackageDrafts).toHaveBeenCalledWith(PKG);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
