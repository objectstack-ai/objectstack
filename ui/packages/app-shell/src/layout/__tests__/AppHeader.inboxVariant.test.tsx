/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * #4110 — the top-bar bell's Notifications tab was permanently empty on every
 * console surface that is not an app page (Home, Organizations, the full-page
 * AI screen). The bell renders in all of those variants, but the poller that
 * fills it (`sys_inbox_message` + `sys_notification_receipt`, ADR-0030 L5 /
 * #1429) was gated on `isApp` — the same flag that hides the app-only presence
 * avatars and connection dot. So on Home the popover held `[]` forever: the
 * "Unread" sub-filter showed "You're all caught up" and "All" — which filters
 * nothing at all — showed "No notifications", while Home's own To-do card
 * (`useHomeInbox`, ungated) listed the very same row from the very same object.
 *
 * These render the header against a fake adapter holding one canonical
 * MessagingService-emitted inbox row and assert the bell lists it in EVERY
 * variant. The `variant="app"` case is the control: it passed before the fix
 * too, and is what made the defect look like a popover-side filter bug.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

// ── Chrome the header pulls in but that this test does not exercise ──────────

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/', search: '', hash: '', state: null, key: 'test' }),
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
  // Reached through `useUrlOverlay` (the ⌘K / shortcuts overlays).
  useSearchParams: () => [new URLSearchParams(), vi.fn()] as const,
  Link: ({ children, to, ...p }: any) => <a href={String(to)} {...p}>{children}</a>,
}));

// Interpolating stub — the real packs carry `{{unread}}` / `{{total}}` holes,
// so returning `defaultValue` verbatim would make the copy assertions vacuous.
// `formatRelativeTime` is reached through `utils/relativeTime` for every row,
// so keep the rest of the module real.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    language: 'en',
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
        String(options?.[name] ?? ''),
      ),
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

// Passthrough primitives: the popover body renders inline instead of driving
// Radix open/close in jsdom (i.e. "as if the user clicked the bell"). Menus
// that Radix would keep unmounted while closed render as nothing.
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const Pass = ({ children, ...p }: any) => <div {...stripProps(p)}>{children}</div>;
  const stripProps = (p: any) => {
    const { asChild, variant, size, align, sideOffset, ...rest } = p ?? {};
    return rest;
  };
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

// Every lucide glyph renders as an inert span — the header imports 14 of them
// and the popover 4 more, and the set churns.
vi.mock('lucide-react', () => {
  const Icon = () => <span />;
  return new Proxy(
    { __esModule: true } as Record<string | symbol, unknown>,
    {
      get: (target, prop) => {
        if (prop === 'then' || prop === '__esModule' || typeof prop === 'symbol') {
          return target[prop];
        }
        return Icon;
      },
      // Vitest validates that each imported name exists on the mock, so the
      // proxy has to claim every glyph name, not just answer for it.
      has: (_target, prop) => prop !== 'then',
    },
  );
});

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOffline: () => ({ isOnline: true }),
}));

// Presence renders identifiably (and with a non-empty tenant list) so the
// #4197 boundary case can assert that presence stays app-only chrome while the
// activity feed goes user-scoped. `useTenantPresence` is a transport
// subscription, not a `dataSource.find` — there is no presence *read* to count.
vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  PresenceAvatars: () => <div data-testid="presence-avatars" />,
  useTenantPresence: () => [{ id: 'u2', name: 'Wang Wu' }],
}));

vi.mock('../ModeToggle', () => ({ ModeToggle: () => null }));
vi.mock('../WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => null }));
vi.mock('../LocaleSwitcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('../ConnectionStatus', () => ({
  ConnectionStatus: () => <div data-testid="connection-dot" />,
}));
vi.mock('../AppSwitcher', () => ({ AppSwitcher: () => null }));
vi.mock('../LocalizedSidebarTrigger', () => ({ LocalizedSidebarTrigger: () => null }));
vi.mock('../PreviewBadge', () => ({ PreviewBadge: () => null }));

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

// One app listing `hr_contract`: the bell's Activity tab reads only the objects
// an app lists (objectui#12530), and `ACTIVITY_ROW` below is one of its rows.
const EHR_APP = { name: 'ehr', label: 'EHR', navigation: [{ id: 'nav_contract', type: 'object', objectName: 'hr_contract' }] };
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [EHR_APP], dashboards: [], pages: [], reports: [] }),
}));

// ── The inbox fixture: exactly what MessagingService materializes ────────────

/**
 * One `sys_inbox_message` row as the L5 materialization writes it for an emit
 * of `{topic, audience:[userId], payload:{title, body, url}, dedupKey, source}`
 * — the shape #4110 reports as invisible in the bell.
 */
const INBOX_ROW = {
  id: 'ibx_1',
  user_id: 'u1',
  notification_id: 'ntf_1',
  topic: 'hr.contract.expiring',
  title: 'Contract expiring: Zhang San',
  body_md: "Zhang San's labour contract expires in 30 days.",
  action_url: '/apps/ehr/hr_contract/record/c_1',
  created_at: '2026-08-10T09:00:00Z',
};

