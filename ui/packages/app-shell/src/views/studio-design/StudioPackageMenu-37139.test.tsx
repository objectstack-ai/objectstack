// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37139 — the 「⋯」 package menu: the door to the Packages page's
 * development-face actions now that the Studio home is gone.
 *
 * objectstack#37454 — re-pointed: the menu moved from the top bar's left end
 * to 概览 Overview's header (ADR-0084, amended 2026-11-26), its six rows as
 * they were. Every case below reads it there; case 1 also pins that the top
 * bar no longer draws it.
 *
 *  1. A `manage_metadata` holder on a package's overview sees it, at the end
 *     of the header, with the maintainer's six items in the table's order, in en
 *     and zh-CN.
 *  2. Each item's greyed state: on a read-only package Edit package info,
 *     Duplicate, Revert and Adopt are greyed (the server refuses each there);
 *     Revert is greyed too while nothing has changed since the last publish.
 *     Export and Manage in Setup… are never greyed.
 *  3. No 「⋯」 on `~org` or `~all` (no current package): its one home, a
 *     package's overview, is not drawn there at its own address. None for a
 *     user without `manage_metadata`.
 *  4. Each item does what the development face's action does: the same door,
 *     the same confirmation, the same answer; Manage in Setup… opens Setup →
 *     Packages on this package's row.
 *  5. The menu and the development face's sheet share one copy of each
 *     action (`metadata-admin/packageActions.tsx`), read off the source.
 *
 * The REAL `StudioDesignSurface`, metadata client and permission provider over
 * a fetch stub that serves the package list, the package's drafts and the
 * package doors, recording every write.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// The surface's reach loads `@objectstack/lint` lazily; pay that load during
// collection, not inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';
// The surface mounts the command palette, which reaches the record preview's
// `lazy()` detail entry: its first load is paid at collection too.
import '@object-ui/plugin-detail';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import { StudioEntryPermissionsProvider } from './studioEntryPermissions';
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
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { toast } from 'sonner';
import { StudioDesignSurface } from './StudioDesignSurface';
import { StudioPillarRedirect } from './StudioPillarRedirect';
import { t, tFormat } from '../metadata-admin/i18n';
import { setupPackagePath } from '../metadata-admin/packageSource';
import { STUDIO_PACKAGE_MENU_ITEMS } from './StudioPackageMenu';

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

interface Write {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

const srv = {
  /** The open package's pending drafts. */
  drafts: [] as Array<{ type: string; name: string }>,
  writes: [] as Write[],
  exports: 0,
};

const PACKAGE_LIST = {
  success: true,
  data: [
    {
      manifest: { id: OWN, name: 'Sales', namespace: 'sales', version: '0.1.0', type: 'app', scope: 'project', description: 'Pipeline' },
      writable: true,
      source: 'authored',
    },
    {
      manifest: { id: INSTALLED, name: 'Vendor CRM', namespace: 'vcrm', version: '2.0.0', type: 'app' },
      writable: false,
      source: 'marketplace',
    },
  ],
};

beforeEach(() => {
  localeFixture = 'en-US';
  srv.drafts = [{ type: 'object', name: 'sales_lead' }];
  srv.writes = [];
  srv.exports = 0;
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method !== 'GET') {
        srv.writes.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null });
        if (path.endsWith('/revert')) {
          srv.drafts = [];
          return json({ success: true, data: { success: true } });
        }
        if (path.endsWith('/adopt-orphans')) return json({ success: true, data: { success: true, reassignedCount: 3, reassigned: [] } });
        if (path.endsWith('/duplicate')) return json({ success: true, data: { success: true, copiedCount: 2, failedCount: 0 } });
        return json({ success: true, data: {} });
      }
      if (path === '/api/v1/packages') return json(PACKAGE_LIST);
      if (path === `/api/v1/packages/${OWN}/export`) {
        srv.exports += 1;
        return json({ success: true, data: { manifest: { id: OWN } } });
      }
      if (path === '/api/v1/meta/_drafts') {
        const pkg = url.searchParams.get('package');
        return json({ drafts: pkg === OWN ? srv.drafts : [] });
      }
      if (path === '/api/v1/meta/app') return json([]);
      if (path === '/api/v1/meta/object') return json([]);
      if (path.endsWith('/layers')) return json({ code: null, overlay: null, overlayScope: null, effective: null });
      if (/^\/api\/v1\/meta\/[^/]+\/[^/]+$/.test(path)) return json({}, 404);
      return json([]);
    }) as unknown as typeof fetch,
  );
  // Export downloads a file: the browser half is stubbed, the request is real.
  URL.createObjectURL = vi.fn(() => 'blob:export');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A `/me/permissions` answer holding exactly `held`. */
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

