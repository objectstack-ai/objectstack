// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12913 — inside an app, the top bar a host gets when it asks for no
 * app switcher and the viewer is served one app.
 *
 * Through the real `AppHeader`, the real `AppSwitcher`, the real
 * `PreviewBadge` and the real runtime-config loader (a stubbed
 * `GET /api/v1/runtime/config`):
 *   - no pill trigger: the app's glyph and name stand in its slot, after the
 *     product mark and its `/` rule;
 *   - the platform-stage chip is still drawn, beside the app's name, as it is
 *     beside the pill (objectui#12461).
 *
 * CONTROLS: two served apps keep the pill, with the chip beside it; a payload
 * without the key keeps the pill for one served app.
 *
 * Layout is not measured (jsdom applies no stylesheet), so the order of the
 * left group's elements is what is asserted, as in
 * `AppHeader.appBarLeftGroup-12461`, whose harness this file follows.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

const served = vi.hoisted(() => ({ apps: [] as Array<Record<string, unknown>> }));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/apps/cloud_control/project', search: '', hash: '', state: null, key: 't' }),
  useParams: () => ({ appName: 'cloud_control' }),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(''), vi.fn()] as const,
  Link: ({ children, to, ...p }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <a href={String(to)} {...p}>{children}</a>
  ),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    language: 'en',
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useObjectLabel: () => {
    const label = (x: { name?: string; label?: string } | string) =>
      typeof x === 'string' ? x : String(x?.label ?? x?.name ?? '');
    return {
      objectLabel: label,
      objectPluralLabel: (x: { name?: string; label?: string; pluralLabel?: string }) =>
        String(x?.pluralLabel ?? x?.label ?? x?.name ?? ''),
      dashboardLabel: label,
      pageLabel: label,
      reportLabel: label,
      viewLabel: (_o: string, _v: string, fallback?: string) => fallback ?? '',
      appLabel: label,
    };
  },
}));

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOffline: () => ({ isOnline: true }),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  PresenceAvatars: () => null,
  useTenantPresence: () => [],
}));

vi.mock('../ModeToggle', () => ({ ModeToggle: () => null }));
vi.mock('../WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => null }));
vi.mock('../CurrentOrganizationIndicator', () => ({ CurrentOrganizationIndicator: () => null }));
vi.mock('../LocaleSwitcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('../ConnectionStatus', () => ({ ConnectionStatus: () => null }));
vi.mock('../LocalizedSidebarTrigger', () => ({ LocalizedSidebarTrigger: () => null }));
vi.mock('../InboxPopover', () => ({ InboxPopover: () => <span data-testid="inbox-stub" /> }));
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));
vi.mock('../../context/NavigationContext.js', () => ({
  useNavigationContext: () => ({ currentAppName: 'cloud_control', recordTitle: undefined }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Lin Yue', email: 'linyue@example.com' },
    signOut: vi.fn(),
    isAuthEnabled: true,
    organizations: [],
    activeOrganization: null,
    isOrganizationsLoading: false,
    getAuthConfig: undefined,
  }),
  getUserInitials: () => 'LY',
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: served.apps, dashboards: [], pages: [], reports: [] }),
}));

// One adapter object for the file: the shared feeds key on the adapter's
// identity (objectui#12615).
const ADAPTER = vi.hoisted(() => ({ find: () => Promise.resolve({ data: [] }), getClient: () => undefined }));
vi.mock('../../providers/AdapterProvider', () => ({
  useAdapter: () => ADAPTER,
}));

import { AppHeader } from '../AppHeader';
import { CommandPaletteProvider } from '../../context/CommandPaletteProvider';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../runtime-config';

const MEMBER: MePermissionsResponse = {
  authenticated: true,
  userId: 'u1',
  tenantId: 'org_1',
  roles: [],
  permissionSets: [],
  systemPermissions: [],
  objects: {},
  fields: {},
};

const CLOUD = { name: 'cloud_control', label: 'Cloud', icon: 'cloud', navigation: [{ type: 'object', objectName: 'project' }] };
const CLOUD_ADMIN = { name: 'platform_admin', label: 'Cloud Admin', icon: 'shield' };
const ACCOUNT = { name: 'account', label: 'Account', icon: 'user', hidden: true };

/** Serve `runtimeConfig` at `/api/v1/runtime/config`, run the real loader, and answer every other GET empty. */
async function serveRuntimeConfig(runtimeConfig: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).endsWith('/api/v1/runtime/config') ? runtimeConfig : { data: [] }),
    })),
  );
  await initRuntimeConfig();
}

function mount() {
  return render(
    <MePermissionsProvider initialPermissions={MEMBER}>
      <CommandPaletteProvider>
        <AppHeader variant="app" appName="Cloud" activeAppName="cloud_control" onAppChange={vi.fn()} objects={[]} />
      </CommandPaletteProvider>
    </MePermissionsProvider>,
  );
}

/** The left group's element that holds the app's slot (the pill or its stand-in). */
const slotOf = (el: HTMLElement) => el.parentElement!;

beforeEach(() => {
  served.apps = [];
});

afterEach(() => {
  resetRuntimeConfigForTesting();
  vi.unstubAllGlobals();
});

describe('the host asked, and the viewer is served one app (objectui#12913)', () => {
  it('no pill trigger: the app\'s name stands in its slot after the product mark, and the chip still follows it', async () => {
    await serveRuntimeConfig({ hideSingleAppSwitcher: true });
    served.apps = [CLOUD, ACCOUNT];
    mount();

    expect(screen.queryByTestId('app-switcher-trigger')).not.toBeInTheDocument();
    expect(screen.queryByText('All apps')).not.toBeInTheDocument();

    const identity = screen.getByTestId('app-switcher-single-app');
    expect(identity).toHaveTextContent('Cloud');

    const mark = screen.getByTestId('app-bar-product-home');
    const rule = screen.getByTestId('app-bar-home-separator');
    expect(Boolean(mark.compareDocumentPosition(rule) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(rule.nextElementSibling).toBe(slotOf(identity));

    const chip = screen.getByTestId('platform-preview-badge');
    expect(chip).toHaveTextContent(/preview/i);
    expect(slotOf(identity).nextElementSibling).toBe(chip);
  });
});

describe('CONTROLS (objectui#12913)', () => {
  it('a viewer served two apps keeps the pill, with the chip beside it', async () => {
    await serveRuntimeConfig({ hideSingleAppSwitcher: true });
    served.apps = [CLOUD, CLOUD_ADMIN, ACCOUNT];
    mount();

    expect(screen.queryByTestId('app-switcher-single-app')).not.toBeInTheDocument();
    const pill = screen.getByTestId('app-switcher-trigger');
    expect(pill).toHaveAttribute('title', 'Cloud');
    expect(slotOf(pill).nextElementSibling).toBe(screen.getByTestId('platform-preview-badge'));
  });

  it('without the key, a viewer served one app keeps the pill', async () => {
    await serveRuntimeConfig({});
    served.apps = [CLOUD, ACCOUNT];
    mount();

    expect(screen.queryByTestId('app-switcher-single-app')).not.toBeInTheDocument();
    const pill = screen.getByTestId('app-switcher-trigger');
    expect(slotOf(pill).nextElementSibling).toBe(screen.getByTestId('platform-preview-badge'));
  });
});
