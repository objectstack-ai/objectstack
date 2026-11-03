// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A caller the Setup app refuses gets the app's access verdict on an object
 * LIST route spelled with the `setup` alias (objectstack#28988), the screen
 * the canonical `/apps/com.objectstack.setup/OBJECT` already draws.
 *
 * ## The measured defect
 *
 * A plain member opening `/apps/setup/sys_user` (or `sys_organization`, or an
 * app object such as `showcase_task`) got the object list inside the DEFAULT
 * app's header and sidebar, under a `/apps/setup/…` URL; the legacy
 * `/apps/setup/system/users` forwards there. `/apps/com.objectstack.setup/
 * sys_user` drew `app-access-denied`. The server's read is allowed by design,
 * so it was a wrong screen, not an access hole.
 *
 * The cause: the `/apps/setup` subtree is a pseudo-route (`isSpecialRoute`),
 * so it skips `requestedAppMissing`, and `appSurfaceAwaitsVerdict` covered the
 * metadata, root, settings and marketplace routes only.
 *
 * ## What is pinned
 *
 * The alias-spelled list routes (`OBJECT`, `OBJECT/view/ID`, `OBJECT/data`)
 * wait on the verdict for the app the URL names and draw `app-access-denied`
 * on `denied`, nothing of the list mounted. So does the create form beside
 * them, `OBJECT/new` (objectstack#29102), in both spellings; an admitted
 * caller still gets the form. An admitted caller and a server
 * without the app render as before. The record routes the approvals inbox
 * links to stay reachable (objectui#12706 leaves them open), as does the inbox
 * itself; `AppContent.setupItemRoutesVerdict-12706.test.tsx` pins both too.
 *
 * ## Why the route is stubbed at the TRANSPORT
 *
 * As in `AppContent.setupItemRoutesVerdict-12706.test.tsx`: a real
 * `ObjectStackAdapter` over a stubbed `fetch`, so the verdict comes from the
 * real probe reading the real envelope.
 *
 * NOTE ON SCOPE: this file measures WHICH SURFACE renders. `ConsoleLayout` and
 * the list, data, record and create-form pages are stubbed; each stub counts its mounts, so
 * "nothing of the list mounted" is a count.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Navigate, Routes, Route, useLocation, useParams } from 'react-router-dom';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';

// ---------------------------------------------------------------------------
// Mocks — everything that takes part in the DECISION stays real.
// ---------------------------------------------------------------------------

/** How many times each stubbed page mounted, by test id. */
const mounts: Record<string, number> = {};
const counted = (testId: string, text?: string) => {
  mounts[testId] = (mounts[testId] ?? 0) + 1;
  return <div data-testid={testId}>{text}</div>;
};

// AGENTS.md §测试纪律 — the lazy page modules are stubbed so no unbounded
// `import()` races a bounded `findBy` window.
vi.mock('../../views/ObjectView', () => ({
  ObjectView: () => {
    const { objectName, viewId } = useParams<{ objectName?: string; viewId?: string }>();
    return counted('object-view', viewId ? `${objectName}/${viewId}` : objectName);
  },
}));
vi.mock('../../views/ObjectDataPage', () => ({
  ObjectDataPage: () => {
    const { objectName } = useParams<{ objectName?: string }>();
    return counted('object-data-page', objectName);
  },
}));
vi.mock('../../views/RecordFormPage', () => ({
  RecordFormPage: ({ mode }: { mode?: string }) => {
    const { objectName } = useParams<{ objectName?: string }>();
    return counted('record-form-page', `${objectName}/${mode ?? ''}`);
  },
}));
vi.mock('../../views/RecordDetailView', () => ({
  RecordDetailView: () => {
    const { objectName, recordId } = useParams<{ objectName?: string; recordId?: string }>();
    return counted('record-detail-view', `${objectName}/${recordId}`);
  },
}));
vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-designer')>()),
  CreateAppPage: () => <div data-testid="create-app-page" />,
  EditAppPage: () => <div data-testid="edit-app-page" />,
  DashboardDesignPage: () => <div data-testid="dashboard-design-page" />,
}));

vi.mock('../../layout/ConsoleLayout', () => ({
  ConsoleLayout: ({ activeAppName, children }: { activeAppName?: string; children?: React.ReactNode }) => (
    <div data-testid="console-layout" data-active-app={activeAppName}>
      <header>chrome</header>
      {children}
    </div>
  ),
}));
vi.mock('../../chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../chrome/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../chrome/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useObjectLabel: () => ({
    objectLabel: ({ label }: { label?: string }) => label,
    objectPluralLabel: ({ label }: { label?: string }) => label,
    appLabel: ({ name, label }: { name: string; label?: string }) => label ?? name,
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u_member', name: 'Member', email: 'member@example.com', role: 'member' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: { id: 'org_1', name: 'Org' },
  }),
  // The least-privileged value, so nothing here is an admin-only result.
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

