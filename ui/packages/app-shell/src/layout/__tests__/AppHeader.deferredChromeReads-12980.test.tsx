/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12980, part 3 — the header's reads that no first-paint surface
 * needs no longer start in the console open's first commit.
 *
 * What this file pins, through the real `AppHeader` and the real
 * `sharedUserFeeds` store:
 *   - the dashboard, page and report lists (lazy getters: reading one starts
 *     its `/meta/:type` read) are read only on the route type that names one,
 *     for the phone bar's title — an object route reads none of them;
 *   - no bell feed (the inbox, the approvals count) is read while the boot
 *     splash is up, and each is once it is gone and a frame has painted;
 *   - the Activity feed, which no badge reads, is read on the bell's open
 *     intent, not on mount;
 *   - CONTROL: while the approvals read is pending the badge draws nothing —
 *     never a `0` — and draws the count once the read lands.
 *
 * The popover primitives render inline (as in `AppHeader.inboxVariant`), so
 * the badge and the tabs are in the document without driving Radix.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

const route = vi.hoisted(() => ({ pathname: '/apps/ehr/hr_contract' }));
/** Which of the three lazy lists the header read, in this case. */
const listsRead = vi.hoisted(() => new Set<string>());

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: route.pathname, search: '', hash: '', state: null, key: 'test' }),
  useParams: () => ({ appName: 'ehr' }),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()] as const,
  Link: ({ children, to, ...p }: any) => <a href={String(to)} {...p}>{children}</a>,
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    language: 'en',
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
        String(options?.[name] ?? ''),
      ),
  }),
  useObjectLabel: () => {
    const label = (x: { name?: string; label?: string } | string) =>
      typeof x === 'string' ? x : String(x?.label ?? x?.name ?? '');
    return {
      objectLabel: label,
      objectPluralLabel: label,
      dashboardLabel: label,
      pageLabel: label,
      reportLabel: label,
      viewLabel: (_o: string, _v: string, fallback?: string) => fallback ?? '',
      appLabel: label,
    };
  },
}));

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
    DropdownMenuContent: () => null,
    DropdownMenuItem: Pass,
    DropdownMenuLabel: Pass,
    DropdownMenuSeparator: () => null,
    DropdownMenuGroup: Pass,
    Avatar: Pass,
    AvatarImage: () => null,
    AvatarFallback: Pass,
    Popover: Pass,
    PopoverTrigger: Pass,
    PopoverContent: Pass,
    Tabs: Pass,
    TabsList: Pass,
    TabsTrigger: ({ children }: any) => <button type="button">{children}</button>,
    TabsContent: Pass,
    cn: (...c: any[]) => c.filter(Boolean).join(' '),
  };
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
vi.mock('../WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => null }));
vi.mock('../CurrentOrganizationIndicator', () => ({ CurrentOrganizationIndicator: () => null }));
vi.mock('../LocaleSwitcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('../ConnectionStatus', () => ({ ConnectionStatus: () => null }));
vi.mock('../AppSwitcher', () => ({ AppSwitcher: () => null }));
vi.mock('../LocalizedSidebarTrigger', () => ({ LocalizedSidebarTrigger: () => null }));
vi.mock('../PreviewBadge', () => ({ PreviewBadge: () => null }));
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));
vi.mock('../../context/NavigationContext.js', () => ({
  useNavigationContext: () => ({ currentAppName: 'ehr', recordTitle: undefined }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Zhang San', email: 'zs@example.com' },
    signOut: vi.fn(),
    isAuthEnabled: true,
    organizations: [],
    activeOrganization: null,
    isOrganizationsLoading: false,
    getAuthConfig: undefined,
  }),
  getUserInitials: () => 'ZS',
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

// One app listing `hr_contract`, so the Activity feed has a roster to read.
const EHR_APP = {
  name: 'ehr',
  label: 'EHR',
  navigation: [{ id: 'nav_contract', type: 'object', objectName: 'hr_contract' }],
};

// The three lists are getters that record the read, as `MetadataProvider`'s
// are getters that START one.
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: [EHR_APP],
    get dashboards() {
      listsRead.add('dashboard');
      return [{ name: 'ops_board', label: 'Ops Board' }];
    },
    get pages() {
      listsRead.add('page');
      return [{ name: 'welcome', label: 'Welcome' }];
    },
    get reports() {
      listsRead.add('report');
      return [{ name: 'sales_summary', label: 'Sales Summary' }];
    },
  }),
}));

const finds: string[] = [];
const fakeAdapter = {
  find: (object: string) => {
    finds.push(object);
    if (object === 'sys_activity') {
      return Promise.resolve({
        data: [
          {
            id: 'act_1',
            type: 'updated',
            actor_name: 'Li Si',
            summary: 'updated Contract C-1',
            object_name: 'hr_contract',
            record_id: 'c_1',
            timestamp: '2026-08-10T08:00:00Z',
          },
        ],
      });
    }
    return Promise.resolve({ data: [] });
  },
  getClient: () => undefined,
};
vi.mock('../../providers/AdapterProvider', () => ({ useAdapter: () => fakeAdapter }));

