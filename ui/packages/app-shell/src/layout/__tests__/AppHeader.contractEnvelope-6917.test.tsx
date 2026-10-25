/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * AppHeader's help menu reads a `meta.getItems()` answer the way the metadata
 * API DECLARES it — and does NOT read `value` (objectui#6917 arm B).
 *
 * ── The seam is NOT `DataSource.find()`, which changed the measurement ─────
 * objectui#6917 filed this site as "the same arm objectui#6840 removed", i.e.
 * a non-`QueryResult` key at the `DataSource.find()` seam. It is not.
 * `QueryResult` (`@object-ui/types`) never reaches here: `loadHelpDocs` calls
 * `client.meta.getItems('doc')`, whose envelope is `{ type, items: [...] }`,
 * or a bare array on the ADR-0037 preview path. `data` is not a member of it
 * either — this package's own `MetadataProvider.extractItems` pins
 * `{ data: [...] }` to `[]`, and `MetadataService.getItems` reads `items` and
 * nothing else.
 *
 * That is objectui#6917's own central rule turned back on the card: a zero
 * measured at one seam says nothing about another. So the census below sits on
 * the `meta.getItems` JOIN, not on the `find()` join the card named:
 *
 *   CELL      every `meta.getItems` producer body in the repo ...  28 producers
 *   CONTROL   `items` emitted as an envelope member .............  18 producers
 *   SUBJECT   `value` emitted as an envelope member ............     0 producers
 *
 * Superset sweep, so a shape assembled outside a producer body still surfaces:
 * of the 25 files holding a producer, 6 contain the token `value:` anywhere,
 * and all 6 are filter-condition values, select options, a DOM helper parameter
 * or a storage shim — none an envelope member. The control sits on the JOIN
 * (same cell, same pass, same extraction), so the zero is a reading.
 *
 * ⛔ The fix is the deletion, NOT widening any published type to bless `value`
 * — the floor objectui#6726, #6840 and #6839 all held.
 *
 * No precedence case appears here: `value` sat LAST, behind both live arms, so
 * no ordering was ever observable at this site. (The one site on this card that
 * DID invert is `packages/fields`, pinned there.) The live arms are pinned
 * beside the dead one, because live-versus-dead is the whole distinction.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/apps/crm/home', search: '', hash: '', state: null, key: 't' }),
  useParams: () => ({ appName: 'crm' }),
  useNavigate: () => vi.fn(),
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
 * Passthrough menu primitives: the help dropdown's CONTENT is the subject, so
 * `DropdownMenuContent` must render its children — Radix keeps a closed menu
 * unmounted in jsdom. `DropdownMenu` must forward `onOpenChange`, because that
 * is what triggers the lazy `loadHelpDocs()` fetch under measurement.
 */
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stripProps = (p: any) => {
    const { asChild, variant, size, align, sideOffset, onOpenChange, ...rest } = p ?? {};
    return rest;
  };
  const Pass = ({ children, ...p }: any) => <div {...stripProps(p)}>{children}</div>;
  const OpeningMenu = ({ children, onOpenChange, ...p }: any) => {
    // Fire "opened" once on mount: the header only fetches docs on first open.
    const fired = (globalThis as any).__oi_fired ?? ((globalThis as any).__oi_fired = new WeakSet());
    if (onOpenChange && !fired.has(onOpenChange)) {
      fired.add(onOpenChange);
      queueMicrotask(() => onOpenChange(true));
    }
    return <div {...stripProps(p)}>{children}</div>;
  };
  return {
    ...actual,
    Button: ({ children, asChild, variant, size, ...p }: any) => (
      <button type="button" {...p}>{children}</button>
    ),
    DropdownMenu: OpeningMenu,
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
      if (prop === 'then' || prop === '__esModule' || typeof prop === 'symbol') return target[prop];
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

/**
 * ONE fetch double at MODULE scope, deliberately never torn down
 * (objectui#6640 / objectui#7439). The header mounts pollers — the AI agent
 * probe and the pending-approvals bell — that fire and forget; happy-dom
 * resolves their relative URLs against `http://localhost:3000`, so a real
 * socket is attempted and the network-escape guard fails the file. Because
 * those reads can happen AFTER a test body returns, restoring the real fetch
 * in an afterEach would simply move the escape rather than close it.
 */
vi.stubGlobal(
  'fetch',
  vi.fn(async () =>
    new Response(JSON.stringify({ data: [], items: [], agents: [], requests: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
);

const PACKAGE_ID = 'pkg_crm';

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: [{ name: 'crm', label: 'CRM', _packageId: PACKAGE_ID }],
    dashboards: [], pages: [], reports: [],
  }),
}));

vi.mock('../../context/NavigationContext.js', () => ({
  useNavigationContext: () => ({ currentAppName: 'crm', recordTitle: undefined }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => {
  // ONE stable identity for the whole file: AppHeader resolves this in a
  // `useEffect(..., [getAuthConfig])` that ends in setState, so a fresh closure
  // per render loops effect → setState → render until the heap dies.
  const getAuthConfig = () => Promise.resolve({ features: { multiOrgEnabled: false } });
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useAuth: () => ({
      user: { id: 'u1', name: 'Zhang San', email: 'zs@example.com' },
      signOut: vi.fn(),
      isAuthEnabled: true,
      organizations: [],
      activeOrganization: null,
      isOrganizationsLoading: false,
      switchOrganization: vi.fn(),
      getAuthConfig,
    }),
    getUserInitials: () => 'ZS',
    useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  };
});

/** The answer `meta.getItems('doc')` gives for the current case. */
const state: { answer: unknown } = { answer: [] };

/** Stable adapter identity — the header's pollers key effects off it, so a
 *  fresh object per call would re-arm them on every render. */
const fakeAdapter = {
  find: () => Promise.resolve({ data: [] }),
  getClient: () => ({ meta: { getItems: async () => state.answer } }),
};

vi.mock('../../providers/AdapterProvider', () => ({ useAdapter: () => fakeAdapter }));

import { AppHeader } from '../AppHeader';

/** One `doc` row owned by the current app — the only rows the menu surfaces. */
const DOC = { name: 'getting-started', label: 'Getting Started', _packageId: PACKAGE_ID };

beforeEach(() => { state.answer = []; });
afterEach(cleanup);

/** True once the header has decided whether the app owns any docs. */
async function appDocsEntryAppears(answer: unknown): Promise<boolean> {
  state.answer = answer;
  render(<AppHeader variant="app" appName="crm" activeAppName="crm" objects={[]} />);
  // "All documentation" is unconditional — waiting on it proves the help menu
  // rendered at all, so a false negative below cannot be "the menu never opened".
  await waitFor(() => {
    expect(screen.getAllByText('All documentation').length).toBeGreaterThan(0);
  });
  // …then let the lazy fetch settle before reading the conditional entry.
  await waitFor(() => expect(state.answer).toBe(answer));
  await new Promise((r) => setTimeout(r, 0));
  return screen.queryAllByText("This app's docs").length > 0;
}

describe('AppHeader help docs — meta.getItems envelope (objectui#6917)', () => {
  it("still reads the envelope's `items` member", async () => {
    expect(await appDocsEntryAppears({ items: [DOC] })).toBe(true);
  });

  it('still reads a bare array — the ADR-0037 preview path answers with one', async () => {
    expect(await appDocsEntryAppears([DOC])).toBe(true);
  });

  it('does NOT read `value` — not a member of this envelope', async () => {
    // Before the fix the entry appeared off an undeclared key.
    expect(await appDocsEntryAppears({ value: [DOC] })).toBe(false);
  });

  it('does NOT read `data` either — `extractItems` pins that to empty as well', async () => {
    // The caricature guard: a reader returning the first array it found under
    // any key would surface the entry here.
    expect(await appDocsEntryAppears({ data: [DOC] })).toBe(false);
  });
});
