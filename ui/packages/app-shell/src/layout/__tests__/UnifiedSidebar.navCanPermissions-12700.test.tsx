// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — a navigation entry gated on `current_user.can(object, verb)`
 * follows the member's `/auth/me/permissions` answer, and is WITHHELD wherever
 * that answer is not bound (objectui#12700).
 *
 * HotCRM declares `visible: "current_user.can(\"crm_opportunity\", \"read\")"`
 * on a navigation entry. The fixture gates a `dashboard` entry, NOT an `object`
 * entry on `crm_opportunity`: an object entry is already pruned by the read
 * gate (objectui#12109), which would hide it whatever the predicate said and
 * leave this file measuring the wrong gate.
 *
 * Everything on the path is real — `MePermissionsProvider` (fed through its
 * `fetcher`, i.e. only the network is mocked), `ExpressionProvider` binding the
 * payload for `can`, `MetadataProvider`, `@object-ui/layout`'s item guard —
 * except the chrome hooks the sibling harness
 * `UnifiedSidebar.objectReadGate-12109.test.tsx` also stubs (labels, recents,
 * pins, context selectors), none of which decides visibility.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { __resetVisibilityPredicateWarnings } from '@object-ui/react';

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
import { ExpressionProvider } from '../../providers/ExpressionProvider';
import { UnifiedSidebar } from '../UnifiedSidebar';

/** The served shape: the spec normalizes an authored `visible` string into a CEL envelope. */
const CAN_READ_OPPORTUNITY = { dialect: 'cel', source: 'current_user.can("crm_opportunity", "read")' };

const NAVIGATION: NavigationItem[] = [
  { id: 'nav_accounts', type: 'object', objectName: 'crm_account', label: 'Accounts' },
  { id: 'nav_pipeline', type: 'dashboard', dashboardName: 'pipeline', label: 'Pipeline', visible: CAN_READ_OPPORTUNITY as never },
  { id: 'nav_help', type: 'url', url: '/help', label: 'Help' },
];

const CRM_APP = { name: 'crm', label: 'CRM', active: true, navigation: NAVIGATION };

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
    },
    fields: {},
  } as MePermissionsResponse;
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

/** The console's in-app mount: the sidebar under `ExpressionProvider`. */
function shell() {
  return (
    <MetadataProvider adapter={adapterFor(CRM_APP)}>
      <MemoryRouter initialEntries={['/apps/crm']}>
        <ExpressionProvider user={{ id: 'u_agent', name: 'Agent' }}>
          <SidebarProvider>
            <UnifiedSidebar activeAppName="crm" />
          </SidebarProvider>
        </ExpressionProvider>
      </MemoryRouter>
    </MetadataProvider>
  );
}

function respond(answer: MePermissionsResponse): Response {
  return { ok: true, status: 200, json: async () => answer } as unknown as Response;
}

function renderWithPermissions(fetcher: (...args: unknown[]) => Promise<Response>) {
  return render(
    <MePermissionsProvider
      endpoint="/api/v1/auth/me/permissions"
      fetcher={fetcher as unknown as typeof fetch}
      loadingFallback={<div data-testid="permissions-loading" />}
    >
      {shell()}
    </MePermissionsProvider>,
  );
}

const link = (name: string) => screen.queryByRole('link', { name });
const warnings = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  __resetVisibilityPredicateWarnings();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe('UnifiedSidebar — a `current_user.can()` navigation gate follows `/auth/me/permissions` (objectui#12700)', () => {
  it('(a) a member without read on the object is not shown the gated entry, and nothing is reported', async () => {
    renderWithPermissions(async () => respond(answerFor(false)));
    await waitFor(() => expect(link('Accounts')).toBeInTheDocument());
    expect(link('Pipeline')).not.toBeInTheDocument();
    // A denial is a verdict, not a fault: the refusal line is not printed.
    expect(warnings(warn)).not.toMatch(/app-shell:visible/);
  });

  it('(b) a member with read is shown it', async () => {
    renderWithPermissions(async () => respond(answerFor(true)));
    await waitFor(() => expect(link('Pipeline')).toHaveAttribute('href', '/apps/crm/dashboard/pipeline'));
    expect(warnings(warn)).not.toMatch(/app-shell:visible/);
  });

  it('(c) while the answer is pending the entry is absent; it appears once the answer grants read', async () => {
    let answer!: (r: Response) => void;
    const pending = new Promise<Response>((resolve) => { answer = resolve; });
    const fetcher = vi.fn(() => pending);
    renderWithPermissions(fetcher);
    // The console's posture: the provider withholds the whole shell, not one entry.
    expect(screen.getByTestId('permissions-loading')).toBeInTheDocument();
    expect(link('Pipeline')).not.toBeInTheDocument();
    await act(async () => { answer(respond(answerFor(true))); });
    await waitFor(() => expect(link('Pipeline')).toBeInTheDocument());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('(d) CONTROL: ungated entries are drawn for the member the gate hides from', async () => {
    renderWithPermissions(async () => respond(answerFor(false)));
    await waitFor(() => expect(link('Accounts')).toBeInTheDocument());
    expect(link('Help')).toBeInTheDocument();
  });

  it('with no permissions payload bound the gated entry is WITHHELD, the rest drawn, and the refusal reported once', async () => {
    // A frame with no permission provider (the Home and Studio frames).
    render(shell());
    await waitFor(() => expect(link('Accounts')).toBeInTheDocument());
    expect(link('Help')).toBeInTheDocument();
    expect(link('Pipeline')).not.toBeInTheDocument();
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('app-shell:visible'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/carries no permission data/);
    expect(lines[0]).toMatch(/WITHHELD/);
    expect(lines[0]).not.toMatch(/did NOT bite/);
  });
});
