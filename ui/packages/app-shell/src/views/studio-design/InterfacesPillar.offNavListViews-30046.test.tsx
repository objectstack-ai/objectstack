// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30046 (Scope 6–8) — what the Interfaces rail's 不在导航中 → 视图
 * group lists, and where a list view in it opens.
 *
 * Scope 1–5 put an object's list views in the header's title (object / view ▾).
 * The group under the navigation tree still listed every view no entry named:
 * a list view whose object has a navigation entry was listed there although
 * the dropdown reaches it, a form view read as its machine name
 * (`crm_lead.form`) under a heading that said nothing of what was left, and a
 * list view picked there opened a page of its own (`surface=view:`), not the
 * object's page with its dropdown.
 *
 * Pinned, through the mounted pillar, its real list-view buffer and the real
 * panel (the client is a recorder):
 *  - Scope 7: a list view of an object with a nav entry is not listed, a view
 *    only drafted here included; CONTROL: the list views of an object with no
 *    entry stay listed;
 *  - Scope 8: a form view is listed under a readable name (its label, else the
 *    object's name and the word for a form), and the group's heading says
 *    what it holds (forms, list views, or both);
 *  - Scope 6: a list view picked there opens on the object's page, title
 *    object / view ▾, with that view in the panel and the address; the
 *    panel keeps what the view page offered (条件格式化 and the spec form's
 *    sections); a link to the view (`surface=view:`) lands on the same page,
 *    on the object's nav entry when it has one; CONTROL: a form view still
 *    opens as itself.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ComponentRegistry } from '@object-ui/core';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';

const PKG = 'com.acme.crm';

const NAV = [{ id: 'nav_leads', type: 'object', label: 'Leads', objectName: 'crm_lead' }];

const grid = (object: string, extra: Record<string, unknown> = {}) => ({
  type: 'grid',
  data: { provider: 'object', object },
  columns: ['name'],
  ...extra,
});
const listView = (object: string, key: string, label: string, extra: Record<string, unknown> = {}, body: Record<string, unknown> = {}) => ({
  name: `${object}.${key}`,
  object,
  viewKind: 'list',
  label,
  ...extra,
  config: grid(object, body),
});
const formView = (object: string, key: string, label?: string, extra: Record<string, unknown> = {}) => ({
  name: `${object}.${key}`,
  object,
  viewKind: 'form',
  ...(label ? { label } : {}),
  ...extra,
  config: { type: 'simple', sections: [{ label: 'Main', fields: ['name'] }] },
});

/** The views the package publishes, by name. */
let published: Record<string, Record<string, any>> = {};
/** The views only drafted in this package, by name. */
let drafts: Record<string, Record<string, any>> = {};

function seed() {
  published = Object.fromEntries(
    [
      listView('crm_lead', 'all', 'All leads', { isDefault: true }),
      listView('crm_lead', 'hot', 'Hot leads'),
      formView('crm_lead', 'form', undefined, { isDefault: true }),
      formView('crm_lead', 'contact_us', 'Contact us'),
      listView('crm_case', 'open', 'Open cases', { isDefault: true }),
      listView('crm_case', 'mine', 'My cases', {}, {
        conditionalFormatting: [{ condition: "status == 'urgent'", style: { color: 'red' } }],
      }),
    ].map((row) => [row.name, row]),
  );
  drafts = Object.fromEntries([listView('crm_lead', 'drafted', 'Drafted leads')].map((row) => [row.name, row]));
}

const OBJECTS = [
  { name: 'crm_lead', label: 'Lead' },
  { name: 'crm_case', label: 'Case' },
];

/** An object as the shell's merged metadata holds it: its list views keyed by item name. */
function objectDef(name: string) {
  const own = Object.values(published).filter((row) => row.object === name && row.viewKind === 'list');
  return {
    name,
    label: OBJECTS.find((o) => o.name === name)?.label ?? name,
    fields: { name: { name: 'name', label: 'Name', type: 'text' }, status: { name: 'status', label: 'Status', type: 'text' } },
    listViews: Object.fromEntries(
      own.map((row) => [row.name, { ...row.config, name: row.name, label: row.label, ...(row.isDefault ? { isDefault: true } : {}) }]),
    ),
  };
}

