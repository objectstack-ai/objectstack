// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — every app's sidebar links its report index
 * (objectui#13020), so a report the app's navigation does not name still has
 * a UI path, with nothing for the app to author.
 *
 * Pinned: the entry links `/apps/APP/reports`, it is drawn for an app whose
 * navigation names no report at all, and drawing it reads no report list
 * (the sidebar is chrome on every route, objectui#12980). CONTROL: the app's
 * own navigation entries are drawn as before.
 *
 * Harness: the provider / chrome mocks of `UnifiedSidebar.objectReadGate-12109.test.tsx`;
 * `MetadataProvider`, `@object-ui/layout` and `@object-ui/components` stay real.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';

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

const NAVIGATION: NavigationItem[] = [
  { id: 'nav_account', type: 'object', objectName: 'crm_account', label: 'Accounts' },
  { id: 'nav_help', type: 'url', url: '/help', label: 'Help' },
];
const CRM_APP = { name: 'crm', label: 'CRM', active: true, navigation: NAVIGATION };

function renderSidebar() {
  const asked: string[] = [];
  const adapter = {
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
        getItems: (type: string) => {
          asked.push(type);
          return Promise.resolve({ type, items: type === 'app' ? [CRM_APP] : [] });
        },
        getItem: () => Promise.resolve({ item: null }),
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
  render(
    <MetadataProvider adapter={adapter}>
      <MemoryRouter initialEntries={['/apps/crm']}>
        <SidebarProvider>
          <UnifiedSidebar activeAppName="crm" />
        </SidebarProvider>
      </MemoryRouter>
    </MetadataProvider>,
  );
  return asked;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('UnifiedSidebar — the report index entry (objectui#13020)', () => {
  it('links the app\'s report index, though the navigation names no report', async () => {
    renderSidebar();
    await waitFor(() => expect(screen.getByRole('link', { name: 'All reports' })).toHaveAttribute('href', '/apps/crm/reports'));
  });

  it('drawing it reads no report list', async () => {
    const asked = renderSidebar();
    await waitFor(() => expect(screen.getByRole('link', { name: 'All reports' })).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(asked).not.toContain('report');
  });

  it('CONTROL: the app\'s own entries are drawn as before', async () => {
    renderSidebar();
    await waitFor(() => expect(screen.getByRole('link', { name: 'Accounts' })).toHaveAttribute('href', '/apps/crm/crm_account'));
    expect(screen.getByRole('link', { name: 'Help' })).toBeInTheDocument();
  });
});
