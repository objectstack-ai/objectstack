/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RecordDetailView's shared harness: the per-issue pins that render the real
 * `RecordDetailView` over the same chrome mocks, folded into one file
 * (objectstack#29469, the rollout of objectstack#25911's pilot).
 *
 * Each block below was its own file, named in its `describe`, with the same
 * eight mocks, declared once here: `@object-ui/auth` answering a signed-in
 * `Ada` with no active organization, `@object-ui/collaboration` with no
 * presence, `sonner`'s `toast` as spies, and the five pieces of orthogonal
 * chrome (`./ActionConfirmDialog`, `./ActionParamDialog`,
 * `./ActionResultDialog`, `./FlowRunner`, `./MetadataInspector`) drawing
 * nothing. Under the `dom` project's `isolate: true`, each of those files paid
 * the whole module graph's import again, and the import was nearly all of a
 * file's time. Here the graph loads once. Every block keeps its fixtures,
 * hooks and assertions as they were, and its issue number in its `describe`.
 *
 * Isolation between blocks:
 *  - React Testing Library's `cleanup()` runs after every test (the `dom`
 *    setup registers it).
 *  - Every fixture, data source and call log is declared inside its block,
 *    and a former file's module-level hooks are its block's own hooks, so the
 *    `fetch` stub a block installs is the one its tests see.
 *  - Every block's first line is `restoreAfterBlock()` (below). A former file
 *    got a fresh window, a fresh registry and fresh mocks; a block shares
 *    them with the blocks after it, so after its last test the helper puts
 *    back what the block left: registry entries, a swapped-in
 *    `localStorage`, the contents of both storages, the `lang` / `dir` that
 *    `I18nProvider` sets on `<html>`, the `innerWidth` / `innerHeight` a
 *    block pins, and the call history of the mocks above.
 *  - react-i18next's global instance, which a mounted `I18nProvider`
 *    installs, is put back after every test by `vitest.setup.i18n-global.ts`,
 *    so a block that mounts no provider still renders with none.
 *
 * A new `RecordDetailView` pin that renders over these eight mocks joins this
 * file as its own top-level `describe` that opens with `restoreAfterBlock()`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { PermissionProvider, MePermissionsProvider, type MePermissionsResponse, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import { MetadataCtx } from '@object-ui/react';
import { appSegmentOf } from '../console/home/appLastOpened';
import { recentItemObject } from '../console/home/recentItemTypeLabel';
import { NavigationProvider, useNavigationContext } from '../context/NavigationContext';
import { RecentItemsProvider, useRecentItems, type RecentItem } from '../context/RecentItemsProvider';
import { RecordDetailView } from './RecordDetailView';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

/**
 * Puts back, after the calling block's last test, what the block's hooks and
 * tests left behind, so the next block starts from the state its former file
 * started from: registry entries, a swapped-in `localStorage`, both storages'
 * contents, `<html lang>` / `dir`, `window.innerWidth` / `innerHeight`, and
 * the call history of the module mocks above. Several former files pin
 * `innerWidth` to a desktop width in a `beforeAll` and never take it back,
 * which a fresh window used to hide.
 *
 * Declared first in the block, so its `beforeAll` runs before the block's own
 * and its `afterAll` after them (Vitest runs after-hooks in reverse order).
 */
function restoreAfterBlock() {
  let registered = new Map<string, ReturnType<typeof ComponentRegistry.getConfig>>();
  let storage: PropertyDescriptor | undefined;
  let viewport: Record<'innerWidth' | 'innerHeight', PropertyDescriptor | undefined> = {
    innerWidth: undefined,
    innerHeight: undefined,
  };
  beforeAll(() => {
    registered = new Map(ComponentRegistry.getAllTypes().map((type) => [type, ComponentRegistry.getConfig(type)]));
    storage = Object.getOwnPropertyDescriptor(window, 'localStorage');
    viewport = {
      innerWidth: Object.getOwnPropertyDescriptor(window, 'innerWidth'),
      innerHeight: Object.getOwnPropertyDescriptor(window, 'innerHeight'),
    };
  });
  afterAll(() => {
    for (const type of ComponentRegistry.getAllTypes()) {
      if (!registered.has(type)) ComponentRegistry.unregister(type);
    }
    // Re-register each changed entry's own config; a bare key that falls back to
    // a namespaced one comes back with it.
    const restored = new Set<unknown>();
    for (const [type, config] of registered) {
      if (!config || ComponentRegistry.getConfig(type) === config || restored.has(config)) continue;
      restored.add(config);
      const { type: fullType, component, ...meta } = config;
      ComponentRegistry.register(meta.namespace ? fullType.slice(meta.namespace.length + 1) : fullType, component, meta);
    }
    if (storage) Object.defineProperty(window, 'localStorage', storage);
    window.localStorage.clear();
    window.sessionStorage.clear();
    for (const key of ['innerWidth', 'innerHeight'] as const) {
      const before = viewport[key];
      if (before) Object.defineProperty(window, key, before);
      else delete (window as unknown as Record<string, unknown>)[key];
    }
    document.documentElement.removeAttribute('lang');
    document.documentElement.removeAttribute('dir');
    vi.clearAllMocks();
  });
}

// ── RecordDetailView.recordsRecentVisit-12604 ───────────────────────────────

/**
 * objectui#12604 — opening a record page records the visit in the recent-items
 * store Home's "Recently accessed" and the sidebar read: the record, under the
 * title it was opened with, at the address it was opened at — which names the
 * app it was opened in and its object, the two the Home row's trail prints
 * ("Invoice · HotCRM · 10 minutes ago"; that rendering is pinned in
 * `HomePage.recentlyAccessed-12604.test.tsx`).
 *
 * Harness: `RecordDetailView.printAction-11958.test.tsx`'s, on a real
 * `RecentItemsProvider` and an `/apps/APP/OBJECT/record/ID` route.
 */

describe('RecordDetailView.recordsRecentVisit-12604', () => {
  restoreAfterBlock();

  const APP = 'com.acme.crm';
  const OBJECT = 'invoice_12604';
  const REC = 'INV-1';

  const objectDef = {
    name: OBJECT,
    label: 'Invoice',
    fields: { id: { label: 'Id', type: 'text' }, name: { label: 'Number', type: 'text' } },
  };

  function makeDataSource() {
    return {
      find: vi.fn(async () => ({ data: [], total: 0, hasMore: false, pageSize: 50 })),
      findOne: vi.fn(async () => ({ id: REC, name: 'INV-0001' })),
      create: vi.fn(async (_o: string, row: unknown) => row),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
      getObjectSchema: async () => objectDef,
    };
  }

  const metadata = {
    objects: [], pages: [], loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: async () => [], getItem: async () => null,
    getItemsByType: () => [],
  } as never;

  /** What the store holds, read from inside the provider after each commit. */
  const held: { items: RecentItem[] } = { items: [] };
  function StoreProbe() {
    const { recentItems } = useRecentItems();
    React.useEffect(() => {
      held.items = recentItems;
    }, [recentItems]);
    return null;
  }

  beforeAll(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  });

  beforeEach(() => {
    localStorage.clear();
    held.items = [];
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ allowed: true, data: [] }),
      text: async () => '{}',
    })) as never);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('RecordDetailView — opening a record page records the visit (objectui#12604)', () => {
    it('records the record with its title, its object and the app it was opened in', async () => {
      const ds = makeDataSource();
      render(
        <MemoryRouter initialEntries={[`/apps/${APP}/${OBJECT}/record/${REC}`]}>
          <MetadataCtx.Provider value={metadata}>
            <NavigationProvider>
              <RecentItemsProvider>
                <StoreProbe />
                <Routes>
                  <Route
                    path="/apps/:appName/:objectName/record/:recordId"
                    element={<RecordDetailView dataSource={ds as never} objects={[objectDef] as never} onEdit={() => {}} />}
                  />
                </Routes>
              </RecentItemsProvider>
            </NavigationProvider>
          </MetadataCtx.Provider>
        </MemoryRouter>,
      );

      await waitFor(() => expect(held.items).toHaveLength(1));
      const [entry] = held.items;
      expect(entry).toMatchObject({
        id: `record:${OBJECT}:${REC}`,
        type: 'record',
        label: 'INV-0001',
        href: `/apps/${APP}/${OBJECT}/record/${REC}`,
      });
      // The two the Home trail prints, read back off the entry as Home reads them.
      expect(recentItemObject(entry)).toBe(OBJECT);
      expect(appSegmentOf(entry.href)).toBe(APP);
    });
  });
});

