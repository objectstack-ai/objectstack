// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — the app sidebar's Recent group still renders once the store
 * holds records and list views (objectui#12604).
 *
 * The store is the one Home's "Recently accessed" reads, and since
 * objectui#12604 it keeps the last 20 entries, a list view among its kinds. The
 * sidebar reads the same list: a record shows the title it was visited under,
 * a list view its view's label, each linking to its own address.
 *
 * Harness: `UnifiedSidebar.recentPackage-11863.test.tsx`'s, with the store's
 * list swapped per test; `useRecentItemLabel`, `@object-ui/layout` and
 * `@object-ui/components` stay REAL.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const i18nState = vi.hoisted(() => ({ language: 'en' }));
/** What the store holds, swapped per test. */
const recent = vi.hoisted(() => ({ items: [] as unknown[] }));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: i18nState.language,
  }),
  // No translation bundle: every convention lookup answers its fallback.
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

vi.mock('@object-ui/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/permissions')>()),
  usePermissions: () => ({ can: () => true, hasCapabilities: () => true }),
}));

let metadataState: { apps: unknown[]; objects: unknown[] };
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => metadataState,
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
vi.mock('../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: recent.items }) }));
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
import { UnifiedSidebar } from '../UnifiedSidebar';

const at = '2026-10-16T09:00:00.000Z';
const RECORD = {
  id: 'record:crm_account:a1',
  type: 'record',
  label: 'Acme Corporation',
  href: '/apps/crm/crm_account/record/a1',
  visitedAt: at,
};
const VIEW = {
  id: 'view:crm_account:crm_account.all_accounts',
  type: 'view',
  object: 'crm_account',
  name: 'crm_account.all_accounts',
  href: '/apps/crm/crm_account/view/crm_account.all_accounts',
  visitedAt: at,
};
const DASHBOARD = { id: 'dashboard:exec', type: 'dashboard', name: 'exec', href: '/apps/crm/dashboard/exec', visitedAt: at };

function sidebarUi() {
  metadataState = {
    apps: [{ name: 'crm', label: 'CRM', active: true, navigation: [] }],
    objects: [
      {
        name: 'crm_account',
        label: 'Account',
        listViews: { 'crm_account.all_accounts': { name: 'crm_account.all_accounts', label: 'All Accounts' } },
      },
    ],
  };
  return (
    <MemoryRouter initialEntries={['/apps/crm']}>
      <SidebarProvider>
        <UnifiedSidebar activeAppName="crm" />
      </SidebarProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  i18nState.language = 'en';
  recent.items = [];
});

/** The Recent group, found by its label and opened (it starts collapsed). */
function openRecent(): HTMLElement {
  const label = screen.getByText('Recent');
  fireEvent.click(label);
  return label.closest('[data-sidebar="group"]') as HTMLElement;
}

describe('UnifiedSidebar — Recent with records and list views in the store (objectui#12604)', () => {
  it('draws a record and a list view, each linking to its own address', () => {
    recent.items = [RECORD, VIEW, DASHBOARD];
    render(sidebarUi());

    const group = openRecent();
    expect(within(group).getByRole('link', { name: /Acme Corporation$/ })).toHaveAttribute('href', RECORD.href);
    expect(within(group).getByRole('link', { name: /All Accounts$/ })).toHaveAttribute('href', VIEW.href);
    expect(within(group).getAllByRole('link')).toHaveLength(3);
  });

  it('shows the newest five of a full store', () => {
    recent.items = Array.from({ length: 20 }, (_, i) => ({ ...RECORD, id: `record:crm_account:r${i}`, label: `Record ${i}`, href: `/apps/crm/crm_account/record/r${i}` }));
    render(sidebarUi());

    const links = within(openRecent()).getAllByRole('link');
    expect(links.map((a) => a.textContent?.replace(/^\W+/u, '').trim())).toEqual([
      'Record 0', 'Record 1', 'Record 2', 'Record 3', 'Record 4',
    ]);
  });
});