import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { AppHeader } from '../AppHeader';
import {
  __resetSharedUserFeeds,
  __resetFirstPaint,
  __markFirstPainted,
} from '../../hooks/sharedUserFeeds';

const READER: MePermissionsResponse = {
  authenticated: true,
  userId: 'u1',
  tenantId: 'org_1',
  roles: [],
  permissionSets: [],
  systemPermissions: [],
  objects: {
    hr_contract: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    sys_activity: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
  },
  fields: {},
};

/**
 * What the approvals route answers (objectui#13027): asked for a page
 * (`limit`), the first `limit` rows plus the exact `total`; unpaged, every row
 * and no `total` — the route's two shapes, so the fixture is the server's.
 */
function approvalsPage(rows: unknown[], url: string): { data: unknown[]; total?: number } {
  const limit = new URL(url, 'http://localhost').searchParams.get('limit');
  return limit == null ? { data: rows } : { data: rows.slice(0, Number(limit)), total: rows.length };
}

/** Every approvals request, and the hand that answers the pending one. */
let approvalUrls: string[] = [];
let answerApprovals: ((rows: Array<{ id: string }>) => void) | null = null;

function mountAt(pathname: string) {
  route.pathname = pathname;
  return render(
    <MePermissionsProvider initialPermissions={READER}>
      <AppHeader variant="app" appName="EHR" activeAppName="ehr" onAppChange={vi.fn()} objects={[]} />
    </MePermissionsProvider>,
  );
}

const inboxReads = () => finds.filter((o) => o === 'sys_inbox_message').length;
const activityReads = () => finds.filter((o) => o === 'sys_activity').length;
/** A few real frames: long enough for a deferred read to have gone out if it were going to. */
const someFrames = () => act(() => new Promise<void>((r) => setTimeout(r, 80)));

beforeEach(() => {
  finds.length = 0;
  listsRead.clear();
  approvalUrls = [];
  answerApprovals = null;
  __resetSharedUserFeeds();
  __markFirstPainted();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/approvals/requests')) {
        approvalUrls.push(url);
        // Held until the case answers it: the read is PENDING meanwhile.
        return new Promise<Response>((resolve) => {
          answerApprovals = (rows) =>
            resolve(
              new Response(JSON.stringify(approvalsPage(rows, url)), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }),
            );
        });
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }),
  );
});

afterEach(() => {
  document.querySelectorAll('[data-boot-splash]').forEach((el) => el.remove());
  vi.unstubAllGlobals();
});

describe('the dashboard, page and report lists are read only on the route that names one (objectui#12980)', () => {
  it('an object route reads none of the three', async () => {
    mountAt('/apps/ehr/hr_contract');
    await someFrames();
    expect([...listsRead]).toEqual([]);
  });

  it('CONTROL: a dashboard route reads the dashboards, and only them — the phone title still names it', () => {
    mountAt('/apps/ehr/dashboard/ops_board');
    expect([...listsRead]).toEqual(['dashboard']);
    expect(screen.getAllByText('Ops Board').length).toBeGreaterThan(0);
  });

  it('CONTROL: a page route reads the pages, and only them', () => {
    mountAt('/apps/ehr/page/welcome');
    expect([...listsRead]).toEqual(['page']);
  });

  it('CONTROL: a report route reads the reports, and only them', () => {
    mountAt('/apps/ehr/report/sales_summary');
    expect([...listsRead]).toEqual(['report']);
  });
});

describe('the bell feeds start after the first paint (objectui#12980)', () => {
  it('reads neither the inbox nor the approvals while the boot splash is up, and both once it is gone', async () => {
    __resetFirstPaint();
    const splash = document.createElement('div');
    splash.setAttribute('data-boot-splash', '');
    document.body.appendChild(splash);

    mountAt('/apps/ehr/hr_contract');
    await someFrames();
    expect(inboxReads()).toBe(0);
    expect(approvalUrls).toHaveLength(0);

    act(() => splash.remove());
    await waitFor(() => expect(inboxReads()).toBe(1));
    await waitFor(() => expect(approvalUrls).toHaveLength(1));
  });

  it('reads the Activity feed on the bell\'s open intent, not on mount', async () => {
    mountAt('/apps/ehr/hr_contract');
    // The inbox read is the settle signal: the bell's feeds have attached.
    await waitFor(() => expect(inboxReads()).toBe(1));
    await someFrames();
    expect(activityReads()).toBe(0);

    fireEvent.pointerEnter(screen.getByTestId('inbox-bell-intent'));
    await waitFor(() => expect(activityReads()).toBe(1));
    expect(await screen.findByText('updated Contract C-1')).toBeInTheDocument();
  });

  it('CONTROL: the badge draws nothing while the approvals read is pending — never a 0 — and the count once it lands', async () => {
    mountAt('/apps/ehr/hr_contract');
    await waitFor(() => expect(approvalUrls).toHaveLength(1));
    await waitFor(() => expect(inboxReads()).toBe(1));
    await someFrames();
    expect(screen.queryByTestId('inbox-bell-badge')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();

    await act(async () => answerApprovals?.([{ id: 'apr_1' }, { id: 'apr_2' }]));
    expect(await screen.findByTestId('inbox-bell-badge')).toHaveTextContent('2');
  });
});