/** `state: 'delivered'` — delivered is NOT read, so the row must show unread. */
const DELIVERED_RECEIPT = {
  id: 'rcp_1',
  notification_id: 'ntf_1',
  user_id: 'u1',
  channel: 'inbox',
  state: 'delivered',
};

const finds: Array<{ object: string; query: unknown }> = [];
/** What the fake `sys_inbox_message` collection holds for the current test. */
let inboxRows: Array<Record<string, unknown>> = [];

/**
 * #4197 — one `sys_activity` row in plugin-audit's raw column names, the shape
 * both the bell's Activity tab and Home's activity card map onto `ActivityItem`.
 * A named human actor, so it survives BOTH mappings (Home additionally drops
 * `System`-actor churn).
 */
const ACTIVITY_ROW = {
  id: 'act_1',
  type: 'updated',
  actor_name: 'Li Si',
  summary: 'updated Contract C-1',
  object_name: 'hr_contract',
  record_id: 'c_1',
  timestamp: '2026-08-10T08:00:00Z',
};

/** What the fake `sys_activity` collection holds for the current test. */
let activityRows: Array<Record<string, unknown>> = [];
/**
 * What the fake `sys_activity` read rejects with instead, when set — the
 * objectui#12081 block uses it for the server's own `403` (a stale grant).
 */
let activityError: unknown = null;

/**
 * What the fake `sys_notification_receipt` collection holds. `null` keeps the
 * original behaviour — one `delivered` receipt whenever the inbox is non-empty
 * — so every case written before #4230 reads exactly as it did. The #4230 block
 * sets it explicitly, because a read/unread MIX is the only payload that can
 * tell "Unread is empty because everything is read" apart from "the panel was
 * handed nothing", and that distinction is the whole oracle down there.
 */
let receiptRows: Array<Record<string, unknown>> | null = null;

/**
 * What `/api/v1/approvals/requests?status=pending` answers for the current
 * test. Two rows ⇒ `pendingApprovalsCount` 2, which is the second badge addend.
 */
let approvalRows: Array<{ id: string }> = [];
/** How many approval rows each approvals response carried — the payload measure (objectui#13027). */
let approvalRowsServed: number[] = [];

/**
 * What the approvals route answers (objectui#13027): asked for a page
 * (`limit`), the first `limit` rows plus the exact `total`; unpaged, every row
 * and no `total` — the route's two shapes, so the fixture is the server's.
 */
function approvalsPage(rows: unknown[], url: string): { data: unknown[]; total?: number } {
  const limit = new URL(url, 'http://localhost').searchParams.get('limit');
  return limit == null ? { data: rows } : { data: rows.slice(0, Number(limit)), total: rows.length };
}


const fakeAdapter = {
  find: (object: string, query: unknown) => {
    finds.push({ object, query });
    if (object === 'sys_inbox_message') return Promise.resolve({ data: inboxRows });
    if (object === 'sys_notification_receipt') {
      return Promise.resolve({
        data: receiptRows ?? (inboxRows.length ? [DELIVERED_RECEIPT] : []),
      });
    }
    if (object === 'sys_activity') {
      return activityError ? Promise.reject(activityError) : Promise.resolve({ data: activityRows });
    }
    return Promise.resolve({ data: [] });
  },
  getClient: () => undefined,
};

vi.mock('../../providers/AdapterProvider', () => ({
  useAdapter: () => fakeAdapter,
}));

import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { AppHeader } from '../AppHeader';
import { useHomeInbox } from '../../hooks/useHomeInbox';
import { __resetSharedUserFeeds, __markFirstPainted } from '../../hooks/sharedUserFeeds';

/** Every URL passed to `fetch`, in order — the approvals reads are counted here. */
let fetchUrls: string[] = [];