const mockClient: Record<string, any> = {
  save: vi.fn(async (..._args: unknown[]) => ({ success: true, version: 'v1', state: 'draft' })),
  list: vi.fn(async (type: string) => {
    if (type === 'app') return [{ name: 'crm_app', label: 'CRM', navigation: NAV }];
    if (type === 'object') return OBJECTS;
    if (type === 'view') return Object.values(published);
    return [];
  }),
  listDrafts: vi.fn(async (opts?: { type?: string }) =>
    opts?.type === 'view' ? Object.values(drafts).map((d) => ({ name: d.name, label: d.label, packageId: PKG })) : [],
  ),
  listTypes: vi.fn(async () => ({ entries: [] })),
  references: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'crm_app', label: 'CRM', navigation: NAV } };
    if (type === 'object') return { effective: objectDef(name), code: objectDef(name) };
    if (type === 'view') {
      const row = published[name] ?? null;
      return { code: null, overlay: row, overlayScope: row ? 'env' : null, effective: row, editable: true };
    }
    return { effective: { name } };
  }),
  getDraft: vi.fn(async (type: string, name: string) => {
    const row = type === 'view' ? drafts[name] : undefined;
    if (row) return { type, name, item: { ...row, _draft: true }, version: 'v1' };
    throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
  }),
  get: vi.fn(async (type: string, name: string) => (type === 'object' ? objectDef(name) : undefined)),
  publish: vi.fn(async () => ({ success: true })),
};
// The draft-overlaid reads: the package's view drafts are tagged `_draft`, as the server serves them.
const previewClient: Record<string, any> = Object.assign(Object.create(mockClient), {
  list: vi.fn(async (type: string, opts?: unknown) =>
    type === 'view'
      ? [...Object.values(published), ...Object.values(drafts).map((d) => ({ ...d, _draft: true, _packageId: PKG }))]
      : mockClient.list(type, opts),
  ),
});
mockClient.withPreviewDrafts = () => previewClient;

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

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

// The `view` resource's list filter (the aggregated container is no item) is
// registered here, as the console registers it.
import '../../services/builtinComponents';
import { InterfacesPillar } from './StudioDesignSurface';
import { registerMetadataPreview, type MetadataPreviewProps } from '../metadata-admin/preview-registry';
import { t, tFormat } from '../metadata-admin/i18n';
import { STUDIO_RAIL_ROW_ACTIVE } from './studio-tokens';

/** A view page's canvas that says what it was opened on. */
function StubPreview({ type, name }: MetadataPreviewProps) {
  return <div data-testid="stub-canvas">{`${type}:${name}`}</div>;
}
registerMetadataPreview('view', StubPreview);

/** Stands in for `plugin-view`'s `object-view` on an object page's canvas. */
function ObjectViewRecorder({ schema }: { schema: Record<string, unknown> }) {
  return <pre data-testid="object-view-schema">{JSON.stringify(schema)}</pre>;
}

function metadata(): MetadataContextValue {
  return {
    apps: [],
    objects: OBJECTS.map((o) => objectDef(o.name)),
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
  };
}

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

beforeAll(() => {
  ComponentRegistry.register('object-view', ObjectViewRecorder as never, { namespace: 'plugin-view' });
});
beforeEach(() => {
  seed();
  for (const fn of [mockClient.save, mockClient.list, mockClient.listDrafts, previewClient.list]) fn.mockClear();
  window.confirm = vi.fn(() => false) as unknown as typeof window.confirm;
});
afterEach(cleanup);

/** The address the pillar writes, as a reload or a shared link reads it. */
let address = new URLSearchParams();
function AddressProbe() {
  const { search } = useLocation();
  React.useEffect(() => {
    address = new URLSearchParams(search);
  }, [search]);
  return null;
}

