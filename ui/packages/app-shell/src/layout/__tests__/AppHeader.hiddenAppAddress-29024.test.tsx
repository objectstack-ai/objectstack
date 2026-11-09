// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#29024 — the avatar menu's entry for a hidden app
 * opens THAT app.
 *
 * `hidden: true` keeps an app off the launcher and the switcher; the avatar
 * menu is the door left to it. The entry linked to the app's package id, and
 * `/apps/PACKAGE_ID` resolves to the package's FIRST app, so a hidden app that
 * shares its package with a visible first app could not be reached from the
 * menu at all: the entry opened the first app. It now links to the app's one
 * address (`appAddressSegment`): the package id where that resolves back to
 * the app, else the app's name.
 *
 * The card's reproduction (QA run #29002): package `com.qa.r6nav` ships
 * `qsixn_app` (first, visible) and `qsixn_hidden_app` (hidden). A hidden app
 * that is its package's only or first app keeps its package-id address.
 *
 * The avatar-menu harness is `AppHeader.myOrganizations.test.tsx`'s:
 * passthrough menu primitives, so the entries render and click without radix.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const navigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/home', search: '', hash: '', state: null, key: 'test' }),
  useParams: () => ({}),
  useNavigate: () => navigate,
  useSearchParams: () => [new URLSearchParams(), vi.fn()] as const,
  Link: ({ children, to, ...p }: any) => <a href={String(to)} {...p}>{children}</a>,
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    language: 'en',
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useObjectLabel: () => ({
    objectLabel: (n: string) => n,
    dashboardLabel: (n: string) => n,
    pageLabel: (n: string) => n,
    reportLabel: (n: string) => n,
    viewLabel: (n: string) => n,
    appLabel: (x: { name?: string; label?: string }) => String(x?.label ?? x?.name ?? ''),
  }),
}));

/**
 * Passthrough menu primitives — unlike the sibling inbox test, the avatar
 * dropdown's CONTENT is the subject here, so `DropdownMenuContent` must render
 * its children rather than the `() => null` that suffices when only the bell is
 * under test. Radix would otherwise keep the closed menu unmounted in jsdom.
 */
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stripProps = (p: any) => {
    const { asChild, variant, size, align, sideOffset, ...rest } = p ?? {};
    return rest;
  };
  const Pass = ({ children, ...p }: any) => <div {...stripProps(p)}>{children}</div>;
  return {
    ...actual,
    Button: ({ children, asChild, variant, size, ...p }: any) => (
      <button type="button" {...p}>{children}</button>
    ),
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: Pass,
    // Menu items must be clickable — the assertion is where `onClick` navigates.
    DropdownMenuItem: ({ children, onClick, ...p }: any) => (
      <button type="button" onClick={onClick} {...stripProps(p)}>{children}</button>
    ),
    DropdownMenuLabel: Pass,
    DropdownMenuSeparator: () => null,
    DropdownMenuGroup: Pass,
    Avatar: Pass,
    AvatarImage: () => null,
    AvatarFallback: Pass,
    Popover: Pass,
    PopoverTrigger: Pass,
    PopoverContent: () => null,
    Tabs: Pass,
    TabsList: Pass,
    TabsTrigger: ({ children }: any) => <button type="button">{children}</button>,
    TabsContent: Pass,
    cn: (...c: any[]) => c.filter(Boolean).join(' '),
  };
});

vi.mock('lucide-react', () => {
  const Icon = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, prop) => {
      if (prop === 'then' || prop === '__esModule' || typeof prop === 'symbol') {
        return target[prop];
      }
      return Icon;
    },
    has: (_target, prop) => prop !== 'then',
  });
});

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
vi.mock('../LocaleSwitcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('../ConnectionStatus', () => ({ ConnectionStatus: () => null }));
vi.mock('../AppSwitcher', () => ({ AppSwitcher: () => null }));
vi.mock('../LocalizedSidebarTrigger', () => ({ LocalizedSidebarTrigger: () => null }));
vi.mock('../PreviewBadge', () => ({ PreviewBadge: () => null }));

vi.mock('../WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => null }));

/** The metadata app list the menu reads, which `/apps/SEGMENT` also resolves on. */
const served = vi.hoisted(() => ({ apps: [] as Array<Record<string, unknown>> }));
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: served.apps, dashboards: [], pages: [], reports: [] }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => {
  // One stable identity for the file: the header resolves it in an effect
  // keyed on it, so a fresh closure per call would loop (see the
  // `AppHeader.myOrganizations` harness).
  const getAuthConfig = () => Promise.resolve({ features: { multiOrgEnabled: true } });
  const org = { id: 'org_1', name: 'Acme', slug: 'acme' };
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useAuth: () => ({
      user: { id: 'u1', name: 'Zhang San', email: 'zs@example.com' },
      signOut: vi.fn(),
      isAuthEnabled: true,
      organizations: [org],
      activeOrganization: org,
      isOrganizationsLoading: false,
      switchOrganization: vi.fn(),
      getAuthConfig,
    }),
    getUserInitials: () => 'ZS',
    useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  };
});

