// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34692 — Home's "Recently accessed" leaves out a row whose object
 * this environment does not register, and never asks that object by name.
 *
 * A module's package can be disabled after one of its records was opened. The
 * row stayed (it opened a page the environment no longer serves), and its icon
 * read `/meta/object/NAME`, a 404 on every Home render. The rule is the one
 * objectstack#26988 applies to a record page's lists: an object the registered
 * object list does not hold is neither drawn nor asked about. Home asks its
 * rows' objects in one `GET /meta/object?names=` presence read, which leaves an
 * unregistered name out, and reads by name only the names it answered served.
 *
 * Real subjects: `HomePage` and `MetadataProvider` over a fake adapter that
 * records each read and serves the objects of the packages that are enabled;
 * the rest of the page is the harness of `HomePage.recentObjectReads-29121`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import { MetadataProvider } from '../../../providers/MetadataProvider';

const navigateMock = vi.fn();

const state = vi.hoisted(() => ({
  apps: [] as Array<Record<string, unknown>>,
  recentItems: [] as Array<Record<string, unknown>>,
}));

vi.mock('react-router-dom', async () => {
  const { createElement } = await import('react');
  return {
    useNavigate: () => navigateMock,
    Link: ({ to, ...rest }: { to: string } & Record<string, unknown>) => createElement('a', { ...rest, href: to }),
  };
});

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (key: string) => `«${key}»`, language: 'en' }),
  // Every labeller echoes the label, else the name.
  useObjectLabel: () => {
    const label = (x: { name?: string; label?: string }) => String(x?.label || x?.name || '');
    return {
      appLabel: label,
      objectLabel: label,
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
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

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
  useCanAuthorMetadata: () => true,
  useCanReadPendingDrafts: () => true,
}));
vi.mock('../../../hooks/useHomeInbox', () => ({
  useHomeInbox: () => ({
    pendingApprovalsCount: 0,
    pendingApprovalsStatus: 'ready',
    notifications: [],
    unreadTopicCount: 0,
    notificationsStatus: 'ready',
    activity: { value: [], status: 'ready', readable: true },
  }),
}));
vi.mock('../../../runtime-config', () => ({
  getRuntimeConfig: () => ({ branding: { productName: 'ObjectStack' } }),
  isMarketplaceEnabled: () => true,
  isAiStudioEnabled: () => true,
}));
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
vi.mock('../../../hooks/useInboxBell', () => ({ useInboxBell: () => ({ markRead: vi.fn() }) }));
vi.mock('../../deployment-notice/DeploymentNotice', () => ({ DeploymentNotice: () => null }));

import { HomePage } from '../HomePage';

const CRM = { name: 'crm', label: 'HotCRM', icon: 'Building2', _packageId: 'com.acme.crm', navigation: [] };
const PSA = 'com.acme.psa';
const OBJECTS = [
  { name: 'crm_account', label: 'Account', pluralLabel: 'Accounts', icon: 'building', _packageId: 'com.acme.crm', fields: {} },
  { name: 'pm_project', label: 'Project', pluralLabel: 'Projects', icon: 'briefcase', _packageId: PSA, fields: {} },
];

