// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12513 — the Studio home loop. Inside a package the header's first
 * button and the package switcher's first row both return to the Studio
 * landing (`/studio`), and the Organization flows empty block's way out to
 * Setup › Packaged automation is a link that says it leaves Studio.
 *
 * Rendered through the REAL `StudioDesignSurface` on the REAL route shape, on
 * the server double objectui#11553's file uses: a read-only showcase package
 * with two packaged flows, and no package-less flow (so the Organization
 * flows scope is empty).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const SHOWCASE = 'com.example.showcase';
const NODES = [
  { id: 'start', type: 'start', label: 'Start' },
  { id: 'end', type: 'end', label: 'End' },
];
const EDGES = [{ id: 'e1', source: 'start', target: 'end' }];
const flow = (name: string, label: string, packageId?: string) => ({
  name,
  label,
  type: 'autolaunched',
  status: 'active',
  nodes: NODES,
  edges: EDGES,
  ...(packageId ? { _packageId: packageId } : {}),
});

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  drafts: [] as Array<{ type: string; name: string; packageId: string | null }>,
  saves: [] as Array<{ type: string; name: string; options: Record<string, unknown> | undefined; body: Record<string, unknown> }>,
  publishedByRef: [] as Array<{ type: string; name: string }>,
  packageBatches: [] as string[],
}));

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async (type: string, options?: { packageId?: string }) =>
    [...server.active.values()]
      .filter((row) => row.__type === type)
      .filter((row) => !options?.packageId || row._packageId === options.packageId)
      .map(({ __type: _t, ...row }) => row),
  ),
  listDrafts: vi.fn(async (options: { packageId?: string; type?: string } = {}) =>
    server.drafts.filter(
      (d) => (!options.type || d.type === options.type) && (!options.packageId || d.packageId === options.packageId),
    ),
  ),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    const row = server.active.get(`${type}/${name}`);
    const { __type: _t, ...eff } = row ?? {};
    return { code: null, overlay: row ? eff : null, overlayScope: row ? 'env' : null, effective: row ? eff : null };
  }),
  getDraft: vi.fn(async (type: string, name: string) => {
    throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
  }),
  save: vi.fn(async (type: string, name: string, item: unknown, options?: Record<string, unknown>) => {
    server.saves.push({ type, name, options, body: JSON.parse(JSON.stringify(item)) as Record<string, unknown> });
    return { type, name, item };
  }),
  publishDraft: vi.fn(async (type: string, name: string) => {
    server.publishedByRef.push({ type, name });
    return { success: true };
  }),
  publishPackageDrafts: vi.fn(async (packageId: string) => {
    server.packageBatches.push(packageId);
    return { success: true, failed: [] };
  }),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
}));

