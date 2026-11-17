/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#8096 — a user in exactly ONE organization had no UI path to the
 * workspace management pages (Members / Invitations / Organization settings).
 * Three individually-reasonable mechanisms closed every door at once:
 *
 *   1. `/organizations` auto-skips the picker at one org (UX P0-1, deliberate);
 *   2. `WorkspaceSwitcher` returns null at `orgList.length <= 1`, so the
 *      header-left switcher — and its "Manage members" item — never renders;
 *   3. the avatar menu kept only the `?create=1` entry, having dropped the
 *      `?manage=1` "My Organizations" one on the assumption that (2) covered it.
 *
 * The fix restores (3), which the code's own comments already documented as the
 * intended design. These cases pin the restored entry AND the reason it has to
 * be the avatar menu: they assert it with the switcher rendering nothing, which
 * is precisely the single-org configuration where the defect bit.
 *
 * The destination is load-bearing, not cosmetic: `?manage=1` is what
 * OrganizationsPage reads as "came here to manage", which for a single-org user
 * re-targets the auto-skip at `/organizations/:slug/members` instead of
 * bouncing them home. A bare `/organizations` link would dead-end in exactly
 * the auto-skip this card is about, so the query string is asserted verbatim.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

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
    DropdownMenuSub: Pass,
    DropdownMenuSubTrigger: Pass,
    DropdownMenuSubContent: Pass,
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

/**
 * The REAL WorkspaceSwitcher and WorkspaceSwitcherMenu, deliberately — mocking
 * them away would erase the preconditions under test: the switcher's
 * one-membership early return is what leaves "My Organizations" as the only
 * door, and the top bar's switcher drawing nothing in a browser is what the
 * deployment-posture cases below assert.
 */
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [], dashboards: [], pages: [], reports: [] }),
}));

const ONE_ORG = { id: 'org_1', name: 'Acme', slug: 'acme' };

/** Orgs the mocked `useAuth` reports for the current case. */
let organizations: Array<Record<string, unknown>> = [ONE_ORG];
/** The served `features` the mocked auth config resolves with. */
let features: Record<string, unknown> = { multiOrgEnabled: true };

