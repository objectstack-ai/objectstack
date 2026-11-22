// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — from 768 px up the sidebar's Recent group lists only what
 * was opened in the current app (objectstack#36112 item 5,
 * 「这个应用里的最近使用」). The store is the one Home's "Recently accessed"
 * reads and holds every app's entries; an entry belongs to the app its
 * address names (`/apps/APP/…`), resolved as the router resolves a segment.
 * An entry opened in another app, or outside every app (a Studio item), is
 * left out. The phone drawer is unchanged: it still lists every app's.
 *
 * Harness: `UnifiedSidebar.recentRecordsAndViews-12604.test.tsx`'s, with two
 * apps and the store's list swapped per test.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  useHasExpressionScope: () => true,
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

const at = '2026-11-22T09:00:00.000Z';
const record = (app: string, id: string, label: string) => ({
  id: `record:${app}_account:${id}`,
  type: 'record',
  label,
  href: `/apps/${app}/${app}_account/record/${id}`,
  visitedAt: at,
});
const CRM_RECORD = record('crm', 'a1', 'Acme Corporation');
const CRM_RECORD_2 = record('crm', 'a2', 'Globex');
const HR_RECORD = record('hr', 'e1', 'Jane Doe');
const SETUP_ITEM = { id: 'object:sys_user', type: 'object', name: 'sys_user', href: '/apps/setup/sys_user', visitedAt: at };
const STUDIO_ITEM = {
  id: 'metadata:object:crm_account',
  type: 'metadata',
  label: 'crm_account',
  href: '/studio/crm/data/object/crm_account',
  visitedAt: at,
};

function setViewportWidth(width: number) {
  (window as unknown as { happyDOM: { setViewport: (v: { width: number; height: number }) => void } }).happyDOM.setViewport({
    width,
    height: 900,
  });
}

function renderSidebar(width: number) {
  setViewportWidth(width);
  metadataState = {
    apps: [
      { name: 'crm', label: 'CRM', active: true, navigation: [] },
      { name: 'hr', label: 'HR', active: true, navigation: [] },
      { name: 'setup', label: 'Setup', active: true, navigation: [] },
    ],
    objects: [],
  };
  return render(
    <MemoryRouter initialEntries={['/apps/crm']}>
      <SidebarProvider>
        <UnifiedSidebar activeAppName="crm" />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

/** The Recent group's entries, by their text, after opening it (it starts collapsed). */
function recentEntries(): string[] {
  const label = screen.getByText('Recent');
  fireEvent.click(label);
  const group = label.closest('[data-sidebar="group"]') as HTMLElement;
  return within(group)
    .getAllByRole('link')
    .map((a) => a.textContent?.replace(/^\W+/u, '').trim() ?? '');
}

beforeEach(() => {
  localStorage.clear();
  i18nState.language = 'en';
  recent.items = [];
});

afterEach(() => {
  cleanup();
  setViewportWidth(1024);
});

describe('the sidebar’s Recent lists this app’s items (objectstack#36112)', () => {
  it('from 768 px up, only what was opened in the current app, newest first', () => {
    recent.items = [HR_RECORD, CRM_RECORD, SETUP_ITEM, STUDIO_ITEM, CRM_RECORD_2];
    renderSidebar(1024);
    expect(recentEntries()).toEqual(['Acme Corporation', 'Globex']);
  });

  it('the five it shows are this app’s newest five, not the store’s', () => {
    recent.items = [
      ...Array.from({ length: 5 }, (_, i) => record('hr', `e${i}`, `HR ${i}`)),
      ...Array.from({ length: 6 }, (_, i) => record('crm', `a${i}`, `CRM ${i}`)),
    ];
    renderSidebar(1440);
    expect(recentEntries()).toEqual(['CRM 0', 'CRM 1', 'CRM 2', 'CRM 3', 'CRM 4']);
  });

  it('with nothing opened in this app there is no Recent group', () => {
    recent.items = [HR_RECORD, SETUP_ITEM];
    renderSidebar(1024);
    expect(screen.queryByText('Recent')).toBeNull();
  });

  it('the phone drawer is unchanged: it lists every app’s entries', () => {
    recent.items = [HR_RECORD, CRM_RECORD];
    renderSidebar(700);
    // The drawer is drawn on demand: open it as the phone's trigger does (the provider's toggle, ⌘B).
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expect(document.querySelector('[data-mobile="true"][data-sidebar="sidebar"]')).not.toBeNull();
    expect(recentEntries()).toEqual(['Jane Doe', 'Acme Corporation']);
  });
});