/** What the surface handed the pending-changes sheet, last render. */
const panel = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
const chatDock = vi.hoisted(() => ({ mounts: 0 }));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return {
    ...mod,
    // The stock showcase: its one installed package is read-only.
    fetchPackages: vi.fn(async () => [{ id: SHOWCASE, name: 'Showcase', writable: false, namespace: 'showcase' }]),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

vi.mock('./StudioAiCopilot', () => ({
  StudioChatDock: () => {
    chatDock.mounts += 1;
    return null;
  },
}));

vi.mock('../../preview/DraftChangesPanel', () => ({
  DraftChangesPanel: (props: Record<string, unknown>) => {
    panel.props = props;
    return null;
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { StudioDesignSurface } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { FlowInspector } from '../metadata-admin/inspectors/FlowInspector';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

// The two global-`fetch` reads on this surface: the pending-drafts feed
// (`/meta/_drafts`, the header count and the package-less publish) and the
// rail's `/automation/_status` probe (answered "absent", so no dots).
vi.stubGlobal(
  'fetch',
  vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.startsWith('/api/v1/meta/_drafts')) {
      const qs = new URL(url, 'http://x').searchParams.get('packageId');
      const drafts = server.drafts.filter((d) => !qs || d.packageId === qs);
      return new Response(JSON.stringify({ drafts }), { status: 200, headers: { 'content-type': 'application/json' } });
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

registerMetadataPreview('flow', FlowPreview);
registerMetadataInspector('flow', FlowInspector);

function seed(row: Record<string, unknown>) {
  server.active.set(`flow/${String(row.name)}`, { __type: 'flow', ...row });
}

beforeEach(() => {
  server.active.clear();
  server.drafts.length = 0;
  server.saves.length = 0;
  server.publishedByRef.length = 0;
  server.packageBatches.length = 0;
  panel.props = null;
  chatDock.mounts = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  // Two packaged flows on the read-only showcase, and the clone, which names no package.
  seed(flow('showcase_urgent_task_alert', 'Urgent task alert', SHOWCASE));
  seed(flow('showcase_daily_digest', 'Daily digest', SHOWCASE));
  seed(flow('qa_urgent_alert_clone', 'QA urgent alert clone'));
});

afterEach(cleanup);

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{`${pathname}${search}`}</div>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <LocationProbe />
      <Routes>
        <Route path="/studio" element={<div data-testid="studio-landing" />} />
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
}

const location = () => screen.getByTestId('location').textContent ?? '';

describe('Studio home loop (objectui#12513)', () => {
  it('the header’s first button returns to the Studio landing', async () => {
    renderAt(`/studio/${SHOWCASE}/automations`);

    const home = await screen.findByTestId('studio-home');
    expect(home).toHaveAccessibleName('Studio home');
    // It is the header's first control.
    const header = screen.getByTestId('studio-shell-header');
    expect(within(header).getAllByRole('button')[0]).toBe(home);

    fireEvent.click(home);
    expect(await screen.findByTestId('studio-landing')).toBeInTheDocument();
    expect(location()).toBe('/studio');
  });

  it('the package switcher’s first row is Studio home, above the package list', async () => {
    renderAt(`/studio/${SHOWCASE}/automations`);

    fireEvent.click(await screen.findByRole('button', { name: /Showcase/ }));
    const pkgRow = await screen.findByRole('button', { name: new RegExp(SHOWCASE.replace(/\./g, '\\.')) });
    const panel = pkgRow.closest('[role="dialog"]') as HTMLElement;
    expect(panel).not.toBeNull();
    const row = within(panel).getByTestId('studio-switcher-home');
    expect(within(panel).getAllByRole('button')[0]).toBe(row);
    expect(row).toHaveAccessibleName('Studio home');
    // Control: the package row is in the same panel, after it.
    expect(row.compareDocumentPosition(pkgRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(row);
    expect(await screen.findByTestId('studio-landing')).toBeInTheDocument();
    expect(location()).toBe('/studio');
  });

  it('the Organization flows empty block links to Setup › Packaged automation, and creates nothing', async () => {
    server.active.delete('flow/qa_urgent_alert_clone');
    renderAt('/studio/~org/automations');

    const block = await screen.findByTestId('auto-empty', undefined, { timeout: 8000 });
    expect(block).toHaveTextContent('Setup › Packaged automation');
    const link = within(block).getByRole('link', { name: 'Open in Setup' });
    expect(link).toHaveAttribute('data-testid', 'auto-empty-open-setup');
    expect(link).toHaveAttribute('href', '/apps/setup/component/automation/packaged');
    expect(link.querySelector('svg.lucide-arrow-up-right')).not.toBeNull();
    expect(within(block).queryByTestId('auto-empty-new')).toBeNull();
  });

  it('control: a package’s own empty block offers no Setup link', async () => {
    server.active.clear();
    renderAt(`/studio/${SHOWCASE}/automations`);

    const block = await screen.findByTestId('auto-empty', undefined, { timeout: 8000 });
    expect(within(block).queryByTestId('auto-empty-open-setup')).toBeNull();
    expect(within(block).queryByRole('link', { name: 'Open in Setup' })).toBeNull();
  });
});