/** A fake adapter serving the objects of the enabled packages; `hold` keeps the `?names=` read in flight. */
function makeAdapter(calls: string[], options: { disabled?: string[]; hold?: Promise<void> } = {}) {
  const served = () => OBJECTS.filter((o) => !options.disabled?.includes(o._packageId));
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
        getItems: async (type: string, opts?: { packageId?: string; names?: readonly string[] }) => {
          if (opts?.names) {
            calls.push(`${type}?names=${opts.names.join(',')}`);
            await options.hold;
            const items = type === 'object' ? served().filter((o) => opts.names!.includes(o.name)) : [];
            return { type, items: structuredClone(items) };
          }
          calls.push(opts?.packageId ? `${type}?package=${opts.packageId}` : type);
          const all = type === 'object' ? served() : type === 'app' ? state.apps : [];
          return { type, items: structuredClone(all) };
        },
        getItem: (type: string, name: string) => {
          calls.push(`${type}/${name}`);
          const item = (type === 'object' ? served() : []).find((o) => o.name === name);
          // A disabled package's object answers 404 by name.
          if (!item) return Promise.reject(Object.assign(new Error('Not found'), { status: 404 }));
          return Promise.resolve({ item: structuredClone(item) });
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

const objectReads = (calls: string[]) => calls.filter((c) => c === 'object' || c.startsWith('object?') || c.startsWith('object/'));

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

const ACCOUNT_ROW = { id: 'record:crm_account:a1', type: 'record', label: 'Acme', href: '/apps/com.acme.crm/crm_account/record/a1', visitedAt: minutesAgo(5) };
const PROJECT_ROW = {
  id: 'record:pm_project:p1',
  type: 'record',
  label: 'Wayne Operations Module Rollout',
  href: '/apps/com.acme.psa/pm_project/record/p1',
  visitedAt: minutesAgo(60),
};

function renderPage(options: { disabled?: string[]; hold?: Promise<void> } = {}): string[] {
  const calls: string[] = [];
  render(
    <MetadataProvider adapter={makeAdapter(calls, options)}>
      <HomePage />
    </MetadataProvider>,
  );
  return calls;
}

function rows() {
  return within(screen.getByTestId('home-recent')).queryAllByTestId('home-recent-row');
}
const titles = () => rows().map((row) => row.querySelector('span.truncate')?.textContent);
const icons = () => rows().map((row) => within(row).getByTestId('home-recent-icon').getAttribute('data-icon'));

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(() => {
  sessionStorage.clear();
  navigateMock.mockReset();
  state.apps = [CRM];
  state.recentItems = [];
});
afterEach(() => cleanup());

describe('Home leaves out a recent row whose object is not registered, and never asks it by name (objectstack#34692)', () => {
  it('a record visited while its package was enabled: drawn then; once the package is disabled, not drawn and not asked by name', async () => {
    state.recentItems = [ACCOUNT_ROW, PROJECT_ROW];

    // Visited while the PSA package was enabled: both rows draw their object's icon.
    const enabled = renderPage();
    await waitFor(() => expect(icons()).toEqual(['building', 'briefcase']));
    expect(titles()).toEqual(['Acme', 'Wayne Operations Module Rollout']);
    await settle();
    expect(objectReads(enabled)).toContain('object/pm_project');
    cleanup();

    // The package is disabled; the stored entry outlives it.
    const disabled = renderPage({ disabled: [PSA] });
    // CONTROL: the served object's row still draws, with its icon.
    await waitFor(() => expect(icons()).toEqual(['building']));
    expect(titles()).toEqual(['Acme']);
    await settle();
    expect(titles()).toEqual(['Acme']);
    // One presence read for both names; by name only the served one.
    expect(objectReads(disabled).sort()).toEqual(['object/crm_account', 'object?names=crm_account,pm_project']);
    expect(objectReads(disabled)).not.toContain('object/pm_project');
  });

  it('an object row and a list-view row of the disabled package are left out too', async () => {
    state.recentItems = [
      { id: 'object:pm_project', type: 'object', name: 'pm_project', href: '/apps/psa/pm_project', visitedAt: minutesAgo(5) },
      {
        id: 'view:pm_project:pm_project.active',
        type: 'view',
        object: 'pm_project',
        name: 'pm_project.active',
        href: '/apps/psa/pm_project/view/pm_project.active',
        visitedAt: minutesAgo(6),
      },
      { id: 'object:crm_account', type: 'object', name: 'crm_account', href: '/apps/crm/crm_account', visitedAt: minutesAgo(7) },
    ];
    const calls = renderPage({ disabled: [PSA] });
    await waitFor(() => expect(titles()).toEqual(['Accounts']));
    await settle();
    expect(titles()).toEqual(['Accounts']);
    expect(objectReads(calls).filter((c) => c.includes('pm_project') && !c.startsWith('object?names='))).toEqual([]);
  });

  it('a left-out row holds no place: the six rows are taken from the rows that remain', async () => {
    state.recentItems = [
      PROJECT_ROW,
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `record:crm_account:a${i}`,
        type: 'record',
        label: `Account ${i}`,
        href: `/apps/com.acme.crm/crm_account/record/a${i}`,
        visitedAt: minutesAgo(10 + i),
      })),
    ];
    renderPage({ disabled: [PSA] });
    await waitFor(() => expect(titles()).toEqual(['Account 0', 'Account 1', 'Account 2', 'Account 3', 'Account 4', 'Account 5']));
  });

  it('while the presence read is unanswered, the row is drawn and its object is not asked by name', async () => {
    state.recentItems = [PROJECT_ROW];
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = renderPage({ disabled: [PSA], hold });
    await waitFor(() => expect(objectReads(calls)).toEqual(['object?names=pm_project']));
    await settle();
    // Drawn, with its kind's icon and its object's bundle label, and no by-name read.
    expect(titles()).toEqual(['Wayne Operations Module Rollout']);
    expect(icons()).toEqual(['record']);
    expect(objectReads(calls)).toEqual(['object?names=pm_project']);

    release();
    await waitFor(() => expect(rows()).toEqual([]));
    await settle();
    expect(objectReads(calls)).toEqual(['object?names=pm_project']);
  });
});
