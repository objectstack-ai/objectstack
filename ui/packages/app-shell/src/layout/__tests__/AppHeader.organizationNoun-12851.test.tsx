/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12851 — the avatar menu names the organisation 「组织」 / "Organization"
 * (the maintainer's ruling on objectstack-ai/cloud#2939, letter A). These cases
 * render the REAL locale packs through `I18nProvider` (the sibling
 * `AppHeader.myOrganizations.test.tsx` stubs `t()` to its inline default, so it
 * cannot see a pack value), in zh-CN with en as the control. The mock scaffold
 * is that file's, minus its `@object-ui/i18n` stub.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const navigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/home', search: '', hash: '', state: null, key: 'test' }),
  useParams: () => ({}),
  useNavigate: () => navigate,
  useSearchParams: () => [new URLSearchParams(), vi.fn()] as const,
  Link: ({ children, to, ...p }: any) => <a href={String(to)} {...p}>{children}</a>,
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

import { I18nProvider } from '@object-ui/i18n';
import { AppHeader } from '../AppHeader';

// One fetch double for the whole file, never torn down: the header's
// inbox / assistant probes can read after a test body returns (objectui#7439).
vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 404 }))));

beforeEach(() => {
  organizations = [ONE_ORG, { id: 'org_2', name: 'Globex', slug: 'globex' }];
  multiOrgEnabled = true;
  navigate.mockReset();
});

const renderIn = (language: 'en' | 'zh-CN') =>
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <AppHeader variant="home" />
    </I18nProvider>,
  );

describe('AppHeader avatar menu — the organisation is 「组织」 (objectui#12851)', () => {
  it('zh-CN: the organisation entries read 我的组织 and 创建组织', async () => {
    renderIn('zh-CN');
    expect(await screen.findByTestId('header-my-organizations')).toHaveTextContent('我的组织');
    expect(await screen.findByTestId('header-create-workspace')).toHaveTextContent('创建组织');
    expect(document.body.textContent).not.toContain('工作区');
  });

  it('en (control): the same entries read "My Organizations" and "Create organization"', async () => {
    renderIn('en');
    expect(await screen.findByTestId('header-my-organizations')).toHaveTextContent('My Organizations');
    expect(within(await screen.findByTestId('header-create-workspace')).getByText('Create organization')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/workspace/i);
  });
});
