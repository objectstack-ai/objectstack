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
 *  - the draft discard drops this set's draft at its package; a declined
 *    question discards nothing, a never-published set goes back to the list,
 *    a read-only package offers no discard, and an unanswered read of the
 *    package's sets never counts a set as never published;
 *  - the matrix's sections behave as they did in the Access pillar
 *    (objectui#12456): five tabs, Objects the landing, each other tab its
 *    section, the facet panels kept mounted for the Save gate, the bulk strip
 *    on every row with keyboard focus marking the row, CRUD granting the four
 *    cells, and the sharing chip and the object count.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

/** The set's pending draft as the strict draft read serves it, with who wrote it. */
function draftOf(by: 'copilot' | 'mcp' | 'studio') {
  return {
    type: 'permission',
    name: SET,
    item: { ...BODY, label: 'Sales rep (AI)' },
    draftChanges: [{ path: ['label'], by, actor: 'u1', at: '2026-11-24T10:00:00.000Z' }],
  };
}

function makeClient(drafts: string[] = [], draft: ReturnType<typeof draftOf> | null = null) {
  return {
    save: vi.fn(async (_t: string, _n: string, body: Record<string, unknown>) => body),
    reset: vi.fn(async () => ({})),
    withPreviewDrafts() {
      return this;
    },
    list: vi.fn(async (type: string) => {
      if (type === 'object') {
        return [
          { name: 'crm_lead', label: 'Lead' },
          { name: 'crm_account', label: 'Account' },
        ];
      }
      return type === 'permission' ? [{ name: SET, label: 'Sales rep' }] : [];
    }),
    listDrafts: vi.fn(async () => drafts.map((name) => ({ name }))),
    layered: vi.fn(async () => ({ effective: BODY, code: null, overlay: null, overlayScope: null })),
    getDraft: vi.fn(async () => draft),
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
/** How many times the permission sets were listed: the page re-reads them after a discard that stays. */
const setsReads = () => clientImpl.list.mock.calls.filter(([type]) => type === 'permission').length;
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

describe('the status place says what a save does, or that nothing is saved (objectui#11781, #12453, #29674)', () => {
  it('read-only: one read-only link carrying the sentence, and no save banner', async () => {
    mount(BASE_PKG);
    await title();
    const links = screen.getAllByTestId('studio-readonly-link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('title', en('engine.studio.access.bannerTitleReadOnly'));
    expect(screen.queryByTestId('studio-item-status')).toBeNull();
  });

  it('CONTROL — writable, a set of a base\'s pair: the status chip names the base whose objects it lists', async () => {
    mount(CUSTOM_PKG);
    await title();
    const chip = await screen.findByTestId('studio-item-status');
    expect(chip).toHaveTextContent(tFormat('engine.studio.access.bannerPair', 'en', { package: BASE_PKG }));
    expect(chip).toHaveAccessibleDescription(tFormat('engine.studio.access.bannerTitlePair', 'en', { package: BASE_PKG }));
    expect(screen.queryByTestId('studio-readonly-link')).toBeNull();
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

  // objectstack#26836's discard cases, moved from the Access pillar's pin.
  it('a declined question discards nothing, and the discard stays offered', async () => {
    clientImpl = makeClient([SET]);
    window.confirm = vi.fn(() => false) as unknown as typeof window.confirm;
    mount(CUSTOM_PKG);
    fireEvent.click(await screen.findByTestId('access-discard-draft', undefined, { timeout: 8000 }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(clientImpl.reset).not.toHaveBeenCalled();
    expect(screen.getByTestId('access-discard-draft')).toBeInTheDocument();
    expect(where()).toBe(`/studio/${CUSTOM_PKG}/metadata/permission/${SET}?package=${CUSTOM_PKG}`);
  });

  it('a set never published: its question says so, and its discard goes back to the list of sets', async () => {
    clientImpl = makeClient([SET]);
    // The package's published sets do not hold it: only its draft does.
    clientImpl.list.mockImplementation(async (type: string) => (type === 'object' ? [{ name: 'crm_lead', label: 'Lead' }] : []));
    mount(CUSTOM_PKG);
    fireEvent.click(await screen.findByTestId('access-discard-draft', undefined, { timeout: 8000 }));
    expect(window.confirm).toHaveBeenCalledWith(
      tFormat('engine.studio.access.discardConfirmUnpublished', 'en', { item: 'Sales rep' }),
    );
    await waitFor(() => expect(clientImpl.reset).toHaveBeenCalledWith('permission', SET, { state: 'draft', packageId: CUSTOM_PKG }));
    await screen.findByTestId('list');
    expect(where()).toBe(`/studio/${CUSTOM_PKG}/metadata/permission?package=${encodeURIComponent(CUSTOM_PKG)}`);
  });

  it('CONTROL: a published set\'s discard asks the published question and stays on the set', async () => {
    clientImpl = makeClient([SET]);
    mount(CUSTOM_PKG);
    const discard = await screen.findByTestId('access-discard-draft', undefined, { timeout: 8000 });
    const readsBefore = setsReads();
    fireEvent.click(discard);
    expect(window.confirm).toHaveBeenCalledWith(tFormat('engine.studio.access.discardConfirm', 'en', { item: 'Sales rep' }));
    await waitFor(() => expect(clientImpl.reset).toHaveBeenCalledTimes(1));
    // The page stayed: it reads the package's sets again, which a page sent to the list never does.
    await waitFor(() => expect(setsReads()).toBeGreaterThan(readsBefore));
    expect(screen.queryByTestId('list')).toBeNull();
    expect(where()).toBe(`/studio/${CUSTOM_PKG}/metadata/permission/${SET}?package=${CUSTOM_PKG}`);
  });

  it('a read-only package offers no discard, even with a pending draft', async () => {
    clientImpl = makeClient([SET]);
    mount(BASE_PKG);
    await title();
    await waitFor(() => expect(clientImpl.listDrafts).toHaveBeenCalled());
    expect(screen.queryByTestId('access-discard-draft')).toBeNull();
  });

  it('an unanswered read of the package\'s sets never counts the set as never published: the AI discard stays on it', async () => {
    clientImpl = makeClient([SET], draftOf('copilot'));
    clientImpl.list.mockImplementation(async (type: string) => {
      if (type === 'permission') throw new Error('sets unreadable');
      return [{ name: 'crm_lead', label: 'Lead' }];
    });
    mount(CUSTOM_PKG);
    const discard = await screen.findByTestId('studio-ai-draft-discard', undefined, { timeout: 8000 });
    const readsBefore = setsReads();
    fireEvent.click(discard);
    await waitFor(() => expect(clientImpl.reset).toHaveBeenCalledWith('permission', SET, { state: 'draft', packageId: CUSTOM_PKG }));
    // The page stayed: it reads the package's sets again, which a page sent to the list never does.
    await waitFor(() => expect(setsReads()).toBeGreaterThan(readsBefore));
    expect(screen.queryByTestId('list')).toBeNull();
    expect(where()).toBe(`/studio/${CUSTOM_PKG}/metadata/permission/${SET}?package=${CUSTOM_PKG}`);
  });
});

describe('an AI draft gets the designers\' notice and discard (objectstack#36905 item 6, epic decision 1)', () => {
  for (const by of ['copilot', 'mcp'] as const) {
    it(`${by}: the notice, its discard drops the set's draft at its package without asking on a clean page`, async () => {
      clientImpl = makeClient([SET], draftOf(by));
      mount(CUSTOM_PKG);
      expect(await screen.findByTestId('studio-ai-draft-notice', undefined, { timeout: 8000 })).toHaveTextContent(
        en('engine.studio.aiDraft.notice'),
      );
      // The AI's draft is discarded from its notice, not from the plain button.
      expect(screen.queryByTestId('access-discard-draft')).toBeNull();
      fireEvent.click(screen.getByTestId('studio-ai-draft-discard'));
      await waitFor(() =>
        expect(clientImpl.reset).toHaveBeenCalledWith('permission', SET, { state: 'draft', packageId: CUSTOM_PKG }),
      );
      expect(window.confirm).not.toHaveBeenCalled();
    });
  }

  it('CONTROL: a person\'s own draft draws no notice, and keeps Discard draft', async () => {
    clientImpl = makeClient([SET], draftOf('studio'));
    mount(CUSTOM_PKG);
    await screen.findByTestId('access-discard-draft', undefined, { timeout: 8000 });
    expect(screen.queryByTestId('studio-ai-draft-notice')).toBeNull();
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

/**
 * objectui#12456 / objectstack#34795 — the matrix's sections as the Access
 * pillar's pin held them, now on the set's page (moved from
 * `StudioDesignSurface.accessTabs-12456`; the pillar's own header half went
 * with the pillar).
 */
describe('the matrix\'s five sections on the page (objectui#12456)', () => {
  const sectionPanel = (key: string) =>
    screen.getByTestId(key === 'objects' || key === 'capabilities' ? `perm-tabpanel-${key}` : `perm-facet-${key}`);

  async function openWritable() {
    mount(CUSTOM_PKG);
    await screen.findByTestId('perm-row-crm_lead', undefined, { timeout: 8000 });
  }

  it('five tabs in order, Objects the landing', async () => {
    await openWritable();
    const header = screen.getByTestId('permission-detail-header');
    const tabs = Array.from(header.querySelectorAll<HTMLElement>('[data-testid^="perm-tab-"]'));
    expect(tabs.map((b) => b.textContent)).toEqual([
      en('engine.studio.access.tab.objects'),
      en('engine.studio.access.tab.capabilities'),
      en('engine.studio.access.tab.rls'),
      en('engine.studio.access.tab.tabs'),
      en('engine.studio.access.tab.admin'),
    ]);
    expect(screen.getByTestId('perm-tab-objects')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('perm-tabpanel-objects')).toBeVisible();
    expect(screen.getByTestId('perm-tabpanel-capabilities')).not.toBeVisible();
    expect(screen.getByTestId('perm-tabpanel-facets')).not.toBeVisible();
  });

  it('each other tab shows its own section and hides the rest', async () => {
    await openWritable();
    fireEvent.click(screen.getByTestId('perm-tab-capabilities'));
    expect(screen.getByTestId('perm-tab-capabilities')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('perm-tabpanel-objects')).not.toBeVisible();
    expect(within(sectionPanel('capabilities')).getByText(en('perm.field.systemCapabilities'))).toBeVisible();

    for (const [key, name] of [
      ['rls', 'perm.rls.title'],
      ['tabs', 'perm.tabs.title'],
      ['admin', 'perm.admin.title'],
    ] as const) {
      fireEvent.click(screen.getByTestId(`perm-tab-${key}`));
      expect(sectionPanel(key)).toBeVisible();
      expect(sectionPanel(key)).toHaveAccessibleName(en(name));
      for (const other of ['rls', 'tabs', 'admin'].filter((k) => k !== key)) {
        expect(sectionPanel(other)).not.toBeVisible();
      }
    }
  });

  it('the facet panels stay mounted while Objects is open, so each still reports to the Save gate', async () => {
    await openWritable();
    for (const key of ['rls', 'tabs', 'admin']) {
      expect(screen.getByTestId(`perm-facet-${key}`)).toBeInTheDocument();
    }
  });

  it('the bulk strip draws on every row at rest: All · Read only · None, then the CRUD arm', async () => {
    await openWritable();
    await screen.findByTestId('perm-row-crm_account');
    for (const obj of ['crm_lead', 'crm_account']) {
      expect(within(screen.getByTestId(`perm-bulk-${obj}`)).getAllByRole('button').map((b) => b.textContent)).toEqual([
        en('perm.bulk.all'),
        en('perm.bulk.read'),
        en('perm.bulk.none'),
        en('perm.bulk.crud'),
      ]);
    }
  });

  it("keyboard focus on a row's first checkbox marks the row; focus leaving the row clears it", async () => {
    await openWritable();
    const row = await screen.findByTestId('perm-row-crm_account');
    const first = within(row).getAllByRole('checkbox')[0];
    act(() => first.focus());
    expect(first).toHaveFocus();
    expect(row).toHaveAttribute('data-active', 'true');
    // The strip's buttons are in the row's tab order.
    act(() => within(screen.getByTestId('perm-bulk-crm_account')).getAllByRole('button')[0].focus());
    expect(row).toHaveAttribute('data-active', 'true');
    act(() => within(screen.getByTestId('perm-row-crm_lead')).getAllByRole('checkbox')[0].focus());
    await waitFor(() => expect(row).not.toHaveAttribute('data-active'));
  });

  it('CRUD grants the four CRUD cells and nothing else, and the header counts it', async () => {
    await openWritable();
    const row = await screen.findByTestId('perm-row-crm_account');
    fireEvent.mouseEnter(row);
    fireEvent.click(within(row).getByRole('button', { name: en('perm.bulk.crud') }));
    for (const action of ['perm.action.create', 'perm.action.read', 'perm.action.edit', 'perm.action.delete']) {
      expect(within(row).getByRole('checkbox', { name: `crm_account ${en(action)}` })).toBeChecked();
    }
    expect(within(row).getByRole('checkbox', { name: `crm_account ${en('perm.action.viewAll')}` })).not.toBeChecked();
    await waitFor(() =>
      expect(within(screen.getByTestId('permission-detail-header')).getByText('2 objects granted · 0 field overrides')).toBeInTheDocument(),
    );
  });

  it('the sharing column is a chip that opens the overview on its object; the toolbar counts the objects', async () => {
    await openWritable();
    const row = screen.getByTestId('perm-row-crm_lead');
    const chip = within(row).getByTestId('owd-badge-crm_lead');
    expect(chip).toHaveTextContent(en('perm.owd.defaultPrivate'));
    expect(screen.getByTestId('perm-object-count')).toHaveTextContent('2 objects');
    fireEvent.click(chip);
    await waitFor(() => expect(where()).toBe(`/studio/${CUSTOM_PKG}/owd?object=crm_lead`));
  });
});