// ── RecordDetailView.appScopedPage-29592 ────────────────────────────────────

/**
 * The record view opens the record page scoped to the app it is opened in
 * (`PageSchema.apps`, maintainer ruling A on objectstack#28979).
 *
 * The route's `:appName` segment is NOT the app's name: `/apps/SEGMENT` carries
 * `appRouteSegment(app)`, the app's package id when it has one. So the view
 * resolves the segment to its app (`matchAppBySegment`, package id first, then
 * name) and hands the app's NAME to the assignment. Pins:
 *
 *   - the ruling's own: inside the Duly app, a user record opens `duly_member`
 *     (`apps: ['duly']`), under its package-id segment and under its name
 *     segment; under Setup (`/apps/com.objectstack.setup/...`) the platform's
 *     `sys_user_detail` still opens;
 *   - two apps in one package share the package-id segment, which resolves to
 *     the first app, so the second app's scoped page opens under its name
 *     segment only;
 *   - the record drawer inside an app list reads the host route's app;
 *   - CONTROL: with no `apps` on any page, every app opens the default page.
 */

describe('RecordDetailView.appScopedPage-29592', () => {
  restoreAfterBlock();

  const OBJECT = 'sys_user';
  const REC = 'u1';

  const objectDef = {
    name: OBJECT,
    label: 'User',
    fields: { id: { label: 'Id', type: 'text' }, name: { label: 'Name', type: 'text' } },
  };

  function makeDataSource() {
    return {
      find: vi.fn(async () => ({ data: [], total: 0, hasMore: false, pageSize: 50 })),
      findOne: vi.fn(async () => ({ id: REC, name: 'Ada' })),
      create: vi.fn(async (_o: string, row: unknown) => row),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
      getObjectSchema: async () => objectDef,
    };
  }

  /**
   * A full record page of the user object. Its accessible name (`aria.ariaLabel`,
   * stamped on the page root) names the page, so the drawn page is readable.
   */
  function userPage(name: string, extra: Record<string, unknown> = {}) {
    return {
      name,
      label: name,
      type: 'record',
      object: OBJECT,
      aria: { ariaLabel: name },
      ...extra,
      regions: [{ name: 'main', components: [] }],
    };
  }

  const SYS_USER_DETAIL = userPage('sys_user_detail', { isDefault: true });
  const DULY_MEMBER = userPage('duly_member', { apps: ['duly'] });

  const SETUP_APP = { name: 'setup', label: 'Setup', _packageId: 'com.objectstack.setup' };
  const DULY_APP = { name: 'duly', label: 'Duly', _packageId: 'com.duly' };
  // One package, two apps: the package id resolves to the first.
  const ACME_SALES = { name: 'acme_sales', label: 'Sales', _packageId: 'com.acme' };
  const ACME_SERVICE = { name: 'acme_service', label: 'Service', _packageId: 'com.acme' };
  const APPS = [SETUP_APP, DULY_APP, ACME_SALES, ACME_SERVICE];

  function makeMetadata(pages: unknown[]) {
    return {
      apps: APPS, objects: [], pages, loading: false, error: null,
      refresh: async () => {}, invalidate: () => {},
      ensureType: async () => pages, getItem: async () => null,
      getItemsByType: () => pages,
    } as never;
  }

  /** Mount the record route `url` (or, with `drawer`, the list route with the record drawer) and read the page drawn. */
  async function drawnPage(url: string, pages: unknown[], drawer = false): Promise<string | undefined> {
    const ds = makeDataSource();
    const view = drawer ? (
      <RecordDetailView dataSource={ds as never} objects={[objectDef] as never} onEdit={() => {}}
        objectNameOverride={OBJECT} recordIdOverride={REC} embedded />
    ) : (
      <RecordDetailView dataSource={ds as never} objects={[objectDef] as never} onEdit={() => {}} />
    );
    const utils = render(
      <MemoryRouter initialEntries={[url]}>
        <MetadataCtx.Provider value={makeMetadata(pages)}>
          <NavigationProvider>
            <Routes>
              <Route path={drawer ? '/apps/:appName/:objectName' : '/apps/:appName/:objectName/record/:recordId'} element={view} />
            </Routes>
          </NavigationProvider>
        </MetadataCtx.Provider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(ds.findOne).toHaveBeenCalled());
    await waitFor(() => expect(utils.container.querySelector('[data-page-type="record"][aria-label]')).not.toBeNull());
    const drawn = utils.container.querySelector('[data-page-type="record"][aria-label]')?.getAttribute('aria-label') ?? undefined;
    cleanup();
    return drawn;
  }

  const recordUrl = (segment: string) => `/apps/${segment}/${OBJECT}/record/${REC}`;

  beforeAll(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  });

  beforeEach(() => {
    // Unrelated chrome reaches for the platform API; serve it from a double so
    // happy-dom never opens a socket (objectui#6640).
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ allowed: true, data: [] }),
      text: async () => '{}',
    })) as never);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('RecordDetailView — the record page scoped to the route\'s app opens (ruling A on objectstack#28979)', () => {
    it('inside the Duly app, under its package-id segment, a user record opens duly_member', async () => {
      expect(await drawnPage(recordUrl('com.duly'), [SYS_USER_DETAIL, DULY_MEMBER])).toBe('duly_member');
    });

    it('inside the Duly app, under its name segment, a user record opens duly_member', async () => {
      expect(await drawnPage(recordUrl('duly'), [SYS_USER_DETAIL, DULY_MEMBER])).toBe('duly_member');
    });

    it('Setup → Users under /apps/com.objectstack.setup still opens sys_user_detail', async () => {
      expect(await drawnPage(recordUrl('com.objectstack.setup'), [DULY_MEMBER, SYS_USER_DETAIL])).toBe('sys_user_detail');
    });

    it('two apps in one package: the package-id segment opens the first app, so the second app\'s page opens under its name only', async () => {
      const servicePage = userPage('acme_service_user', { apps: ['acme_service'] });
      const pages = [SYS_USER_DETAIL, servicePage];
      expect(await drawnPage(recordUrl('com.acme'), pages)).toBe('sys_user_detail');
      expect(await drawnPage(recordUrl('acme_service'), pages)).toBe('acme_service_user');
      // The first app's own scoped page is the one its package-id segment opens.
      const salesPage = userPage('acme_sales_user', { apps: ['acme_sales'] });
      expect(await drawnPage(recordUrl('com.acme'), [SYS_USER_DETAIL, salesPage, servicePage])).toBe('acme_sales_user');
    });

    it('the record drawer inside the Duly app\'s list opens duly_member; inside Setup\'s, sys_user_detail', async () => {
      expect(await drawnPage(`/apps/com.duly/${OBJECT}`, [SYS_USER_DETAIL, DULY_MEMBER], true)).toBe('duly_member');
      expect(await drawnPage(`/apps/com.objectstack.setup/${OBJECT}`, [SYS_USER_DETAIL, DULY_MEMBER], true)).toBe('sys_user_detail');
    });

    it('CONTROL: with no `apps` on any page, every app opens the default record page', async () => {
      const pages = [userPage('first_authored'), SYS_USER_DETAIL];
      for (const segment of ['com.duly', 'duly', 'com.objectstack.setup', 'com.acme', 'acme_service']) {
        expect(await drawnPage(recordUrl(segment), pages)).toBe('sys_user_detail');
      }
    });
  });
});

