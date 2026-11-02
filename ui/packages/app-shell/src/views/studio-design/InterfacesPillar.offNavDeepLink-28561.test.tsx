// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28561 — Studio's "All metadata" area opens a page, dashboard,
 * report or view in the Interfaces pillar by URL (`?surface=<type>:<name>`,
 * ADR-0146 D1: "a pillar type opened from the directory opens its pillar").
 *
 * The pillar resolved a `?surface=` deep link through its nav tree alone, so
 * an item no nav entry opens (objectstack#26889's off-nav items) fell back to
 * the first leaf: the link landed in the right pillar on the wrong item. These
 * cases pin that it now opens the item from the package's own lists, with or
 * without an app, and still falls back to the first leaf for a name the
 * package does not hold. The harness is objectstack#26889's.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const PKG = 'com.acme.crm';

const NAV = [
  { id: 'nav_home', type: 'page', label: 'Home menu', pageName: 'home' },
  { id: 'nav_ops', type: 'dashboard', label: 'Ops board', dashboardName: 'ops' },
  { id: 'nav_my_leads', type: 'object', label: 'My leads', objectName: 'crm_lead', viewName: 'mine' },
];

/** What the mocked server holds, per metadata type: published rows and `_drafts` headers. */
const server = vi.hoisted(() => ({
  published: new Map<string, Array<Record<string, unknown>>>(),
  drafts: new Map<string, Array<Record<string, unknown>>>(),
}));

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async (type: string) => server.published.get(type) ?? []),
  listDrafts: vi.fn(async (opts?: { type?: string }) => server.drafts.get(opts?.type ?? '') ?? []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    const eff = (server.published.get(type) ?? []).find((row) => row.name === name) ?? null;
    return { code: null, overlay: eff, overlayScope: eff ? 'env' : null, effective: eff, editable: true, deletable: true, resettable: false, lock: 'none' };
  }),
  getDraft: vi.fn(async (type: string, name: string) => {
    throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
  }),
  save: vi.fn(async (type: string, name: string, item: unknown) => ({ type, name, item })),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
}));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

// The `view` resource's list filter (the aggregated container is no item) is
// registered here, as the console registers it.
import '../../services/builtinComponents';
import { InterfacesPillar } from './StudioDesignSurface';
import { registerMetadataPreview, type MetadataPreviewProps } from '../metadata-admin/preview-registry';

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

/** A canvas that says what it was opened on, and whether it may write. */
function StubPreview({ type, name, onPatch }: MetadataPreviewProps) {
  return (
    <div data-testid="stub-canvas" data-writable={onPatch ? 'yes' : 'no'}>
      {`${type}:${name}`}
    </div>
  );
}
for (const type of ['page', 'dashboard', 'report', 'view']) registerMetadataPreview(type, StubPreview);

const page = (name: string, label: string, extra: Record<string, unknown> = {}) => ({ name, label, type: 'app', ...extra });

function seedWithApp() {
  server.published.set('app', [{ name: 'crm_app', label: 'CRM', navigation: NAV }]);
  server.published.set('page', [page('home', 'Home'), page('lead_detail', 'Lead Detail', { type: 'record', object: 'crm_lead' })]);
  server.published.set('dashboard', [
    { name: 'ops', label: 'Ops' },
    { name: 'sales_overview', label: 'Sales Overview' },
  ]);
  server.published.set('report', [{ name: 'pipeline', label: 'Pipeline' }]);
  server.published.set('view', [
    { name: 'crm_lead.mine', label: 'Mine', object: 'crm_lead', viewKind: 'list', config: { type: 'grid', columns: ['name'] } },
    { name: 'crm_lead.hot', label: 'Hot Leads', object: 'crm_lead', viewKind: 'list', config: { type: 'grid', columns: ['name'] } },
    // The container the server keeps beside the expanded items: no item of its own.
    { name: 'crm_lead', object: 'crm_lead', listViews: { hot: { columns: ['name'] } } },
  ]);
  server.drafts.set('page', [{ name: 'welcome', label: 'Welcome', packageId: PKG }]);
}

function seedNoApp() {
  server.published.set('dashboard', [{ name: 'service_overview', label: 'Service Overview' }]);
  server.published.set('page', [page('case_detail', 'Case Detail', { type: 'record', object: 'crm_case' })]);
}

beforeEach(() => {
  server.published.clear();
  server.drafts.clear();
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
});

afterEach(cleanup);

function Where() {
  const { search } = useLocation();
  return <div data-testid="where">{search}</div>;
}

function renderPillar(surface: string) {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces?surface=${encodeURIComponent(surface)}`]}>
      <Where />
      <InterfacesPillar packageId={PKG} packageLabel="Acme CRM" />
    </MemoryRouter>,
  );
}

const surfaceParam = () => new URLSearchParams(screen.getByTestId('where').textContent ?? '').get('surface');

const canvas = () => screen.findByTestId('stub-canvas', undefined, { timeout: 8000 });

describe('objectstack#28561 — Interfaces opens an off-nav item by `?surface=`', () => {
  it('a view no nav entry opens: the view, not the first leaf', async () => {
    seedWithApp();
    renderPillar('view:crm_lead.hot');
    expect(await canvas()).toHaveTextContent('view:crm_lead.hot');
    expect(surfaceParam()).toBe('view:crm_lead.hot');
  });

  it('a report and a record page no entry opens', async () => {
    seedWithApp();
    renderPillar('report:pipeline');
    expect(await canvas()).toHaveTextContent('report:pipeline');
    cleanup();
    renderPillar('page:lead_detail');
    expect(await canvas()).toHaveTextContent('page:lead_detail');
  });

  it('a package with no app opens the dashboard the link names', async () => {
    seedNoApp();
    renderPillar('dashboard:service_overview');
    expect(await canvas()).toHaveTextContent('dashboard:service_overview');
    expect(screen.queryByText('This package has no app yet')).toBeNull();
  });

  it('CONTROL: an item a nav entry opens still opens through its entry', async () => {
    seedWithApp();
    renderPillar('dashboard:ops');
    expect(await canvas()).toHaveTextContent('dashboard:ops');
  });

  it('CONTROL: a name the package does not hold falls back to the first leaf', async () => {
    seedWithApp();
    renderPillar('view:crm_lead.gone');
    expect(await canvas()).toHaveTextContent('page:home');
    await waitFor(() => expect(surfaceParam()).toBe('page:home'));
  });
});
