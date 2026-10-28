// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26845 — the create departure objectstack#26705 left open in the
 * Interfaces pillar. A new dashboard, report or page opens at once, and its
 * load replaces the leaf buffer a held widget lives in, so the "+" menu's
 * create asks the shared departure question before its dialog opens: Cancel
 * costs nothing, and the create itself asks nothing.
 *
 * Rendered through the REAL `StudioDesignSurface` on the real route shape, as
 * in `StudioDesignSurface.heldWidgetLeave-26705.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
// Module-scope import of the lazily loaded canvas renderer (AGENTS.md,
// flaky-test discipline).
import '@object-ui/plugin-dashboard';

const PKG = 'com.acme.app';

const NAV = [
  { id: 'nav_sales', type: 'dashboard', label: 'Sales', dashboardName: 'sales_dash' },
  { id: 'nav_ops', type: 'dashboard', label: 'Ops', dashboardName: 'ops_dash' },
];

const DASHBOARDS: Record<string, Record<string, unknown>> = {
  sales_dash: {
    name: 'sales_dash',
    label: 'Sales',
    widgets: [{ id: 'pipeline', type: 'metric', title: 'Pipeline', dataset: 'sales_ds', values: ['revenue'] }],
  },
  ops_dash: {
    name: 'ops_dash',
    label: 'Ops',
    widgets: [{ id: 'backlog', type: 'metric', title: 'Backlog', dataset: 'sales_ds', values: ['revenue'] }],
  },
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
  list: vi.fn(async (_type: string) => [] as unknown[]),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async (_type: string, _name: string) => null as unknown),
  references: vi.fn(async () => []),
  layered: vi.fn(async (_type: string, _name: string) => ({ code: null, overlay: null, overlayScope: null, effective: null as unknown })),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({ success: true, version: 'v1', state: 'draft' })),
  publishDraft: vi.fn(async () => ({ success: true })),
  publishPackageDrafts: vi.fn(async () => ({ success: true, failed: [] })),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
}));

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
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { StudioDesignSurface } from './StudioDesignSurface';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { DashboardPreview } from '../metadata-admin/previews/DashboardPreview';
import { DashboardWidgetInspector } from '../metadata-admin/inspectors/DashboardWidgetInspector';
import { t } from '../metadata-admin/i18n';

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
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

// This jsdom environment ships no window.confirm — install a mock outright.
let confirmSpy: ReturnType<typeof vi.fn>;
const LEAVE_QUESTION = t('engine.edit.unsavedLeaveConfirm', 'en');

beforeEach(() => {
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  mockClient.list.mockImplementation(async (type: string) => {
    if (type === 'app') return [{ name: 'acme_app', label: 'Acme' }];
    if (type === 'dashboard') return Object.values(DASHBOARDS);
    if (type === 'dataset') return DATASETS;
    return [];
  });
  mockClient.layered.mockImplementation(async (type: string, name: string) => {
    const effective =
      type === 'app'
        ? { name: 'acme_app', label: 'Acme', navigation: NAV }
        : type === 'dashboard' && DASHBOARDS[name]
          ? JSON.parse(JSON.stringify(DASHBOARDS[name]))
          : null;
    return { code: null, overlay: null, overlayScope: null, effective };
  });
  mockClient.get.mockImplementation(async (type: string, name: string) =>
    type === 'dataset' ? DATASETS.find((d) => d.name === name) : null,
  );
  confirmSpy = vi.fn();
  window.confirm = confirmSpy as unknown as typeof window.confirm;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

async function openSalesDashboard(): Promise<void> {
  // The shell's link guard reads the window's URL to skip a link to the page
  // already shown; `BrowserRouter` keeps the two equal, so this does too.
  window.history.replaceState(null, '', `/studio/${PKG}/interfaces`);
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByTitle('dashboard · sales_dash', undefined, { timeout: 8000 });
  await screen.findByRole('button', { name: t('engine.inspector.add.widget', 'en') }, { timeout: 8000 });
}

/** Add a Metric widget and bind nothing: the leaf autosave holds it. */
async function holdAMetric(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: t('engine.inspector.add.widget', 'en') }));
  await userEvent.click(await screen.findByRole('button', { name: /^Metric \(KPI\)/ }));
  await screen.findByTestId('studio-held', undefined, { timeout: 8000 });
}

/** The rail's "+" menu, then its New dashboard item. */
async function newDashboard(): Promise<void> {
  await userEvent.click(screen.getByTestId('if-create-menu'));
  await userEvent.click(await screen.findByTestId('if-create-dashboard'));
}

describe('a held dashboard widget guards create (objectstack#26845)', () => {
  it('New dashboard asks; Cancel opens no dialog and keeps the held widget, OK opens the dialog', async () => {
    await openSalesDashboard();
    await holdAMetric();

    confirmSpy.mockReturnValueOnce(false);
    await newDashboard();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(LEAVE_QUESTION);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('studio-held')).toBeInTheDocument();

    confirmSpy.mockReturnValueOnce(true);
    await newDashboard();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await screen.findByRole('dialog');
  });

  // CONTROL: nothing held, nothing asked.
  it('with no edit held, New dashboard never asks', async () => {
    await openSalesDashboard();

    await newDashboard();
    await screen.findByRole('dialog');
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
