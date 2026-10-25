// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12604 — Home's "Recently accessed" column beside the activity feed,
 * as the artboard "系统首页 · 四段式" draws its section ④.
 *
 * What these cases pin, on the real `HomePage` with the real `HomeContinue` and
 * `HomeActivity` (the store and the feeds are the harness of
 * `HomePage.greetingAndApps-12601.test.tsx`):
 *
 *   - the column lists the store's entries newest first, records and list
 *     views among them, at most six;
 *   - each row draws its kind's icon — a record its OBJECT's icon — and a
 *     trail: the context (a record's object label, else the kind), the app
 *     the entry was opened in, and the visit time in the display locale;
 *   - the activity column is there only for a caller who may read
 *     `sys_activity` (objectui#12081); without it the recent block spans the
 *     full width.
 *
 * `t` echoes the KEY, so a hardcoded string fails here.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, within } from '@testing-library/react';
import { useDisplayLocale } from '@object-ui/i18n';
import { timeAgo } from '../../../utils/relativeTime';

const navigateMock = vi.fn();

const state = vi.hoisted(() => ({
  isAdmin: true,
  canAuthorMetadata: true,
  marketplaceEnabled: true,
  pendingApprovalsCount: 0,
  approvalsStatus: 'ready' as 'idle' | 'loading' | 'ready' | 'error',
  apps: [] as Array<Record<string, unknown>>,
  objects: [] as Array<Record<string, unknown>>,
  recentItems: [] as Array<Record<string, unknown>>,
  activityReadable: true,
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
      // The list title is the plural, as the real lookup's first rung reads it.
      objectPluralLabel: (x: { name?: string; label?: string; pluralLabel?: string }) =>
        String(x?.pluralLabel || x?.label || x?.name || ''),
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

// No AI agent: the greeting row holds the builder chips alone.
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: [] }),
  isAskAgent: () => false,
  agentHasCapability: () => false,
}));

vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: state.apps, objects: state.objects, dashboards: [], pages: [], reports: [], loading: false }),
}));
vi.mock('../../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ currentAppName: undefined }),
}));
vi.mock('../../../hooks/useCanAuthorMetadata', () => ({
  useCanAuthorMetadata: () => state.canAuthorMetadata,
}));
// The page's one inbox seam: the approvals count AND whether it is an answer.
vi.mock('../../../hooks/useHomeInbox', () => ({
  useHomeInbox: () => ({
    pendingApprovalsCount: state.pendingApprovalsCount,
    pendingApprovalsStatus: state.approvalsStatus,
    notifications: [],
    unreadTopicCount: 0,
    notificationsStatus: 'ready',
    activity: { value: [], status: 'ready', readable: state.activityReadable },
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

import { HomePage } from '../HomePage';

const CRM = { name: 'crm', label: 'HotCRM', icon: 'Building2', _packageId: 'com.acme.crm' };
const ACCOUNT = {
  name: 'crm_account',
  label: 'Account',
  pluralLabel: 'Accounts',
  icon: 'building',
  listViews: { 'crm_account.all_accounts': { name: 'crm_account.all_accounts', label: 'All Accounts' } },
};

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

/** The store's list, newest first: a record, a list view, a dashboard, an object list. */
function storeOf() {
  return [
    {
      id: 'record:crm_account:a1',
      type: 'record',
      label: 'Acme Corporation',
      href: '/apps/com.acme.crm/crm_account/record/a1',
      visitedAt: minutesAgo(10),
    },
    {
      id: 'view:crm_account:crm_account.all_accounts',
      type: 'view',
      object: 'crm_account',
      name: 'crm_account.all_accounts',
      href: '/apps/crm/crm_account/view/crm_account.all_accounts',
      visitedAt: minutesAgo(20),
    },
    {
      id: 'dashboard:executive',
      type: 'dashboard',
      name: 'executive',
      href: '/apps/crm/dashboard/executive',
      visitedAt: minutesAgo(30),
    },
    {
      id: 'object:crm_account',
      type: 'object',
      name: 'crm_account',
      href: '/apps/crm/crm_account',
      visitedAt: minutesAgo(40),
    },
  ];
}

/** Renders the page beside a probe that reports the display locale the page reads. */
function renderPage(): string {
  let locale = '';
  function Probe() {
    locale = useDisplayLocale();
    return null;
  }
  render(
    <>
      <Probe />
      <HomePage />
    </>,
  );
  return locale;
}

function rows() {
  return within(screen.getByTestId('home-recent')).getAllByTestId('home-recent-row');
}

beforeEach(() => {
  navigateMock.mockReset();
  state.isAdmin = true;
  state.canAuthorMetadata = true;
  state.marketplaceEnabled = true;
  state.pendingApprovalsCount = 0;
  state.approvalsStatus = 'ready';
  state.apps = [CRM];
  state.objects = [ACCOUNT];
  state.recentItems = storeOf();
  state.activityReadable = true;
});

afterEach(() => {
  cleanup();
});

describe('Home "Recently accessed" (objectui#12604)', () => {
  it('lists the store newest first, records and list views among them', () => {
    renderPage();
    const titles = rows().map((row) => row.querySelector('span.truncate')?.textContent);
    expect(titles).toEqual(['Acme Corporation', 'All Accounts', 'executive', 'Accounts']);
    expect(rows().map((row) => row.getAttribute('data-recent-type'))).toEqual(['record', 'view', 'dashboard', 'object']);
  });

  it('a record row draws its object’s icon; every other row its kind’s', () => {
    renderPage();
    const icons = rows().map((row) => within(row).getByTestId('home-recent-icon').getAttribute('data-icon'));
    expect(icons).toEqual(['building', 'view', 'dashboard', 'object']);
  });

  it('each trail reads context · app · visit time, the time in the display locale', () => {
    const locale = renderPage();
    const trails = rows().map((row) => within(row).getByTestId('home-recent-trail').textContent);
    const items = storeOf();
    // A record names its object (singular); the app is resolved from the
    // entry's address, by package id or by name, and labelled as its tile is.
    expect(trails).toEqual([
      `Account · HotCRM · ${timeAgo(items[0].visitedAt, locale)}`,
      `«home.recentApps.itemType.view» · HotCRM · ${timeAgo(items[1].visitedAt, locale)}`,
      `«home.recentApps.itemType.dashboard» · HotCRM · ${timeAgo(items[2].visitedAt, locale)}`,
      `«home.recentApps.itemType.object» · HotCRM · ${timeAgo(items[3].visitedAt, locale)}`,
    ]);
    // Instrument check: the time is a real phrase, not an empty tail.
    expect(timeAgo(items[0].visitedAt, locale)).toMatch(/10/);
  });

  it('shows at most six rows', () => {
    state.recentItems = Array.from({ length: 9 }, (_, i) => ({
      id: `dashboard:d${i}`,
      type: 'dashboard',
      name: `d${i}`,
      href: `/apps/crm/dashboard/d${i}`,
      visitedAt: minutesAgo(i),
    }));
    renderPage();
    expect(rows()).toHaveLength(6);
  });

  it('opening a row navigates to the entry’s address', () => {
    renderPage();
    rows()[1].click();
    expect(navigateMock).toHaveBeenCalledWith('/apps/crm/crm_account/view/crm_account.all_accounts');
  });
});

describe('the activity column gate (objectui#12081, objectui#12604)', () => {
  /** The grid that holds the two columns. */
  function grid(): HTMLElement {
    return screen.getByTestId('home-recent').parentElement as HTMLElement;
  }

  it('without read access to sys_activity the recent block spans the full width', () => {
    state.activityReadable = false;
    renderPage();
    expect(screen.queryByTestId('home-activity')).toBeNull();
    expect(grid().className).not.toMatch(/grid-cols-\[/);
    expect(grid().children).toHaveLength(1);
  });

  it('CONTROL — with it, the activity column sits beside the recent block at 360 px', () => {
    renderPage();
    expect(screen.getByTestId('home-activity')).toBeInTheDocument();
    expect(grid()).toHaveClass('lg:grid-cols-[minmax(0,1fr)_360px]');
    expect(grid().children).toHaveLength(2);
  });
});
