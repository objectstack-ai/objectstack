// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12702 — at 1024 px, Setup › System › Marketplace read
 * 「S… / PREVIEW / Sys… / Market…」: the pill, the chip and both crumbs shrank
 * together. Now the crumbs fold from the left: where they do not fit the left
 * group, every crumb but the last collapses into one `⋯` menu that lists
 * them, the last crumb keeps its full text, and the PREVIEW chip moves after
 * the crumbs; where even that row has no room for the chip, the chip, now the
 * row's last element, is not drawn, so the pill and the last crumb still keep
 * their full text. Where they fit, the bar is as before: the chip beside the pill,
 * every crumb in full. The fold is measured from the left group's own width,
 * not the viewport. The search field keeps its width down to 960 px and is
 * the icon below it.
 *
 * jsdom lays nothing out, so the measurements the fold reads are stubbed:
 * the left group's `clientWidth` (the element that holds the crumbs) is the
 * width under test, and each child's box is a fixed width (the pill, the
 * chip, a `⋯`) or, for a crumb, a width from its label's length. A
 * `ResizeObserver` stand-in delivers the resizes. No route draws three crumbs
 * today (a `system/*` route draws two, a report route one), so the
 * three-segment case renders `AppBarCrumbTrail` in a left group of its own; the Marketplace route goes through the real
 * `AppHeader`.
 *
 * CONTROL: an object route draws no crumb and no `⋯`, and its chip sits
 * beside the pill, as `AppHeader.appBarLeftGroup-12461` pins.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

const route = vi.hoisted(() => ({ pathname: '/apps/crm/system/marketplace', search: '' }));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: route.pathname, search: route.search, hash: '', state: null, key: 't' }),
  useParams: () => ({ appName: 'crm' }),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(route.search), vi.fn()] as const,
  Link: ({ children, to, ...p }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <a href={String(to)} {...p}>{children}</a>
  ),
}));

// The crumbs read as the en pack reads them; any other key answers its default.
const PACK: Record<string, string> = {
  'console.breadcrumb.system': 'System',
  'console.breadcrumb.marketplace': 'Marketplace',
};
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    language: 'en',
    t: (key: string, options?: Record<string, unknown>) => PACK[key] ?? String(options?.defaultValue ?? key),
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
// The pill is a stand-in with the app's full label: its own truncation is
// `AppHeader.centeredSearch-12472`'s pin.
vi.mock('../AppSwitcher', () => ({
  AppSwitcher: () => <div data-testid="app-switcher-stub">Setup</div>,
}));
vi.mock('../../context/NavigationContext.js', () => ({
  useNavigationContext: () => ({ currentAppName: 'crm', recordTitle: undefined }),
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
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: [{ name: 'crm', label: 'Setup', _packageId: 'com.example.crm', navigation: [] }],
    dashboards: [],
    pages: [],
    reports: [],
  }),
}));

const ADAPTER = vi.hoisted(() => ({ find: () => Promise.resolve({ data: [] }), getClient: () => undefined }));
vi.mock('../../providers/AdapterProvider', () => ({
  useAdapter: () => ADAPTER,
}));

import { AppHeader, AppBarCrumbTrail } from '../AppHeader';
import { CommandPaletteProvider } from '../../context/CommandPaletteProvider';

const AUTHOR: MePermissionsResponse = {
  authenticated: true,
  userId: 'u1',
  tenantId: 'org_1',
  roles: [],
  permissionSets: [],
  systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
  objects: {},
  fields: {},
};

const OBJECTS = [{ name: 'lead', label: 'Lead', pluralLabel: 'Leads' }];

// ── Layout stand-ins ──────────────────────────────────────────────────────

/** The left group's width under test. */
let groupWidth = 0;
const observers = new Set<() => void>();

class ResizeObserverStub {
  private readonly cb: () => void;
  constructor(cb: () => void) {
    this.cb = cb;
    observers.add(this.cb);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    observers.delete(this.cb);
  }
}

/** The element that holds the crumbs (or the fold) as children: the left group. */
const isGroup = (el: Element) =>
  Boolean(el.querySelector(':scope > [data-app-bar-crumb], :scope > [data-app-bar-crumb-fold]'));

/** A child's box: the pill, the chip and the `⋯` at fixed widths, a crumb by its label. */
function boxWidth(el: Element): number {
  const h = el as HTMLElement;
  if (h.dataset?.appBarCrumbFold !== undefined) return 44;
  if (h.dataset?.appBarCrumb !== undefined) return 16 + 8 * (el.textContent ?? '').replace('/', '').trim().length;
  if (h.dataset?.testid === 'platform-preview-badge') return 64;
  const first = el.firstElementChild as HTMLElement | null;
  if (first?.dataset?.testid === 'app-switcher-stub' || h.dataset?.testid === 'harness-pill') return 120;
  return 0;
}

