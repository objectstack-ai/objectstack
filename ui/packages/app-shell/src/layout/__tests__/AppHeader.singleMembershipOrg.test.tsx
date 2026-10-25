// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5287 — the top bar, composed, for a user with exactly ONE
 * organization membership.
 *
 * The sibling file `CurrentOrganizationIndicator.test.tsx` holds the
 * component's own matrix. This one asserts the thing the card was actually
 * filed about, which only exists at the composition: the console top bar as a
 * whole. A user on an `isolated` deployment with one membership sees the
 * organization name AND no switcher — the switcher stays hidden because there
 * is nothing to switch to, which is the shape that was ruled (a one-entry
 * disabled dropdown was rejected). Two components have to agree for that to
 * hold, and neither of their unit tests can see the other.
 *
 * ## The reading this file replaces
 *
 * Before the fix, the same harness rendered NO organization name for this
 * session while the user's own name — a datum the bar demonstrably does
 * receive — rendered fine. That counter-probe is kept in the first case: it is
 * what makes "the name is present" a measurement of the fix rather than of the
 * query. The datum itself was never missing (`@object-ui/auth`'s
 * `singleMembershipActiveOrg-5287.test.tsx` pins that the provider carries it
 * at one membership); only the rendering was.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

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
    appLabel: (n: string) => n,
  }),
}));

// Passthrough menu primitives — the switcher's trigger and the avatar menu's
// content both have to be reachable for the presence/absence assertions.
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
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [], dashboards: [], pages: [], reports: [] }),
}));

// The REAL WorkspaceSwitcher and CurrentOrganizationIndicator, deliberately —
// mocking either away would erase the composition this file exists to assert.

const SOLO = { id: 'org_solo', name: 'Titanwind EHR', slug: 'titanwind' };
const SECOND = { id: 'org_two', name: 'Globex', slug: 'globex' };

let organizations: Array<Record<string, unknown>> = [SOLO];
let features: Record<string, unknown> = {};

vi.mock('@object-ui/auth', async (importOriginal) => {
  // ONE stable identity — see the sibling inbox/organizations header tests: a
  // fresh closure per render re-arms every `[getAuthConfig]` effect forever.
  const getAuthConfig = () => Promise.resolve({ features });
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useAuth: () => ({
      user: { id: 'u1', name: 'Zhang San', email: 'zs@example.com' },
      signOut: vi.fn(),
      isAuthEnabled: true,
      organizations,
      activeOrganization: organizations[0] ?? null,
      isOrganizationsLoading: false,
      switchOrganization: vi.fn(),
      getAuthConfig,
    }),
    getUserInitials: () => 'ZS',
    useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  };
});

const fakeAdapter = {
  find: () => Promise.resolve({ data: [] }),
  getClient: () => undefined,
};
vi.mock('../../providers/AdapterProvider', () => ({ useAdapter: () => fakeAdapter }));

import { AppHeader } from '../AppHeader';

/** Lets the async posture/config gates resolve and React flush before reading an absence. */
async function settle() {
  await waitFor(() => expect(screen.getByTestId('header-my-organizations')).toBeInTheDocument());
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  navigate.mockClear();
  organizations = [SOLO];
  features = { multiOrgEnabled: true, tenancyPosture: 'isolated' };
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 404 }))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppHeader — organization context at one membership (#5287)', () => {
  it('isolated posture: names the organization read-only, with no switcher', async () => {
    render(<AppHeader variant="home" />);

    expect(await screen.findByTestId('current-organization-indicator')).toBeInTheDocument();
    expect(screen.getByText('Titanwind EHR')).toBeInTheDocument();

    // The counter-probe that keeps the pre-fix zero honest: this bar renders
    // session data. Before the fix, this line passed and the two above did not.
    expect(screen.getByText('Zhang San')).toBeInTheDocument();

    // The ruled shape: nothing to switch to ⇒ no switcher, not a disabled one.
    expect(screen.queryByTestId('workspace-switcher')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-manage-members')).not.toBeInTheDocument();
    expect(screen.queryByText('Switch organization')).not.toBeInTheDocument();
  });

  it('multiple memberships: unchanged — the switcher renders and the indicator stands down', async () => {
    organizations = [SOLO, SECOND];
    render(<AppHeader variant="home" />);

    expect(await screen.findByTestId('workspace-switcher')).toBeInTheDocument();
    expect(screen.queryByTestId('current-organization-indicator')).not.toBeInTheDocument();
  });

  it('single-tenant posture: nothing new renders — no organization name anywhere', async () => {
    features = { multiOrgEnabled: false, tenancyPosture: 'single' };
    render(<AppHeader variant="home" />);

    await settle();
    expect(screen.queryByTestId('current-organization-indicator')).not.toBeInTheDocument();
    expect(screen.queryByText('Titanwind EHR')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-switcher')).not.toBeInTheDocument();
  });

  it('server reports no posture (older or degraded deployment): nothing new renders', async () => {
    features = { multiOrgEnabled: true };
    render(<AppHeader variant="home" />);

    await settle();
    expect(screen.queryByTestId('current-organization-indicator')).not.toBeInTheDocument();
    expect(screen.queryByText('Titanwind EHR')).not.toBeInTheDocument();
  });
});
