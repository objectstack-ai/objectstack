// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26838 — Home's tiles are the apps the user's `GET /me/apps`
 * answer lists, so an app a permission set hides (`tabPermissions: hidden`)
 * draws no tile, while `GET /meta/app` still serves it (it opens from a URL).
 *
 * On the real `HomePage` and `HomeAppsStrip`, under the real
 * `LauncherAppsProvider` fed a `/me/apps` double:
 *
 *   - `/meta/app` = [setup, crm, showcase_app], `/me/apps` = [setup, crm]:
 *     no Showcase tile; Setup's System Settings link stays;
 *   - a set that hides Setup takes the System Settings link away too;
 *   - `404` (no security plugin): every tile, as before;
 *   - while the first read is out the page holds its loading line and draws
 *     no tile, so a hidden tile is never drawn and then taken away.
 *
 * The harness is `HomePage.greetingAndApps-12601.test.tsx`'s.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';

const navigateMock = vi.fn();

const state = vi.hoisted(() => ({
  isAdmin: true,
  canAuthorMetadata: true,
  marketplaceEnabled: true,
  pendingApprovalsCount: 0,
  approvalsStatus: 'ready' as 'idle' | 'loading' | 'ready' | 'error',
  apps: [] as Array<Record<string, unknown>>,
  recentItems: [] as Array<Record<string, unknown>>,
}));

vi.mock('react-router-dom', async () => {
  const { createElement } = await import('react');
  return {
    useNavigate: () => navigateMock,
    // The tiles and the settings link are router `Link`s; this harness has no
    // router, so the stand-in renders the anchor `Link` would, minus the basename.
    Link: ({ to, ...rest }: { to: string } & Record<string, unknown>) =>
      createElement('a', { ...rest, href: to }),
  };
});

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, opts?: { count?: number; time?: string }) =>
      `«${key}»` +
      (opts?.count === undefined ? '' : `[count=${opts.count}]`) +
      (opts?.time === undefined ? '' : `[time=${opts.time}]`),
    language: 'en',
  }),
  // Every labeller echoes the label, else the name: the tiles read `appLabel`,
  // and the recent rail beside them labels the store's entries.
  useObjectLabel: () => {
    const label = (x: { name?: string; label?: string }) => String(x?.label || x?.name || '');
    return {
      appLabel: label,
      objectLabel: label,
      objectPluralLabel: label,
      dashboardLabel: label,
      pageLabel: label,
      reportLabel: label,
      viewLabel: (_object: string, _view: string, fallback?: string) => fallback ?? '',
    };
  },
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Dev Admin', email: 'dev.admin@example.com' } }),
  useWorkspaceAdminStatus: () => ({ isAdmin: state.isAdmin, isResolved: true }),
}));

// One custom agent and no ask or build agent: AI is on here, so the build chip
// keeps its "Build an app" form (objectstack#26614 gives the agent-less
// deployment its own, `HomePage.noAgentsBuildChip-26614.test.tsx`), and no AI
// CTA joins the greeting row, which holds the builder chips alone.
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: [{ name: 'custom_helper' }] }),
  isAskAgent: () => false,
  agentHasCapability: () => false,
}));

vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: state.apps, objects: [], dashboards: [], pages: [], reports: [], loading: false }),
}));
vi.mock('../../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ currentAppName: undefined }),
}));
vi.mock('../../../hooks/useCanAuthorMetadata', () => ({
  useCanAuthorMetadata: () => state.canAuthorMetadata,
  useCanReadPendingDrafts: () => true,
}));
// The page's one inbox seam: the approvals count AND whether it is an answer.
vi.mock('../../../hooks/useHomeInbox', () => ({
  useHomeInbox: () => ({
    pendingApprovalsCount: state.pendingApprovalsCount,
    // objectui#12602: the approvals preview, and whether each source is
    // the caller's to read — the My-work section draws a column per source.
    pendingApprovals: [],
    pendingApprovalsReadable: true,
    notificationsReadable: true,
    pendingApprovalsStatus: state.approvalsStatus,
    notifications: [],
    unreadTopicCount: 0,
    notificationsStatus: 'ready',
    activity: { value: [], status: 'ready', readable: true },
  }),
}));
vi.mock('../../../runtime-config', () => ({
  getRuntimeConfig: () => ({ branding: { productName: 'ObjectStack' } }),
  isMarketplaceEnabled: () => state.marketplaceEnabled,
  isAiStudioEnabled: () => true,
}));

// The tiles' last-opened time reads the recent-items store.
vi.mock('../../../hooks/useRecentItems', () => ({
  useRecentItems: () => ({ recentItems: state.recentItems }),
}));