const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const originalRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;

beforeEach(() => {
  groupWidth = 0;
  observers.clear();
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return isGroup(this) ? groupWidth : 0;
    },
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = boxWidth(this);
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).endsWith('/api/v1/packages')
          ? { data: { packages: [{ manifest: { id: 'com.example.crm', name: 'CRM' }, writable: true }] } }
          : { data: [] },
    })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalRO;
});

/** Resize the left group and let the observers answer. */
function resizeGroup(width: number) {
  groupWidth = width;
  act(() => {
    for (const cb of [...observers]) cb();
  });
}

function mountAt(pathname: string) {
  route.pathname = pathname;
  return render(
    <MePermissionsProvider initialPermissions={AUTHOR}>
      <CommandPaletteProvider>
        <AppHeader variant="app" appName="Setup" activeAppName="crm" onAppChange={vi.fn()} objects={OBJECTS} />
      </CommandPaletteProvider>
    </MePermissionsProvider>,
  );
}

/** The crumbs drawn after the pill, in order: each crumb's text. */
const crumbTexts = () =>
  [...document.querySelectorAll('[data-app-bar-crumb]')].map((c) => (c.textContent ?? '').replace('/', '').trim());

const FOLD = 'app-bar-crumb-fold';
const BADGE = 'platform-preview-badge';
const follows = (a: Element, b: Element) => Boolean(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);

function Harness({ labels }: { labels: string[] }) {
  return (
    <div className="flex items-center min-w-0 flex-1">
      <div data-testid="harness-pill">Setup</div>
      <AppBarCrumbTrail segments={labels.map((label) => ({ label }))} moreLabel="More" />
    </div>
  );
}

describe('the crumbs fold from the left when the left group is too narrow (objectui#12702)', () => {
  const THREE = ['Reports', 'Quarterly', 'Pipeline by Region'];

  it('three segments at a 320 px left group: the pill, `⋯` and the last segment in full; `⋯` lists the rest', async () => {
    groupWidth = 320;
    render(<Harness labels={THREE} />);

    expect(screen.getByTestId('harness-pill')).toHaveTextContent('Setup');
    const fold = screen.getByTestId(FOLD);
    expect(fold).toHaveAttribute('aria-label', 'More');
    expect(fold).toHaveAttribute('title', 'More');
    expect(crumbTexts()).toEqual(['Pipeline by Region']);
    expect(follows(document.querySelector('[data-app-bar-crumb]')!, fold)).toBe(true);
    // The pill (120) + `⋯` (44) + the last crumb (160) + the chip (64) need
    // 388: no room for the chip, so it is not drawn.
    expect(screen.queryByTestId(BADGE)).toBeNull();

    await userEvent.setup().click(fold);
    const items = await screen.findAllByTestId('app-bar-crumb-fold-item');
    expect(items.map((i) => i.textContent)).toEqual(['Reports', 'Quarterly']);
    // Plain text: the menu links nowhere, as the crumbs do not.
    for (const item of items) expect(within(item).queryByRole('link')).toBeNull();
  });

  it('folded with room for the chip (400 px): the chip after the last crumb', () => {
    groupWidth = 400;
    render(<Harness labels={THREE} />);

    expect(crumbTexts()).toEqual(['Pipeline by Region']);
    const fold = screen.getByTestId(FOLD);
    const last = document.querySelector('[data-app-bar-crumb]')!;
    const badge = screen.getByTestId(BADGE);
    expect(follows(last, fold)).toBe(true);
    expect(follows(badge, last)).toBe(true);
  });

  it('with room, every segment renders in full, the chip beside the pill, and there is no `⋯`', () => {
    groupWidth = 900;
    render(<Harness labels={THREE} />);

    expect(crumbTexts()).toEqual(THREE);
    expect(screen.queryByTestId(FOLD)).toBeNull();
    expect(screen.getByTestId('harness-pill').nextElementSibling).toBe(screen.getByTestId(BADGE));
  });

  it('the fold follows the group\'s width both ways', () => {
    groupWidth = 900;
    render(<Harness labels={THREE} />);
    expect(screen.queryByTestId(FOLD)).toBeNull();

    resizeGroup(400);
    expect(screen.getByTestId(FOLD)).toBeInTheDocument();
    expect(screen.getByTestId(BADGE)).toBeInTheDocument();
    expect(crumbTexts()).toEqual(['Pipeline by Region']);

    resizeGroup(320);
    expect(screen.getByTestId(FOLD)).toBeInTheDocument();
    expect(screen.queryByTestId(BADGE)).toBeNull();

    resizeGroup(400);
    expect(screen.getByTestId(BADGE)).toBeInTheDocument();

    resizeGroup(900);
    expect(screen.queryByTestId(FOLD)).toBeNull();
    expect(crumbTexts()).toEqual(THREE);
  });

  it('a group not laid out yet (no width) keeps every crumb', () => {
    groupWidth = 0;
    render(<Harness labels={THREE} />);
    expect(screen.queryByTestId(FOLD)).toBeNull();
    expect(crumbTexts()).toEqual(THREE);
  });
});

