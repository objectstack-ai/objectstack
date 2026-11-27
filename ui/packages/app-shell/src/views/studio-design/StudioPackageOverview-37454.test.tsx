// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37454 — 概览 Overview, the open package's own page (ADR-0084,
 * amended 2026-11-26), in its thin build:
 *
 *  1. The header: the package's name, a 系统自带 (with a lock) or 可写 chip from
 *     the server's writable verdict, a 使用中 or 已停用 chip from the row's
 *     `enabled`, the description, and the ⋯ package menu — moved here from
 *     the top bar, which no longer draws it.
 *  2. 信息 Info: the business fields, read-only, with id, namespace and type
 *     folded away.
 *  3. 待发布 Pending: the changes panel drawn in place, wired exactly as the
 *     top bar's review sheet is — the same publish, the same drafts, the same
 *     entry notes, the same read-only gate. (What a publish from it says is
 *     pinned through both doors in `StudioDesignSurface.publishCount-11807`.)
 *  4. A read-only package keeps its posture: 系统自带 with a lock, no Publish
 *     from either door.
 *  5. The overview's branch order: an unknown package lands on the surface's
 *     not-found state, not on an overview; the package-less scope's
 *     `~org/overview` redirects to its area; inside the page, the row read's
 *     loading state (announced) comes before its failure, which comes before
 *     the fields.
 *
 * The REAL `StudioDesignSurface`, metadata client and permission provider over
 * a fetch stub serving the package list and the package's drafts.
 * `DraftChangesPanel` is a probe recording each mount's props, so the two
 * doors' wiring is compared prop by prop; the panel's embedded drawing has its
 * own pins (`../../preview/__tests__/DraftChangesPanel.posture-12517.test.tsx`).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
// The surface's reach loads `@objectstack/lint` lazily; pay that load during
// collection, not inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';
// The surface mounts the command palette, which reaches the record preview's
// `lazy()` detail entry: its first load is paid at collection too.
import '@object-ui/plugin-detail';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

let localeFixture: 'en-US' | 'zh-CN' = 'en-US';
vi.mock('../metadata-admin/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => localeFixture,
}));
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

/** Each mounted panel's latest props: the top bar's sheet, and the Pending tab's (`embedded`). */
const panels: { sheet: Record<string, unknown> | null; embedded: Record<string, unknown> | null } = { sheet: null, embedded: null };
vi.mock('../../preview/DraftChangesPanel', () => ({
  DraftChangesPanel: (props: Record<string, unknown>) => {
    if (props.embedded) panels.embedded = props;
    else panels.sheet = props;
    return props.embedded ? <div data-testid="pending-panel-probe" /> : null;
  },
}));

import { StudioDesignSurface } from './StudioDesignSurface';
import { StudioPillarRedirect } from './StudioPillarRedirect';
import { t, tFormat } from '../metadata-admin/i18n';
import { STUDIO_PACKAGE_MENU_ITEMS } from './StudioPackageMenu';
import { StudioPackageOverviewPage } from './StudioPackageOverviewPage';
import { studioOrgScopePath } from './studioScope';

const OWN = 'com.example.sales';
const INSTALLED = 'com.vendor.crm';
const PAUSED = 'com.example.paused';

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const PACKAGE_LIST = {
  success: true,
  data: [
    {
      manifest: { id: OWN, name: 'Sales', namespace: 'sales', version: '0.1.0', type: 'app', description: 'Pipeline and orders' },
      writable: true,
      enabled: true,
      source: 'authored',
    },
    {
      manifest: { id: INSTALLED, name: 'Vendor CRM', namespace: 'vcrm', version: '2.0.0', type: 'app' },
      writable: false,
      enabled: true,
      source: 'marketplace',
    },
    {
      manifest: { id: PAUSED, name: 'Paused', namespace: 'paused', version: '1.0.0', type: 'module' },
      writable: true,
      enabled: false,
      source: 'authored',
    },
  ],
};

/** Each package's pending drafts. */
let drafts: Record<string, Array<{ type: string; name: string }>> = {};

