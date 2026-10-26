// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — an app's navigation group opens on first view unless it
 * declares `expanded: false`, however many children it holds (objectui#13336).
 *
 * Measured on Setup: Configuration (13 entries, no `expanded`) opened
 * collapsed beside Advanced (`expanded: false`), because the renderer closed
 * any undeclared group of eight or more. Pinned here in the real sidebar: the
 * undeclared 13-entry group is open with every entry linked, the declared
 * group is closed, and a declared-closed group that holds the current route
 * opens.
 *
 * Harness: the provider / chrome mocks of `UnifiedSidebar.reportIndexLink-13020.test.tsx`,
 * with `useMetadata` answered in place as `UnifiedSidebar.pinnedOrder-12059.test.tsx`
 * does; `@object-ui/layout` and `@object-ui/components` stay REAL.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
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
  useNavigationContext: () => ({ context: 'app', currentAppName: 'setup' }),
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

const entries = (prefix: string, count: number): NavigationItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `nav_${prefix}_${i + 1}`,
    type: 'object',
    objectName: `${prefix}_${i + 1}`,
    label: `${prefix} ${i + 1}`,
  })) as NavigationItem[];

/** Setup's shape: an undeclared 13-entry group, and a group declared closed. */
const NAVIGATION: NavigationItem[] = [
  { id: 'group_configuration', type: 'group', label: 'Configuration', children: entries('config', 13) },
  { id: 'group_advanced', type: 'group', label: 'Advanced', expanded: false, children: entries('advanced', 3) },
] as NavigationItem[];

function renderSidebar(path = '/apps/setup') {
  metadataState = {
    apps: [{ name: 'setup', label: 'Setup', active: true, navigation: NAVIGATION }],
    objects: [],
  };
  render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>
        <UnifiedSidebar activeAppName="setup" />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

const disclosure = (label: string) => screen.getByRole('button', { name: label });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(cleanup);

describe('UnifiedSidebar — a group opens unless it declares otherwise (objectui#13336)', () => {
  it('the undeclared 13-entry group opens, every entry linked', () => {
    renderSidebar();
    expect(disclosure('Configuration')).toHaveAttribute('aria-expanded', 'true');
    for (let i = 1; i <= 13; i += 1) {
      expect(screen.getByRole('link', { name: `config ${i}` })).toHaveAttribute(
        'href',
        `/apps/setup/config_${i}`,
      );
    }
  });

  it('the group declaring `expanded: false` stays collapsed', () => {
    renderSidebar();
    expect(disclosure('Advanced')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'advanced 1' })).not.toBeInTheDocument();
  });

  it('a declared-closed group holding the current route opens', () => {
    renderSidebar('/apps/setup/advanced_3');
    expect(disclosure('Advanced')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'advanced 3' })).toBeInTheDocument();
  });
});