const actionRunnerStub = { registerHandler: vi.fn(), getContext: () => ({}) };
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useActionRunner: () => ({ execute: vi.fn(), runner: actionRunnerStub }),
  useGlobalUndo: () => {},
  useMutationInvalidationBridge: () => {},
}));

// ---------------------------------------------------------------------------
// The transport. One stubbed `fetch` behind a real adapter + real client.
// ---------------------------------------------------------------------------

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** `GET /api/v1/meta/app/:name` for an app that exists and refuses this session. */
const deniedBody = (app: string) => ({
  success: false,
  error: { code: 'PERMISSION_DENIED', message: `You do not have permission to open the '${app}' app.` },
});
/** …and for a name with nothing behind it. */
const ABSENT_BODY = {
  error: { code: 'RESOURCE_NOT_FOUND', message: 'Metadata item not found or access denied.' },
};

/** URLs the by-name meta route was asked for, in order. */
let metaItemRequests: string[] = [];
/** How the by-name route answers, per app name; unlisted names are absent. */
let byName: Record<string, () => Response> = {};

function makeAdapter() {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/v1/discovery')) {
      return json(200, { success: true, data: { version: 'v0', routes: {}, capabilities: {} } });
    }
    // objectstack#27627 — entering an app loads its metadata bundle; that is
    // not the by-name read this file asks about, and it answers as refused.
    if (/\/api\/v1\/meta\/app\/[^/?]+\/bundle$/.test(url)) return json(404, ABSENT_BODY);
    const item = /\/api\/v1\/meta\/app\/([^/?]+)/.exec(url);
    if (item) {
      metaItemRequests.push(url);
      const answer = byName[decodeURIComponent(item[1])];
      return answer ? answer() : json(404, ABSENT_BODY);
    }
    // Nothing else is part of this question; a loud 500 keeps an unexpected
    // call from passing as a silent success.
    return json(500, { error: { code: 'UNEXPECTED_REQUEST', message: url } });
  });
  return new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: fetchImpl });
}

let adapter: unknown = null;
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => adapter,
}));

/**
 * The list as the SERVER hands it to this session: an app the session may not
 * open is simply ABSENT (`filterAppForUser`). The member's one app is
 * Showcase, the launcher's default, which a pseudo-route falls back to.
 */
const SHOWCASE_APP = {
  name: 'showcase_app',
  label: 'Showcase',
  isDefault: true,
  navigation: [{ id: 'nav_tasks', type: 'object', objectName: 'showcase_task', label: 'Tasks' }],
};
const SETUP_APP = { name: 'setup', label: 'Setup', navigation: [] };
let metadataApps: unknown[] = [];
vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({
    apps: metadataApps,
    objects: [],
    loading: false,
    ensureType: undefined,
    error: null,
    refresh: vi.fn(async () => {}),
  }),
}));

import { AppContent } from '../AppContent';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
}

/**
 * The host's routes under the Setup segment, as `apps/console` mounts them:
 * the legacy `system/users` forward (`SystemObjectRedirect`, same prefix
 * arithmetic) and the approvals inbox.
 */
function LegacyUsersRedirect() {
  const location = useLocation();
  const prefix = location.pathname.replace(/\/system\/[^/]+\/?$/, '');
  return <Navigate to={`${prefix}/sys_user`} replace />;
}
function ApprovalsInboxStub() {
  return counted('approvals-inbox-page');
}
const hostSystemRoutes = (
  <>
    <Route path="system/users" element={<LegacyUsersRedirect />} />
    <Route path="system/approvals" element={<ApprovalsInboxStub />} />
  </>
);

