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
 * The REAL WorkspaceSwitcher, deliberately — mocking it away would erase the
 * precondition under test. Its `orgList.length <= 1` early return is what
 * leaves the avatar menu as the only door, so the cases below get to assert
 * that it renders nothing while the avatar entry is present.
 */
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [], dashboards: [], pages: [], reports: [] }),
}));

const ONE_ORG = { id: 'org_1', name: 'Acme', slug: 'acme' };

/** Orgs the mocked `useAuth` reports for the current case. */
let organizations: Array<Record<string, unknown>> = [ONE_ORG];
/** `features.multiOrgEnabled` the mocked auth config resolves with. */
let multiOrgEnabled = true;

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
  const getAuthConfig = () => Promise.resolve({ features: { multiOrgEnabled } });
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
  multiOrgEnabled = true;
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

  it('survives multi-org self-service being disabled — that flag governs CREATE only', async () => {
    multiOrgEnabled = false;
    render(<AppHeader variant="home" />);

    // Where creation is off this entry is the only way into the manage pages,
    // so gating it on the same flag as "Create workspace" would re-close the
    // door. Await a tick so the async `getAuthConfig` gate has resolved.
    await vi.waitFor(() =>
      expect(screen.queryByTestId('header-create-workspace')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('header-my-organizations')).toBeInTheDocument();
  });

  it('still offers it to a multi-org user (the switcher is a duplicate, not a replacement)', () => {
    organizations = [ONE_ORG, { id: 'org_2', name: 'Globex', slug: 'globex' }];
    render(<AppHeader variant="home" />);

    expect(screen.getByTestId('header-my-organizations')).toBeInTheDocument();
  });
});
