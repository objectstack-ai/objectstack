// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30238 — after "Restore package original" the Interfaces rail
 * reads the restored state without a reload: the item's customized mark and
 * the "only customizations" count come from the base's one customization read
 * (`GET /api/v1/packages/:id/customizations`), and a restore deletes the row
 * that read lists, so the surface reads it again.
 *
 * The REAL `StudioDesignSurface` and the REAL metadata client over a fetch
 * stub that serves the package list (a read-only base with its pair listed),
 * the base's items, the pair's served rows over them, the customization read
 * (one override per pair row it holds) and the reset door (`DELETE`), which
 * deletes the pair's row. Stubbed: the dashboard and page canvases (a label
 * each), `DraftChangesPanel` and the session, as the surface's other
 * customization suite does.
 *
 * Pinned, on a dashboard (opened from the navigation) and on a page (listed
 * under its type), the path every Interfaces type shares:
 *  - before the restore the rail marks the item and counts it under "only
 *    customizations";
 *  - after it the customization read is asked again, the mark is gone and
 *    the count with it, with no reload;
 *  - CONTROL: an item that stays customized keeps its mark and its count.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const BASE = 'com.example.hotcrm';
const PAIR = 'com.example.hotcrm.custom';
const DECLARED = { package: BASE, basedOn: '4.0.0' };

const NAV = [
  { id: 'nav_pipeline', type: 'dashboard', label: 'Pipeline', dashboardName: 'pipeline' },
  { id: 'nav_forecast', type: 'dashboard', label: 'Forecast', dashboardName: 'forecast' },
];
const APP = { name: 'crm_app', label: 'CRM', navigation: NAV };
/** The base's rows, by `type/name`. */
const BASE_ROWS: Record<string, Record<string, unknown>> = {
  'dashboard/pipeline': { name: 'pipeline', label: 'Pipeline', widgets: [] },
  'dashboard/forecast': { name: 'forecast', label: 'Forecast', widgets: [] },
  'page/crm_welcome': { name: 'crm_welcome', label: 'Welcome', type: 'home', kind: 'full', regions: [] },
};

const srv = vi.hoisted(() => ({
  /** The pair's ACTIVE rows, by `type/name`: each is served over the base's item and listed as an override. */
  pairRows: new Map<string, Record<string, unknown>>(),
  customizationReads: 0,
  resets: [] as string[],
}));

vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/auth')>();
  return {
    ...actual,
    useAuth: () => ({ ...actual.useAuth(), user: null, getAuthConfig: async () => ({ features: {} }) }),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ({}) };
});

vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn(), message: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { StudioDesignSurface } from './StudioDesignSurface';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { tFormat } from '../metadata-admin/i18n';

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
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

