// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A caller the Setup app refuses gets the app's access verdict on Setup's item
 * pages, not the pages under another app's chrome (objectui#12706).
 *
 * ## The measured defect
 *
 * A plain member (no `setup.access`) opened `/apps/setup` and landed on the CRM
 * app's dashboard, under the CRM app's chrome; `/apps/setup/metadata/permission`
 * drew the permission-set list, and `/apps/setup/metadata/permission/NAME` and
 * `/apps/setup/metadata/position/NAME` drew the editors. The server refused
 * every read that matters (403), so it was a wrong screen, not an access hole.
 *
 * The cause: `AppContent` asked the app's access verdict only on its
 * `requestedAppMissing` branch, and that branch excludes every pseudo-route
 * (`isSpecialRoute`: create-app, a `system` or `metadata` segment, and the
 * whole `/apps/setup` subtree). For an ordinary app every nested route already
 * waits on the verdict; for Setup, no route did. A pseudo-route falls back to
 * the default launcher app, so `/apps/setup` ran the CRM app's landing.
 *
 * ## What is pinned
 *
 * The metadata-admin routes and Setup's root wait on the verdict for the app
 * the URL names, and draw `app-access-denied` on `denied` with nothing of the
 * page mounted. Every other verdict, and an admitted caller, render as before.
 * The approvals inbox and the record pages it links to stay reachable: a member
 * approver reaches them under the Setup segment (the server's notification
 * links are `/system/approvals?request=ID`, which forward onto
 * `/apps/setup/system/approvals`), so they are outside this gate.
 *
 * ## Why the route is stubbed at the TRANSPORT
 *
 * As in `AppContent.deniedVsUnpublished.test.tsx`: a real `ObjectStackAdapter`
 * over a stubbed `fetch`, so the verdict comes from the real probe reading the
 * real envelope, not from a fixture of its own conclusion.
 *
 * NOTE ON SCOPE: this file measures WHICH SURFACE renders. `ConsoleLayout` and
 * the lazy pages are stubbed; each stub counts its mounts, so "nothing of the
 * page mounted" is a count, not the absence of a test id at one instant.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useParams } from 'react-router-dom';
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
vi.mock('../../views/metadata-admin', () => ({
  MetadataDirectoryPage: () => counted('metadata-directory-page'),
  MetadataResourceListPage: () => {
    const { type } = useParams<{ type?: string }>();
    return counted('metadata-resource-list-page', type);
  },
  MetadataResourceEditPage: () => {
    const { type, name } = useParams<{ type?: string; name?: string }>();
    return counted('metadata-resource-edit-page', `${type}/${name}`);
  },
  MetadataResourceHistoryPage: () => counted('metadata-resource-history-page'),
  MetadataDiagnosticsPage: () => counted('metadata-diagnostics-page'),
}));
vi.mock('../../views/RecordDetailView', () => ({
  RecordDetailView: () => {
    const { objectName, recordId } = useParams<{ objectName?: string; recordId?: string }>();
    return counted('record-detail-view', `${objectName}/${recordId}`);
  },
}));
vi.mock('../../views/ObjectView', () => ({
  ObjectView: () => {
    const { objectName } = useParams<{ objectName?: string }>();
    return counted('object-view', objectName);
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
 * open is simply ABSENT (`filterAppForUser`). The member's one app is CRM, the
 * launcher's default, which a pseudo-route falls back to.
 */
const CRM_APP = {
  name: 'crm',
  label: 'CRM',
  isDefault: true,
  navigation: [{ id: 'nav_leads', type: 'object', objectName: 'crm_lead', label: 'Leads' }],
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

/** The host's `system/approvals` route, as `apps/console`'s `systemRoutes` mounts it. */
function ApprovalsInboxStub() {
  return counted('approvals-inbox-page');
}
const hostSystemRoutes = <Route path="system/approvals" element={<ApprovalsInboxStub />} />;

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
const PAGE_STUBS = [
  'metadata-directory-page',
  'metadata-resource-list-page',
  'metadata-resource-edit-page',
  'object-view',
  'record-detail-view',
];
const pagesMounted = () => PAGE_STUBS.filter((id) => (mounts[id] ?? 0) > 0);

describe('AppContent — Setup\'s item routes wait on the app\'s access verdict (objectui#12706)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(mounts)) delete mounts[k];
    metadataApps = [CRM_APP];
    metaItemRequests = [];
    byName = { setup: () => json(403, deniedBody('setup')) };
    adapter = makeAdapter();
  });

  it.each([
    ['the permission-set editor', '/apps/setup/metadata/permission/crm_sales_user'],
    ['the position editor', '/apps/setup/metadata/position/sales_rep'],
    ['a metadata list', '/apps/setup/metadata/permission'],
    ['the metadata directory', '/apps/setup/metadata'],
  ])('a refused caller gets app-access-denied on %s, with nothing of the page mounted', async (_label, url) => {
    renderConsoleAt(`${url}?scope=environment`);

    expect(await screen.findByTestId('app-access-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('console-layout')).not.toBeInTheDocument();
    expect(pagesMounted()).toEqual([]);
    // The verdict asked is Setup's, the app the URL names, never the fallback's.
    expect(metaItemRequests).toHaveLength(1);
    expect(metaItemRequests[0]).toContain('/api/v1/meta/app/setup');
    // The URL is left as the caller typed it.
    expect(pathname()).toBe(url);
  });

  it('a refused caller opening Setup\'s root gets app-access-denied, not the default app\'s landing', async () => {
    // Before this card the same URL ran the CRM app's landing and moved the URL
    // onto it (`/apps/setup/crm_lead`), under the CRM app's chrome.
    renderConsoleAt('/apps/setup');

    expect(await screen.findByTestId('app-access-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('console-layout')).not.toBeInTheDocument();
    expect(pagesMounted()).toEqual([]);
    expect(pathname()).toBe('/apps/setup');
    // The screen owns its way back (it renders above `ConsoleLayout`).
    expect(screen.getByTestId('app-access-denied-home')).toBeInTheDocument();
  });

  it('a legacy metadata spelling under the refused app gets the same verdict', async () => {
    renderConsoleAt('/apps/setup/component/metadata/resource/crm_sales_user?type=permission');

    expect(await screen.findByTestId('app-access-denied')).toBeInTheDocument();
    expect(pagesMounted()).toEqual([]);
  });

  it('the verdict is the app\'s own, not a Setup rule: another refused app\'s metadata route is refused too', async () => {
    byName.finance = () => json(403, deniedBody('finance'));

    renderConsoleAt('/apps/finance/metadata/object');

    expect(await screen.findByTestId('app-access-denied')).toBeInTheDocument();
    expect(pagesMounted()).toEqual([]);
    expect(metaItemRequests[0]).toContain('/api/v1/meta/app/finance');
  });

  it('CONTROL — an admitted caller gets the page, and nothing is probed', async () => {
    metadataApps = [CRM_APP, SETUP_APP];

    renderConsoleAt('/apps/setup/metadata/permission/crm_sales_user?scope=environment');

    expect(await screen.findByTestId('metadata-resource-edit-page')).toHaveTextContent('permission/crm_sales_user');
    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'setup');
    expect(screen.queryByTestId('app-access-denied')).not.toBeInTheDocument();
    expect(metaItemRequests).toEqual([]);
  });

  it('CONTROL — a server that has no such app changes nothing: the page renders as before', async () => {
    // A 404 is not a refusal; the pseudo-route keeps its default-app fallback.
    byName = {};

    renderConsoleAt('/apps/setup/metadata/permission');

    expect(await screen.findByTestId('metadata-resource-list-page')).toHaveTextContent('permission');
    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'crm');
    expect(screen.queryByTestId('app-access-denied')).not.toBeInTheDocument();
  });

  it('CONTROL — the approvals inbox stays reachable under the Setup segment for a refused caller', async () => {
    renderConsoleAt('/apps/setup/system/approvals');

    expect(await screen.findByTestId('approvals-inbox-page')).toBeInTheDocument();
    expect(screen.queryByTestId('app-access-denied')).not.toBeInTheDocument();
    expect(metaItemRequests).toEqual([]);
  });

  it('CONTROL — the record page the inbox links to stays reachable for a refused caller', async () => {
    // `ApprovalsInboxPage` opens a request's record at `/apps/setup/OBJECT/record/ID`.
    renderConsoleAt('/apps/setup/crm_opportunity/record/opp_000001');

    expect(await screen.findByTestId('record-detail-view')).toHaveTextContent('crm_opportunity/opp_000001');
    expect(screen.queryByTestId('app-access-denied')).not.toBeInTheDocument();
    expect(metaItemRequests).toEqual([]);
  });
});
