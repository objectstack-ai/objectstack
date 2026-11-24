// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36905 — a permission set's full-screen page at its metadata
 * address: the REAL `StudioPermissionSetPage` and `PermissionMatrixEditPage`,
 * routed as the "All metadata" area routes an item.
 *
 *  - the header is the full-screen detail's (× back to the list), and the
 *    matrix draws no header of its own;
 *  - the tab row is the five sections, then References, History and Source;
 *    a tool tab is addressable (`?tab=`) and keeps the matrix mounted;
 *  - × opens the list of sets with the list's context;
 *  - "New similar" sits in ⋯ on a read-only base, and the copy opens at its
 *    own metadata address with the strip saying where it landed;
 *  - the draft discard drops this set's draft at its package.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
// The matrix reaches `@objectstack/lint`'s dynamic imports; their first load is
// paid here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';

const BASE_PKG = 'hotcrm';
const CUSTOM_PKG = 'hotcrm.custom';
const SET = 'hotcrm_sales_rep';
const COPY_NAME = 'my_sales_rep';
const BODY = { name: SET, label: 'Sales rep', objects: { crm_lead: { allowRead: true } }, fields: {} };

let clientImpl: ReturnType<typeof makeClient>;
vi.mock('../metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => clientImpl,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: false, allowRuntimeCreate: true }],
  }),
}));
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => true,
  useCanReadAuthoringTrail: () => true,
}));
vi.mock('../metadata-admin/catalog-scope', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWalledCatalogReadOnly: () => false,
}));
// The tool panels are `ItemToolTabs`' own (pinned beside it): here, which one opened.
vi.mock('../item-tools/ItemToolTabs.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ItemToolTabPanel: ({ tab }: { tab: string }) => <div data-testid="tool-panel" data-tab={tab} />,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));

import { t, tFormat } from '../metadata-admin/i18n';
import { StudioPermissionSetPage } from './StudioPermissionSetPage';

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

const en = (key: string) => t(key, 'en');

function makeClient(drafts: string[] = []) {
  return {
    save: vi.fn(async (_t: string, _n: string, body: Record<string, unknown>) => body),
    reset: vi.fn(async () => ({})),
    withPreviewDrafts() {
      return this;
    },
    list: vi.fn(async (type: string) => {
      if (type === 'object') return [{ name: 'crm_lead', label: 'Lead' }];
      return type === 'permission' ? [{ name: SET, label: 'Sales rep' }] : [];
    }),
    listDrafts: vi.fn(async () => drafts.map((name) => ({ name }))),
    layered: vi.fn(async () => ({ effective: BODY, code: null, overlay: null, overlayScope: null })),
    getDraft: vi.fn(async () => null),
    get: vi.fn(async () => ({ fields: [] })),
  };
}

let doorAnswer: { status: number; body: unknown };
function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(doorAnswer.body), {
        status: doorAnswer.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

/** The area's item route: the page keyed per item, as `AreaItem` keys it. */
function ItemRoute() {
  const { packageId = '', name = '' } = useParams<{ packageId: string; name: string }>();
  return (
    <StudioPermissionSetPage key={`${packageId}/${name}`} packageId={packageId} name={name} readOnly={packageId === BASE_PKG} />
  );
}

function Where() {
  const { pathname, search } = useLocation();
  return <span data-testid="where">{pathname + search}</span>;
}

function mount(pkg: string, query = '') {
  render(
    <MemoryRouter initialEntries={[`/studio/${pkg}/metadata/permission/${SET}?package=${pkg}${query}`]}>
      <Where />
      <Routes>
        <Route path="/studio/:packageId/metadata/permission/:name" element={<ItemRoute />} />
        <Route path="/studio/:packageId/metadata/permission" element={<div data-testid="list" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId('where').textContent ?? '';
const title = () => screen.findByTestId('studio-detail-title', undefined, { timeout: 8000 });

beforeEach(() => {
  // `?tab=` is read from and written to the document's address (`useItemToolTab`).
  window.history.replaceState(null, '', '/');
  clientImpl = makeClient();
  doorAnswer = { status: 200, body: { success: true, data: {} } };
  stubFetch();
  window.confirm = vi.fn(() => true) as unknown as typeof window.confirm;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the full-screen header and tabs (objectstack#36905)', () => {
  it('draws the detail header, the five sections and the item tools; the matrix draws no header of its own', async () => {
    mount(CUSTOM_PKG);
    expect(await title()).toHaveTextContent('Sales rep');
    expect(screen.getByTestId('studio-detail-close')).toBeInTheDocument();
    expect(screen.queryByTestId('access-item-header')).toBeNull();
    for (const section of ['objects', 'capabilities', 'rls', 'tabs', 'admin']) {
      expect(screen.getByTestId(`perm-tab-${section}`)).toBeInTheDocument();
    }
    for (const tool of ['references', 'history', 'source']) {
      expect(screen.getByTestId(`item-tab-${tool}`)).toBeInTheDocument();
    }
    // History is a tab here, never the matrix's sheet button.
    expect(screen.queryByTestId('history-button')).toBeNull();
    expect(screen.getByTestId('perm-tab-objects')).toHaveAttribute('aria-pressed', 'true');
  });

  it('a tool tab is addressable and keeps the matrix mounted; a section tab goes back', async () => {
    mount(CUSTOM_PKG);
    await title();
    await screen.findByTestId('perm-studio-sections', undefined, { timeout: 8000 });
    fireEvent.click(screen.getByTestId('item-tab-history'));
    expect(await screen.findByTestId('tool-panel')).toHaveAttribute('data-tab', 'history');
    await waitFor(() => expect(window.location.search).toContain('tab=history'));
    // Mounted and hidden: an edit survives the visit.
    expect(screen.getByTestId('perm-studio-sections')).toHaveClass('hidden');
    expect(screen.getByTestId('perm-tab-objects')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByTestId('perm-tab-capabilities'));
    await waitFor(() => expect(screen.queryByTestId('tool-panel')).toBeNull());
    expect(screen.getByTestId('perm-studio-sections')).not.toHaveClass('hidden');
    expect(screen.getByTestId('perm-tab-capabilities')).toHaveAttribute('aria-pressed', 'true');
  });

  it('an address on a tool tab opens it', async () => {
    window.history.replaceState(null, '', '/?tab=source');
    mount(CUSTOM_PKG, '&tab=source');
    expect(await screen.findByTestId('tool-panel', undefined, { timeout: 8000 })).toHaveAttribute('data-tab', 'source');
  });

  it('× opens the list of sets, with the package', async () => {
    mount(CUSTOM_PKG);
    await title();
    fireEvent.click(screen.getByTestId('studio-detail-close'));
    await screen.findByTestId('list');
    expect(where()).toBe(`/studio/${CUSTOM_PKG}/metadata/permission?package=${encodeURIComponent(CUSTOM_PKG)}`);
  });
});

describe('the draft discard (objectstack#36905)', () => {
  it('drops this set\'s draft at its package, after one question', async () => {
    clientImpl = makeClient([SET]);
    mount(CUSTOM_PKG);
    fireEvent.click(await screen.findByTestId('access-discard-draft', undefined, { timeout: 8000 }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(clientImpl.reset).toHaveBeenCalledWith('permission', SET, { state: 'draft', packageId: CUSTOM_PKG }));
  });

  it('CONTROL: no draft, no discard', async () => {
    mount(CUSTOM_PKG);
    await title();
    await waitFor(() => expect(clientImpl.listDrafts).toHaveBeenCalled());
    expect(screen.queryByTestId('access-discard-draft')).toBeNull();
  });
});

describe('"New similar" in ⋯ on a read-only base (objectstack#36905, #28573)', () => {
  async function openNewSimilar() {
    await title();
    fireEvent.pointerDown(screen.getByTestId('studio-detail-more'), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await screen.findByTestId('access-new-similar'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(en('perm.clone.name')), { target: { value: COPY_NAME } });
    fireEvent.change(within(dialog).getByLabelText(en('perm.clone.label')), { target: { value: 'My sales rep' } });
    fireEvent.click(within(dialog).getByRole('button', { name: en('perm.clone.confirm') }));
  }

  it('opens the copy at its metadata address in the package the answer names, with the strip', async () => {
    doorAnswer = {
      status: 200,
      body: { success: true, data: { permissionSet: { ...BODY, name: COPY_NAME }, package: CUSTOM_PKG, notice: 'Saved.' } },
    };
    mount(BASE_PKG);
    await openNewSimilar();
    await waitFor(() =>
      expect(where()).toBe(`/studio/${CUSTOM_PKG}/metadata/permission/${COPY_NAME}?package=${encodeURIComponent(CUSTOM_PKG)}`),
    );
    const strip = await screen.findByTestId('access-new-similar-strip');
    expect(strip).toHaveTextContent(
      tFormat('engine.studio.access.newSimilar.done', 'en', { name: COPY_NAME, package: CUSTOM_PKG }),
    );
  });

  it('an answer naming no package opens nothing and says so', async () => {
    doorAnswer = { status: 200, body: { success: true, data: { permissionSet: { ...BODY, name: COPY_NAME }, notice: 'Saved.' } } };
    mount(BASE_PKG);
    await openNewSimilar();
    const strip = await screen.findByTestId('access-new-similar-strip');
    expect(strip).toHaveTextContent(tFormat('engine.studio.access.newSimilar.noPackage', 'en', { name: COPY_NAME }));
    expect(where()).toBe(`/studio/${BASE_PKG}/metadata/permission/${SET}?package=${BASE_PKG}`);
  });

  it('CONTROL: a writable package\'s set offers no New similar', async () => {
    mount(CUSTOM_PKG);
    await title();
    fireEvent.pointerDown(screen.getByTestId('studio-detail-more'), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    await screen.findByText(en('perm.basics.editHint'));
    expect(screen.queryByTestId('access-new-similar')).toBeNull();
  });
});
