// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — a recent Studio PACKAGE entry is left out of the app
 * sidebar's Recent group (objectui#11863).
 *
 * A package entry stores the package's identity only, and its label comes from
 * the package list (`useRecentItemLabel`'s `packages`). This sidebar loads no
 * package list — `GET /api/v1/packages` is a Studio read, refused without
 * `studio.access` or `setup.access` — so drawing the entry here could only show
 * the raw package id, the regression objectui#11678 retired. The Studio landing
 * lists recent packages instead. The other kinds are listed as before.
 *
 * Harness: the provider / chrome mocks of
 * `UnifiedSidebar.navLabelInheritsTarget-9868.test.tsx`, with the store's list
 * swapped per test; `useRecentItemLabel`, `@object-ui/layout` and
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

const at = '2026-10-08T09:00:00.000Z';
const PACKAGE = { id: 'package:com.acme.crm', type: 'package', name: 'com.acme.crm', href: '/studio/com.acme.crm', visitedAt: at };
const METADATA = { id: 'metadata:object:account', type: 'metadata', label: 'account', href: '/apps/crm/metadata/object/account', visitedAt: at };

function sidebarUi() {
  metadataState = { apps: [{ name: 'crm', label: 'CRM', active: true, navigation: [] }], objects: [] };
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

describe('UnifiedSidebar — a recent package is not drawn without a package list (objectui#11863)', () => {
  it('lists the other kinds and leaves the package entry out', () => {
    recent.items = [PACKAGE, METADATA];
    render(sidebarUi());

    const group = openRecent();
    expect(within(group).getByRole('link', { name: /\baccount$/ })).toHaveAttribute('href', METADATA.href);
    expect(within(group).queryByText('com.acme.crm')).not.toBeInTheDocument();
    expect(group.querySelector(`a[href="${PACKAGE.href}"]`)).toBeNull();
  });

  it('with only package entries there is no Recent group at all', () => {
    recent.items = [PACKAGE];
    render(sidebarUi());

    expect(screen.queryByText('Recent')).not.toBeInTheDocument();
    expect(screen.queryByText('com.acme.crm')).not.toBeInTheDocument();
  });

  it('control: a store with no package entry draws its Recent group as before', () => {
    recent.items = [METADATA];
    render(sidebarUi());

    expect(within(openRecent()).getByRole('link', { name: /\baccount$/ })).toBeInTheDocument();
  });
});