// ── RecordDetailView.titleFls-10434 ─────────────────────────────────────────

/**
 * The record page's title, which the breadcrumb, the favourite and the
 * "Recently Accessed" rail carry, is built from the record as the viewer may
 * read it (objectui#10434).
 *
 * `RecordDetailView` resolves that title with `getRecordDisplayName` over the
 * loaded page record. It passed the raw served row, so on a backend that does
 * not strip denied fields, a `titleFormat` token or declared `nameField` the
 * policy denies printed in the breadcrumb while the field's row was hidden on
 * the page. The title is now resolved from the row with the denied fields
 * removed (`id` kept), so the resolver falls through to its next rung, the
 * title ObjectStack's `FieldMasker` row already yields.
 *
 * What is pinned, against the real `PermissionProvider` and the real
 * `NavigationProvider` the breadcrumb reads:
 *
 *  - a denied `titleFormat` token or declared `nameField` never reaches the
 *    published title, which falls through to the derived `name` field;
 *  - CONTROLS: a loaded policy denying a field the title does not read, and
 *    no provider at all (`isLoaded` false), publish the served row's title.
 */

describe('RecordDetailView.titleFls-10434', () => {
  restoreAfterBlock();

  const OBJECT = 'contact_10434';
  const REC = 'K1';

  const FIELDS = {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Name', type: 'text' },
    email: { label: 'Email', type: 'text' },
    phone: { label: 'Phone', type: 'text' },
  };

  const RECORD = { id: REC, name: 'Ada Lovelace', email: 'ada@example.com', phone: '555-0100' };

  type Wrap = (node: React.ReactElement) => React.ReactElement;
  const bare: Wrap = (node) => node;

  /** The real role-based provider, denying the named fields of the object to `viewer`. */
  function denying(...fields: string[]): Wrap {
    const permissions = [
      {
        object: OBJECT,
        roles: {
          viewer: { actions: ['read'], fieldPermissions: fields.map((field) => ({ field, read: false })) },
        },
      },
    ];
    const userRoles = ['viewer'];
    return (node) => (
      <PermissionProvider roles={[]} userRoles={userRoles} permissions={permissions as never}>
        {node}
      </PermissionProvider>
    );
  }

  function makeDataSource(objectDef: Record<string, unknown>) {
    return {
      find: vi.fn(async () => ({ data: [], total: 0, hasMore: false, pageSize: 50 })),
      findOne: vi.fn(async () => ({ ...RECORD })),
      create: vi.fn(async (_o: string, row: any) => row),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
      getObjectSchema: async () => objectDef,
    } as Record<string, any>;
  }

  function makeMetadata() {
    const pages: any[] = [];
    return {
      objects: [], pages, loading: false, error: null,
      refresh: async () => {}, invalidate: () => {},
      ensureType: async () => pages, getItem: async () => null,
      getItemsByType: () => pages,
    } as any;
  }

  /** Every record title the page published to the breadcrumb, in order. */
  function TitleProbe({ seen }: { seen: Array<string | undefined> }) {
    const { recordTitle } = useNavigationContext();
    if (seen[seen.length - 1] !== recordTitle) seen.push(recordTitle);
    return <span data-testid="crumb-title">{recordTitle ?? ''}</span>;
  }

  /**
   * Mount the standalone record page (not embedded: an embedded page leaves the
   * breadcrumb to its host) and wait for the title it publishes to settle on
   * `expected`. Returns every title it published on the way.
   */
  async function publishedTitles(
    objectSchema: Record<string, unknown>,
    wrap: Wrap,
    expected: string,
  ): Promise<Array<string | undefined>> {
    const objectDef = { name: OBJECT, label: 'Contact', managedBy: 'platform', fields: FIELDS, ...objectSchema };
    const ds = makeDataSource(objectDef);
    const seen: Array<string | undefined> = [];
    render(
      <MemoryRouter initialEntries={[`/app/demo/${OBJECT}/${REC}`]}>
        <MetadataCtx.Provider value={makeMetadata()}>
          <NavigationProvider>
            {wrap(
              <RecordDetailView
                dataSource={ds as never}
                objects={[objectDef] as never}
                onEdit={() => {}}
                objectNameOverride={OBJECT}
                recordIdOverride={REC}
              />,
            )}
            <TitleProbe seen={seen} />
          </NavigationProvider>
        </MetadataCtx.Provider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(ds.findOne).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector('[data-testid="crumb-title"]')?.textContent).toBe(expected));
    return seen;
  }

  beforeAll(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  });

  beforeEach(() => {
    // Unrelated chrome (approvals, row-level verdicts) reaches for the platform
    // API; happy-dom would resolve those relative URLs to a real socket, which
    // the repo's network-escape guard fails the file for (objectui#6640). Serve
    // them from a double: none of it is what this file observes.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ allowed: true, data: [] }),
      text: async () => '{}',
    })) as never);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe('RecordDetailView — the published record title reads only the fields the viewer may read (#10434)', () => {
    it('a denied `titleFormat` token never reaches the breadcrumb; the title falls through to `name`', async () => {
      const seen = await publishedTitles({ titleFormat: '{email}' }, denying('email'), 'Ada Lovelace');
      expect(seen).not.toContain('ada@example.com');
    });

    it('a denied declared `nameField` never reaches the breadcrumb; the title falls through to `name`', async () => {
      const seen = await publishedTitles({ nameField: 'email' }, denying('email'), 'Ada Lovelace');
      expect(seen).not.toContain('ada@example.com');
    });

    it('CONTROL — a loaded policy denying a field the title does not read publishes the served row’s title', async () => {
      await publishedTitles({ titleFormat: '{email}' }, denying('phone'), 'ada@example.com');
    });

    it('CONTROL — with no provider nothing is filtered, and the served row’s title is published', async () => {
      await publishedTitles({ titleFormat: '{email}' }, bare, 'ada@example.com');
    });
  });
});