function Elsewhere() {
  const location = useLocation();
  return <p data-testid="elsewhere">{`${location.pathname}${location.search}`}</p>;
}

function renderAt(entry: string, perms = AUTHOR) {
  // The console's Studio gate hands its pages the set it read (`StudioEntryPermissionsProvider`).
  return render(
    <MePermissionsProvider initialPermissions={perms}>
      <StudioEntryPermissionsProvider value={perms.systemPermissions}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/studio/:packageId/metadata/*" element={<StudioDesignSurface area="metadata" />} />
            <Route path="/studio/:packageId/:tab" element={<StudioPillarRedirect><StudioDesignSurface /></StudioPillarRedirect>} />
            <Route path="*" element={<Elsewhere />} />
          </Routes>
        </MemoryRouter>
      </StudioEntryPermissionsProvider>
    </MePermissionsProvider>,
  );
}

/** objectstack#37456 — no top bar: the left column's top rows, where the package is named. */
const header = () => screen.getByTestId('studio-top-left');
/** objectstack#37454 — 概览 Overview's header, where the menu lives now. */
const overviewHeader = () => screen.getByTestId('studio-package-overview-header');

/** The package name settles in the switcher (the list read answered). */
async function settledOn(name: string) {
  await waitFor(() => expect(within(header()).getByTestId('studio-pkg-switcher-name')).toHaveTextContent(name), {
    timeout: 8000,
  });
}

async function openMenu(): Promise<HTMLElement> {
  const trigger = await screen.findByTestId('studio-package-menu', undefined, { timeout: 8000 });
  expect(overviewHeader()).toContainElement(trigger);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByTestId('studio-package-menu-content');
}

const menuItem = (id: string) => screen.getByTestId(`studio-package-menu-${id}`);
const isGreyed = (id: string) => menuItem(id).hasAttribute('data-disabled');

/** Wait until the pending-changes count is read (概览's badge shows it). */
async function pendingRead(count: number) {
  if (count > 0) {
    await waitFor(() => expect(screen.getByTestId('studio-menu-overview-pending')).toHaveTextContent(String(count)), {
      timeout: 8000,
    });
  }
}

// ---------------------------------------------------------------------------
// 1. Where it is and what it holds
// ---------------------------------------------------------------------------

const LABELS: Record<'en-US' | 'zh-CN', string[]> = {
  'en-US': ['Edit package info', 'Export', 'Duplicate as a new package', 'Revert to last publish', 'Adopt loose items', 'Manage in Setup…'],
  'zh-CN': ['编辑软件包信息', '导出', '复制为新软件包', '还原到上次发布', '收编散落项', '在设置中管理…'],
};

describe('the 「⋯」 package menu: in the overview header, six items in the table’s order (objectstack#37139, objectstack#37454)', () => {
  it.each(['en-US', 'zh-CN'] as const)('%s: a manage_metadata holder sees it in the overview header, and not in the left column', async (locale) => {
    localeFixture = locale;
    renderAt(`/studio/${OWN}/overview`);
    await settledOn('Sales');
    const trigger = await within(overviewHeader()).findByTestId('studio-package-menu', undefined, { timeout: 8000 });
    expect(trigger).toHaveAccessibleName(locale === 'zh-CN' ? '软件包操作' : 'Package actions');
    // objectstack#37454 — moved: the left column (and, objectstack#37456, no top bar) draws none.
    expect(within(header()).queryByTestId('studio-package-menu')).toBeNull();
    expect(screen.getAllByTestId('studio-package-menu')).toHaveLength(1);
    // The last control of the header's title row.
    const titleRow = within(overviewHeader()).getByTestId('studio-overview-title').parentElement!;
    const order = [...titleRow.querySelectorAll('[data-testid]')].map((n) => n.getAttribute('data-testid'));
    expect(order.indexOf('studio-package-menu')).toBeGreaterThan(order.indexOf('studio-overview-title'));

    const content = await openMenu();
    const items = within(content).getAllByRole('menuitem');
    expect(items.map((i) => i.getAttribute('data-testid'))).toEqual(
      STUDIO_PACKAGE_MENU_ITEMS.map((id) => `studio-package-menu-${id}`),
    );
    expect(items.map((i) => i.textContent?.trim())).toEqual(LABELS[locale]);
    // No 「发布全部草稿」: the top bar's Changes / Publish already do it.
    expect(content.textContent).not.toMatch(locale === 'zh-CN' ? /发布全部|草稿/ : /Publish all|draft/i);
  });
});

// ---------------------------------------------------------------------------
// 2. Each item's greyed state
// ---------------------------------------------------------------------------

describe('which items are greyed (objectstack#37139)', () => {
  it.each(['en-US', 'zh-CN'] as const)('%s: a writable package with changes greys nothing', async (locale) => {
    localeFixture = locale;
    renderAt(`/studio/${OWN}/overview`);
    await settledOn('Sales');
    await pendingRead(1);
    await openMenu();
    for (const id of STUDIO_PACKAGE_MENU_ITEMS) expect(isGreyed(id), id).toBe(false);
  });

  it.each(['en-US', 'zh-CN'] as const)('%s: a read-only installed package greys Edit, Duplicate, Revert and Adopt, and says why', async (locale) => {
    localeFixture = locale;
    renderAt(`/studio/${INSTALLED}/overview`);
    await settledOn('Vendor CRM');
    // The writability verdict has landed when the surface reads read-only.
    await waitFor(() => expect(within(overviewHeader()).getByTestId('studio-package-menu')).toBeInTheDocument(), { timeout: 8000 });
    await openMenu();
    await waitFor(() => expect(isGreyed('edit')).toBe(true), { timeout: 8000 });
    expect({
      edit: isGreyed('edit'),
      export: isGreyed('export'),
      duplicate: isGreyed('duplicate'),
      revert: isGreyed('revert'),
      adopt: isGreyed('adopt'),
      manage: isGreyed('manage'),
    }).toEqual({ edit: true, export: false, duplicate: true, revert: true, adopt: true, manage: false });
    const reason = t('engine.studio.pkg.readonlyHint', locale);
    for (const id of ['edit', 'duplicate', 'revert', 'adopt']) {
      expect(menuItem(id)).toHaveAttribute('data-disabled-reason', reason);
    }
  });

  it.each(['en-US', 'zh-CN'] as const)('%s: with nothing changed since the last publish, only Revert is greyed', async (locale) => {
    localeFixture = locale;
    srv.drafts = [];
    renderAt(`/studio/${OWN}/overview`);
    await settledOn('Sales');
    await openMenu();
    await waitFor(() => expect(isGreyed('revert')).toBe(true), { timeout: 8000 });
    expect(menuItem('revert')).toHaveAttribute('data-disabled-reason', t('engine.studio.packageMenu.noChanges', locale));
    for (const id of ['edit', 'export', 'duplicate', 'adopt', 'manage']) expect(isGreyed(id), id).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Where there is none
// ---------------------------------------------------------------------------

describe('no 「⋯」 without a current package or without manage_metadata (objectstack#37139)', () => {
  // objectstack#37454 — the menu's one home is a package's overview, so the
  // check asks for the overview's own address on the two scopes: neither draws
  // it, so neither draws the menu. (Asked on their other pages it would pass
  // whatever the scopes did, the overview being absent there anyway.)
  it.each(['en-US', 'zh-CN'] as const)('%s: none on ~org/overview and none on ~all/overview', async (locale) => {
    localeFixture = locale;
    renderAt('/studio/~org/overview');
    await waitFor(() => expect(within(header()).getByTestId('studio-pkg-switcher-name')).toHaveTextContent(t('engine.studio.pkg.orgScope', locale)), {
      timeout: 8000,
    });
    expect(screen.queryByTestId('studio-package-overview')).toBeNull();
    expect(screen.queryByTestId('studio-package-menu')).toBeNull();
    cleanup();

    // objectstack#37565 — the cross-package leg draws no overview: its root is
    // Setup's directory page now, so `~all/overview` lands there…
    renderAt('/studio/~all/overview');
    expect(await screen.findByTestId('elsewhere', undefined, { timeout: 8000 })).toHaveTextContent(
      '/apps/setup/component/security/access-directory',
    );
    expect(screen.queryByTestId('studio-package-overview')).toBeNull();
    expect(screen.queryByTestId('studio-package-menu')).toBeNull();
    cleanup();

    // …and a page the leg still draws carries no 「⋯」 either.
    renderAt('/studio/~all/metadata/permission/admin?scope=environment');
    await waitFor(() => expect(within(header()).getByTestId('studio-pkg-switcher-name')).toHaveTextContent(t('engine.studio.menu.environment', locale)), {
      timeout: 8000,
    });
    expect(screen.queryByTestId('studio-package-overview')).toBeNull();
    expect(screen.queryByTestId('studio-package-menu')).toBeNull();
  });

  it.each(['en-US', 'zh-CN'] as const)('%s: none for a user without manage_metadata', async (locale) => {
    localeFixture = locale;
    renderAt(`/studio/${OWN}/overview`, STUDIO_ONLY);
    await settledOn('Sales');
    expect(within(overviewHeader()).getByTestId('studio-overview-title')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-package-menu')).toBeNull();
  });

  it('CONTROL: the same page with manage_metadata draws it', async () => {
    renderAt(`/studio/${OWN}/overview`, AUTHOR);
    await settledOn('Sales');
    expect(await within(overviewHeader()).findByTestId('studio-package-menu', undefined, { timeout: 8000 })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 4. Each item does what the development face's action does
// ---------------------------------------------------------------------------

describe('each item runs the development face’s action (objectstack#37139)', () => {
  it('Export reads the export door and downloads the file', async () => {
    renderAt(`/studio/${OWN}/overview`);
    await settledOn('Sales');
    await openMenu();
    fireEvent.click(menuItem('export'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(t('engine.packages.detail.exported', 'en-US')));
    expect(srv.exports).toBe(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(srv.writes).toEqual([]);
  });

  it('Revert asks first: Cancel sends nothing; confirm sends the revert', async () => {
    renderAt(`/studio/${OWN}/overview`);
    await settledOn('Sales');
    await pendingRead(1);
    await openMenu();
    fireEvent.click(menuItem('revert'));
    let dialog = await screen.findByTestId('studio-package-menu-revert-dialog');
    expect(within(dialog).getByRole('heading')).toHaveTextContent(
      tFormat('engine.studio.packageMenu.revertTitle', 'en-US', { name: 'Sales' }),
    );
    fireEvent.click(within(dialog).getByTestId('studio-package-menu-revert-cancel'));
    await waitFor(() => expect(screen.queryByTestId('studio-package-menu-revert-dialog')).toBeNull());
    expect(srv.writes).toEqual([]);

    await openMenu();
    fireEvent.click(menuItem('revert'));
    dialog = await screen.findByTestId('studio-package-menu-revert-dialog');
    fireEvent.click(within(dialog).getByTestId('studio-package-menu-revert-confirm'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(t('engine.packages.detail.reverted', 'en-US')));
    expect(srv.writes.map((w) => `${w.method} ${w.path}`)).toEqual([`POST /api/v1/packages/${OWN}/revert`]);
    // The pending count re-reads: nothing is left to publish.
    await waitFor(() => expect(screen.queryByTestId('studio-menu-overview-pending')).toBeNull(), { timeout: 8000 });
  });

  it('Adopt loose items asks first, then adopts and says how many moved', async () => {
    renderAt(`/studio/${OWN}/overview`);
    await settledOn('Sales');
    await openMenu();
    fireEvent.click(menuItem('adopt'));
    const dialog = await screen.findByTestId('pkg-detail-adopt-dialog');
    expect(srv.writes).toEqual([]);
    fireEvent.click(within(dialog).getByTestId('pkg-detail-adopt-confirm'));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(tFormat('engine.packages.detail.adoptedOther', 'en-US', { count: 3 })),
    );
    expect(srv.writes.map((w) => `${w.method} ${w.path}`)).toEqual([`POST /api/v1/packages/${OWN}/adopt-orphans`]);
  });

  it('Duplicate opens the development face’s form on 「Copy of NAME」 and `<id>-copy`, and sends the duplicate', async () => {
    renderAt(`/studio/${OWN}/overview`);
    await settledOn('Sales');
    await openMenu();
    fireEvent.click(menuItem('duplicate'));
    const dialog = await screen.findByTestId('studio-package-menu-duplicate-dialog');
    const form = within(dialog).getByTestId('pkg-detail-dup-form');
    expect(within(form).getByTestId('pkg-detail-dup-name-input')).toHaveValue(
      tFormat('engine.studio.landing.dupDefaultName', 'en-US', { name: 'Sales' }),
    );
    expect(within(form).getByTestId('pkg-detail-dup-id-input')).toHaveValue(`${OWN}-copy`);
    fireEvent.click(within(form).getByRole('button', { name: t('engine.packages.detail.duplicateGo', 'en-US') }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(t('engine.packages.detail.duplicated', 'en-US')));
    expect(srv.writes).toEqual([
      {
        method: 'POST',
        path: `/api/v1/packages/${OWN}/duplicate`,
        body: { targetPackageId: `${OWN}-copy`, targetName: tFormat('engine.studio.landing.dupDefaultName', 'en-US', { name: 'Sales' }) },
      },
    ]);
    await waitFor(() => expect(screen.queryByTestId('studio-package-menu-duplicate-dialog')).toBeNull());
  });

  it('Edit package info opens the development face’s Edit dialog on the listed manifest', async () => {
    renderAt(`/studio/${OWN}/overview`);
    await settledOn('Sales');
    await openMenu();
    fireEvent.click(menuItem('edit'));
    const dialog = await screen.findByRole('dialog', undefined, { timeout: 8000 });
    expect(within(dialog).getByRole('heading', { name: t('engine.packages.edit.title', 'en-US') })).toBeInTheDocument();
    expect(within(dialog).getByText(OWN)).toBeInTheDocument();
    expect(srv.writes).toEqual([]);
  });

  it('Manage in Setup… opens Setup → Packages on this package’s row', async () => {
    renderAt(`/studio/${OWN}/overview`);
    await settledOn('Sales');
    await openMenu();
    fireEvent.click(menuItem('manage'));
    expect(await screen.findByTestId('elsewhere')).toHaveTextContent(setupPackagePath(OWN));
    expect(setupPackagePath(OWN)).toBe(`/apps/setup/component/developer/packages?face=admin&package=${OWN}`);
  });
});

// ---------------------------------------------------------------------------
// 5. One copy of each action
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));

describe('the menu and the development face share one copy of each action (objectstack#37139)', () => {
  const menu = readFileSync(resolve(HERE, 'StudioPackageMenu.tsx'), 'utf8');
  const page = readFileSync(resolve(HERE, '../metadata-admin/PackagesPage.tsx'), 'utf8');
  const shared = ['revertPackage', 'exportPackageFile', 'adoptLooseItems', 'AdoptLooseItemsDialog', 'DuplicatePackageForm', 'EditPackageDialog'];

  it.each(shared)('%s comes from packageActions in both surfaces', (name) => {
    for (const source of [menu, page]) {
      const imported = source.match(/import \{([^}]*)\} from '(?:\.\.\/metadata-admin\/|\.\/)packageActions\.js';/)?.[1] ?? '';
      expect(imported.split(',').map((s) => s.trim())).toContain(name);
    }
  });

  it('neither surface spells the revert or adopt door itself', () => {
    for (const source of [menu, page]) {
      // A request spelled in place: `${…}/revert` in a template literal.
      expect(source).not.toMatch(/\}\/revert`|\}\/adopt-orphans`/);
    }
  });
});
