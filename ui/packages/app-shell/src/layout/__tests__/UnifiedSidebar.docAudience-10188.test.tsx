// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — a `doc` navigation entry the member may not read is not
 * drawn (objectui#10188), as defence in depth behind the server.
 *
 * On a current server the app read already drops such an entry
 * (objectstack#19790), so the sidebar never receives it; that ruling's point 2
 * keeps the renderer's pruning behind it. This pins the case the defence is
 * FOR: an app document that still carries every entry (a server that did not
 * prune), rendered for two members whose own `doc` / `book` reads differ. The
 * sidebar's answer comes from those reads alone — through the REAL
 * `MetadataProvider` cache, fed by an adapter that answers per member — and
 * never from an `audience`.
 *
 * Harness: the provider / chrome mocks of
 * `UnifiedSidebar.navLabelInheritsTarget-9868.test.tsx`, except that
 * `MetadataProvider` is the real one; `@object-ui/layout` and
 * `@object-ui/components` stay REAL.
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

vi.mock('@object-ui/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/permissions')>()),
  usePermissions: () => ({ can: () => true, hasCapabilities: () => true }),
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

const PKG = 'com.example.crm';

/** The app as a server that did NOT prune it would serve it — every entry, to every member. */
const NAVIGATION: NavigationItem[] = [
  { id: 'nav_leads', type: 'object', label: 'Leads', objectName: 'crm_lead' },
  { id: 'nav_open_doc', type: 'doc', label: 'Open doc', doc: 'crm_gs_welcome' },
  { id: 'nav_open_book', type: 'doc', label: 'Open book', book: 'crm_manual' },
  { id: 'nav_pkg_book', type: 'doc', label: 'Package docs', book: PKG },
  { id: 'nav_staff_doc', type: 'doc', label: 'Staff doc', doc: 'crm_staff_secret' },
  { id: 'nav_staff_book', type: 'doc', label: 'Staff book', book: 'crm_staff_manual' },
  { id: 'nav_staff_both', type: 'doc', label: 'Staff doc in book', book: 'crm_staff_manual', doc: 'crm_staff_secret' },
];

/** Each member's own reads, as the server prunes them per caller (ADR-0046 §6.7). */
const MEMBERS = {
  insider: {
    doc: [
      { name: 'crm_gs_welcome', _packageId: PKG },
      { name: 'crm_staff_secret', _packageId: PKG },
    ],
    book: [
      { name: 'crm_manual', _packageId: PKG },
      { name: 'crm_staff_manual', _packageId: PKG, audience: { permissionSet: 'crm_staff' } },
    ],
  },
  outsider: {
    doc: [{ name: 'crm_gs_welcome', _packageId: PKG }],
    book: [{ name: 'crm_manual', _packageId: PKG }],
  },
} as const;

function adapterFor(member: keyof typeof MEMBERS, navigation: NavigationItem[], calls: string[]) {
  const lists: Record<string, readonly unknown[]> = {
    app: [{ name: 'crm', label: 'CRM', active: true, navigation }],
    doc: MEMBERS[member].doc,
    book: MEMBERS[member].book,
  };
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
        getItems: (type: string) => {
          calls.push(type);
          return Promise.resolve({ type, items: lists[type] ?? [] });
        },
        getItem: () => Promise.resolve({ item: null }),
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

function renderSidebar(member: keyof typeof MEMBERS, navigation: NavigationItem[] = NAVIGATION) {
  const calls: string[] = [];
  render(
    <MetadataProvider adapter={adapterFor(member, navigation, calls)}>
      <MemoryRouter initialEntries={['/apps/crm']}>
        <SidebarProvider>
          <UnifiedSidebar activeAppName="crm" />
        </SidebarProvider>
      </MemoryRouter>
    </MetadataProvider>,
  );
  return calls;
}

const link = (name: string) => screen.queryByRole('link', { name });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('UnifiedSidebar — a `doc` entry follows the member\'s own reads (objectui#10188)', () => {
  it('outsider: the staff page, book and page-in-book are not drawn; the readable ones are', async () => {
    renderSidebar('outsider');
    await waitFor(() => expect(link('Open doc')).toBeInTheDocument());
    await waitFor(() => expect(link('Staff doc')).not.toBeInTheDocument());
    expect(link('Staff book')).not.toBeInTheDocument();
    expect(link('Staff doc in book')).not.toBeInTheDocument();
    expect(link('Open book')).toHaveAttribute('href', '/apps/crm/docs/crm_manual');
    // The implicit per-package book: a package the member reads a doc from.
    expect(link('Package docs')).toHaveAttribute('href', `/apps/crm/docs/${PKG}`);
    expect(link('Leads')).toBeInTheDocument();
  });

  it('insider: every entry is drawn, on the same app document', async () => {
    renderSidebar('insider');
    await waitFor(() => expect(link('Staff doc')).toHaveAttribute('href', '/apps/crm/docs/crm_staff_secret'));
    expect(link('Staff book')).toHaveAttribute('href', '/apps/crm/docs/crm_staff_manual');
    expect(link('Staff doc in book')).toHaveAttribute('href', '/apps/crm/docs/crm_staff_manual/crm_staff_secret');
    expect(link('Open doc')).toBeInTheDocument();
    expect(link('Open book')).toBeInTheDocument();
  });

  it('the lists are read through the shell\'s metadata cache, once per type', async () => {
    const calls = renderSidebar('outsider');
    await waitFor(() => expect(link('Open doc')).toBeInTheDocument());
    await waitFor(() => expect(link('Staff doc')).not.toBeInTheDocument());
    expect(calls.filter((t) => t === 'doc')).toHaveLength(1);
    expect(calls.filter((t) => t === 'book')).toHaveLength(1);
  });

  it('control: an app with no `doc` entry reads neither list', async () => {
    const calls = renderSidebar('outsider', [NAVIGATION[0]]);
    await waitFor(() => expect(link('Leads')).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toContain('app');
    expect(calls).not.toContain('doc');
    expect(calls).not.toContain('book');
  });

  it('a page-only menu reads the `doc` list and not the `book` list', async () => {
    const calls = renderSidebar('outsider', NAVIGATION.filter((item) => item.type !== 'doc' || !item.book));
    await waitFor(() => expect(link('Open doc')).toBeInTheDocument());
    await waitFor(() => expect(link('Staff doc')).not.toBeInTheDocument());
    expect(calls).toContain('doc');
    expect(calls).not.toContain('book');
  });
});
