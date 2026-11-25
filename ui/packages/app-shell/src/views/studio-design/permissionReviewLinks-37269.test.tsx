// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37269 — both producers of a review link reach a permission
 * set's draft review.
 *
 * The two producers write `?review=1` for any draft item, a permission set
 * included, and name no package:
 *  - the Packages page's per-draft link (`PackageDetailSheet`, rendered here
 *    for real with a permission-set draft), to `APP/metadata/TYPE/NAME?review=1`,
 *    which Setup's metadata route sends on to Studio (`SetupMetadataRoute` in
 *    `AppContent.tsx`, re-stated below from the same two helpers; the route
 *    itself is pinned in `AppContent.setupMetadataStudio-28578.test.tsx`);
 *  - the chat's 「Review N change(s)」 (`DraftReviewNavigator` in
 *    `AppContent.tsx`), which navigates to `setupMetadataStudioPath(item,
 *    'review=1')`, called here with the same arguments.
 *
 * Both land on Studio's cross-package leg, where the REAL area hands the set
 * to its type's own item page, the REAL matrix (`PermissionMatrixEditPage`,
 * the editor `builtinComponents` registers), with no package. The matrix
 * opens the generic draft review there (`DraftReviewSheet`): the draft read
 * by name, as the generic item page reads it, against the published set.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
// The matrix reaches `@objectstack/lint`'s dynamic imports; their first load is
// paid here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';

const PKG = 'com.acme.crm';
const SET = 'acme_sales_rep';
const PUBLISHED = { name: SET, label: 'Sales rep', objects: { acme_lead: { allowRead: true } }, fields: {} };
const DRAFT = {
  type: 'permission',
  name: SET,
  item: { ...PUBLISHED, objects: { acme_lead: { allowRead: true, allowEdit: true } } },
};