// --- surfaces these cases do not read ---------------------------------------
vi.mock('../../../hooks/useFavorites', () => ({ useFavorites: () => ({ favorites: [] }) }));
vi.mock('../../../hooks/useAiSurface', () => ({ resolveAiApiBase: () => '' }));
vi.mock('../../../preview/usePendingDrafts', () => ({ usePendingDrafts: () => ({ count: 0 }) }));
vi.mock('../../../preview/usePublishAllDrafts', () => ({
  usePublishAllDrafts: () => ({ publishAll: async () => ({ ok: true }), publishing: false }),
}));

// Home marks an opened notification read through the bell's own write
// (`useInboxBell`); this harness serves no inbox feed, so the write is stubbed.
vi.mock('../../../hooks/useInboxBell', () => ({ useInboxBell: () => ({ markRead: vi.fn() }) }));

import { HomePage } from '../HomePage';
import { LauncherAppsProvider } from '../../../hooks/useLauncherApps';

const SETUP = { name: 'setup', label: 'Setup', icon: 'Settings', _packageId: 'com.objectstack.setup' };
const CRM = { name: 'crm', label: 'CRM', icon: 'Building2' };
const SHOWCASE = { name: 'showcase_app', label: 'Showcase', icon: 'Sparkles' };

const ENDPOINT = '/me-apps-double';

/** A `/me/apps` double: the listed names, or a bare status. */
function meApps(answer: string[] | number) {
  return vi.fn(async (_url: unknown) =>
    typeof answer === 'number'
      ? new Response('{}', { status: answer })
      : new Response(JSON.stringify({ apps: answer.map((name) => ({ name })) }), { status: 200 }),
  );
}

function renderHome(fetcher: unknown) {
  return render(
    <LauncherAppsProvider endpoint={ENDPOINT} fetcher={fetcher as typeof fetch}>
      <HomePage />
    </LauncherAppsProvider>,
  );
}

/** Every URL the page handed the global `fetch` — none is expected. */
let fetchCalls: string[] = [];

beforeEach(() => {
  navigateMock.mockReset();
  state.isAdmin = true;
  state.canAuthorMetadata = true;
  state.marketplaceEnabled = true;
  state.pendingApprovalsCount = 0;
  state.approvalsStatus = 'ready';
  state.apps = [SETUP, CRM, SHOWCASE];
  state.recentItems = [];
  fetchCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      fetchCalls.push(String(input));
      return { ok: false, status: 404, json: async () => ({}) };
    }),
  );
});

afterEach(() => {
  expect(fetchCalls).toEqual([]);
  cleanup();
  vi.unstubAllGlobals();
});

describe('Home draws a tile only for an app /me/apps lists (objectstack#26838)', () => {
  it('an app the member’s set hides draws no tile', async () => {
    const fetcher = meApps(['setup', 'crm']);
    renderHome(fetcher);
    expect(await screen.findByTestId('app-tile-crm')).toBeInTheDocument();
    expect(screen.queryByTestId('app-tile-showcase_app')).toBeNull();
    expect(screen.getByTestId('home-system-settings-link')).toBeInTheDocument();
    expect(screen.getByTestId('home-apps-count')).toHaveTextContent(/^1$/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('a set that hides Setup takes the System Settings link away', async () => {
    renderHome(meApps(['crm', 'showcase_app']));
    expect(await screen.findByTestId('app-tile-showcase_app')).toBeInTheDocument();
    expect(screen.getByTestId('app-tile-crm')).toBeInTheDocument();
    expect(screen.queryByTestId('home-system-settings-link')).toBeNull();
  });

  it('CONTROL — a 404 (no security plugin) draws every tile, as before', async () => {
    renderHome(meApps(404));
    expect(await screen.findByTestId('app-tile-showcase_app')).toBeInTheDocument();
    expect(screen.getByTestId('app-tile-crm')).toBeInTheDocument();
    expect(screen.getByTestId('home-system-settings-link')).toBeInTheDocument();
  });

  it('holds the loading line, and no tile, while the first read is out', async () => {
    let answer!: (res: Response) => void;
    renderHome(vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))));
    expect(await screen.findByText('«home.loading»')).toBeInTheDocument();
    expect(screen.queryByTestId('app-tile-showcase_app')).toBeNull();
    expect(screen.queryByTestId('app-tile-crm')).toBeNull();

    await act(async () => {
      answer(new Response(JSON.stringify({ apps: [{ name: 'setup' }, { name: 'crm' }] }), { status: 200 }));
    });
    expect(screen.getByTestId('app-tile-crm')).toBeInTheDocument();
    expect(screen.queryByTestId('app-tile-showcase_app')).toBeNull();
  });
});