beforeEach(() => {
  finds.length = 0;
  fetchUrls = [];
  approvalRowsServed = [];
  inboxRows = [INBOX_ROW];
  // Default: no activity, no approvals — so the #4110 cases above keep the
  // exact badge arithmetic they were written against (approvals addend 0).
  activityRows = [];
  activityError = null;
  approvalRows = [];
  receiptRows = null;
  // Drop the shared feeds' cache and poll timer so cases do not inherit each
  // other's reads — the store deliberately outlives any one render tree.
  __resetSharedUserFeeds();
  // objectui#12980 — these cases start past the console's first paint.
  __markFirstPainted();
  // Route by URL: the approvals endpoint answers from `approvalRows`; every
  // other request (auth config, mark-read) stays a soft-degrading 404.
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      fetchUrls.push(url);
      if (url.includes('/api/v1/approvals/requests')) {
        const page = approvalsPage(approvalRows, url);
        approvalRowsServed.push(page.data.length);
        return Promise.resolve(
          new Response(JSON.stringify(page), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Objects the bell's poller reads, in the order it issued them. */
const inboxReads = () => finds.filter((f) => f.object === 'sys_inbox_message');
/** `sys_activity` reads issued by anyone in the tree — the dedupe assertion. */
const activityReads = () => finds.filter((f) => f.object === 'sys_activity');
/** Approvals-endpoint requests issued by anyone in the tree. */
const approvalReads = () => fetchUrls.filter((u) => u.includes('/api/v1/approvals/requests'));
/**
 * objectui#12980 — the bell reads `sys_activity` only once it is about to open
 * (a pointer over it, focus, a click), not on every console open. A case about
 * the Activity tab shows that intent first: a click on the bell.
 */
const askForActivity = () =>
  fireEvent.click(within(screen.getByTestId('inbox-bell-intent')).getAllByRole('button')[0]);

describe('AppHeader — the bell polls the inbox in every variant (#4110)', () => {
  it('lists a canonical inbox row on Home, where the To-do card already shows it', async () => {
    render(<AppHeader variant="home" />);

    await waitFor(() => expect(inboxReads().length).toBeGreaterThan(0));
    expect(await screen.findByText('Contract expiring: Zhang San')).toBeInTheDocument();
    // …and the empty states are gone: "Unread" is the default sub-filter, and
    // "All" — which applies no predicate — must never be empty while a row is
    // in hand.
    expect(screen.queryByText("You're all caught up")).not.toBeInTheDocument();
    expect(screen.queryByText('No notifications')).not.toBeInTheDocument();
  });

  it('scopes that read to the signed-in user, newest first (ADR-0030 `mine`)', async () => {
    render(<AppHeader variant="home" />);

    await waitFor(() => expect(inboxReads().length).toBeGreaterThan(0));
    expect(inboxReads()[0].query).toMatchObject({
      $filter: { user_id: 'u1' },
      $orderby: { created_at: 'desc' },
    });
  });

  it('counts a `delivered` receipt as unread, so the badge shows the row', async () => {
    render(<AppHeader variant="home" />);

    expect(await screen.findByTestId('inbox-bell-badge')).toHaveTextContent('1');
  });

  it('lists it on the Organizations variant too', async () => {
    render(<AppHeader variant="orgs" />);

    expect(await screen.findByText('Contract expiring: Zhang San')).toBeInTheDocument();
  });

  it('still lists it inside an app (the control — this half never broke)', async () => {
    render(<AppHeader variant="app" appName="ehr" />);

    expect(await screen.findByText('Contract expiring: Zhang San')).toBeInTheDocument();
  });

  it('shows the empty state only when the inbox is genuinely empty', async () => {
    inboxRows = [];
    render(<AppHeader variant="home" />);

    // The read still happens — "empty" is now an answer, not an unasked question.
    await waitFor(() => expect(inboxReads().length).toBeGreaterThan(0));
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
    expect(screen.queryByTestId('inbox-bell-badge')).not.toBeInTheDocument();
  });
});

/**
 * #4197 — the two sibling effects #4110 left behind. The pending-approvals poll
 * (`if (!isApp || !user?.id) return;`) and the activity read
 * (`if (!dataSource || !isApp) return;`) carried the same variant gate, so
 * off-app the Approvals tab read "No pending approvals" and the Activity tab
 * "No recent activity" — on the very page whose own cards (`useHomeInbox`,
 * ungated) were showing both. Worse, the bell badge is
 * `unreadTopics + pendingApprovalsCount`, so after #4110 only the FIRST addend
 * was fetched off-app: the same user with the same data read 1 on Home and 3
 * inside an app.
 *
 * `variant="home"` is also the AI screen — `AiChatPage` renders
 * `<AppHeader variant="home" />`; there is no separate `ai-chat` variant
 * (see `AppHeaderVariant`). `studio` is the `/studio` front door
 * (objectui#11863).
 */
describe('AppHeader — Approvals + Activity fill in every variant (#4197)', () => {
  beforeEach(() => {
    approvalRows = [{ id: 'apr_1' }, { id: 'apr_2' }];
    activityRows = [ACTIVITY_ROW];
  });

  // 'app' is the control: it was green before the fix and must stay green.
  for (const variant of ['home', 'orgs', 'studio', 'app'] as const) {
    it(`fills the Approvals tab on the ${variant} variant`, async () => {
      render(<AppHeader variant={variant} appName={variant === 'app' ? 'ehr' : undefined} />);

      // The count reached the popover: the breakdown line spells the second
      // addend out unclamped, and the tab body offers the drill-in.
      await waitFor(() =>
        expect(screen.getByTestId('inbox-badge-breakdown-approvals')).toHaveTextContent(
          '2 pending approvals',
        ),
      );
      expect(screen.getByText('View approvals')).toBeInTheDocument();
      expect(screen.queryByText('No pending approvals')).not.toBeInTheDocument();
    });

    it(`fills the Activity tab on the ${variant} variant`, async () => {
      render(<AppHeader variant={variant} appName={variant === 'app' ? 'ehr' : undefined} />);
      askForActivity();

      expect(await screen.findByText('updated Contract C-1')).toBeInTheDocument();
      expect(screen.getByText('Li Si')).toBeInTheDocument();
      expect(screen.queryByText('No recent activity')).not.toBeInTheDocument();
    });

    it(`reads the same badge on ${variant} as anywhere else — 1 unread topic + 2 approvals`, async () => {
      render(<AppHeader variant={variant} appName={variant === 'app' ? 'ehr' : undefined} />);

      // Both addends are fetched, so the badge reconciles against the
      // breakdown line instead of against an unasked question (#4073).
      await waitFor(() =>
        expect(screen.getByTestId('inbox-bell-badge')).toHaveTextContent('3'),
      );
      expect(screen.getByTestId('inbox-badge-breakdown-total')).toHaveTextContent('3 total');
      expect(screen.getByTestId('inbox-badge-breakdown-notifications')).toHaveTextContent(
        '1 notifications',
      );
    });
  }

  it('still reports an empty approvals inbox as an answer, not a gate', async () => {
    approvalRows = [];
    render(<AppHeader variant="home" />);

    await waitFor(() => expect(approvalReads().length).toBeGreaterThan(0));
    expect(await screen.findByText('No pending approvals')).toBeInTheDocument();
    // Badge falls back to the notifications addend alone — correctly this time.
    expect(screen.getByTestId('inbox-bell-badge')).toHaveTextContent('1');
  });
});

/**
 * The To-do card's real data path. `HomePage` renders this hook's output
 * alongside the bell inside `HomeLayout`, so on Home both consumers mount in
 * the same commit — the duplicate-read site the card called out.
 */
function HomeTodoCardProbe() {
  const { pendingApprovalsCount, activity } = useHomeInbox();
  return (
    // Fenced off with a testid so the assertions below can tell the card's
    // copy of a row apart from the bell's — when the fix works, BOTH render
    // the same text and an unscoped `getByText` is ambiguous by construction.
    <div data-testid="home-cards">
      <span data-testid="home-approvals-count">{pendingApprovalsCount}</span>
      <span data-testid="home-activity-summary">{activity.value[0]?.description ?? ''}</span>
    </div>
  );
}

/**
 * The pin on the triage ruling (#4197): consistency is the acceptance
 * criterion and ONE fetch feeds both consumers. Naively dropping `isApp` would
 * make Home issue the approvals read and the `sys_activity` read twice — once
 * for the bell, once for `useHomeInbox` — which is precisely the trade-off the
 * card refused to resolve by duplicate polling. Both consumers now read one
 * shared store, so the read count stays 1 no matter how many mount.
 */
describe('AppHeader + Home cards share one fetch, not two (#4197)', () => {
  beforeEach(() => {
    approvalRows = [{ id: 'apr_1' }, { id: 'apr_2' }];
    activityRows = [ACTIVITY_ROW];
  });

  it('issues ONE approvals read for the bell and the To-do card together', async () => {
    render(
      <>
        <AppHeader variant="home" />
        <HomeTodoCardProbe />
      </>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('inbox-badge-breakdown-approvals')).toHaveTextContent(
        '2 pending approvals',
      ),
    );
    await waitFor(() => expect(screen.getByTestId('home-approvals-count')).toHaveTextContent('2'));

    // …and exactly one request went out for the two of them.
    expect(approvalReads()).toHaveLength(1);
  });

  it('issues ONE sys_activity read for the bell and the activity card together', async () => {
    render(
      <>
        <AppHeader variant="home" />
        <HomeTodoCardProbe />
      </>,
    );
    askForActivity();

    // The one row surfaces in BOTH places — the bell's Activity tab and Home's
    // card — so it is matched twice and each match is attributed explicitly.
    await waitFor(() => {
      const homeCards = screen.getByTestId('home-cards');
      const shown = screen.getAllByText('updated Contract C-1');
      expect(shown.some((el) => !homeCards.contains(el))).toBe(true); // the bell's tab
      expect(shown.some((el) => homeCards.contains(el))).toBe(true); // Home's card
    });

    expect(activityReads()).toHaveLength(1);
  });

  it('serves both consumers the same numbers — the consistency criterion', async () => {
    render(
      <>
        <AppHeader variant="home" />
        <HomeTodoCardProbe />
      </>,
    );

    await waitFor(() => expect(screen.getByTestId('home-approvals-count')).toHaveTextContent('2'));
    // The bell's second badge addend IS the card's number, from one read.
    expect(screen.getByTestId('inbox-badge-breakdown-approvals')).toHaveTextContent(
      '2 pending approvals',
    );
  });
});

/**
 * The other half of the boundary. `isApp` still means something — it is the
 * flag that hides genuinely app-scoped chrome — so un-gating the two
 * user/org-scoped reads must NOT drag presence off-app with them.
 *
 * Note what is being pinned: presence never was a *read*. `useTenantPresence`
 * is a transport subscription (`PresenceProvider.subscribeTenant`) and the
 * effect formerly named `fetchPresenceAndActivities` explicitly never probed
 * it — its one and only read is `sys_activity`. So the boundary is a RENDER
 * gate, and these assert it stayed put.
 */
describe('AppHeader — presence stays app-only chrome (#4197 boundary)', () => {
  it('renders no presence avatars and no connection dot off-app', async () => {
    render(<AppHeader variant="home" connectionState="connected" />);

    // Settle on the INBOX read, not the activity read. Asserting an absence
    // needs the tree to have done its work first, and the inbox poll is the
    // one read this variant issues on both sides of this change (#4199
    // un-gated it) — so this case stays green before AND after, which is what
    // a boundary pin is for. Anchored on the activity read it went red on
    // `origin/main` for the settle point never arriving, which would have
    // dressed an unrelated timeout up as evidence about presence.
    await waitFor(() => expect(inboxReads().length).toBeGreaterThan(0));
    expect(screen.queryByTestId('presence-avatars')).not.toBeInTheDocument();
    expect(screen.queryByTestId('connection-dot')).not.toBeInTheDocument();
  });

  it('renders both inside an app (the control)', async () => {
    render(<AppHeader variant="app" appName="ehr" connectionState="connected" />);

    expect(await screen.findByTestId('presence-avatars')).toBeInTheDocument();
    expect(screen.getByTestId('connection-dot')).toBeInTheDocument();
  });

  it('never issues a presence read in any variant — presence is a subscription', async () => {
    render(<AppHeader variant="app" appName="ehr" connectionState="connected" />);

    // objectui#12980 — the inbox read, not the activity read, is the settle
    // signal: the bell no longer reads `sys_activity` until it is opened.
    await waitFor(() => expect(inboxReads().length).toBeGreaterThan(0));
    // Not one read names presence — in the variant that DOES render it.
    expect(finds.some((f) => String(f.object).includes('presence'))).toBe(false);
  });
});

/**
 * #4230 — the three-way oracle, pinned as a *panel* assertion.
 *
 * ## Why this block exists even though #4230 turned out not to be a regression
 *
 * #4230 was filed as "#4110 is back on console `09987b68`", and it is not: that
 * console is objectui `09987b680d53801c` (2026-08-09 02:35:56Z) and #4110's fix
 * is `7b07832327ea07af` (#4199, 2026-08-10 20:39:10Z) — **42 hours later**, so
 * the vendored build never contained the fix. `git merge-base --is-ancestor
 * 7b0783232 09987b68` exits non-zero, and that console's `AppHeader.tsx:338`
 * still reads `if (!dataSource || !isApp || !user?.id) return;` — the very gate
 * #4199 removed. #4230 is #4110 observed on a build predating its fix.
 *
 * What the round nonetheless exposed is a hole in the pin above: every case up
 * there holds ONE row and never touches the Unread/All sub-filter. But the
 * symptom both cards actually report is a *pair* of readings — "You're all
 * caught up" under Unread AND "No notifications" under All — and "All" is the
 * load-bearing half, because it applies no predicate at all. A panel showing
 * nothing under All has been handed nothing, full stop; a panel empty only
 * under Unread may simply have no unread rows, which is correct behaviour.
 * Nothing in this file could tell those two apart, so a recurrence that left
 * the poll running but dropped rows on the way to the popover — the OTHER
 * branch #4110's investigation named, and the one still open on #4230 — would
 * have found every case above green.
 *
 * So these drive the QA payload (10 rows, mixed read-state, including the
 * `approval.reminder` #4230 names) through the real `AppHeader` → `InboxPopover`
 * pair and assert what a user sees under BOTH filters. Reverse verification:
 * restoring the `isApp` gate on the poll turns every `variant="home"` case here
 * red and leaves `variant="app"` green — the same signature #4110 had.
 *
 * Oracle boundary, stated rather than implied: this mounts the real components
 * over a fake adapter. It pins everything from `dataSource.find` to the rendered
 * row — the whole span both cards localise the defect to — and it does NOT pin
 * the adapter, the REST layer or `/api/v1/notifications` itself.
 */
describe('AppHeader — the bell panel renders what the inbox returns, under BOTH filters (#4230)', () => {
  /**
   * The QA payload from objectstack#7517: ten `sys_inbox_message` rows for one
   * user, newest-first, five of them already read. Three share a `(topic,
   * title)` so the coalescing pass (#2765) is exercised rather than avoided —
   * grouping is the one transform between the poll and the rendered list, and
   * "10 rows in, 0 rows out" is exactly the failure being pinned against.
   */
  const QA_ROWS = [
    { id: 'ibx_01', notification_id: 'ntf_01', topic: 'approval.reminder', title: 'Approval reminder: INV-1008', body_md: 'A dual sign-off is waiting on you.', created_at: '2026-08-11T04:30:00Z' },
    { id: 'ibx_02', notification_id: 'ntf_02', topic: 'hr.contract.expiring', title: 'Contract expiring: Zhang San', body_md: 'Expires in 30 days.', created_at: '2026-08-11T04:00:00Z' },
    { id: 'ibx_03', notification_id: 'ntf_03', topic: 'project.digest', title: 'Scheduled project digest', body_md: 'Hourly digest.', created_at: '2026-08-11T03:00:00Z' },
    { id: 'ibx_04', notification_id: 'ntf_04', topic: 'project.digest', title: 'Scheduled project digest', body_md: 'Hourly digest.', created_at: '2026-08-11T02:00:00Z' },
    { id: 'ibx_05', notification_id: 'ntf_05', topic: 'task.mention', title: 'You were mentioned in Task T-42', body_md: '@zhangsan can you confirm?', created_at: '2026-08-11T01:00:00Z' },
    { id: 'ibx_06', notification_id: 'ntf_06', topic: 'project.digest', title: 'Scheduled project digest', body_md: 'Hourly digest.', created_at: '2026-08-11T00:00:00Z' },
    { id: 'ibx_07', notification_id: 'ntf_07', topic: 'crm.lead.assigned', title: 'Lead assigned: Acme Corp', body_md: 'Assigned to you.', created_at: '2026-08-10T23:00:00Z' },
    { id: 'ibx_08', notification_id: 'ntf_08', topic: 'invoice.paid', title: 'Invoice INV-1004 paid', body_md: 'Payment cleared.', created_at: '2026-08-10T22:00:00Z' },
    { id: 'ibx_09', notification_id: 'ntf_09', topic: 'deal.won', title: 'Deal won: Globex renewal', body_md: 'Closed-won.', created_at: '2026-08-10T21:00:00Z' },
    { id: 'ibx_10', notification_id: 'ntf_10', topic: 'system.maintenance', title: 'Scheduled maintenance Sunday 02:00', body_md: 'Two hours of downtime.', created_at: '2026-08-10T20:00:00Z' },
  ].map((r) => ({ ...r, user_id: 'u1', action_url: `/apps/showcase/sys_inbox_message/record/${r.id}` }));

  /** Read rows: 06 (one member of the digest group), 07, 08, 09, 10. */
  const READ_NOTIFICATION_IDS = ['ntf_06', 'ntf_07', 'ntf_08', 'ntf_09', 'ntf_10'];

  /**
   * One receipt per row — `read` for the five above, `delivered` for the rest.
   * `delivered` is NOT read (ADR-0030), which is the distinction #4110 pinned
   * and the reason a row can carry a receipt and still be unread.
   */
  const qaReceipts = (readIds: string[]) =>
    QA_ROWS.map((r, i) => ({
      id: `rcp_${i + 1}`,
      notification_id: r.notification_id,
      user_id: 'u1',
      channel: 'inbox',
      state: readIds.includes(r.notification_id) ? 'read' : 'delivered',
    }));

  /** Titles of the five UNREAD rows, deduped by the (topic, title) coalescing. */
  const UNREAD_TITLES = [
    'Approval reminder: INV-1008',
    'Contract expiring: Zhang San',
    'Scheduled project digest',
    'You were mentioned in Task T-42',
  ];
  /** Every distinct title in the payload — what "All" must list, always. */
  const ALL_TITLES = [
    ...UNREAD_TITLES,
    'Lead assigned: Acme Corp',
    'Invoice INV-1004 paid',
    'Deal won: Globex renewal',
    'Scheduled maintenance Sunday 02:00',
  ];

  /** The popover's Unread/All sub-filter. Their names are exactly these words. */
  const clickAll = () => fireEvent.click(screen.getByRole('button', { name: /^All$/ }));
  const clickUnread = () =>
    fireEvent.click(screen.getByRole('button', { name: /^Unread\s*\d*$/ }));

  beforeEach(() => {
    inboxRows = QA_ROWS;
    receiptRows = qaReceipts(READ_NOTIFICATION_IDS);
  });

  it('lists the unread rows under Unread — the default filter', async () => {
    render(<AppHeader variant="home" />);

    for (const title of UNREAD_TITLES) {
      expect(await screen.findByText(title)).toBeInTheDocument();
    }
    // A read row must NOT leak into the unread filter — the assertion that
    // keeps "renders everything" from passing this case vacuously.
    expect(screen.queryByText('Invoice INV-1004 paid')).not.toBeInTheDocument();
    expect(screen.queryByText("You're all caught up")).not.toBeInTheDocument();
  });

  it('lists ALL ten rows under All — the filter that applies no predicate', async () => {
    render(<AppHeader variant="home" />);

    await screen.findByText('Approval reminder: INV-1008');
    clickAll();

    for (const title of ALL_TITLES) {
      expect(await screen.findByText(title)).toBeInTheDocument();
    }
    // The exact copy #4230 reports. "All" filters nothing, so this string and a
    // non-empty inbox cannot both be true.
    expect(screen.queryByText('No notifications')).not.toBeInTheDocument();
  });

  it('surfaces the `approval.reminder` row #4230 names, on the surface it names', async () => {
    render(<AppHeader variant="home" />);

    expect(await screen.findByText('Approval reminder: INV-1008')).toBeInTheDocument();
  });

  it('separates "everything is read" from "the panel got nothing"', async () => {
    // Every row read: Unread is *correctly* empty, and All must still hold ten.
    // Neither #4110 nor #4230 could make this distinction from the outside —
    // both saw two empty tabs and had to guess which one meant what.
    receiptRows = qaReceipts(QA_ROWS.map((r) => r.notification_id));
    render(<AppHeader variant="home" />);

    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
    clickAll();
    for (const title of ALL_TITLES) {
      expect(await screen.findByText(title)).toBeInTheDocument();
    }
    expect(screen.queryByText('No notifications')).not.toBeInTheDocument();
  });

  it('coalesces the repeated digest instead of dropping it (#2765 ∩ #4230)', async () => {
    render(<AppHeader variant="home" />);

    // Unread: two of the three digests are unread, so the group reads ×2 …
    const unreadGroup = (await screen.findByText('Scheduled project digest')).closest('button');
    expect(within(unreadGroup as HTMLElement).getByText('×2')).toBeInTheDocument();

    // … and All shows the full run of three. Grouping is a fold, never a drop:
    // the count pill is what makes "10 rows in, 8 rows listed" readable as
    // correct rather than as eight-of-ten silently lost.
    clickAll();
    await waitFor(() => {
      const allGroup = screen.getByText('Scheduled project digest').closest('button');
      expect(within(allGroup as HTMLElement).getByText('×3')).toBeInTheDocument();
    });
  });

  it('reconciles the badge with the rows on show — 4 unread topics, 0 approvals', async () => {
    render(<AppHeader variant="home" />);

    // 5 unread rows fold into 4 unread topics (two digests are one topic), and
    // the breakdown line spells that out unclamped next to the listed rows.
    await waitFor(() => expect(screen.getByTestId('inbox-bell-badge')).toHaveTextContent('4'));
    expect(screen.getByTestId('inbox-badge-breakdown-notifications')).toHaveTextContent(
      '4 notifications',
    );
    expect(screen.getByTestId('inbox-badge-breakdown-approvals')).toHaveTextContent(
      '0 pending approvals',
    );
  });

  it('holds on every console surface, not only inside an app', async () => {
    // The #4110/#4230 signature is variant-shaped: `app` kept working while the
    // off-app surfaces went dark. Both filters, every off-app variant.
    for (const variant of ['home', 'orgs', 'studio'] as const) {
      const view = render(<AppHeader variant={variant} />);
      expect(await screen.findByText('Approval reminder: INV-1008')).toBeInTheDocument();
      clickAll();
      expect(await screen.findByText('Invoice INV-1004 paid')).toBeInTheDocument();
      expect(screen.queryByText('No notifications')).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('returns to the unread cut when the user switches back', async () => {
    render(<AppHeader variant="home" />);

    await screen.findByText('Approval reminder: INV-1008');
    clickAll();
    expect(await screen.findByText('Invoice INV-1004 paid')).toBeInTheDocument();
    clickUnread();
    // Round-trip: the sub-filter is client-side over rows already in hand
    // (switching never re-fetches), so the read row leaves and the unread ones
    // stay — a panel that lost its rows on the way back would show the empty
    // state here instead.
    await waitFor(() =>
      expect(screen.queryByText('Invoice INV-1004 paid')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Approval reminder: INV-1008')).toBeInTheDocument();
    expect(screen.queryByText("You're all caught up")).not.toBeInTheDocument();
  });
});

/**
 * objectui#12081 item 8 — the bell's Activity tab asked `sys_activity` for
 * every signed-in user, and every non-admin was answered `403`.
 *
 * The `403` is OBJECT-level, not a row filter a narrower query could pass:
 * objectstack's `member_default` set names `sys_activity` deliberately NOT
 * (its own comment says so), and the server already narrows the rows of an
 * admitted read to the records the caller can open. So no scoped query gets a
 * caller without the object grant any rows, and the record Discussion tab's
 * activity half is refused for that caller too — the tab renders its refusal
 * state there (objectui#11195). The honest answer here is the one the shell
 * already gives for an object the deployment lacks: decide BEFORE asking.
 *
 * What the user saw was the second defect: the `403` went to `markFailed()`,
 * the store said `error`, and the hook handed its consumers `.value` alone —
 * the empty array — so the tab read "No recent activity". A denial dressed
 * as an answer, the #4235 shape on another feed.
 *
 * Real `AppHeader`, real shared feed, real `MePermissionsProvider` with the
 * payload `/auth/me/permissions` serves. The settle point is the inbox row:
 * the inbox read goes out on both sides of this change, so an ABSENCE asserted
 * after it is an absence and not a tree that has not run yet.
 */
describe('AppHeader — the Activity tab asks only a caller who may read sys_activity (objectui#12081)', () => {
  /** `/auth/me/permissions` for an authenticated member — `member_default`'s two inbox reads, no `*`. */
  const MEMBER: MePermissionsResponse = {
    authenticated: true,
    userId: 'u1',
    tenantId: null,
    roles: [],
    permissionSets: ['member_default'],
    objects: {
      sys_inbox_message: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
      sys_notification_receipt: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    },
    fields: {},
  };
  /** The same member, plus an app set that grants read on `sys_activity`. */
  const ACTIVITY_READER: MePermissionsResponse = {
    ...MEMBER,
    objects: {
      ...MEMBER.objects,
      sys_activity: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
      // The object its app lists: the roster is pruned by the same read gate
      // the sidebar applies (objectui#12530).
      hr_contract: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    },
  };

  const renderBell = (perms: MePermissionsResponse) => {
    const rendered = render(
      <MePermissionsProvider initialPermissions={perms}>
        <AppHeader variant="home" />
      </MePermissionsProvider>,
    );
    // Asked for, as a user about to open the bell asks (objectui#12980): the
    // grant decides from there, so a member without it still issues nothing.
    askForActivity();
    return rendered;
  };

  beforeEach(() => {
    activityRows = [ACTIVITY_ROW];
  });

  it('a member without the grant issues no sys_activity request and is not told "No recent activity"', async () => {
    renderBell(MEMBER);

    expect(await screen.findByText('Contract expiring: Zhang San')).toBeInTheDocument();
    expect(activityReads()).toHaveLength(0);
    // The tab is not offered at all — neither its trigger, nor an empty state
    // that would assert something about rows the caller may not read, nor a
    // drill into a list page that answers this caller 403.
    expect(screen.queryByText('Activity feed')).not.toBeInTheDocument();
    expect(screen.queryByText('No recent activity')).not.toBeInTheDocument();
    expect(screen.queryByText('View all activity')).not.toBeInTheDocument();
  });

  it('a caller holding the grant still gets the feed (the control)', async () => {
    renderBell(ACTIVITY_READER);

    expect(await screen.findByText('updated Contract C-1')).toBeInTheDocument();
    expect(activityReads()).toHaveLength(1);
    expect(screen.getByText('Activity feed')).toBeInTheDocument();
    expect(screen.queryByText('No recent activity')).not.toBeInTheDocument();
  });

  it('a 403 from the server (a stale grant) reads as refused, never as "No recent activity" (objectui#12859)', async () => {
    activityError = Object.assign(new Error("operation 'find' on object 'sys_activity' is not permitted"), {
      httpStatus: 403,
      code: 'PERMISSION_DENIED',
    });
    renderBell(ACTIVITY_READER);

    await waitFor(() => expect(activityReads()).toHaveLength(1));
    const unanswered = await screen.findByTestId('inbox-activity-unanswered');
    expect(unanswered).toHaveTextContent("You don't have permission to view activity.");
    expect(unanswered).not.toHaveTextContent('An unexpected error occurred.');
    expect(screen.getByTestId('inbox-activity-access-denied')).toBeInTheDocument();
    expect(screen.queryByText('No recent activity')).not.toBeInTheDocument();
  });

  it('CONTROL: a 500 reads as failed with the generic copy, never as refused (objectui#12859)', async () => {
    activityError = Object.assign(new Error('Internal Server Error'), { httpStatus: 500 });
    renderBell(ACTIVITY_READER);

    await waitFor(() => expect(activityReads()).toHaveLength(1));
    expect(await screen.findByTestId('inbox-activity-unanswered')).toHaveTextContent(
      'An unexpected error occurred.',
    );
    expect(screen.queryByTestId('inbox-activity-access-denied')).not.toBeInTheDocument();
    expect(screen.queryByText('No recent activity')).not.toBeInTheDocument();
  });

  it('a genuinely empty feed still says so — the empty copy is earned, not retired', async () => {
    activityRows = [];
    renderBell(ACTIVITY_READER);

    await waitFor(() => expect(activityReads()).toHaveLength(1));
    expect(await screen.findByText('No recent activity')).toBeInTheDocument();
    expect(screen.queryByTestId('inbox-activity-unanswered')).not.toBeInTheDocument();
  });
});

/**
 * objectui#13027 — the approvals read is ONE PAGE plus the route's `total`.
 *
 * The count is drawn on every console page (the badge's second addend, the
 * breakdown line, the tab strip); the rows only by Home's five-row preview. So
 * the one shared read asks for a page (`limit`) and every surface's count is
 * the answer's `total` — never the page's length, which would cap the badge at
 * the page size. Still one request for the bell and Home together (#4197).
 */
describe('AppHeader — the approvals read is one page and its total (objectui#13027)', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => ({ id: `apr_${i + 1}` }));

  it('one open asks for one page, and the badge shows the total, not the page', async () => {
    approvalRows = twelve;
    render(<AppHeader variant="app" appName="ehr" />);

    await waitFor(() =>
      expect(screen.getByTestId('inbox-badge-breakdown-approvals')).toHaveTextContent(
        '12 pending approvals',
      ),
    );
    expect(approvalReads()).toHaveLength(1);
    expect(new URL(approvalReads()[0], 'http://localhost').searchParams.get('limit')).toBe('5');
    // The measure: one open's approvals response carried 5 rows, not all 12.
    expect(approvalRowsServed).toEqual([5]);
  });

  it('the bell and Home read the same total from the same one read, past the page size', async () => {
    approvalRows = twelve;
    render(
      <>
        <AppHeader variant="home" />
        <HomeTodoCardProbe />
      </>,
    );

    await waitFor(() => expect(screen.getByTestId('home-approvals-count')).toHaveTextContent('12'));
    expect(screen.getByTestId('inbox-badge-breakdown-approvals')).toHaveTextContent(
      '12 pending approvals',
    );
    expect(approvalReads()).toHaveLength(1);
  });
});