function makeClient(draft: typeof DRAFT | null) {
  return {
    save: vi.fn(async (_t: string, _n: string, body: Record<string, unknown>) => body),
    reset: vi.fn(async () => ({})),
    withPreviewDrafts() {
      return this;
    },
    list: vi.fn(async (type: string) => {
      if (type === 'object') return [{ name: 'acme_lead', label: 'Lead' }];
      return type === 'permission' ? [{ name: SET, label: 'Sales rep', _packageId: PKG }] : [];
    }),
    listDrafts: vi.fn(async () => (draft ? [{ type: 'permission', name: SET, packageId: PKG }] : [])),
    layered: vi.fn(async () => ({ effective: PUBLISHED, code: null, overlay: null, overlayScope: null })),
    getDraft: vi.fn(async () => draft),
    get: vi.fn(async () => ({ fields: [] })),
  };
}

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
vi.mock('./packages-io.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchListedPackageManifests: vi.fn(async () => new Map()),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { t } from '../metadata-admin/i18n';
import { registerMetadataResource } from '../metadata-admin/registry';
import { PermissionMatrixEditPage } from '../metadata-admin/PermissionMatrixEditor';
import { PackageDetailSheet, type InstalledPackageRow } from '../metadata-admin/PackagesPage';
import { StudioMetadataArea } from './StudioMetadataArea';
import { setupMetadataRest, setupMetadataStudioPath } from './setupMetadataRedirect';

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

const PACKAGE_ROW: InstalledPackageRow = {
  manifest: { id: PKG, name: 'Acme CRM', version: '1.0.0', type: 'app' },
  enabled: true,
  status: 'installed',
  source: 'authored',
  writable: true,
};

function respond(body: unknown) {
  const text = JSON.stringify(body);
  return { ok: true, status: 200, text: async () => text, headers: new Headers(), json: async () => JSON.parse(text) } as unknown as Response;
}

/** Setup's metadata route as `AppContent` declares it (`SetupMetadataRoute`): on to Studio, query kept. */
function SetupMetadataRoute() {
  const location = useLocation();
  const target = setupMetadataStudioPath(setupMetadataRest(location.pathname) ?? '', location.search, location.hash);
  return target ? <Navigate to={target} replace /> : <div data-testid="setup-kept" />;
}

/** The chat's 「Review N change(s)」, as `DraftReviewNavigator` navigates it. */
function ChatReview({ type, name }: { type: string; name: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      data-testid="chat-review"
      onClick={() => {
        const item = `${encodeURIComponent(type)}/${encodeURIComponent(name)}`;
        navigate(setupMetadataStudioPath(item, 'review=1') ?? `/apps/setup/metadata/${item}?review=1`);
      }}
    />
  );
}

function Where() {
  const { pathname, search } = useLocation();
  return <span data-testid="where">{pathname + search}</span>;
}

function mount(start: string) {
  render(
    <MemoryRouter initialEntries={[start]}>
      <Where />
      <Routes>
        <Route
          path="/apps/setup/component/packages"
          element={
            <>
              <PackageDetailSheet pkg={PACKAGE_ROW} appBase="/apps/setup" open onOpenChange={() => {}} onChanged={() => {}} />
              <ChatReview type="permission" name={SET} />
            </>
          }
        />
        <Route path="/apps/setup/metadata/*" element={<SetupMetadataRoute />} />
        <Route path="/studio/~all/metadata/*" element={<StudioMetadataArea packageId={null} />} />
      </Routes>
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId('where').textContent ?? '';
const reviewPanel = () => screen.findByTestId('draft-review-panel', undefined, { timeout: 8000 });
const SET_ON_ALL_LEG = `/studio/~all/metadata/permission/${SET}`;
/** The matrix's grant cells of the set's one object (`hidden`: a modal sheet hides the page from the role tree). */
const leadCells = () => screen.findAllByRole('checkbox', { name: /^acme_lead /, hidden: true }, { timeout: 8000 });

beforeEach(() => {
  clientImpl = makeClient(DRAFT);
  // As builtinComponents registers it: the matrix is the set's own item page.
  registerMetadataResource({ type: 'permission', EditPage: PermissionMatrixEditPage });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) =>
      String(input).startsWith('/api/v1/meta/_drafts')
        ? respond({ success: true, data: { drafts: [{ type: 'permission', name: SET }] } })
        : respond({ success: true, data: {} }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** The review is open on the matrix: the draft's grant against the published one. */
async function expectSetReview() {
  const panel = await reviewPanel();
  expect(screen.getByText(t('designer.draftReview.title', 'en'))).toBeInTheDocument();
  expect(within(panel).getByText('objects')).toBeInTheDocument();
  expect(within(panel).queryByText('label')).toBeNull();
  // The matrix is the page under it, still editable, read by name: the
  // address names no package.
  const cells = await leadCells();
  expect(cells.length).toBeGreaterThan(0);
  for (const cell of cells) expect(cell).toBeEnabled();
  expect(clientImpl.getDraft).toHaveBeenCalledWith('permission', SET, {});
  // `?review=1` leaves the address once the review is open.
  await waitFor(() => expect(where()).toBe(SET_ON_ALL_LEG));
}

describe('both producers of a review link reach a permission set\'s draft review (objectstack#37269)', () => {
  it('the Packages page\'s per-draft link opens the matrix with the review shown', async () => {
    mount('/apps/setup/component/packages');
    const link = await screen.findByRole('link', { name: new RegExp(SET) }, { timeout: 8000 });
    expect(link).toHaveAttribute('href', `/apps/setup/metadata/permission/${SET}?review=1`);
    fireEvent.click(link);
    await expectSetReview();
  });

  it('the chat\'s 「Review N change(s)」 opens the matrix with the review shown', async () => {
    mount('/apps/setup/component/packages');
    fireEvent.click(screen.getByTestId('chat-review'));
    await expectSetReview();
  });

  it('CONTROL: the same page without `?review=1` opens no review', async () => {
    mount(`/apps/setup/metadata/permission/${SET}`);
    await leadCells();
    expect(where()).toBe(SET_ON_ALL_LEG);
    expect(screen.queryByTestId('draft-review-panel')).toBeNull();
    // The routed matrix reads no draft at all without a package or a review.
    expect(clientImpl.getDraft).not.toHaveBeenCalled();
  });

  it('a set with no pending draft opens no review, and the address still drops `?review=1`', async () => {
    clientImpl = makeClient(null);
    mount(`/apps/setup/metadata/permission/${SET}?review=1`);
    await waitFor(() => expect(where()).toBe(SET_ON_ALL_LEG), { timeout: 8000 });
    await leadCells();
    expect(screen.queryByTestId('draft-review-panel')).toBeNull();
  });
});
