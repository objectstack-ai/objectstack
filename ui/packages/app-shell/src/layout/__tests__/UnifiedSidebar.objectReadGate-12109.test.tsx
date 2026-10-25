// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — an entry bound to an object the caller may not read is not
 * drawn, by default (objectui#12109).
 *
 * Measured on HotCRM (objectstack-ai/hotcrm#2058, 17.7.0): a service agent with
 * no read on `crm_opportunity` was shown Opportunities and My Deals, each
 * ending in "You don't have access". The fixture below is that app's shape:
 * both entries are `type: 'object'` on `crm_opportunity`, one in a group with a
 * readable sibling, one alone in its group.
 *
 * The verdict is the REAL `MePermissionsProvider`'s, fed the `/me/permissions`
 * answer through its `fetcher` — the permissions the console already loads —
 * so this also measures that the gate costs no request per entry.
 *
 * Harness: the provider / chrome mocks of `UnifiedSidebar.docAudience-10188.test.tsx`,
 * except that `@object-ui/permissions` is NOT mocked; `MetadataProvider`,
 * `@object-ui/layout` and `@object-ui/components` stay real.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationArea, NavigationItem } from '@object-ui/types';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  }),
  useObjectLabel: () => ({
    objectLabel: ({ label }: { label?: string }) => label,
    viewLabel: (_o: string, _v: string, fallback?: string) => fallback,
    dashboardLabel: ({ label }: { label?: string }) => label,
    appLabel: ({ label }: { label?: string }) => label,
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: null, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

vi.mock('../../providers/ExpressionProvider', () => ({
  useExpressionContext: () => ({ evaluator: null }),
  evaluateVisibility: (expr: unknown) => expr !== false && expr !== 'false',
  evaluateNavigationVisibility: (expr: unknown) => expr !== false && expr !== 'false',
}));

vi.mock('../../utils', () => ({
  resolveKeyedI18nLabel: (label: unknown) => (typeof label === 'string' ? label : ''),
  matchAppBySegment: (apps: Array<{ name?: string }>, segment?: string) =>
    apps.find((a) => a?.name === segment),
  appRouteSegment: (app: { name?: string }) => app?.name,
}));

vi.mock('../../utils/getIcon', () => ({ getIcon: () => () => null }));
vi.mock('../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: [] }) }));
vi.mock('../../hooks/useFavorites', () => ({
  useFavorites: () => ({ favorites: [], removeFavorite: vi.fn() }),
}));
vi.mock('../../hooks/useNavPins', () => ({
  useNavPins: () => ({ togglePin: vi.fn(), applyPins: (items: unknown) => items }),
}));
vi.mock('../../hooks/useNavActionDispatch', () => ({
  useNavActionDispatch: () => vi.fn(),
}));
vi.mock('../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ context: 'app', currentAppName: 'crm' }),
}));
vi.mock('../ContextSelectors', () => ({
  useAppContextSelectors: () => ({ contextValues: {}, element: null }),
  contextSelectorQueryKey: (id: string) => (id === 'active_package' ? 'package' : id),
  STUDIO_PACKAGE_SELECTOR_ID: 'active_package',
}));
vi.mock('../LocalizedSidebarTrigger', () => ({
  LocalizedSidebarTrigger: () => null,
}));

import { SidebarProvider } from '@object-ui/components';
import { MetadataProvider } from '../../providers/MetadataProvider';
import { UnifiedSidebar } from '../UnifiedSidebar';

/** HotCRM's shape, abridged to the entries this card names and their neighbours. */
const NAVIGATION: NavigationItem[] = [
  { id: 'nav_home', type: 'dashboard', dashboardName: 'crm_home', label: 'Home' },
  {
    id: 'group_sales',
    type: 'group',
    label: 'Sales',
    children: [
      { id: 'nav_account', type: 'object', objectName: 'crm_account', label: 'Accounts' },
      { id: 'nav_opportunity', type: 'object', objectName: 'crm_opportunity', label: 'Opportunities' },
    ],
  },
  {
    id: 'group_my_work',
    type: 'group',
    label: 'My Work',
    children: [
      { id: 'nav_my_deals', type: 'object', objectName: 'crm_opportunity', viewName: 'my_open_deals', label: 'My Deals' },
    ],
  },
  // Readable, but the author gated it on a grant this caller lacks.
  { id: 'nav_contact', type: 'object', objectName: 'crm_contact', label: 'Contacts', requiredPermissions: ['crm_contact:delete'] },
  { id: 'nav_help', type: 'url', url: '/help', label: 'Help' },
];

function answerFor(opportunityRead: boolean): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u_agent',
    tenantId: null,
    roles: [],
    permissionSets: ['service_agent'],
    systemPermissions: [],
    objects: {
      crm_account: { allowRead: true },
      crm_opportunity: { allowRead: opportunityRead },
      crm_contact: { allowRead: true, allowDelete: false },
    },
    fields: {},
  };
}

