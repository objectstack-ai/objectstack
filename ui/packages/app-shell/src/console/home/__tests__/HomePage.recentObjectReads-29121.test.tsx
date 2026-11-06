// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29121 — Home's recent rows read the objects they name, by name.
 *
 * `HomePage` read `useMetadata().objects` on every render for the icon of a
 * recent record row, and its rows' labels read it too: a record row's object
 * label (`useNavTargetLabel`), an object row's title and a list-view row's
 * label (`useRecentItemLabel`). Each loaded the whole object registry on every
 * visit. Now each row reads its own object by name; a list-view row reads its
 * object with its views (the `/meta/view` list), which its label is.
 *
 * Real subjects: `HomePage` and `MetadataProvider` over a fake adapter that
 * records each read; the rest of the page is the harness of
 * `HomePage.recentlyAccessed-12604` (what the rows print is pinned there).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import { MetadataProvider } from '../../../providers/MetadataProvider';

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

// Home marks an opened notification read through the bell's own write
// (`useInboxBell`); this harness serves no inbox feed, so the write is stubbed.
vi.mock('../../../hooks/useInboxBell', () => ({ useInboxBell: () => ({ markRead: vi.fn() }) }));

// The deployment notice reads its own state from the server for an administrator
// (objectstack#30120); its fetch, its gate and its copy are pinned in
// `deployment-notice/__tests__/DeploymentNotice.test.tsx`, so it is stubbed here
// like every other source this page reads.
vi.mock('../../deployment-notice/DeploymentNotice', () => ({ DeploymentNotice: () => null }));

import { HomePage } from '../HomePage';

const CRM = { name: 'crm', label: 'HotCRM', icon: 'Building2', _packageId: 'com.acme.crm', navigation: [] };
const OBJECTS = [
  { name: 'crm_account', label: 'Account', pluralLabel: 'Accounts', icon: 'building', _packageId: 'com.acme.crm', fields: {} },
  { name: 'crm_contact', label: 'Contact', pluralLabel: 'Contacts', icon: 'user', _packageId: 'com.acme.crm', fields: {} },
  { name: 'crm_lead', label: 'Lead', pluralLabel: 'Leads', icon: 'flag', _packageId: 'com.acme.crm', fields: {} },
  { name: 'sys_user', label: 'User', icon: 'user', _packageId: 'plugin.auth', fields: {} },
];
const VIEWS = [{ name: 'crm_lead.open_leads', object: 'crm_lead', viewKind: 'list', label: 'Open Leads', config: { type: 'grid' } }];

function makeAdapter(calls: string[]) {
  return {
    clearCache: vi.fn(),
    invalidateCache: vi.fn(),
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string, options?: { packageId?: string }) => {
          calls.push(options?.packageId ? `${type}?package=${options.packageId}` : type);
          const all = type === 'object' ? OBJECTS : type === 'app' ? state.apps : type === 'view' ? VIEWS : [];
          const items = options?.packageId ? all.filter((o: any) => o._packageId === options.packageId) : all;
          return Promise.resolve({ type, items: structuredClone(items) });
        },
        getItem: (type: string, name: string) => {
          calls.push(`${type}/${name}`);
          const item = (type === 'object' ? OBJECTS : []).find((o) => o.name === name) ?? null;
          return Promise.resolve({ item: structuredClone(item) });
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

const metaReads = (calls: string[]) =>
  calls.filter((c) => c === 'object' || c === 'view' || c.startsWith('object?') || c.startsWith('object/'));

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

function renderPage(): string[] {
  const calls: string[] = [];
  render(
    <MetadataProvider adapter={makeAdapter(calls)}>
      <HomePage />
    </MetadataProvider>,
  );
  return calls;
}

function rows() {
  return within(screen.getByTestId('home-recent')).getAllByTestId('home-recent-row');
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(() => {
  sessionStorage.clear();
  navigateMock.mockReset();
  state.apps = [CRM];
  state.recentItems = [];
});
afterEach(() => cleanup());

describe('Home’s recent rows read the objects they name, by name (objectstack#29121)', () => {
  it('with no recent row, Home reads no object', async () => {
    const calls = renderPage();
    await waitFor(() => expect(calls).toContain('app'));
    await settle();
    expect(metaReads(calls)).toEqual([]);
  });

  it('record rows: each row’s object by name, for its icon and its label, never the whole list', async () => {
    state.recentItems = [
      { id: 'record:crm_account:a1', type: 'record', label: 'Acme', href: '/apps/com.acme.crm/crm_account/record/a1', visitedAt: minutesAgo(5) },
      { id: 'record:crm_contact:c1', type: 'record', label: 'Ada', href: '/apps/com.acme.crm/crm_contact/record/c1', visitedAt: minutesAgo(6) },
      { id: 'record:crm_account:a2', type: 'record', label: 'Globex', href: '/apps/com.acme.crm/crm_account/record/a2', visitedAt: minutesAgo(7) },
    ];
    const calls = renderPage();
    await waitFor(() =>
      expect(rows().map((row) => within(row).getByTestId('home-recent-icon').getAttribute('data-icon'))).toEqual([
        'building',
        'user',
        'building',
      ]),
    );
    expect(rows().map((row) => within(row).getByTestId('home-recent-trail').textContent?.split(' · ')[0])).toEqual([
      'Account',
      'Contact',
      'Account',
    ]);
    await settle();
    expect([...metaReads(calls)].sort()).toEqual(['object/crm_account', 'object/crm_contact']);
  });

  it('an object row reads its object by name; a list-view row its object with its views (the view list, never the object list)', async () => {
    state.recentItems = [
      { id: 'object:crm_account', type: 'object', name: 'crm_account', href: '/apps/crm/crm_account', visitedAt: minutesAgo(5) },
      {
        id: 'view:crm_lead:crm_lead.open_leads',
        type: 'view',
        object: 'crm_lead',
        name: 'crm_lead.open_leads',
        href: '/apps/crm/crm_lead/view/crm_lead.open_leads',
        visitedAt: minutesAgo(6),
      },
    ];
    const calls = renderPage();
    await waitFor(() =>
      expect(rows().map((row) => row.querySelector('span.truncate')?.textContent)).toEqual(['Accounts', 'Open Leads']),
    );
    await settle();
    expect([...metaReads(calls)].sort()).toEqual(['object/crm_account', 'object/crm_lead', 'view']);
  });
});