function mountPillar(search = '') {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces${search}`]}>
      <MetadataCtx.Provider value={metadata()}>
        <InterfacesPillar packageId={PKG} packageLabel="Acme CRM" />
        <AddressProbe />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

/** The 视图 group under the tree, once the package's views are read. */
async function viewGroup(): Promise<HTMLElement> {
  return screen.findByTestId('if-off-nav-view', undefined, { timeout: 8000 });
}

/** The group's rows, as `type · name` (their tooltip), in rail order. */
function rowNames(group: HTMLElement): string[] {
  return within(group)
    .getAllByRole('button')
    .map((b) => b.getAttribute('title') ?? '')
    .filter((title) => title.startsWith('view · '));
}

/** The group's rows, as an author reads them. */
function rowTexts(group: HTMLElement): string[] {
  return within(group)
    .getAllByRole('button')
    .filter((b) => (b.getAttribute('title') ?? '').startsWith('view · '))
    .map((b) => b.textContent ?? '');
}

/** The view item name the object page's panel shows beneath its title. */
const shownView = () => screen.queryByTestId('list-view-name')?.textContent ?? null;

/** Every view row's read settled: the drafts headers and the draft-overlaid list. */
async function viewsRead() {
  await waitFor(() => expect(mockClient.listDrafts).toHaveBeenCalledWith({ packageId: PKG, type: 'view' }));
  await waitFor(() => expect(previewClient.list).toHaveBeenCalledWith('view', { packageId: PKG }));
  await new Promise((r) => setTimeout(r, 50));
}

describe('不在导航中 → 视图 lists what the dropdown does not reach (objectstack#30046 Scope 7)', () => {
  it('a list view of an object with a nav entry is not listed, a drafted one included', async () => {
    mountPillar();
    const group = await viewGroup();
    await viewsRead();
    const names = rowNames(group);
    expect(names).not.toContain('view · crm_lead.all');
    expect(names).not.toContain('view · crm_lead.hot');
    expect(names).not.toContain('view · crm_lead.drafted');
  });

  it('CONTROL: the list views of an object with no entry stay listed, beside the form views', async () => {
    mountPillar();
    const group = await viewGroup();
    await viewsRead();
    expect(rowNames(group).sort()).toEqual(
      ['view · crm_case.mine', 'view · crm_case.open', 'view · crm_lead.contact_us', 'view · crm_lead.form'].sort(),
    );
  });
});

describe('the group names what it holds, and a form view by a readable name (objectstack#30046 Scope 8)', () => {
  it('a form view reads its label, else the object’s name and the word for a form; never its machine name', async () => {
    mountPillar();
    const group = await viewGroup();
    await viewsRead();
    const texts = rowTexts(group);
    expect(texts).toContain(tFormat('engine.studio.if.offNav.formName', 'en', { object: 'Lead' }));
    expect(texts).toContain('Contact us');
    expect(texts).not.toContain('crm_lead.form');
  });

  it('the heading says it holds form and list views; with only forms left, form views', async () => {
    mountPillar();
    const group = await viewGroup();
    await viewsRead();
    expect(group).toHaveTextContent(t('engine.studio.if.offNav.viewMixed', 'en'));

    cleanup();
    for (const name of Object.keys(published)) if (name.startsWith('crm_case.')) delete published[name];
    mountPillar();
    const forms = await viewGroup();
    await viewsRead();
    expect(rowNames(forms).sort()).toEqual(['view · crm_lead.contact_us', 'view · crm_lead.form']);
    expect(forms).toHaveTextContent(t('engine.studio.if.offNav.viewForms', 'en'));
    expect(forms).not.toHaveTextContent(t('engine.studio.if.offNav.viewMixed', 'en'));
  });

  it('CONTROL: with only list views left, the heading stays 视图', async () => {
    for (const name of Object.keys(published)) if (published[name]!.viewKind === 'form') delete published[name];
    mountPillar();
    const group = await viewGroup();
    await viewsRead();
    expect(rowNames(group).sort()).toEqual(['view · crm_case.mine', 'view · crm_case.open']);
    expect(group).toHaveTextContent(t('engine.studio.if.offNav.view', 'en'));
    expect(group).not.toHaveTextContent(t('engine.studio.if.offNav.viewForms', 'en'));
  });
});

describe('a list view opened from 不在导航中 lands on its object’s page (objectstack#30046 Scope 6)', () => {
  it('opens on the object page: title object / view ▾, the view in the panel and the address, its row active', async () => {
    mountPillar();
    const group = await viewGroup();
    await viewsRead();
    fireEvent.click(within(group).getByRole('button', { name: 'My cases' }));

    await screen.findByTestId('studio-list-view-inspector', undefined, { timeout: 8000 });
    await waitFor(() => expect(shownView()).toBe('crm_case.mine'));
    expect(screen.getByTestId('if-list-view-title-object')).toHaveTextContent('Case');
    expect(within(screen.getByTestId('if-item-header')).getByTestId('list-view-switcher')).toHaveTextContent('My cases');
    // No view page: its canvas is not mounted.
    expect(screen.queryByTestId('stub-canvas')).toBeNull();
    await waitFor(() => expect(address.get('surface')).toBe('object:crm_case'));
    expect(address.get('view')).toBe('crm_case.mine');
    // The row it was opened from is the active one, and only it.
    const active = within(group).getAllByRole('button').filter((b) => b.className.includes(STUDIO_RAIL_ROW_ACTIVE));
    expect(active.map((b) => b.textContent)).toEqual(['My cases']);
  });

  it('the panel keeps what the view page offered: 条件格式化 with the view’s rules, and the spec form’s sections', async () => {
    mountPillar();
    const group = await viewGroup();
    await viewsRead();
    fireEvent.click(within(group).getByRole('button', { name: 'My cases' }));
    await waitFor(() => expect(shownView()).toBe('crm_case.mine'), { timeout: 8000 });

    const more = await screen.findByTestId('list-view-more', undefined, { timeout: 8000 });
    expect(within(more).getByTestId('list-view-conditional-formatting')).toBeInTheDocument();
    expect(within(more).getByDisplayValue("status == 'urgent'")).toBeInTheDocument();
    expect(within(more).getByTestId('list-view-spec-form')).toBeInTheDocument();
  });

  it('a second view of the same object is one more pick in the rail, on the same page', async () => {
    mountPillar();
    const group = await viewGroup();
    await viewsRead();
    fireEvent.click(within(group).getByRole('button', { name: 'My cases' }));
    await waitFor(() => expect(shownView()).toBe('crm_case.mine'), { timeout: 8000 });
    fireEvent.click(within(group).getByRole('button', { name: 'Open cases' }));
    await waitFor(() => expect(shownView()).toBe('crm_case.open'));
    expect(screen.getByTestId('if-list-view-title-object')).toHaveTextContent('Case');
    // The object's default view: the address names the object alone.
    await waitFor(() => expect(address.has('view')).toBe(false));
    expect(address.get('surface')).toBe('object:crm_case');
  });

  it('a link to an object with no entry (a reload of that page) opens it on the view it names', async () => {
    mountPillar('?surface=object%3Acrm_case&view=crm_case.mine');
    await screen.findByTestId('studio-list-view-inspector', undefined, { timeout: 8000 });
    await waitFor(() => expect(shownView()).toBe('crm_case.mine'));
    expect(screen.getByTestId('if-list-view-title-object')).toHaveTextContent('Case');
  });

  it('a link to the view itself (`surface=view:`) lands on the same page; with a nav entry, on the entry', async () => {
    mountPillar('?surface=view%3Acrm_case.mine');
    await screen.findByTestId('studio-list-view-inspector', undefined, { timeout: 8000 });
    await waitFor(() => expect(shownView()).toBe('crm_case.mine'));
    expect(screen.queryByTestId('stub-canvas')).toBeNull();

    cleanup();
    mountPillar('?surface=view%3Acrm_lead.hot');
    await screen.findByTestId('studio-list-view-inspector', undefined, { timeout: 8000 });
    await waitFor(() => expect(shownView()).toBe('crm_lead.hot'));
    expect(screen.getByTestId('if-list-view-title-object')).toHaveTextContent('Leads');
    await waitFor(() => expect(address.get('nav')).toBe('nav_leads'));
    expect(address.get('view')).toBe('crm_lead.hot');
  });

  it('CONTROL: a form view still opens as itself', async () => {
    mountPillar();
    const group = await viewGroup();
    await viewsRead();
    fireEvent.click(within(group).getByRole('button', { name: 'Contact us' }));
    expect(await screen.findByText('view:crm_lead.contact_us', undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByTestId('studio-list-view-inspector')).toBeNull();
  });
});