beforeEach(() => {
  localeFixture = 'en-US';
  panels.sheet = null;
  panels.embedded = null;
  drafts = { [OWN]: [{ type: 'object', name: 'sales_lead' }, { type: 'flow', name: 'notify' }] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname;
      if (path === '/api/v1/packages') return json(PACKAGE_LIST);
      if (path === '/api/v1/meta/_drafts') return json({ drafts: drafts[url.searchParams.get('package') ?? ''] ?? [] });
      if (path.endsWith('/layers')) return json({ code: null, overlay: null, overlayScope: null, effective: null });
      if (/^\/api\/v1\/meta\/[^/]+\/[^/]+$/.test(path)) return json({}, 404);
      return json([]);
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function answer(held: string[]): MePermissionsAuthenticatedResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: null,
    positions: [],
    hasAnyQueue: false,
    objectsUsingQueues: [],
    permissionSets: [],
    systemPermissions: held,
    objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    fields: {},
  } as MePermissionsAuthenticatedResponse;
}

const AUTHOR = answer(['studio.access', 'manage_metadata', 'setup.access', 'manage_platform_settings']);
const STUDIO_ONLY = answer(['studio.access']);

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderAt(entry: string, perms = AUTHOR) {
  return render(
    <MePermissionsProvider initialPermissions={perms}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/studio/:packageId/metadata/*" element={<StudioDesignSurface area="metadata" />} />
          <Route
            path="/studio/:packageId/:tab"
            element={
              <>
                <StudioPillarRedirect>
                  <StudioDesignSurface />
                </StudioPillarRedirect>
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </MePermissionsProvider>,
  );
}

const overviewHeader = () => screen.getByTestId('studio-package-overview-header');
/** objectstack#37456 — the top bar is gone; the left column's top rows stand where it was. */
const topLeft = () => screen.getByTestId('studio-top-left');

/** The overview has read its row: the Info card lists its fields. */
async function overviewRead(name: string) {
  await waitFor(() => expect(screen.getByTestId('studio-overview-field-name')).toHaveTextContent(name), { timeout: 8000 });
}

// ---------------------------------------------------------------------------
// 1. The header
// ---------------------------------------------------------------------------

describe('the overview header: name, two chips, the description, and the ⋯ menu (objectstack#37454)', () => {
  it.each(['en-US', 'zh-CN'] as const)('%s: a writable package in use', async (locale) => {
    localeFixture = locale;
    renderAt(`/studio/${OWN}/overview`);
    await overviewRead('Sales');
    const header = overviewHeader();
    expect(within(header).getByTestId('studio-overview-title')).toHaveTextContent('Sales');
    await waitFor(() => expect(within(header).getByTestId('studio-overview-chip-access')).toHaveAttribute('data-writable', 'true'));
    expect(within(header).getByTestId('studio-overview-chip-access')).toHaveTextContent(
      t('engine.studio.overview.chip.writable', locale),
    );
    expect(within(header).getByTestId('studio-overview-chip-state')).toHaveTextContent(t('engine.studio.overview.chip.enabled', locale));
    expect(within(header).getByTestId('studio-overview-description')).toHaveTextContent('Pipeline and orders');
    if (locale === 'zh-CN') {
      expect(within(header).getByTestId('studio-overview-chip-access')).toHaveTextContent('可写');
      expect(within(header).getByTestId('studio-overview-chip-state')).toHaveTextContent('使用中');
    }
  });

  it.each(['en-US', 'zh-CN'] as const)('%s: a read-only package reads 系统自带, with a lock', async (locale) => {
    localeFixture = locale;
    renderAt(`/studio/${INSTALLED}/overview`);
    await overviewRead('Vendor CRM');
    await waitFor(() => expect(within(overviewHeader()).getByTestId('studio-overview-chip-access')).toHaveAttribute('data-writable', 'false'));
    const chip = within(overviewHeader()).getByTestId('studio-overview-chip-access');
    expect(chip).toHaveTextContent(t('engine.studio.overview.chip.readOnly', locale));
    expect(chip.querySelector('svg')).not.toBeNull();
    expect(chip).toHaveAttribute('title', t('engine.studio.pkg.readonlyHint', locale));
    if (locale === 'zh-CN') expect(chip).toHaveTextContent('系统自带');
  });

  it('a disabled package reads 已停用; CONTROL: the writable chip is unchanged', async () => {
    localeFixture = 'zh-CN';
    renderAt(`/studio/${PAUSED}/overview`);
    await overviewRead('Paused');
    expect(within(overviewHeader()).getByTestId('studio-overview-chip-state')).toHaveTextContent('已停用');
    await waitFor(() => expect(within(overviewHeader()).getByTestId('studio-overview-chip-access')).toHaveTextContent('可写'));
  });

  it('the ⋯ menu is in the header with its six rows; the left column draws none', async () => {
    renderAt(`/studio/${OWN}/overview`);
    await overviewRead('Sales');
    const trigger = await within(overviewHeader()).findByTestId('studio-package-menu', undefined, { timeout: 8000 });
    expect(within(topLeft()).queryByTestId('studio-package-menu')).toBeNull();
    expect(screen.getAllByTestId('studio-package-menu')).toHaveLength(1);
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const content = await screen.findByTestId('studio-package-menu-content');
    expect(within(content).getAllByRole('menuitem').map((i) => i.getAttribute('data-testid'))).toEqual(
      STUDIO_PACKAGE_MENU_ITEMS.map((id) => `studio-package-menu-${id}`),
    );
  });

  it('CONTROL: no ⋯ for a user without manage_metadata; the header is still drawn', async () => {
    renderAt(`/studio/${OWN}/overview`, STUDIO_ONLY);
    await overviewRead('Sales');
    expect(within(overviewHeader()).queryByTestId('studio-package-menu')).toBeNull();
    expect(within(overviewHeader()).getByTestId('studio-overview-title')).toHaveTextContent('Sales');
  });
});

// ---------------------------------------------------------------------------
// 2. 信息 Info
// ---------------------------------------------------------------------------

describe('the Info tab: business fields, technical ones folded away (objectstack#37454)', () => {
  it.each(['en-US', 'zh-CN'] as const)('%s: name, description, source and version; id, namespace and type folded', async (locale) => {
    localeFixture = locale;
    renderAt(`/studio/${OWN}/overview`);
    await overviewRead('Sales');
    expect(screen.getByTestId('studio-package-overview')).toHaveAttribute('data-tab', 'info');
    expect(screen.getByTestId('studio-overview-field-description')).toHaveTextContent('Pipeline and orders');
    expect(screen.getByTestId('studio-overview-field-source')).toHaveTextContent(t('engine.packages.source.authored', locale));
    expect(screen.getByTestId('studio-overview-field-version')).toHaveTextContent('0.1.0');
    const technical = screen.getByTestId('studio-overview-technical') as HTMLDetailsElement;
    expect(technical.tagName).toBe('DETAILS');
    expect(technical.open).toBe(false);
    expect(within(technical).getByTestId('studio-overview-field-id')).toHaveTextContent(OWN);
    expect(within(technical).getByTestId('studio-overview-field-namespace')).toHaveTextContent('sales');
    expect(within(technical).getByTestId('studio-overview-field-type')).toHaveTextContent('app');
    // Read-only: the Info tab offers nothing to type into.
    expect(within(screen.getByTestId('studio-overview-info')).queryAllByRole('textbox')).toEqual([]);
  });

  it('a read-only package says so beside its source', async () => {
    renderAt(`/studio/${INSTALLED}/overview`);
    await overviewRead('Vendor CRM');
    await waitFor(() =>
      expect(screen.getByTestId('studio-overview-field-source')).toHaveTextContent(
        tFormat('engine.studio.overview.readOnlySource', 'en-US', { source: t('engine.packages.source.marketplace', 'en-US') }),
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// 3. 待发布 Pending
// ---------------------------------------------------------------------------

describe('the Pending tab: the changes panel in place, wired as the top bar’s (objectstack#37454)', () => {
  it('the tab carries the pending count, and opening it puts `?tab=pending` in the address', async () => {
    renderAt(`/studio/${OWN}/overview`);
    await overviewRead('Sales');
    await waitFor(() => expect(screen.getByTestId('studio-overview-tab-pending-count')).toHaveTextContent('2'), { timeout: 8000 });
    expect(screen.queryByTestId('pending-panel-probe')).toBeNull();
    fireEvent.click(screen.getByTestId('studio-overview-tab-pending'));
    expect(await screen.findByTestId('pending-panel-probe')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(`/studio/${OWN}/overview?tab=pending`);
    expect(screen.getByTestId('studio-overview-tab-pending')).toHaveAttribute('aria-pressed', 'true');
  });

  it('CONTROL: with nothing pending the tab carries no number', async () => {
    drafts = {};
    renderAt(`/studio/${OWN}/overview`);
    await overviewRead('Sales');
    await waitFor(() => expect(panels.sheet).not.toBeNull());
    expect(screen.queryByTestId('studio-overview-tab-pending-count')).toBeNull();
  });

  it('the embedded panel gets the top bar sheet’s publish, drafts, notes and pair, prop for prop', async () => {
    renderAt(`/studio/${OWN}/overview?tab=pending`);
    await screen.findByTestId('pending-panel-probe', undefined, { timeout: 8000 });
    await waitFor(() => expect(panels.sheet?.onPublish).toBeTypeOf('function'));
    const embedded = panels.embedded!;
    const sheet = panels.sheet!;
    expect(embedded.open).toBe(true);
    for (const prop of ['onPublish', 'packageId', 'renderEntryNote', 'customizationOf', 'publishing', 'include'] as const) {
      expect(embedded[prop], prop).toBe(sheet[prop]);
    }
    expect(embedded.packageId).toBe(OWN);
  });

  it('a read-only package keeps its posture: neither door offers Publish', async () => {
    renderAt(`/studio/${INSTALLED}/overview?tab=pending`);
    await screen.findByTestId('pending-panel-probe', undefined, { timeout: 8000 });
    await waitFor(() => expect(within(overviewHeader()).getByTestId('studio-overview-chip-access')).toHaveAttribute('data-writable', 'false'));
    await waitFor(() => expect(panels.sheet?.onPublish).toBeUndefined());
    expect(panels.embedded?.onPublish).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. The branch order
// ---------------------------------------------------------------------------

/** The page alone, with its address printed outside it. */
function renderPage(entry = `/studio/${OWN}/overview`) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <StudioPackageOverviewPage
        packageId={OWN}
        packageName="Sales"
        writable
        apps={[]}
        app={null}
        pendingCount={null}
        locale="en-US"
        menu={null}
        pending={null}
        refreshKey={0}
        beforeNavigate={() => true}
        navigate={() => {}}
      />
      <Where />
    </MemoryRouter>,
  );
}

/**
 * The surface with its address printed outside the routes, so a redirect that
 * leaves the route is still read. `bare` mounts the surface without the
 * pillar redirect in front of it, to read the surface's own guard.
 */
function renderSurfaceAt(entry: string, { bare = false } = {}) {
  return render(
    <MePermissionsProvider initialPermissions={AUTHOR}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/studio/:packageId/metadata/*" element={<StudioDesignSurface area="metadata" />} />
          <Route
            path="/studio/:packageId/:tab"
            element={
              bare ? (
                <StudioDesignSurface />
              ) : (
                <StudioPillarRedirect>
                  <StudioDesignSurface />
                </StudioPillarRedirect>
              )
            }
          />
        </Routes>
        <Where />
      </MemoryRouter>
    </MePermissionsProvider>,
  );
}

describe('the overview\'s branch order (objectstack#37454)', () => {
  it('the row read fails: the failure is said in place of the fields; the header stays', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ success: false, error: { message: 'list is down' } }, 503)) as unknown as typeof fetch,
    );
    renderPage();
    const failed = await screen.findByTestId('studio-overview-load-failed', undefined, { timeout: 8000 });
    expect(failed).toHaveAttribute('role', 'alert');
    expect(failed).toHaveTextContent(tFormat('engine.studio.overview.loadFailed', 'en-US', { error: '' }).replace(/\s*$/, ''));
    expect(screen.queryByTestId('studio-overview-loading')).toBeNull();
    expect(screen.queryByTestId('studio-overview-field-name')).toBeNull();
    expect(screen.getByTestId('studio-overview-title')).toHaveTextContent('Sales');
  });

  it('the row read still on the wire: an announced loading row, neither a failure nor fields; CONTROL: once it answers, the fields', async () => {
    let answer!: (r: Response) => void;
    const wire = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    vi.stubGlobal('fetch', vi.fn(() => wire) as unknown as typeof fetch);
    renderPage();
    const loading = screen.getByTestId('studio-overview-loading');
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading).toHaveTextContent(t('engine.studio.overview.loading', 'en-US'));
    expect(screen.queryByTestId('studio-overview-load-failed')).toBeNull();
    expect(screen.queryByTestId('studio-overview-field-name')).toBeNull();

    answer(json(PACKAGE_LIST));
    await waitFor(() => expect(screen.getByTestId('studio-overview-field-name')).toHaveTextContent('Sales'));
    expect(screen.queryByTestId('studio-overview-loading')).toBeNull();
  });

  it('an unknown package at its overview address lands on the not-found state, not on an overview', async () => {
    renderSurfaceAt('/studio/com.nowhere.pkg/overview');
    expect(await screen.findByTestId('studio-package-not-found', undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByTestId('studio-package-overview')).toBeNull();
    expect(screen.queryByTestId('studio-package-menu')).toBeNull();
  });

  // Two doors stand in front of it: the pillar redirect, which sends every
  // `~org` address but Automations to the scope's area, and the surface's own
  // guard behind it. Each is read on its own.
  it.each([
    ['through the route as the console mounts it', false],
    ['the surface alone: its own guard', true],
  ])('the package-less scope has no overview: ~org/overview redirects to its area (%s)', async (_door, bare) => {
    renderSurfaceAt('/studio/~org/overview', { bare });
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(studioOrgScopePath()), { timeout: 8000 });
    expect(screen.queryByTestId('studio-package-overview')).toBeNull();
    expect(screen.queryByTestId('studio-package-menu')).toBeNull();
  });
});
