// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — an app navigation entry with NO `label` shows its target's
 * CURRENT label from the metadata cache (objectui#9868, the cloud#2021
 * letter-A ruling).
 *
 * This pins the WIRING in the real sidebar: `UnifiedSidebar` hands
 * `NavigationRenderer` the `useNavTargetLabel` resolver, which reads the
 * object schemas `useMetadata()` publishes. The rename case re-renders the same
 * navigation over a new metadata value and expects the new name — nothing is
 * stored on the nav entry.
 *
 * objectui#11299 adds the locale half of the same wiring: an entry label
 * written as an inline locale map renders the viewer's `language` — the value
 * `useObjectTranslation()` answers, which the sidebar already resolves its area
 * labels in — because `UnifiedSidebar` hands it to `NavigationRenderer` as
 * `locale`.
 *
 * Harness: the provider / chrome mocks of
 * `UnifiedSidebar.derivedAreaVisibility.test.tsx`; `@object-ui/layout` and
 * `@object-ui/components` stay REAL.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';

// The active UI language, switchable per test (objectui#11299).
const i18nState = vi.hoisted(() => ({ language: 'en' }));

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
import { UnifiedSidebar } from '../UnifiedSidebar';

const navigation: NavigationItem[] = [
  { id: 'nav_board', type: 'object', objectName: 'customer', viewName: 'board' },
  { id: 'nav_accounts', type: 'object', objectName: 'account', label: 'account' },
  // objectui#11299: a present label written as an inline locale map.
  { id: 'nav_contacts', type: 'object', objectName: 'contact', label: { en: 'Contacts', 'zh-CN': '联系人' } },
];

function sidebarUi(viewLabel: string) {
  metadataState = {
    apps: [{ name: 'crm', label: 'CRM', active: true, navigation }],
    objects: [
      {
        name: 'customer',
        label: 'Customers',
        listViews: { 'customer.board': { name: 'customer.board', label: viewLabel } },
      },
      { name: 'account', label: 'Accounts' },
      { name: 'contact', label: 'Contact People' },
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
});

describe('UnifiedSidebar — an unlabelled entry inherits its target’s label (objectui#9868)', () => {
  it('shows the view’s label, and the renamed one on the next render', () => {
    const { rerender } = render(sidebarUi('客户管理仪表盘'));
    expect(screen.getByRole('link', { name: '客户管理仪表盘' })).toHaveAttribute(
      'href',
      '/apps/crm/customer/view/board',
    );

    rerender(sidebarUi('Customer Board'));
    expect(screen.getByRole('link', { name: 'Customer Board' })).toBeInTheDocument();
    expect(screen.queryByText('客户管理仪表盘')).not.toBeInTheDocument();
    expect(navigation[0]).not.toHaveProperty('label');
  });

  it('control: an authored label equal to the machine name stays verbatim', () => {
    render(sidebarUi('Board'));
    expect(screen.getByRole('link', { name: 'account' })).toHaveAttribute('href', '/apps/crm/account');
    expect(screen.queryByText('Accounts')).not.toBeInTheDocument();
  });
});

describe('UnifiedSidebar — a map-valued entry label reads the viewer’s language (objectui#11299)', () => {
  it('under zh-CN the entry shows its zh-CN text', () => {
    i18nState.language = 'zh-CN';
    render(sidebarUi('Board'));
    expect(screen.getByRole('link', { name: '联系人' })).toHaveAttribute('href', '/apps/crm/contact');
    expect(screen.queryByText('Contacts')).not.toBeInTheDocument();
    // A present map is not an absent label: the target's label is not shown.
    expect(screen.queryByText('Contact People')).not.toBeInTheDocument();
  });

  it('under en the same entry shows its en text', () => {
    render(sidebarUi('Board'));
    expect(screen.getByRole('link', { name: 'Contacts' })).toHaveAttribute('href', '/apps/crm/contact');
    expect(screen.queryByText('联系人')).not.toBeInTheDocument();
  });
});