// ── RecordDetailView.auditDisplayLocale-10442 ───────────────────────────────

/**
 * `RecordDetailView`'s audit history formats its date diffs in the DISPLAY
 * locale, never the UI language (objectui#10442).
 *
 * The History effect built `fmtCtx = { t, locale: language, lookupLabels }`,
 * and `formatAuditValue` spends `locale` on `toLocaleDateString` /
 * `toLocaleString`. So a regional display locale (`de-CH` under an English UI)
 * never reached a `date` or `datetime` diff. The view now reads
 * `useDisplayLocale()` into `fmtCtx.locale`.
 *
 * The real `I18nProvider` runs with an ENGLISH UI in every case, and the
 * display locale is declared through `LocalizationProvider`, so the display
 * locale is the only thing that differs between the `de-CH` pin and the
 * `en-US` control. The page is the synthesized one, opened on its 动态 tab
 * through the `related` URL param; the diff line is read off the rendered
 * stream, the way a user sees it.
 */

describe('RecordDetailView.auditDisplayLocale-10442', () => {
  restoreAfterBlock();

  const OBJECT_NAME = 'crm_deal';
  const RECORD_ID = 'rec-deal';

  /** Date-only values, read back in the viewer's zone (the suite pins `TZ=UTC`). */
  const FROM_DATE = '2020-03-03';
  const TO_DATE = '2020-03-04';

  const OBJECTS = [
    {
      name: OBJECT_NAME,
      label: 'Deal',
      managedBy: 'platform',
      // The History tab is opt-in per object; this and the registered audit
      // object below are what switch it on.
      enable: { trackHistory: true },
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
        close_date: { type: 'date', label: 'Close date' },
      },
    },
    { name: 'sys_audit_log', label: 'Audit log', fields: { id: { type: 'text' } } },
  ];

  function makeDataSource() {
    const find = vi.fn((objectName: string) => {
      if (objectName === 'sys_audit_log') {
        return Promise.resolve({
          data: [
            {
              id: 'a-1',
              created_at: '2020-03-05T12:00:00.000Z',
              action: 'update',
              old_value: JSON.stringify({ close_date: FROM_DATE }),
              new_value: JSON.stringify({ close_date: TO_DATE }),
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });
    return {
      find,
      findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Alpha', close_date: TO_DATE })),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    } as any;
  }

  function makeMetadata() {
    return {
      objects: OBJECTS,
      pages: [],
      loading: false,
      error: null,
      refresh: async () => {},
      invalidate: () => {},
      ensureType: async () => [],
      getItem: async () => null,
      getItemsByType: () => [],
    } as any;
  }

  function renderHistory(locale: string) {
    return render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
        <LocalizationProvider value={{ locale }}>
          <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}?related=timeline`]}>
            <MetadataCtx.Provider value={makeMetadata()}>
              <RecordDetailView
                dataSource={makeDataSource()}
                objects={OBJECTS}
                onEdit={() => {}}
                objectNameOverride={OBJECT_NAME}
                recordIdOverride={RECORD_ID}
                embedded
              />
            </MetadataCtx.Provider>
          </MemoryRouter>
        </LocalizationProvider>
      </I18nProvider>,
    );
  }

  /**
   * The rendered diff line for `close_date`, under an ENGLISH UI with `locale` as
   * the display locale. Since objectstack#27055 the record page draws the audit
   * entries in the one 动态 stream, each change as one compact line
   * (`data-stream-change`).
   */
  async function diffLine(locale: string): Promise<string> {
    renderHistory(locale);
    let text = '';
    await waitFor(() => {
      const line = Array.from(document.querySelectorAll('[data-stream-change]')).find((el) =>
        (el.textContent ?? '').startsWith('Close date'),
      );
      expect(line).toBeTruthy();
      text = (line!.textContent ?? '').replace(/\s+/g, ' ').trim();
    });
    cleanup();
    return text;
  }

  const expected = (locale: string) =>
    `Close date ${new Date(`${FROM_DATE}T00:00:00Z`).toLocaleDateString(locale)} → ${new Date(`${TO_DATE}T00:00:00Z`).toLocaleDateString(locale)}`;

  beforeEach(() => {
    // Unrelated chrome on this view reaches for the platform API; answering it
    // locally keeps the only asynchrony here the reads this file stubs.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('RecordDetailView — the audit history dates follow the display locale (objectui#10442)', () => {
    it('formats the date diff as de-CH under an English UI with a de-CH display locale', async () => {
      const text = await diffLine('de-CH');
      expect(text, `got: ${text}`).toBe('Close date 3.3.2020 → 4.3.2020');
      expect(text).toBe(expected('de-CH'));
    });

    it('control: formats the date diff as en-US under an en-US display locale', async () => {
      const text = await diffLine('en-US');
      expect(text, `got: ${text}`).toBe('Close date 3/3/2020 → 3/4/2020');
      expect(text).toBe(expected('en-US'));
    });

    /** ⭐ THE PIN: no runner locale can make both readings equal. */
    it('is a reading of the session, not of the machine', async () => {
      expect(await diffLine('de-CH')).not.toBe(await diffLine('en-US'));
    });
  });
});

// ── RecordDetailView.auditTenantCurrency-27640 ──────────────────────────────

/**
 * `RecordDetailView`'s audit history formats a `dynamic`-mode currency diff in
 * the tenant's default currency (ADR-0053), the code the record page's cells
 * show for the same field (objectstack#27640).
 *
 * `formatAuditValue` resolves a currency code through `resolveFieldCurrency`,
 * whose last step is `AuditValueFormatContext.tenantCurrency`. The History
 * effect built `fmtCtx = { t, locale: displayLocale, lookupLabels }` with no
 * tenant currency, so a `dynamic` change read as a plain grouped number beside
 * the record's own currency face. The view now reads
 * `useLocalization().currency` into `fmtCtx.tenantCurrency`.
 *
 * The tenant currency is declared through `LocalizationProvider`, the channel
 * the record page's cells read. A `record`-mode field keeps its code in a
 * sibling field of the row, which the per-value call is not handed, so it
 * stays a plain number with the tenant currency set: the tenant default is
 * never its fallback. The page is the synthesized one, opened on its 动态 tab
 * through the `related` URL param; the diff line is read off the rendered
 * stream, the way a user sees it.
 */

describe('RecordDetailView.auditTenantCurrency-27640', () => {
  restoreAfterBlock();

  const OBJECT_NAME = 'crm_deal';
  const RECORD_ID = 'rec-deal';

  const OBJECTS = [
    {
      name: OBJECT_NAME,
      label: 'Deal',
      managedBy: 'platform',
      // The History tab is opt-in per object; this and the registered audit
      // object below are what switch it on.
      enable: { trackHistory: true },
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
        amount: { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'dynamic' } },
        list_price: {
          type: 'currency',
          label: 'List price',
          currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' },
        },
        currency_code: { type: 'text', label: 'Currency code' },
      },
    },
    { name: 'sys_audit_log', label: 'Audit log', fields: { id: { type: 'text' } } },
  ];

  function makeDataSource() {
    const find = vi.fn((objectName: string) => {
      if (objectName === 'sys_audit_log') {
        return Promise.resolve({
          data: [
            {
              id: 'a-1',
              created_at: '2020-03-05T12:00:00.000Z',
              action: 'update',
              old_value: JSON.stringify({ amount: 1500, list_price: 1500 }),
              new_value: JSON.stringify({ amount: 2500, list_price: 2500 }),
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });
    return {
      find,
      findOne: vi.fn(async () => ({
        id: RECORD_ID,
        name: 'Alpha',
        amount: 2500,
        list_price: 2500,
        currency_code: 'JPY',
      })),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    } as any;
  }

  function makeMetadata() {
    return {
      objects: OBJECTS,
      pages: [],
      loading: false,
      error: null,
      refresh: async () => {},
      invalidate: () => {},
      ensureType: async () => [],
      getItem: async () => null,
      getItemsByType: () => [],
    } as any;
  }

  /**
   * The rendered diff parts, keyed by field label, with `currency` as the
   * tenant default (none when undefined) and `en-US` as the display locale.
   */
  async function diffLines(currency: string | undefined): Promise<Record<string, string>> {
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
        <LocalizationProvider value={{ locale: 'en-US', currency }}>
          <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}?related=timeline`]}>
            <MetadataCtx.Provider value={makeMetadata()}>
              <RecordDetailView
                dataSource={makeDataSource()}
                objects={OBJECTS}
                onEdit={() => {}}
                objectNameOverride={OBJECT_NAME}
                recordIdOverride={RECORD_ID}
                embedded
              />
            </MetadataCtx.Provider>
          </MemoryRouter>
        </LocalizationProvider>
      </I18nProvider>,
    );
    // One audit entry draws its changes as one compact line (`data-stream-change`),
    // joined with `; `, so each field's part is split out and keyed by label.
    const lines: Record<string, string> = {};
    await waitFor(() => {
      const line = Array.from(document.querySelectorAll('[data-stream-change]')).find((el) =>
        (el.textContent ?? '').includes('Amount'),
      );
      expect(line, 'no History diff line').toBeTruthy();
      const parts = (line!.textContent ?? '').replace(/\s+/g, ' ').trim().split('; ');
      for (const label of ['Amount', 'List price']) {
        const part = parts.find((p) => p.startsWith(`${label} `));
        expect(part, `no change for ${label} in: ${parts.join(' | ')}`).toBeTruthy();
        lines[label] = part!;
      }
    });
    cleanup();
    return lines;
  }

  beforeEach(() => {
    // Unrelated chrome on this view reaches for the platform API; answering it
    // locally keeps the only asynchrony here the reads this file stubs.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('RecordDetailView — a dynamic currency diff reads in the tenant currency (objectstack#27640)', () => {
    it('formats a dynamic-mode change from 1500 to 2500 with the EUR face under an EUR tenant', async () => {
      const lines = await diffLines('EUR');
      expect(lines['Amount'], `got: ${lines['Amount']}`).toBe('Amount €1,500.00 → €2,500.00');
    });

    it('keeps a record-mode change a plain number: the tenant currency is not its fallback', async () => {
      const lines = await diffLines('EUR');
      expect(lines['List price'], `got: ${lines['List price']}`).toBe('List price 1,500.00 → 2,500.00');
    });

    it('control: with no tenant currency, the dynamic change reads as a plain number', async () => {
      const lines = await diffLines(undefined);
      expect(lines['Amount'], `got: ${lines['Amount']}`).toBe('Amount 1,500.00 → 2,500.00');
    });
  });
});

// ── RecordDetailView.setupManagedByChip-13385 ───────────────────────────────

/**
 * objectui#13385 — a Setup record page draws no floating `ManagedByBadge`;
 * the header's object-label chip carries the badge's note instead.
 *
 * The maintainer's ruling on objectui#13385 (option B) amends objectui#12194
 * option a for Setup record pages only: inside the Setup app the record page
 * leaves the badge out of its chrome and hands the badge's tooltip title
 * (`managedByBadge.<key>.title`, under the same `useCanAuthorMetadata` gate)
 * to the header chip as `RecordContext.objectLabelNote`. Setup is read off
 * the route's `:appName` (`isSetupAppSegment`: the package id or the name).
 * Every record page outside Setup — a `sys_*` object opened in another app
 * included — keeps the badge exactly as before.
 *
 * Measured through the real record page, the real `page:header` and the real
 * `MePermissionsProvider`. Each case waits for the record body and the H1 to
 * paint, so an absence cannot pass for a page that never rendered.
 *
 * Direction, written before the run: with the Setup condition removed from
 * `RecordDetailView` (badge always drawn, no note handed over), the two Setup
 * cases go RED and the controls stay GREEN.
 */

describe('RecordDetailView.setupManagedByChip-13385', () => {
  restoreAfterBlock();

  const OBJECT = 'sys_organization';
  const REC = 'O1';

  const FIELDS = {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Name', type: 'text' },
    city: { label: 'City', type: 'text' },
  };

  const RECORD = { id: REC, name: 'Acme Workspace', city: 'London' };

  /** A `/me/permissions` answer; `systemPermissions` omitted when `held` is `undefined`. */
  function answer(held: string[] | undefined): MePermissionsAuthenticatedResponse {
    return {
      authenticated: true,
      userId: 'u1',
      tenantId: null,
      positions: [],
      hasAnyQueue: false,
      permissionSets: [],
      ...(held === undefined ? {} : { systemPermissions: held }),
      objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
      fields: {},
    };
  }

  /** An end user: the server reported the set, and it lacks `manage_metadata`. */
  const END_USER = answer(['setup.access']);
  /** An authoring caller. */
  const AUTHOR = answer(['manage_metadata']);

  function makeDataSource(objectDef: Record<string, unknown>) {
    return {
      find: vi.fn(async () => ({ data: [], total: 0, hasMore: false, pageSize: 50 })),
      findOne: vi.fn(async () => ({ ...RECORD })),
      create: vi.fn(async (_o: string, row: Record<string, unknown>) => row),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
      getObjectSchema: async () => objectDef,
    };
  }

  function makeMetadata() {
    const pages: unknown[] = [];
    return {
      objects: [], pages, loading: false, error: null,
      refresh: async () => {}, invalidate: () => {},
      ensureType: async () => pages, getItem: async () => null,
      getItemsByType: () => pages,
    } as never;
  }

  const badges = () =>
    Array.from(document.querySelectorAll('[data-testid="managed-by-badge"]')).map((b) =>
      b.getAttribute('data-bucket'),
    );

  /** The header's object-label chip, when it carries a note: its text and its description. */
  function headerNote(): { label: string | null; note: string | null } | null {
    const trigger = document.querySelector('[data-object-label-note]');
    if (!trigger) return null;
    const id = trigger.getAttribute('aria-describedby');
    return { label: trigger.textContent, note: id ? document.getElementById(id)?.textContent ?? null : null };
  }

  /**
   * Mount the record page under `/apps/<app>/sys_organization/record/O1` — the
   * route the console mounts it on, so the page reads `:appName` the way it does
   * in the console — for an object declaring `managedBy`, under `perms`, and
   * wait for the record body and the header's object label to paint.
   */
  async function mountRecord(app: string, managedBy: string | undefined, perms: MePermissionsResponse) {
    const objectDef = {
      name: OBJECT,
      label: 'Organization',
      fields: FIELDS,
      ...(managedBy === undefined ? {} : { managedBy }),
    };
    const ds = makeDataSource(objectDef);
    render(
      <MemoryRouter initialEntries={[`/apps/${app}/${OBJECT}/record/${REC}`]}>
        <MetadataCtx.Provider value={makeMetadata()}>
          <NavigationProvider>
            <MePermissionsProvider initialPermissions={perms}>
              <Routes>
                <Route
                  path="/apps/:appName/:objectName/record/:recordId"
                  element={
                    <RecordDetailView dataSource={ds as never} objects={[objectDef] as never} onEdit={() => {}} />
                  }
                />
              </Routes>
            </MePermissionsProvider>
          </NavigationProvider>
        </MetadataCtx.Provider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(ds.findOne).toHaveBeenCalled());
    await waitFor(() => expect(document.body.textContent).toContain('London'));
    await waitFor(() => expect(document.querySelector('h1')?.textContent).toContain('Acme Workspace'));
  }

  beforeAll(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  });

  beforeEach(() => {
    // Unrelated chrome (approvals, row-level verdicts) reaches for the platform
    // API; happy-dom would resolve those relative URLs to a real socket, which
    // the repo's network-escape guard fails the file for (objectui#6640).
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ allowed: true, data: [] }),
      text: async () => '{}',
    })) as never);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe('RecordDetailView — Setup record pages carry the managed-by note on the header chip (objectui#13385)', () => {
    it('a Setup sys_organization record page draws no floating badge, and its header chip carries the note', async () => {
      await mountRecord('com.objectstack.setup', 'better-auth', AUTHOR);

      expect(badges()).toEqual([]);
      expect(headerNote()).toEqual({ label: 'Organization', note: 'Written through the built-in identity service' });
    });

    it('Setup addressed by its app name (`setup`) reads the same', async () => {
      await mountRecord('setup', 'better-auth', AUTHOR);

      expect(badges()).toEqual([]);
      expect(headerNote()).toEqual({ label: 'Organization', note: 'Written through the built-in identity service' });
    });

    it('CONTROL — a business-app record page still draws the floating badge for an author, and no chip note', async () => {
      await mountRecord('crm', 'better-auth', AUTHOR);

      expect(badges()).toEqual(['better-auth']);
      expect(headerNote()).toBeNull();
    });

    it('CONTROL — the gate is kept: an end user in Setup sees neither the badge nor the note', async () => {
      await mountRecord('com.objectstack.setup', 'better-auth', END_USER);

      expect(badges()).toEqual([]);
      expect(headerNote()).toBeNull();
    });

    it('CONTROL — a `platform` object in Setup draws no note, as the badge draws nothing for it', async () => {
      await mountRecord('com.objectstack.setup', 'platform', AUTHOR);

      expect(badges()).toEqual([]);
      expect(headerNote()).toBeNull();
    });
  });
});