function LabelCanvas({ draft }: { draft: Record<string, unknown> }) {
  return <p data-testid="canvas-label">{String(draft?.label ?? '')}</p>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** What the customization read serves: one override per pair row. */
function customizationRead() {
  const overrides = [...srv.pairRows.keys()].sort().map((key) => {
    const [type, name] = key.split('/') as [string, string];
    return { type, name, basedOn: '4.0.0' };
  });
  return {
    packageId: BASE,
    overrides,
    extensions: [],
    switchedOff: [],
    contributions: [],
    counts: { overrides: overrides.length, extensions: 0, switchedOff: 0, contributions: 0 },
  };
}

beforeAll(() => {
  registerMetadataPreview('dashboard', LabelCanvas as never);
  registerMetadataPreview('page', LabelCanvas as never);
});

beforeEach(() => {
  srv.pairRows.clear();
  srv.customizationReads = 0;
  srv.resets.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname;
      const method = init?.method ?? 'GET';
      if (path === '/api/v1/packages') {
        return json({
          success: true,
          data: [
            { manifest: { id: BASE, name: 'HotCRM', namespace: 'hotcrm', version: '4.0.0' }, writable: false },
            { manifest: { id: PAIR, name: 'HotCRM customizations', namespace: 'hotcrm_custom', version: '0.1.0' }, writable: true },
          ],
        });
      }
      if (path === `/api/v1/packages/${BASE}/customizations`) {
        srv.customizationReads += 1;
        return json({ success: true, data: customizationRead() });
      }
      if (path === '/api/v1/meta/_drafts') return json({ drafts: [] });
      if (path === '/api/v1/meta/app') return json([{ name: 'crm_app', label: 'CRM' }]);
      if (path === '/api/v1/meta/app/crm_app/layers') return json({ code: APP, overlay: null, overlayScope: null, effective: APP });
      const layers = /^\/api\/v1\/meta\/([^/]+)\/([^/]+)\/layers$/.exec(path);
      if (layers) {
        const key = `${layers[1]}/${layers[2]}`;
        const code = BASE_ROWS[key] ?? null;
        const overlay = srv.pairRows.get(key) ?? null;
        return json({ code, overlay, overlayScope: overlay ? 'env' : null, effective: overlay ?? code });
      }
      const item = /^\/api\/v1\/meta\/([^/]+)\/([^/]+)$/.exec(path);
      if (item && method === 'DELETE') {
        const key = `${item[1]}/${item[2]}`;
        srv.resets.push(`${key}?${url.searchParams.toString()}`);
        if (url.searchParams.get('state') !== 'draft') srv.pairRows.delete(key);
        return json({ success: true });
      }
      if (item) return json({}, 404);
      const list = /^\/api\/v1\/meta\/([^/]+)$/.exec(path);
      if (list) {
        const type = list[1]!;
        return json(
          Object.entries(BASE_ROWS)
            .filter(([key]) => key.startsWith(`${type}/`))
            .map(([, row]) => ({ name: row.name, label: row.label, _packageId: BASE })),
        );
      }
      return json([]);
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWorkbench() {
  return render(
    <MemoryRouter initialEntries={[`/studio/${BASE}/interfaces`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
}

const header = () => screen.getByTestId('if-item-header');
const rail = () => screen.getByTestId('studio-rail-interfaces');
const onlyText = (marked: number) => tFormat('engine.list.customizations.only', 'en', { marked });

/** The rail row named `name`, and its customization mark's kind (null: unmarked). */
async function markOf(name: RegExp): Promise<string | null> {
  const row = await within(rail()).findByRole('button', { name }, { timeout: 8000 });
  return within(row).queryByTestId('customization-mark')?.getAttribute('data-kind') ?? null;
}

async function restoreFromHeader(): Promise<void> {
  fireEvent.click(await within(header()).findByTestId('studio-override-chip', undefined, { timeout: 8000 }));
  const popover = await screen.findByTestId('studio-override-popover');
  await waitFor(() => expect(within(popover).getByTestId('studio-override-restore')).toBeEnabled(), { timeout: 8000 });
  fireEvent.click(within(popover).getByTestId('studio-override-restore'));
  fireEvent.click(within(await screen.findByTestId('studio-restore-original-dialog')).getByTestId('studio-restore-original-confirm'));
}

describe('after Restore package original the rail reads the restored state, with no reload (objectstack#30238)', () => {
  it('a dashboard opened from the navigation: its mark and the "only customizations" count go', async () => {
    srv.pairRows.set('dashboard/pipeline', { ...BASE_ROWS['dashboard/pipeline'], label: 'Pipeline (ours)', overrides: DECLARED });
    renderWorkbench();
    await waitFor(() => expect(screen.getByTestId('canvas-label')).toHaveTextContent('Pipeline (ours)'), { timeout: 8000 });
    await waitFor(async () => expect(await markOf(/Pipeline/)).toBe('customized'), { timeout: 8000 });
    expect(await within(rail()).findByTestId('studio-rail-customizations-only')).toHaveTextContent(onlyText(1));
    const readsBefore = srv.customizationReads;

    await restoreFromHeader();
    await waitFor(() => expect(screen.getByTestId('canvas-label')).toHaveTextContent(/^Pipeline$/), { timeout: 8000 });
    expect(srv.resets.map((r) => r.split('?')[0])).toEqual(['dashboard/pipeline', 'dashboard/pipeline']);
    await waitFor(() => expect(srv.customizationReads).toBeGreaterThan(readsBefore), { timeout: 8000 });
    await waitFor(async () => expect(await markOf(/Pipeline/)).toBeNull(), { timeout: 8000 });
    await waitFor(() => expect(within(rail()).queryByTestId('studio-rail-customizations-only')).toBeNull(), { timeout: 8000 });
  });

  it('a page listed under its type: its mark and the count go; CONTROL: the dashboard still customized keeps both', async () => {
    srv.pairRows.set('dashboard/forecast', { ...BASE_ROWS['dashboard/forecast'], label: 'Forecast (ours)', overrides: DECLARED });
    srv.pairRows.set('page/crm_welcome', { ...BASE_ROWS['page/crm_welcome'], label: 'Welcome (ours)', overrides: DECLARED });
    renderWorkbench();
    await waitFor(() => expect(screen.getByTestId('canvas-label')).toHaveTextContent(/^Pipeline$/), { timeout: 8000 });
    await waitFor(async () => expect(await markOf(/Welcome/)).toBe('customized'), { timeout: 8000 });
    expect(await markOf(/Forecast/)).toBe('customized');
    expect(await within(rail()).findByTestId('studio-rail-customizations-only')).toHaveTextContent(onlyText(2));

    fireEvent.click(await within(rail()).findByRole('button', { name: /Welcome/ }));
    await waitFor(() => expect(screen.getByTestId('canvas-label')).toHaveTextContent('Welcome (ours)'), { timeout: 8000 });
    const readsBefore = srv.customizationReads;
    await restoreFromHeader();
    await waitFor(() => expect(screen.getByTestId('canvas-label')).toHaveTextContent(/^Welcome$/), { timeout: 8000 });
    await waitFor(() => expect(srv.customizationReads).toBeGreaterThan(readsBefore), { timeout: 8000 });
    await waitFor(async () => expect(await markOf(/Welcome/)).toBeNull(), { timeout: 8000 });
    await waitFor(() => expect(within(rail()).getByTestId('studio-rail-customizations-only')).toHaveTextContent(onlyText(1)), {
      timeout: 8000,
    });
    expect(await markOf(/Forecast/)).toBe('customized');
  });
});
