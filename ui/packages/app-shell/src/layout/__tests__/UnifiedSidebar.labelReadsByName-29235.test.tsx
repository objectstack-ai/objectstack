// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29235 — the app sidebar labels an entry that has no label of its
 * own by reading its target by name, never the whole object registry.
 *
 * `UnifiedSidebar` hands `NavigationRenderer` the `useNavTargetLabel` resolver
 * (objectui#9868). It read an unlabelled object entry's label from
 * `useMetadata().objects`, which loads the whole object registry (and the
 * `/meta/view` list it is composed with) on every in-app page whose route has
 * not loaded it already: on app-crm, 551 KB for two labels. The sidebar now
 * asks with `{ byName: true }`: the entry's object by name (which the app
 * bundle answers in the console), and a dashboard entry the bundle does not
 * hold by name too.
 *
 * Real subjects: `UnifiedSidebar`, `useNavTargetLabel`, `MetadataProvider`,
 * `@object-ui/layout` and `@object-ui/components`, over a fake adapter that
 * records each read. The chrome mocks are those of
 * `UnifiedSidebar.navLabelInheritsTarget-9868.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';

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
    objectPluralLabel: ({ label }: { label?: string }) => label,
    viewLabel: (_o: string, _v: string, fallback?: string) => fallback,
    dashboardLabel: ({ label }: { label?: string }) => label,
    pageLabel: ({ label }: { label?: string }) => label,
    reportLabel: ({ label }: { label?: string }) => label,
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
  useHasExpressionScope: () => true,
}));

vi.mock('../../utils', () => ({
  resolveKeyedI18nLabel: (label: unknown) => (typeof label === 'string' ? label : ''),
  matchAppBySegment: (apps: Array<{ name?: string }>, segment?: string) => apps.find((a) => a?.name === segment),
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
  useNavigationContext: () => ({ context: 'app', currentAppName: 'ops' }),
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

// An app written without entry labels, as the spec allows (objectui#9868).
const navigation: NavigationItem[] = [
  { id: 'nav_accounts', type: 'object', objectName: 'crm_account' },
  { id: 'nav_contacts', type: 'object', objectName: 'crm_contact' },
  { id: 'nav_pipeline', type: 'dashboard', dashboardName: 'pipeline' },
];
const APP = { name: 'ops', label: 'Ops', active: true, navigation };
const OBJECTS = [
  { name: 'crm_account', label: { en: 'Account', 'zh-CN': '客户' }, fields: {} },
  { name: 'crm_contact', label: 'Contact', fields: {} },
  { name: 'crm_lead', label: 'Lead', fields: {} },
];
const DASHBOARDS = [{ name: 'pipeline', label: { en: 'Pipeline', 'zh-CN': '销售漏斗' } }];
const ITEMS: Record<string, unknown[]> = { app: [APP], object: OBJECTS, dashboard: DASHBOARDS, view: [] };

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
        getItems: (type: string) => {
          calls.push(type);
          return Promise.resolve({ type, items: structuredClone(ITEMS[type] ?? []) });
        },
        getItem: (type: string, name: string) => {
          calls.push(`${type}/${name}`);
          const item = ((ITEMS[type] ?? []) as Array<{ name: string }>).find((it) => it.name === name) ?? null;
          return Promise.resolve({ item: structuredClone(item) });
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

function renderSidebar(): string[] {
  const calls: string[] = [];
  render(
    <MemoryRouter initialEntries={['/apps/ops']}>
      <MetadataProvider adapter={makeAdapter(calls)}>
        <SidebarProvider>
          <UnifiedSidebar activeAppName="ops" />
        </SidebarProvider>
      </MetadataProvider>
    </MemoryRouter>,
  );
  return calls;
}

/** The whole-list reads a label could cost: the object registry, its views, the dashboards. */
const listReads = (calls: string[]) => calls.filter((c) => c === 'object' || c === 'view' || c === 'dashboard');

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  i18nState.language = 'en';
});
afterEach(() => cleanup());

describe('the app sidebar labels an unlabelled entry by name (objectstack#29235)', () => {
  it('each object and dashboard entry reads its target by name, never a whole list', async () => {
    const calls = renderSidebar();
    expect(await screen.findByRole('link', { name: 'Account' })).toHaveAttribute('href', '/apps/ops/crm_account');
    expect(await screen.findByRole('link', { name: 'Contact' })).toHaveAttribute('href', '/apps/ops/crm_contact');
    expect(await screen.findByRole('link', { name: 'Pipeline' })).toHaveAttribute('href', '/apps/ops/dashboard/pipeline');
    await settle();
    expect(listReads(calls)).toEqual([]);
    expect(calls.filter((c) => c.includes('/')).sort()).toEqual([
      'dashboard/pipeline',
      'object/crm_account',
      'object/crm_contact',
    ]);
  });

  it('zh-CN: an inline locale map reads the viewer’s language, as the whole list gave it', async () => {
    i18nState.language = 'zh-CN';
    const calls = renderSidebar();
    expect(await screen.findByRole('link', { name: '客户' })).toHaveAttribute('href', '/apps/ops/crm_account');
    expect(await screen.findByRole('link', { name: '销售漏斗' })).toHaveAttribute('href', '/apps/ops/dashboard/pipeline');
    await settle();
    expect(listReads(calls)).toEqual([]);
  });
});