describe('Setup › System › Marketplace through the real AppHeader (objectui#12702)', () => {
  it('narrow (340 px): `⋯` then Marketplace in full, and the PREVIEW chip after the crumbs', async () => {
    // In full the row needs 352 (pill 120, chip 64, System 64, Marketplace
    // 104); folded, 332.
    groupWidth = 340;
    mountAt('/apps/crm/system/marketplace');

    const fold = screen.getByTestId(FOLD);
    expect(crumbTexts()).toEqual(['Marketplace']);
    const lastCrumb = document.querySelector('[data-app-bar-crumb]')!;
    const badge = screen.getByTestId(BADGE);
    expect(follows(lastCrumb, fold)).toBe(true);
    expect(follows(badge, lastCrumb)).toBe(true);

    await userEvent.setup().click(fold);
    const items = await screen.findAllByTestId('app-bar-crumb-fold-item');
    expect(items.map((i) => i.textContent)).toEqual(['System']);
  });

  it('narrower (300 px): the pill, `⋯` and Marketplace in full; no room for the chip', () => {
    groupWidth = 300;
    mountAt('/apps/crm/system/marketplace');

    expect(screen.getByTestId('app-switcher-stub')).toHaveTextContent('Setup');
    expect(screen.getByTestId(FOLD)).toBeInTheDocument();
    expect(crumbTexts()).toEqual(['Marketplace']);
    expect(screen.queryByTestId(BADGE)).toBeNull();
  });

  it('with room: the chip beside the pill, both crumbs in full, no `⋯`', () => {
    groupWidth = 900;
    mountAt('/apps/crm/system/marketplace');

    expect(screen.queryByTestId(FOLD)).toBeNull();
    expect(crumbTexts()).toEqual(['System', 'Marketplace']);
    const pill = screen.getByTestId('app-switcher-stub').parentElement!;
    expect(pill.nextElementSibling).toBe(screen.getByTestId(BADGE));
  });

  it('CONTROL: an object route draws no crumb and no `⋯`, the chip beside the pill, at any width', () => {
    groupWidth = 320;
    mountAt('/apps/crm/lead');

    expect(crumbTexts()).toEqual([]);
    expect(screen.queryByTestId(FOLD)).toBeNull();
    const pill = screen.getByTestId('app-switcher-stub').parentElement!;
    expect(pill.nextElementSibling).toBe(screen.getByTestId(BADGE));
  });
});

describe('the search field shows from 960 px and the icon below it, never both (objectui#12702)', () => {
  const classesOf = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

  it('the field, its zone and the icon switch at the one `min-[960px]:` breakpoint', () => {
    mountAt('/apps/crm/system/marketplace');

    const field = screen.getByTestId('action:command-palette:open');
    const zone = field.closest('[data-topbar-zone="search"]')!;
    const icon = screen.getByTestId('action:command-palette:open-mobile');
    const iconGroup = icon.parentElement!;

    // The field and its zone: hidden below 960 px, shown from it.
    for (const el of [field, zone]) expect(classesOf(el)).toEqual(expect.arrayContaining(['hidden', 'min-[960px]:flex']));
    // The icon and its group: shown below 960 px, hidden from it.
    for (const el of [icon, iconGroup]) expect(classesOf(el)).toContain('min-[960px]:hidden');
    // No other breakpoint shows or hides either one.
    for (const el of [field, zone, icon, iconGroup]) {
      expect(classesOf(el).filter((c) => /^(sm|md|lg|xl|2xl|min-\[[^\]]+\]|max-\[[^\]]+\]):(flex|hidden|block|inline-flex)$/.test(c) && !c.startsWith('min-[960px]:'))).toEqual([]);
    }
  });
});