// ── RecordDetailView.pageHeaderTitleFls-10499 ───────────────────────────────

/**
 * The record page's H1, drawn by `page:header`, reads the record as the viewer
 * may read it (objectui#10499).
 *
 * `PageHeaderRenderer` builds the H1 from `RecordContext.data`, and
 * `@object-ui/components` has no permission source. `RecordDetailView` handed
 * that context the raw served row, so on a backend that does not strip denied
 * fields a `titleFormat` token or declared `nameField` the policy denies
 * printed in the H1. The host now hands the page the row with the denied
 * fields removed (`id` kept), the row ObjectStack's `FieldMasker` already
 * serves, so every rung of the header's title ladder reads a denied field
 * exactly as an absent one. It is the same row the breadcrumb title reads
 * (objectui#10434).
 *
 * What is pinned, through the real record page (default composition:
 * `page:header` over `record:details`) and the real `PermissionProvider`:
 *
 *  - a denied `titleFormat` token, a denied declared `nameField` and a denied
 *    token inside a composite template never reach the H1, nor anywhere else
 *    on the page;
 *  - the interim cost objectui#10434 left open: under a denied single-field
 *    title, `record:details` hides the `name` row as the title's duplicate,
 *    and the readable name now IS the H1, so it is on screen;
 *  - CONTROLS: a loaded policy denying a field the title does not read, and no
 *    provider at all (`isLoaded` false, the objectui#10411 rule), render the
 *    served row's title.
 */

