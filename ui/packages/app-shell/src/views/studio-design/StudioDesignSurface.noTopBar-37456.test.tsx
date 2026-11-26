// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37456 — ACCEPTANCE: Studio has no top bar, and every tenant the
 * bar held is reached at its new home (ADR-0084, amended 2026-11-26,
 * `#amendment-2026-11-26-homes`, the seven-row table), walked on the real
 * surface:
 *
 *  1. The way back: the first control of the package row, the open package
 *     named by the switcher beside it; a package picked there opens on 概览.
 *  2. The ⋯ package menu: 概览 Overview's header, not the left column.
 *  3. Changes with its count, and Publish: the count is the badge on the
 *     menu's 概览 row; one click opens the Pending tab, whose Publish sends the
 *     package's one publish request.
 *  4. Save and Cancel: the item header (pinned on this bar-less surface by
 *     `StudioDesignSurface.saveBar-36511`).
 *  5. The AI assistant and the right panel's toggle: the end of the page's
 *     title row (`StudioDesignSurface.rightSlot-12725`), and, on a page with
 *     none, the title-row fallback (`StudioTopLeft-37456`).
 *  6. The menu's show / hide control: Studio's row; under 768 px, the strip
 *     above the page, since the rows live inside the drawer there.
 *  7. 「Create app」 and its 「waits for a publish」 label: no home (silent item
 *     5) — drawn nowhere.
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

/**
 * The changes panel, as a probe: the Pending tab's (`embedded`) draws a Publish
 * that fires the `onPublish` the surface hands it, so the walk reaches the
 * package's publish request itself.
 */
vi.mock('../../preview/DraftChangesPanel', () => ({
  DraftChangesPanel: (props: { embedded?: boolean; onPublish?: () => void }) =>
    props.embedded ? (
      <div data-testid="pending-panel-probe">
        {props.onPublish ? (
          <button type="button" data-testid="pending-panel-publish" onClick={() => props.onPublish?.()}>
            Publish
          </button>
        ) : null}
      </div>
    ) : null,
}));

import { StudioDesignSurface } from './StudioDesignSurface';
import { StudioPillarRedirect } from './StudioPillarRedirect';
import { t } from '../metadata-admin/i18n';

const OWN = 'com.example.sales';
const INSTALLED = 'com.vendor.crm';

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
  ],
};

/** The paths of the POSTs the surface sent. */
let posts: string[] = [];

/** Each package's pending drafts. */
let drafts: Record<string, Array<{ type: string; name: string }>> = {};