function renderConsoleAt(initialUrl: string) {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/apps/:appName/*"
          element={<AppContent extraRoutes={hostSystemRoutes} extraRoutesNoApp={hostSystemRoutes} />}
        />
        <Route path="/home" element={<div data-testid="home-launcher">home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const pathname = () => screen.getByTestId('pathname').textContent;

/** Every page stub this file counts; a refused caller mounts none of them. */
const PAGE_STUBS = ['object-view', 'object-data-page', 'record-form-page', 'record-detail-view', 'approvals-inbox-page'];
const pagesMounted = () => PAGE_STUBS.filter((id) => (mounts[id] ?? 0) > 0);

describe('AppContent — alias-spelled Setup object lists wait on the app\'s access verdict (objectstack#28988)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(mounts)) delete mounts[k];
    metadataApps = [SHOWCASE_APP];
    metaItemRequests = [];
    byName = {
      setup: () => json(403, deniedBody('setup')),
      'com.objectstack.setup': () => json(403, deniedBody('com.objectstack.setup')),
    };
    adapter = makeAdapter();
  });

  it.each([
    ['a platform object list', '/apps/setup/sys_user'],
    ['another platform object list', '/apps/setup/sys_organization'],
    ['an app object list', '/apps/setup/showcase_task'],
    ['a saved list view', '/apps/setup/sys_user/view/all_users'],
    ['the bare data surface', '/apps/setup/sys_user/data'],
  ])('a refused caller gets app-access-denied on %s, never the default app\'s shell', async (_label, url) => {
    renderConsoleAt(url);

    expect(await screen.findByTestId('app-access-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('console-layout')).not.toBeInTheDocument();
    expect(pagesMounted()).toEqual([]);
    // The verdict asked is Setup's, the app the URL names, never the fallback's.
    expect(metaItemRequests).toHaveLength(1);
    expect(metaItemRequests[0]).toContain('/api/v1/meta/app/setup');
    // The URL is left as the caller typed it, and the screen owns its way back.
    expect(pathname()).toBe(url);
    expect(screen.getByTestId('app-access-denied-home')).toBeInTheDocument();
  });

  it('the legacy system/users spelling forwards onto the list, which is refused', async () => {
    renderConsoleAt('/apps/setup/system/users');

    expect(await screen.findByTestId('app-access-denied')).toBeInTheDocument();
    expect(pagesMounted()).toEqual([]);
    expect(pathname()).toBe('/apps/setup/sys_user');
  });

  it('the alias and the package id draw the same screen', async () => {
    renderConsoleAt('/apps/com.objectstack.setup/sys_user');

    expect(await screen.findByTestId('app-access-denied')).toBeInTheDocument();
    expect(pagesMounted()).toEqual([]);
    expect(metaItemRequests[0]).toContain('/api/v1/meta/app/com.objectstack.setup');
  });

  // objectstack#29102 — the create form names no record, so no inbox link
  // lands on it; it waits on the verdict like the lists beside it.
  it.each([
    ['the alias', '/apps/setup/sys_user/new', 'setup'],
    ['an app object under the alias', '/apps/setup/showcase_task/new', 'setup'],
    ['the package id', '/apps/com.objectstack.setup/sys_user/new', 'com.objectstack.setup'],
  ])('a refused caller gets app-access-denied on the create form spelled with %s, never the form', async (_label, url, app) => {
    renderConsoleAt(url);

    expect(await screen.findByTestId('app-access-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('console-layout')).not.toBeInTheDocument();
    expect(pagesMounted()).toEqual([]);
    expect(metaItemRequests).toHaveLength(1);
    expect(metaItemRequests[0]).toContain(`/api/v1/meta/app/${app}`);
    expect(pathname()).toBe(url);
  });

  it('CONTROL — an admitted caller gets the create form under Setup, and nothing is probed', async () => {
    metadataApps = [SHOWCASE_APP, SETUP_APP];

    renderConsoleAt('/apps/setup/sys_user/new');

    expect(await screen.findByTestId('record-form-page')).toHaveTextContent('sys_user/create');
    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'setup');
    expect(screen.queryByTestId('app-access-denied')).not.toBeInTheDocument();
    expect(metaItemRequests).toEqual([]);
  });

  it('CONTROL — an admitted caller gets the list under Setup, and nothing is probed', async () => {
    metadataApps = [SHOWCASE_APP, SETUP_APP];

    renderConsoleAt('/apps/setup/sys_user');

    expect(await screen.findByTestId('object-view')).toHaveTextContent('sys_user');
    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'setup');
    expect(screen.queryByTestId('app-access-denied')).not.toBeInTheDocument();
    expect(metaItemRequests).toEqual([]);
  });

  it('CONTROL — a server that has no such app changes nothing: the list renders as before', async () => {
    // A 404 is not a refusal; the pseudo-route keeps its default-app fallback.
    byName = {};

    renderConsoleAt('/apps/setup/sys_user');

    expect(await screen.findByTestId('object-view')).toHaveTextContent('sys_user');
    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'showcase_app');
    expect(screen.queryByTestId('app-access-denied')).not.toBeInTheDocument();
  });

  it('CONTROL — the record page the approvals inbox links to stays reachable for a refused caller', async () => {
    renderConsoleAt('/apps/setup/sys_user/record/usr_000001');

    expect(await screen.findByTestId('record-detail-view')).toHaveTextContent('sys_user/usr_000001');
    expect(screen.queryByTestId('app-access-denied')).not.toBeInTheDocument();
    expect(metaItemRequests).toEqual([]);
  });

  it('CONTROL — a host route under the Setup segment is not read as an object list', async () => {
    renderConsoleAt('/apps/setup/system/approvals');

    expect(await screen.findByTestId('approvals-inbox-page')).toBeInTheDocument();
    expect(screen.queryByTestId('app-access-denied')).not.toBeInTheDocument();
    expect(metaItemRequests).toEqual([]);
  });

  it('CONTROL — the object list under an app the caller may open renders, unprobed', async () => {
    renderConsoleAt('/apps/showcase_app/showcase_task');

    expect(await screen.findByTestId('object-view')).toHaveTextContent('showcase_task');
    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'showcase_app');
    expect(metaItemRequests).toEqual([]);
  });
});