describe('RecordDetailView.pageHeaderTitleFls-10499', () => {
  restoreAfterBlock();

  const OBJECT = 'contact_10499';
  const REC = 'K1';
  const EMAIL = 'ada@example.com';

  const FIELDS = {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Name', type: 'text' },
    email: { label: 'Email', type: 'text' },
    phone: { label: 'Phone', type: 'text' },
    city: { label: 'City', type: 'text' },
  };

  const RECORD = { id: REC, name: 'Ada Lovelace', email: EMAIL, phone: '555-0100', city: 'London' };

  type Wrap = (node: React.ReactElement) => React.ReactElement;
  const bare: Wrap = (node) => node;

  /** The real role-based provider, denying the named fields of the object to `viewer`. */
  function denying(...fields: string[]): Wrap {
    const permissions = [
      {
        object: OBJECT,
        roles: {
          viewer: { actions: ['read'], fieldPermissions: fields.map((field) => ({ field, read: false })) },
        },
      },
    ];
    return (node) => (
      <PermissionProvider roles={[]} userRoles={['viewer']} permissions={permissions as never}>
        {node}
      </PermissionProvider>
    );
  }

  function makeDataSource(objectDef: Record<string, unknown>) {
    return {
      find: vi.fn(async () => ({ data: [], total: 0, hasMore: false, pageSize: 50 })),
      // A backend that does NOT strip denied fields: the row arrives whole.
      findOne: vi.fn(async () => ({ ...RECORD })),
      create: vi.fn(async (_o: string, row: any) => row),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
      getObjectSchema: async () => objectDef,
    } as Record<string, any>;
  }

  function makeMetadata() {
    const pages: any[] = [];
    return {
      objects: [], pages, loading: false, error: null,
      refresh: async () => {}, invalidate: () => {},
      ensureType: async () => pages, getItem: async () => null,
      getItemsByType: () => pages,
    } as any;
  }

  /** The text of every H1 on the page. */
  const h1Texts = () => Array.from(document.querySelectorAll('h1')).map((h) => h.textContent ?? '');

  /**
   * Mount the standalone record page and wait for its `page:header` H1 to read
   * `expected` and for `record:details` to have painted a body row (the `city`
   * value, which no case here denies or titles by).
   */
  async function renderRecordPage(objectSchema: Record<string, unknown>, wrap: Wrap, expected: string) {
    const objectDef = { name: OBJECT, label: 'Contact', managedBy: 'platform', fields: FIELDS, ...objectSchema };
    const ds = makeDataSource(objectDef);
    render(
      <MemoryRouter initialEntries={[`/app/demo/${OBJECT}/${REC}`]}>
        <MetadataCtx.Provider value={makeMetadata()}>
          <NavigationProvider>
            {wrap(
              <RecordDetailView
                dataSource={ds as never}
                objects={[objectDef] as never}
                onEdit={() => {}}
                objectNameOverride={OBJECT}
                recordIdOverride={REC}
              />,
            )}
          </NavigationProvider>
        </MetadataCtx.Provider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(ds.findOne).toHaveBeenCalled());
    await waitFor(() => expect(h1Texts()).toEqual([expected]));
    await waitFor(() => expect(document.body.textContent).toContain('London'));
  }

  beforeAll(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  });

  beforeEach(() => {
    // Unrelated chrome (approvals, row-level verdicts) reaches for the platform
    // API; happy-dom would resolve those relative URLs to a real socket, which
    // the repo's network-escape guard fails the file for (objectui#6640).
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ allowed: true, data: [] }),
      text: async () => '{}',
    })) as never);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe('RecordDetailView — `page:header` builds the H1 from the fields the viewer may read (#10499)', () => {
    it('a denied `titleFormat` token never reaches the H1; the H1 falls through to `name`', async () => {
      await renderRecordPage({ titleFormat: '{email}' }, denying('email'), 'Ada Lovelace');
      expect(document.body.textContent).not.toContain(EMAIL);
    });

    it('a denied declared `nameField` never reaches the H1; the H1 falls through to `name`', async () => {
      // A withheld pointer reads as a blank one, so the resolver walks on to
      // its type-aware derivation, exactly as on a backend that strips `email`.
      await renderRecordPage({ nameField: 'email' }, denying('email'), 'Ada Lovelace');
      expect(document.body.textContent).not.toContain(EMAIL);
    });

    it('a denied token inside a composite `titleFormat` never reaches the H1', async () => {
      await renderRecordPage({ titleFormat: '{name} - {email}' }, denying('email'), 'Ada Lovelace');
      expect(document.body.textContent).not.toContain(EMAIL);
    });

    it('the interim cost of objectui#10434: the readable name is on screen under a denied single-field title', async () => {
      // `record:details` hides the row its dedupe reads as the H1's duplicate,
      // and that dedupe already read the gated row (objectui#10434). So under
      // `titleFormat: '{email}'` it hid `name` while the H1 printed the denied
      // email, and the readable name was on screen nowhere. The H1 now reads the
      // same row: it shows the name, and the hidden `name` row is its duplicate,
      // as on a backend that strips `email`. The name is in the record once, in
      // the H1; it does not come back as a body row. The top bar's crumb
      // 「对象 › 记录名」 (objectstack#27524) names the record with the same
      // gated title, never the denied email.
      await renderRecordPage({ titleFormat: '{email}' }, denying('email'), 'Ada Lovelace');
      const bar = document.querySelector('[data-record-top-bar]');
      expect(bar?.textContent).toContain('Ada Lovelace');
      expect(bar?.textContent).not.toContain(EMAIL);
      const text = document.body.textContent ?? '';
      expect(text.split('Ada Lovelace').length - 1 - ((bar?.textContent ?? '').split('Ada Lovelace').length - 1)).toBe(1);
      expect(text).toContain('555-0100');
    });

    it('BLAST RADIUS — every block reads the same row, so the default `record:highlights` strip stops printing a denied value too', async () => {
      // The host hands ONE row to the whole page. The default composition's
      // highlight strip gates by field only when a page opts into
      // `enforceFieldSecurity`, so on the served row it printed the denied
      // email even with no title reading it. It now reads the gated row, as it
      // reads a stripping backend's.
      await renderRecordPage({}, denying('email'), 'Ada Lovelace');
      expect(document.body.textContent).not.toContain(EMAIL);
    });

    it('CONTROL — a loaded policy denying a field the title does not read renders the served row’s title', async () => {
      await renderRecordPage({ titleFormat: '{email}' }, denying('phone'), EMAIL);
    });

    it('CONTROL — with no provider (policy not loaded) nothing is filtered, per the objectui#10411 rule', async () => {
      await renderRecordPage({ titleFormat: '{email}' }, bare, EMAIL);
    });
  });
});
