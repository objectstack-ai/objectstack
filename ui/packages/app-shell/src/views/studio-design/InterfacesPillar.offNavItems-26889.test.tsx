// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26889 — the Interfaces pillar lists a package's views, pages,
 * dashboards and reports whether or not a navigation entry names them, and a
 * package with no app still lists what it ships.
 *
 * The rail used to be the app's navigation tree and nothing else, so an item
 * no entry opens (a list view off the menu, a record page, a module package's
 * dashboard) could not be opened in Studio at all, and a package with no app
 * showed only its "no app yet" notice. Under the tree there is now one section
 * per type with the items no entry opens; each row opens its item in the
 * pillar's canvas, read-only on a read-only package.
 *
 *  - an item a nav entry opens keeps its tree row and is not listed again (a
 *    page / dashboard entry's target, and the view an `object` entry's
 *    `viewName` names);
 *  - a draft-only item is listed, by the label its `_drafts` row carries;
 *  - the aggregated view container the server keeps for dual-read is not an
 *    item (Setup › Metadata leaves it out the same way);
 *  - the "no app yet" notice stays, with the sections under it.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
import { STUDIO_RAIL_ROW_ACTIVE } from './studio-tokens';

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

function renderPillar(props: { readOnly?: boolean } = {}) {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
      <InterfacesPillar packageId={PKG} packageLabel="Acme CRM" {...props} />
    </MemoryRouter>,
  );
}

/** The sections under the tree, once the package's items are read. */
async function offNav(): Promise<HTMLElement> {
  return screen.findByTestId('if-off-nav', undefined, { timeout: 8000 });
}

/** Every rail row's `type · name`, in rail order. */
function railTitles(scope: HTMLElement): string[] {
  return within(scope)
    .getAllByRole('button')
    .map((b) => b.getAttribute('title') ?? '')
    .filter((title) => title.includes(' · '));
}

describe('objectstack#26889 — Interfaces lists what no navigation entry names', () => {
  it('lists the views, pages, dashboards and reports no entry opens, one section per type', async () => {
    seedWithApp();
    renderPillar();
    const sections = await offNav();
    expect(within(sections).getByTestId('if-off-nav-page')).toBeInTheDocument();
    expect(railTitles(sections)).toEqual([
      'page · lead_detail',
      'page · welcome',
      'dashboard · sales_overview',
      'report · pipeline',
      'view · crm_lead.hot',
    ]);
    // A draft-only page reads as the label its `_drafts` row carries.
    expect(within(sections).getByRole('button', { name: 'Welcome' })).toHaveAttribute('title', 'page · welcome');
    // Each type was read for this package, published and draft.
    for (const type of ['view', 'page', 'dashboard', 'report']) {
      expect(mockClient.list).toHaveBeenCalledWith(type, { packageId: PKG });
      expect(mockClient.listDrafts).toHaveBeenCalledWith({ packageId: PKG, type });
    }
  });

  it('an item a nav entry opens is listed once, in the tree, and never again', async () => {
    seedWithApp();
    renderPillar();
    const sections = await offNav();
    const rail = sections.closest('nav') as HTMLElement;
    const titles = railTitles(rail);
    expect(titles.filter((t) => t === 'page · home')).toHaveLength(1);
    expect(titles.filter((t) => t === 'dashboard · ops')).toHaveLength(1);
    // The view the `My leads` entry names (`viewName: 'mine'`) is that entry's row.
    expect(titles).not.toContain('view · crm_lead.mine');
    expect(within(sections).queryByText('Home')).toBeNull();
    expect(within(sections).queryByText('Mine')).toBeNull();
    // The aggregated container is not listed as a view.
    expect(titles).not.toContain('view · crm_lead');
  });

  it('a view, a record page and a dashboard no entry names each open in the canvas', async () => {
    seedWithApp();
    renderPillar();
    const sections = await offNav();
    for (const [label, opened] of [
      ['Hot Leads', 'view:crm_lead.hot'],
      ['Lead Detail', 'page:lead_detail'],
      ['Sales Overview', 'dashboard:sales_overview'],
    ] as const) {
      fireEvent.click(within(sections).getByRole('button', { name: label }));
      expect(await screen.findByText(opened, undefined, { timeout: 8000 })).toBeInTheDocument();
      expect(screen.getByTestId('if-breadcrumb')).toHaveTextContent(label);
      // The row it was opened from is the active one, and only it.
      const active = within(sections).getAllByRole('button').filter((b) => b.className.includes(STUDIO_RAIL_ROW_ACTIVE));
      expect(active.map((b) => b.textContent)).toEqual([label]);
    }
  });

  it('a package with no app keeps its notice and lists its dashboard and page, which open', async () => {
    seedNoApp();
    renderPillar();
    const sections = await offNav();
    expect(screen.getByText('This package has no app yet.')).toBeInTheDocument();
    expect(screen.getByText('This package has no app yet')).toBeInTheDocument();
    expect(railTitles(sections)).toEqual(['page · case_detail', 'dashboard · service_overview']);

    fireEvent.click(within(sections).getByRole('button', { name: 'Service Overview' }));
    expect(await screen.findByText('dashboard:service_overview', undefined, { timeout: 8000 })).toBeInTheDocument();
    // The canvas shows the item now, not the empty state; the rail keeps its notice.
    expect(screen.queryByText('This package has no app yet')).toBeNull();
    expect(screen.getByText('This package has no app yet.')).toBeInTheDocument();

    fireEvent.click(within(sections).getByRole('button', { name: 'Case Detail' }));
    expect(await screen.findByText('page:case_detail', undefined, { timeout: 8000 })).toBeInTheDocument();
  });

  it('a read-only package lists them too, and opens them read-only', async () => {
    seedNoApp();
    renderPillar({ readOnly: true });
    const sections = await offNav();
    fireEvent.click(within(sections).getByRole('button', { name: 'Service Overview' }));
    const canvas = await screen.findByTestId('stub-canvas', undefined, { timeout: 8000 });
    expect(canvas).toHaveTextContent('dashboard:service_overview');
    expect(canvas).toHaveAttribute('data-writable', 'no');
    expect(mockClient.save).not.toHaveBeenCalled();
  });

  it('CONTROL: a writable package opens them writable', async () => {
    seedNoApp();
    renderPillar();
    const sections = await offNav();
    fireEvent.click(within(sections).getByRole('button', { name: 'Service Overview' }));
    expect(await screen.findByTestId('stub-canvas', undefined, { timeout: 8000 })).toHaveAttribute('data-writable', 'yes');
  });

  it('CONTROL: a package whose every item an entry opens draws no sections', async () => {
    server.published.set('app', [{ name: 'crm_app', label: 'CRM', navigation: NAV }]);
    server.published.set('page', [page('home', 'Home')]);
    server.published.set('dashboard', [{ name: 'ops', label: 'Ops' }]);
    renderPillar();
    await screen.findByRole('button', { name: 'Home menu Page' }, { timeout: 8000 });
    await vi.waitFor(() => expect(mockClient.listDrafts).toHaveBeenCalledWith({ packageId: PKG, type: 'view' }));
    // Every read settled, and what it answered rendered.
    await act(async () => {
      await Promise.all(mockClient.listDrafts.mock.results.map((r) => r.value));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByTestId('if-off-nav')).toBeNull();
    // CONTROL of the control: the same package with one more dashboard lists it.
    cleanup();
    server.published.set('dashboard', [{ name: 'ops', label: 'Ops' }, { name: 'extra', label: 'Extra' }]);
    renderPillar();
    expect(railTitles(await offNav())).toEqual(['dashboard · extra']);
  });
});