function adapterFor(app: Record<string, unknown>) {
  return {
    clearCache: vi.fn(),
    // objectui#13044 — the real MetadataProvider reads an object by name through
    // the adapter's `getObjectSchema`; this double answers it from its own by-name door.
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string) => Promise.resolve({ type, items: type === 'app' ? [app] : [] }),
        getItem: () => Promise.resolve({ item: null }),
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

function sidebar(app: Record<string, unknown>) {
  return (
    <MetadataProvider adapter={adapterFor(app)}>
      <MemoryRouter initialEntries={['/apps/crm']}>
        <SidebarProvider>
          <UnifiedSidebar activeAppName="crm" />
        </SidebarProvider>
      </MemoryRouter>
    </MetadataProvider>
  );
}

const CRM_APP = { name: 'crm', label: 'CRM', active: true, navigation: NAVIGATION };

/** The console's mount: the sidebar inside the provider that loads `/me/permissions`. */
function renderFor(answer: MePermissionsResponse, app: Record<string, unknown> = CRM_APP) {
  const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => answer }) as unknown as Response);
  render(
    <MePermissionsProvider endpoint="/api/v1/auth/me/permissions" fetcher={fetcher as unknown as typeof fetch}>
      {sidebar(app)}
    </MePermissionsProvider>,
  );
  return fetcher;
}

const link = (name: string) => screen.queryByRole('link', { name });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('UnifiedSidebar — an object entry follows the caller\'s read on its object (objectui#12109)', () => {
  it('the service agent: Opportunities and My Deals are not drawn; the readable entry is', async () => {
    renderFor(answerFor(false));
    await waitFor(() => expect(link('Accounts')).toBeInTheDocument());
    expect(link('Opportunities')).not.toBeInTheDocument();
    expect(link('My Deals')).not.toBeInTheDocument();
    // A group whose only entry is gated away draws no heading either.
    expect(screen.queryByText('My Work')).not.toBeInTheDocument();
    expect(screen.getByText('Sales')).toBeInTheDocument();
  });

  it('a caller who may read the object: both entries are drawn, on the same app document', async () => {
    renderFor(answerFor(true));
    await waitFor(() => expect(link('Opportunities')).toHaveAttribute('href', '/apps/crm/crm_opportunity'));
    expect(link('My Deals')).toHaveAttribute('href', '/apps/crm/crm_opportunity/view/my_open_deals');
    expect(link('Accounts')).toBeInTheDocument();
  });

  it('CONTROL: an entry that is not bound to an object is unchanged', async () => {
    renderFor(answerFor(false));
    await waitFor(() => expect(link('Accounts')).toBeInTheDocument());
    expect(link('Home')).toHaveAttribute('href', '/apps/crm/dashboard/crm_home');
    expect(link('Help')).toBeInTheDocument();
  });

  it('an authored `requiredPermissions` still applies on top of a readable object', async () => {
    renderFor(answerFor(true));
    await waitFor(() => expect(link('Accounts')).toBeInTheDocument());
    expect(link('Contacts')).not.toBeInTheDocument();
  });

  it('the verdict comes from the one permissions read the shell already makes, not a request per entry', async () => {
    const fetcher = renderFor(answerFor(false));
    await waitFor(() => expect(link('Accounts')).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('an area whose only entries are unreadable is not offered, and is not elected', async () => {
    const areas: NavigationArea[] = [
      {
        id: 'area_sales',
        label: 'Pipeline',
        navigation: [{ id: 'nav_opportunity', type: 'object', objectName: 'crm_opportunity', label: 'Opportunities' }],
      },
      {
        id: 'area_service',
        label: 'Service',
        navigation: [{ id: 'nav_account', type: 'object', objectName: 'crm_account', label: 'Accounts' }],
      },
      {
        id: 'area_insight',
        label: 'Insight',
        navigation: [{ id: 'nav_home', type: 'dashboard', dashboardName: 'crm_home', label: 'Home' }],
      },
    ];
    renderFor(answerFor(false), { name: 'crm', label: 'CRM', active: true, navigation: [], areas });
    await waitFor(() => expect(link('Accounts')).toBeInTheDocument());
    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.getByText('Insight')).toBeInTheDocument();
    expect(screen.queryByText('Pipeline')).not.toBeInTheDocument();
    expect(link('Opportunities')).not.toBeInTheDocument();
  });

  it('with no permission provider the answer is unknown, and an unknown hides nothing', async () => {
    render(sidebar(CRM_APP));
    await waitFor(() => expect(link('Opportunities')).toBeInTheDocument());
    expect(link('My Deals')).toBeInTheDocument();
    expect(link('Accounts')).toBeInTheDocument();
  });
});