/** Stable adapter identity: the bell's pollers key their effects off it. */
const fakeAdapter = {
  find: () => Promise.resolve({ data: [] }),
  getClient: () => undefined,
};

vi.mock('../../providers/AdapterProvider', () => ({
  useAdapter: () => fakeAdapter,
}));

import { AppHeader } from '../AppHeader';

const FIRST = { name: 'qsixn_app', label: 'R6 App', icon: 'folder', _packageId: 'com.qa.r6nav' };
const HIDDEN = { name: 'qsixn_hidden_app', label: 'R6 Hidden App', icon: 'settings', hidden: true, _packageId: 'com.qa.r6nav' };
const SOLO = { name: 'solo_settings', label: 'Solo Settings', icon: 'settings', hidden: true, _packageId: 'com.qa.solo' };
const HIDDEN_FIRST = { name: 'lead_settings', label: 'Lead Settings', icon: 'settings', hidden: true, _packageId: 'com.qa.lead' };
const AFTER_HIDDEN = { name: 'lead_app', label: 'Lead App', icon: 'folder', _packageId: 'com.qa.lead' };

beforeEach(() => {
  navigate.mockClear();
  served.apps = [FIRST, HIDDEN, SOLO, HIDDEN_FIRST, AFTER_HIDDEN];
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 404 }))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppHeader avatar menu — a hidden app opens itself (objectstack-ai/objectstack#29024)', () => {
  it('a hidden app sharing its package with the first app opens on its own name', () => {
    render(<AppHeader variant="home" />);

    screen.getByRole('button', { name: 'R6 Hidden App' }).click();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/apps/qsixn_hidden_app');
  });

  it('a hidden app alone in its package keeps its package-id address', () => {
    render(<AppHeader variant="home" />);

    screen.getByRole('button', { name: 'Solo Settings' }).click();

    expect(navigate).toHaveBeenCalledWith('/apps/com.qa.solo');
  });

  it('a hidden app that is its package\'s first app keeps its package-id address', () => {
    render(<AppHeader variant="home" />);

    screen.getByRole('button', { name: 'Lead Settings' }).click();

    expect(navigate).toHaveBeenCalledWith('/apps/com.qa.lead');
  });

  it('lists hidden apps only: the visible apps are not avatar-menu entries', () => {
    render(<AppHeader variant="home" />);

    expect(screen.queryByRole('button', { name: 'R6 App' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lead App' })).toBeNull();
  });
});

/**
 * objectstack-ai/objectstack#30895 — Connect an AI Assistant is in the avatar
 * menu, the person's own things, for every signed-in person. The entry opens
 * the page inside the Account app and is drawn only while the served Account
 * app carries that page: `@objectstack/mcp` contributes the page's nav entry
 * exactly when it registers the page, so with MCP off there is no dead item.
 */
const ACCOUNT_WITH_ASSISTANT = {
  name: 'account',
  label: 'Account',
  icon: 'user-circle',
  hidden: true,
  _packageId: 'com.objectstack.account',
  navigation: [
    { id: 'nav_account_profile', type: 'component', label: 'Profile', componentRef: 'account:profile_card' },
    {
      id: 'grp_account_ai_assistant',
      type: 'group',
      label: 'AI Assistant',
      expanded: true,
      children: [
        { id: 'nav_connect_agent', type: 'page', pageName: 'connect_agent', label: 'Connect an AI Assistant' },
      ],
    },
  ],
};
const ACCOUNT_WITHOUT_ASSISTANT = {
  ...ACCOUNT_WITH_ASSISTANT,
  navigation: [ACCOUNT_WITH_ASSISTANT.navigation[0]],
};

describe('AppHeader avatar menu — Connect an AI Assistant (objectstack-ai/objectstack#30895)', () => {
  it('opens the page inside the Account app, at the app\'s one address', () => {
    served.apps = [FIRST, ACCOUNT_WITH_ASSISTANT];
    render(<AppHeader variant="home" />);

    screen.getByTestId('header-connect-ai-assistant').click();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/apps/com.objectstack.account/page/connect_agent');
  });

  it('is labelled Connect an AI Assistant', () => {
    served.apps = [FIRST, ACCOUNT_WITH_ASSISTANT];
    render(<AppHeader variant="home" />);

    expect(screen.getByRole('button', { name: 'Connect an AI Assistant' })).toBeInTheDocument();
  });

  it('draws nothing when the served Account app does not carry the page (MCP off)', () => {
    served.apps = [FIRST, ACCOUNT_WITHOUT_ASSISTANT];
    render(<AppHeader variant="home" />);

    expect(screen.queryByTestId('header-connect-ai-assistant')).toBeNull();
  });

  it('draws nothing when no Account app is served', () => {
    served.apps = [FIRST];
    render(<AppHeader variant="home" />);

    expect(screen.queryByTestId('header-connect-ai-assistant')).toBeNull();
  });
});