beforeEach(() => {
  localeFixture = 'en-US';
  posts = [];
  window.innerWidth = 1280;
  drafts = { [OWN]: [{ type: 'object', name: 'sales_lead' }, { type: 'flow', name: 'notify' }] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname;
      if (init?.method === 'POST') posts.push(path);
      if (path.endsWith('/publish-drafts')) return json({ success: true, data: { published: 2 } });
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

const topLeft = () => screen.getByTestId('studio-top-left');

/** The surface has read the package list: the switcher names the open package. */
async function settled(name: string) {
  await waitFor(() => expect(screen.getByTestId('studio-pkg-switcher-name')).toHaveTextContent(name), { timeout: 8000 });
}

describe('Studio has no top bar; every tenant at its new home (objectstack#37456)', () => {
  it('no top bar on a pillar nor on 概览; CONTROL: the left column\'s two rows are drawn', async () => {
    renderAt(`/studio/${OWN}/data`);
    await settled('Sales');
    expect(screen.queryByTestId('studio-shell-header')).toBeNull();
    expect(screen.queryByRole('banner')).toBeNull();
    expect(within(topLeft()).getByTestId('studio-brand-row')).toBeInTheDocument();
    expect(within(topLeft()).getByTestId('studio-package-row')).toBeInTheDocument();
    cleanup();
    renderAt(`/studio/${OWN}/overview`);
    await settled('Sales');
    expect(screen.queryByTestId('studio-shell-header')).toBeNull();
  });

  it('1 + 6: the way back leads the package row; the one menu toggle is in Studio\'s row', async () => {
    renderAt(`/studio/${OWN}/data`);
    await settled('Sales');
    const row = within(topLeft()).getByTestId('studio-package-row');
    expect(within(row).getAllByRole('button')[0]).toBe(within(row).getByTestId('studio-package-back'));
    expect(within(row).getByTestId('studio-pkg-switcher')).toBeInTheDocument();
    const toggles = screen.getAllByTestId('studio-menu-toggle');
    expect(toggles).toHaveLength(1);
    expect(within(screen.getByTestId('studio-brand-row')).getByTestId('studio-menu-toggle')).toBe(toggles[0]);
    expect(screen.queryByTestId('studio-mobile-strip')).toBeNull();
  });

  it('6: under 768 px the strip above the page holds the drawer control, and it opens the drawer', async () => {
    window.innerWidth = 390;
    renderAt(`/studio/${OWN}/data`);
    const strip = await screen.findByTestId('studio-mobile-strip', undefined, { timeout: 8000 });
    expect(screen.queryByTestId('studio-top-left')).toBeNull();
    fireEvent.click(within(strip).getByTestId('studio-menu-toggle'));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByTestId('studio-top-left')).toBeInTheDocument();
    expect(within(drawer).getByTestId('studio-package-back')).toBeInTheDocument();
  });

  it('1: picking a package in the switcher opens it on its 概览 (ADR-0084, amended 2026-11-26)', async () => {
    renderAt(`/studio/${OWN}/data`);
    await settled('Sales');
    fireEvent.click(screen.getByTestId('studio-pkg-switcher'));
    const menu = await screen.findByTestId('studio-pkg-switcher-menu');
    const row = await waitFor(() => {
      const el = menu.querySelector(`[data-package="${INSTALLED}"]`);
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    fireEvent.click(row);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/studio/${INSTALLED}/overview`));
  });

  it('2: the ⋯ menu is in 概览\'s header, and nowhere in the left column', async () => {
    renderAt(`/studio/${OWN}/overview`);
    await settled('Sales');
    const header = await screen.findByTestId('studio-package-overview-header', undefined, { timeout: 8000 });
    await waitFor(() => expect(within(header).getByTestId('studio-package-menu')).toBeInTheDocument());
    expect(screen.getAllByTestId('studio-package-menu')).toHaveLength(1);
    expect(within(topLeft()).queryByTestId('studio-package-menu')).toBeNull();
  });

  it('3: the count is 概览\'s badge; one click opens Pending, and its Publish sends the package publish', async () => {
    renderAt(`/studio/${OWN}/data`);
    await settled('Sales');
    const badge = await screen.findByTestId('studio-menu-overview-pending', undefined, { timeout: 8000 });
    await waitFor(() => expect(badge).toHaveTextContent('2'));
    expect(screen.queryByTestId('studio-changes-count')).toBeNull();
    fireEvent.click(badge);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/studio/${OWN}/overview?tab=pending`));
    const panel = await screen.findByTestId('pending-panel-probe', undefined, { timeout: 8000 });
    fireEvent.click(within(panel).getByTestId('pending-panel-publish'));
    await waitFor(() => expect(posts).toContain(`/api/v1/packages/${encodeURIComponent(OWN)}/publish-drafts`));
  });

  it('3, CONTROL: a read-only package\'s Pending offers no Publish', async () => {
    drafts = { [INSTALLED]: [{ type: 'object', name: 'vcrm_deal' }] };
    renderAt(`/studio/${INSTALLED}/overview?tab=pending`);
    const panel = await screen.findByTestId('pending-panel-probe', undefined, { timeout: 8000 });
    expect(within(panel).queryByTestId('pending-panel-publish')).toBeNull();
  });

  it('7: 「Create app」 and its pending label are drawn nowhere, for a package with no app', async () => {
    renderAt(`/studio/${OWN}/data`);
    await settled('Sales');
    expect(screen.queryByRole('button', { name: t('engine.studio.app.create', 'en') })).toBeNull();
    expect(screen.queryByText(t('engine.studio.app.create', 'en'))).toBeNull();
  });
});