vi.mock('@object-ui/auth', async (importOriginal) => {
  /**
   * ONE stable function identity for the whole file — not a fresh arrow per
   * `useAuth()` call. Both AppHeader and WorkspaceSwitcher resolve this config
   * in a `useEffect(..., [getAuthConfig])` that ends in `setState`, so handing
   * back a new closure each render makes the dep array change every render:
   * effect → setState → render → effect, until the heap dies (the failure is a
   * V8 OOM during collection, not a test assertion). Reading the `let` at CALL
   * time keeps per-case control without touching identity.
   */
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

/**
 * Stable adapter identity, for the same reason as `getAuthConfig` above — the
 * bell's pollers key their effects off the adapter, so a fresh object per call
 * would re-arm them on every render.
 */
const fakeAdapter = {
  find: () => Promise.resolve({ data: [] }),
  getClient: () => undefined,
};

vi.mock('../../providers/AdapterProvider', () => ({
  useAdapter: () => fakeAdapter,
}));

import { AppHeader } from '../AppHeader';

beforeEach(() => {
  navigate.mockClear();
  organizations = [ONE_ORG];
  features = { multiOrgEnabled: true };
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 404 }))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppHeader avatar menu — the single-org door to workspace management (#8096)', () => {
  it('offers "My Organizations" to a user with exactly one organization', () => {
    render(<AppHeader variant="home" />);

    expect(screen.getByTestId('header-my-organizations')).toBeInTheDocument();
  });

  it('navigates to /organizations?manage=1 — the query string the manage flow reads', () => {
    render(<AppHeader variant="home" />);

    screen.getByTestId('header-my-organizations').click();

    expect(navigate).toHaveBeenCalledWith('/organizations?manage=1');
  });

  it('is the ONLY door: the workspace switcher renders nothing at one org', () => {
    render(<AppHeader variant="home" />);

    // The precondition that made #8096 bite. If this ever starts rendering,
    // the switcher's single-org early return changed and the premise of this
    // whole file should be re-read — not the assertion silently relaxed.
    expect(screen.queryByTestId('workspace-switcher')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-manage-members')).not.toBeInTheDocument();
    expect(screen.getByTestId('header-my-organizations')).toBeInTheDocument();
  });

  it('still offers it to a multi-org user (the switcher is a duplicate, not a replacement)', () => {
    organizations = [ONE_ORG, { id: 'org_2', name: 'Globex', slug: 'globex' }];
    render(<AppHeader variant="home" />);

    expect(screen.getByTestId('header-my-organizations')).toBeInTheDocument();
  });
});

describe('AppHeader avatar menu trigger — an accessible name (objectui#13461)', () => {
  it('names the avatar button, which holds only the avatar', () => {
    render(<AppHeader variant="home" />);
    // The mocked `t` returns the call's `defaultValue`: the key is `user.accountMenu`.
    const trigger = screen.getByRole('button', { name: 'Account menu' });
    expect(trigger).toHaveTextContent('ZS');
  });
});

/** Lets the async config read resolve and React flush before reading an absence. */
async function settle() {
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

const TWO_ORGS = [ONE_ORG, { id: 'org_2', name: 'Globex', slug: 'globex' }];

/** Which of the avatar menu's organization entries render, and whether the top bar draws a switcher. */
function orgEntries() {
  return {
    myOrganizations: !!screen.queryByTestId('header-my-organizations'),
    switchOrganization: !!screen.queryByTestId('header-switch-organization'),
    createOrganization: !!screen.queryByTestId('header-create-workspace'),
    topBarSwitcher: !!screen.queryByTestId('workspace-switcher'),
  };
}

/*
 * objectstack-ai/objectstack#34591, ruling 6937513776: the avatar menu's
 * organization entries follow the served deployment signals
 * (`features.multiOrgEnabled`, `features.cloudManaged`,
 * `features.tenancyPosture`), with no Setup override; the web switcher moves
 * from the top bar into the avatar menu.
 */
describe('AppHeader avatar menu — organization entries follow the deployment posture (#34591)', () => {
  it('single-tenant: no organization entry and no top-bar switcher', async () => {
    features = { multiOrgEnabled: false, tenancyPosture: 'single' };
    organizations = TWO_ORGS;
    render(<AppHeader variant="home" />);
    await settle();

    // Member management for the one organization is Setup → Organization
    // (ruling 6384629949), so the avatar menu closes no door here.
    expect(orgEntries()).toEqual({
      myOrganizations: false,
      switchOrganization: false,
      createOrganization: false,
      topBarSwitcher: false,
    });
    // Counter-probe: the menu itself rendered.
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  it('multi-organization, one membership: My Organizations and Create, no Switch organization', async () => {
    features = { multiOrgEnabled: true, tenancyPosture: 'isolated' };
    render(<AppHeader variant="home" />);
    await settle();

    expect(orgEntries()).toEqual({
      myOrganizations: true,
      switchOrganization: false,
      createOrganization: true,
      topBarSwitcher: false,
    });
  });

  it('multi-organization, two memberships: Switch organization joins the menu; the top bar draws none', async () => {
    features = { multiOrgEnabled: true, tenancyPosture: 'isolated' };
    organizations = TWO_ORGS;
    render(<AppHeader variant="home" />);
    await settle();

    expect(orgEntries()).toEqual({
      myOrganizations: true,
      switchOrganization: true,
      createOrganization: true,
      topBarSwitcher: false,
    });
    expect(screen.getByTestId('workspace-switcher-org-org_2')).toHaveTextContent('Globex');
  });

  it('cloud-managed: no Create organization (organizations are created on the cloud)', async () => {
    features = { multiOrgEnabled: true, tenancyPosture: 'isolated', cloudManaged: true };
    organizations = TWO_ORGS;
    render(<AppHeader variant="home" />);
    await settle();

    expect(orgEntries()).toEqual({
      myOrganizations: true,
      switchOrganization: true,
      createOrganization: false,
      topBarSwitcher: false,
    });
  });

  it('cloud-managed single-tenant: nothing', async () => {
    features = { multiOrgEnabled: false, tenancyPosture: 'single', cloudManaged: true };
    render(<AppHeader variant="home" />);
    await settle();

    expect(orgEntries()).toEqual({
      myOrganizations: false,
      switchOrganization: false,
      createOrganization: false,
      topBarSwitcher: false,
    });
  });

  it('a server that serves no flags reads the spec defaults: multi-organization on, not managed', async () => {
    features = {};
    render(<AppHeader variant="home" />);
    await settle();

    expect(orgEntries()).toEqual({
      myOrganizations: true,
      switchOrganization: false,
      createOrganization: true,
      topBarSwitcher: false,
    });
  });

  it('group posture: the switcher stays reachable as the write context (ADR-0105) and says so', async () => {
    features = { multiOrgEnabled: true, tenancyPosture: 'group' };
    organizations = TWO_ORGS;
    render(<AppHeader variant="home" />);
    await settle();

    expect(screen.getByTestId('header-switch-organization')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-switcher-group-hint')).toBeInTheDocument();
  });

  it('walled posture: the active organization is named under My Organizations; not on a posture-less server', async () => {
    features = { multiOrgEnabled: true, tenancyPosture: 'isolated' };
    organizations = TWO_ORGS;
    const walled = render(<AppHeader variant="home" />);
    await settle();
    expect(screen.getByTestId('header-my-organizations-current')).toHaveTextContent('Acme');
    walled.unmount();

    features = { multiOrgEnabled: true };
    render(<AppHeader variant="home" />);
    await settle();
    expect(screen.getByTestId('header-my-organizations')).toBeInTheDocument();
    expect(screen.queryByTestId('header-my-organizations-current')).not.toBeInTheDocument();
  });
});
