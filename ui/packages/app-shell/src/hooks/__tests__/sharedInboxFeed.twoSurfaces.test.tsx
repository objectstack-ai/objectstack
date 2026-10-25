/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * #4225 / #4316 — the bell and Home's action centre, driven from ONE inbox feed.
 *
 * ## What was wrong
 *
 * Two consumers read `sys_inbox_message` on `/home`, and they asked different
 * questions of it. The bell's poll joined `sys_notification_receipt` for
 * read-state; `useHomeInbox` did not join anything. So Home could not tell a
 * read message from an unread one and listed the five most recent
 * unconditionally, badged — while the bell two hundred pixels above, reading
 * the same rows through the join, correctly showed zero unread (#4316). One
 * page load, two panels, opposite claims about the same messages.
 *
 * ## What these pin
 *
 * Both surfaces now derive from `sharedUserFeeds`' inbox feed, so the pins here
 * are deliberately *joint*: every case mounts the real `AppHeader` and the real
 * `HomeActionCenter` in ONE tree over ONE fake adapter and asserts what BOTH
 * show. That is the difference between "the bug is fixed" and "the bug has no
 * representable state left" — a future change that re-splits the read has to
 * make these two panels disagree to get past them, which is exactly the failure
 * mode being locked out.
 *
 * Reverse verification (predictions first, measured in PR #4319):
 *   - restore `useHomeInbox`'s own unjoined read ⇒ the #4316 block goes red
 *     (Home lists read messages the bell is not badging) and the one-read block
 *     goes red (two `sys_inbox_message` reads instead of one);
 *   - drop only the `!m.is_read` filter ⇒ the #4316 block goes red, the
 *     one-read block stays GREEN — which is why the read-count pin cannot stand
 *     in for the read-state pin, and both are here.
 *
 * ## #4329 — one question, one number
 *
 * Read-state was only half of "the two surfaces agree". The other half is HOW
 * MANY: Home badged `pendingApprovalsCount + notifications.length`, and
 * `notifications` is the list it renders — which `useHomeInbox` caps at 5. So
 * with nine unread the bell said 9 and the card two hundred pixels below said
 * 5, for the same question about the same rows. The badge was reporting the
 * size of a preview as if it were a total.
 *
 * The badge now counts unread TOPICS through `groupNotifications` — the bell's
 * own fold, over the bell's own rows — while the list stays capped. Badge =
 * "how much is waiting", list = "the newest few of it": two semantics, each
 * truthful, one number.
 *
 * Reverse verification (predictions first, measured in PR #4344):
 *   - restore `total = pendingApprovalsCount + notifications.length` ⇒ the
 *     #4329 block goes red (Home badges its capped 5 against the bell's 9) and
 *     the whole #4316 read-state block stays GREEN — the cap and the join are
 *     different defects and neither pin stands in for the other;
 *   - count the pre-slice list length instead of the topic fold (title-folded,
 *     blank titles dropped) ⇒ every case here stays green EXCEPT
 *     "counts unread TOPICS, not the titles the list happens to show", which is
 *     the only fixture where the two folds disagree — that case is why the
 *     count is taken from `groupNotifications` rather than re-derived.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

// ── Chrome the header pulls in but that this test does not exercise ──────────
// (the mock set `AppHeader.inboxVariant.test.tsx` established for mounting the
// real header in jsdom — kept in step with it deliberately.)

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/', search: '', hash: '', state: null, key: 'test' }),
  useParams: () => ({}),
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
  useObjectLabel: () => ({
    objectLabel: (n: string) => n,
    dashboardLabel: (n: string) => n,
    pageLabel: (n: string) => n,
    reportLabel: (n: string) => n,
    viewLabel: (n: string) => n,
    appLabel: (n: string) => n,
  }),
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
  PresenceAvatars: () => <div data-testid="presence-avatars" />,
  useTenantPresence: () => [],
}));

vi.mock('../../layout/ModeToggle', () => ({ ModeToggle: () => null }));
vi.mock('../../layout/WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => null }));
vi.mock('../../layout/LocaleSwitcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('../../layout/ConnectionStatus', () => ({ ConnectionStatus: () => null }));
vi.mock('../../layout/AppSwitcher', () => ({ AppSwitcher: () => null }));
vi.mock('../../layout/LocalizedSidebarTrigger', () => ({ LocalizedSidebarTrigger: () => null }));
vi.mock('../../layout/PreviewBadge', () => ({ PreviewBadge: () => null }));

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

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [], dashboards: [], pages: [], reports: [] }),
}));

// ── The fixture: one user's inbox, read-state carried by the receipts ────────

/**
 * Nine messages for one user — #4316's exact reported shape ("a user who opens
 * the bell and reads all nine messages, then returns to Home").
 */
const NINE = Array.from({ length: 9 }, (_, i) => ({
  id: `ibx_${i + 1}`,
  user_id: 'u1',
  notification_id: `ntf_${i + 1}`,
  topic: 'approval.reminder',
  title: `Approval request ${i + 1} needs your decision`,
  action_url: `/apps/crm/sys_approval_request/record/a_${i + 1}`,
  created_at: `2026-08-0${i + 1}T09:00:00Z`,
}));

/**
 * Ten messages, five of them read — the mixed cut. Three share a `(topic,
 * title)` so BOTH consumers' coalescing passes are exercised: the bell folds by
 * `(topic, title)`, Home by title, and the unread subset has to survive each.
 */
const MIXED = [
  { id: 'ibx_01', notification_id: 'ntf_01', topic: 'approval.reminder', title: 'Approval reminder: INV-1008', created_at: '2026-08-11T04:30:00Z' },
  { id: 'ibx_02', notification_id: 'ntf_02', topic: 'hr.contract.expiring', title: 'Contract expiring: Zhang San', created_at: '2026-08-11T04:00:00Z' },
  { id: 'ibx_03', notification_id: 'ntf_03', topic: 'project.digest', title: 'Scheduled project digest', created_at: '2026-08-11T03:00:00Z' },
  { id: 'ibx_04', notification_id: 'ntf_04', topic: 'project.digest', title: 'Scheduled project digest', created_at: '2026-08-11T02:00:00Z' },
  { id: 'ibx_05', notification_id: 'ntf_05', topic: 'task.mention', title: 'You were mentioned in Task T-42', created_at: '2026-08-11T01:00:00Z' },
  { id: 'ibx_06', notification_id: 'ntf_06', topic: 'project.digest', title: 'Scheduled project digest', created_at: '2026-08-11T00:00:00Z' },
  { id: 'ibx_07', notification_id: 'ntf_07', topic: 'crm.lead.assigned', title: 'Lead assigned: Acme Corp', created_at: '2026-08-10T23:00:00Z' },
  { id: 'ibx_08', notification_id: 'ntf_08', topic: 'invoice.paid', title: 'Invoice INV-1004 paid', created_at: '2026-08-10T22:00:00Z' },
  { id: 'ibx_09', notification_id: 'ntf_09', topic: 'deal.won', title: 'Deal won: Globex renewal', created_at: '2026-08-10T21:00:00Z' },
  { id: 'ibx_10', notification_id: 'ntf_10', topic: 'system.maintenance', title: 'Scheduled maintenance Sunday 02:00', created_at: '2026-08-10T20:00:00Z' },
].map((r) => ({ ...r, user_id: 'u1', action_url: `/apps/showcase/x/record/${r.id}` }));

/** Rows 06-10 are read; 01-05 are not. */
const MIXED_READ_IDS = ['ntf_06', 'ntf_07', 'ntf_08', 'ntf_09', 'ntf_10'];
/** The four distinct UNREAD titles (the two unread digests fold into one). */
const UNREAD_TITLES = [
  'Approval reminder: INV-1008',
  'Contract expiring: Zhang San',
  'Scheduled project digest',
  'You were mentioned in Task T-42',
];
/** Titles that are read — neither surface may present them as waiting. */
const READ_TITLES = [
  'Lead assigned: Acme Corp',
  'Invoice INV-1004 paid',
  'Deal won: Globex renewal',
  'Scheduled maintenance Sunday 02:00',
];

/**
 * Two unread messages sharing a TITLE across two different topics — the one
 * fixture where the surfaces' two folds disagree. The bell folds by
 * `(topic, title)` and sees two topics; Home's LIST folds by title alone (its
 * digest-collapsing rule, deliberately unchanged here) and renders one row.
 * The badge is the bell's question, so it answers the bell's fold: 2.
 */
const TWIN_TITLES = [
  { id: 'ibx_t1', notification_id: 'ntf_t1', topic: 'crm.lead.assigned', title: 'Acme Corp needs you', created_at: '2026-08-11T05:00:00Z' },
  { id: 'ibx_t2', notification_id: 'ntf_t2', topic: 'approval.reminder', title: 'Acme Corp needs you', created_at: '2026-08-11T04:00:00Z' },
].map((r) => ({ ...r, user_id: 'u1', action_url: `/apps/showcase/x/record/${r.id}` }));

/** Twelve unread topics — past the bell's "9+" display clamp. */
const TWELVE = Array.from({ length: 12 }, (_, i) => ({
  id: `ibx_d${i + 1}`,
  user_id: 'u1',
  notification_id: `ntf_d${i + 1}`,
  topic: `topic.${i + 1}`,
  title: `Waiting item ${i + 1}`,
  action_url: `/apps/crm/x/record/d_${i + 1}`,
  created_at: `2026-08-${String(i + 1).padStart(2, '0')}T09:00:00Z`,
}));

/** `read` for the listed notification ids, `delivered` (= NOT read) for the rest. */
const receiptsFor = (rows: Array<{ notification_id: string }>, readIds: string[]) =>
  rows.map((r, i) => ({
    id: `rcp_${i + 1}`,
    notification_id: r.notification_id,
    user_id: 'u1',
    channel: 'inbox',
    state: readIds.includes(r.notification_id) ? 'read' : 'delivered',
  }));

const finds: Array<{ object: string; query: unknown }> = [];
let inboxRows: Array<Record<string, unknown>> = [];
let receiptRows: Array<Record<string, unknown>> = [];
/** Overrides the inbox read outright (rejections, for the status cases). */
let inboxBehaviour: (() => Promise<unknown>) | null = null;

const fakeAdapter = {
  find: (object: string, query: unknown) => {
    finds.push({ object, query });
    if (object === 'sys_inbox_message') {
      return inboxBehaviour ? inboxBehaviour() : Promise.resolve({ data: inboxRows });
    }
    if (object === 'sys_notification_receipt') return Promise.resolve({ data: receiptRows });
    return Promise.resolve({ data: [] });
  },
  getClient: () => undefined,
};

vi.mock('../../providers/AdapterProvider', () => ({ useAdapter: () => fakeAdapter }));

import { AppHeader } from '../../layout/AppHeader';
import { HomeActionCenter } from '../../console/home/HomeRail';
import { useHomeInbox } from '../useHomeInbox';
import { __resetSharedUserFeeds } from '../sharedUserFeeds';

/**
 * Home's action centre wired exactly as `HomePage` wires it, fenced behind a
 * testid: both panels render the same strings by construction when the fix
 * works, so every assertion has to say WHICH panel it is talking about.
 */
function HomeProbe() {
  const inbox = useHomeInbox();
  return (
    <div data-testid="home-cards">
      <HomeActionCenter
        pendingApprovals={inbox.pendingApprovals}
        pendingApprovalsCount={inbox.pendingApprovalsCount}
        pendingApprovalsStatus={inbox.pendingApprovalsStatus}
        pendingApprovalsReadable={inbox.pendingApprovalsReadable}
        notifications={inbox.notifications}
        unreadTopicCount={inbox.unreadTopicCount}
        notificationsStatus={inbox.notificationsStatus}
        notificationsReadable={inbox.notificationsReadable}
        onOpenApprovals={() => {}}
        onOpenApproval={() => {}}
        onOpenInbox={() => {}}
        onOpenNotification={() => {}}
        t={(key: string, options?: any) =>
          String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
            String(options?.[name] ?? ''),
          )
        }
      />
    </div>
  );
}

/** The page as a user meets it: the bell above, the action centre below. */
function HomeSurfaces() {
  return (
    <>
      <AppHeader variant="home" />
      <HomeProbe />
    </>
  );
}

const home = () => screen.getByTestId('home-cards');
/** Home's "My work" total pill (objectui#12602), or null when it shows none. */
const homeBadge = (): string | null =>
  within(home()).queryByTestId('home-my-work-count')?.textContent ?? null;
/** Home's notifications column says its read is unanswered (loading or failed). */
const homeUnanswered = () =>
  within(home()).queryByTestId('home-my-work-notifications-notice')?.getAttribute('data-status') !== 'ready' &&
  within(home()).queryByTestId('home-my-work-notifications-notice') !== null;
/** Matches inside the bell only — i.e. anywhere that is not Home's card. */
const inBell = (title: string) =>
  screen.queryAllByText(title).filter((el) => !home().contains(el));
const inHome = (title: string) =>
  screen.queryAllByText(title).filter((el) => home().contains(el));

const inboxReads = () => finds.filter((f) => f.object === 'sys_inbox_message');
const receiptReads = () => finds.filter((f) => f.object === 'sys_notification_receipt');

beforeEach(() => {
  finds.length = 0;
  inboxRows = [];
  receiptRows = [];
  inboxBehaviour = null;
  // The feeds are module-scoped stores that outlive any one render tree.
  __resetSharedUserFeeds();
  // Approvals soft-degrade to 0 (404), so every badge below is the inbox's
  // contribution alone and the two surfaces' numbers are directly comparable.
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 404 }))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Approvals answer with `ids` pending requests; every other fetch still 404s.
 *
 * The count is the number of DISTINCT request ids (`sharedUserFeeds` dedupes by
 * `id` before counting), degrading to 0 on 404 — the second addend BOTH badges
 * have always had, and the one rule #4329 deliberately leaves alone.
 */
/**
 * What the approvals route answers (objectui#13027): asked for a page
 * (`limit`), the first `limit` rows plus the exact `total`; unpaged, every row
 * and no `total` — the route's two shapes, so the fixture is the server's.
 */
function approvalsPage(rows: unknown[], url: string): { data: unknown[]; total?: number } {
  const limit = new URL(url, 'http://localhost').searchParams.get('limit');
  return limit == null ? { data: rows } : { data: rows.slice(0, Number(limit)), total: rows.length };
}

const approvalsPending = (ids: string[]) =>
  vi.stubGlobal(
    'fetch',
    vi.fn((url: unknown) =>
      Promise.resolve(
        String(url).includes('/api/v1/approvals/requests')
          ? new Response(JSON.stringify(approvalsPage(ids.map((id) => ({ id })), String(url))), { status: 200 })
          : new Response('{}', { status: 404 }),
      ),
    ),
  );

describe('#4316 — an already-read message is not "needs your attention"', () => {
  it('nine messages, all read: the bell badges nothing AND Home lists nothing', async () => {
    // #4316's headline scenario, verbatim: the user opened the bell and read
    // all nine, then came back to Home. Before the join, Home listed five of
    // them under "Needs your attention" with a badge, directly contradicting
    // the bell above it.
    inboxRows = NINE;
    receiptRows = receiptsFor(NINE, NINE.map((r) => r.notification_id));

    render(<HomeSurfaces />);

    await waitFor(() => expect(inboxReads().length).toBeGreaterThan(0));
    await waitFor(() =>
      expect(within(home()).getByText('No unread notifications')).toBeInTheDocument(),
    );
    // Home: no rows, no badge.
    expect(within(home()).queryAllByText(/Approval request \d+ needs your decision/)).toHaveLength(0);
    expect(homeBadge()).toBeNull();
    // The bell agrees, and it is the same nine rows it is agreeing about.
    expect(screen.queryByTestId('inbox-bell-badge')).not.toBeInTheDocument();
  });

  it('one unread among nine: both surfaces name that one, and only that one', async () => {
    // The sharpest cut — everything read except row 3. A card that lists "the
    // five most recent" regardless of read-state shows four wrong rows here.
    inboxRows = NINE;
    receiptRows = receiptsFor(
      NINE,
      NINE.map((r) => r.notification_id).filter((id) => id !== 'ntf_3'),
    );

    render(<HomeSurfaces />);

    await waitFor(() =>
      expect(inHome('Approval request 3 needs your decision')).toHaveLength(1),
    );
    // Nothing else reached Home's card …
    expect(within(home()).queryAllByText(/Approval request \d+ needs your decision/)).toHaveLength(1);
    expect(homeBadge()).toBe('1');
    // … and the bell counts exactly the same single unread message.
    await waitFor(() =>
      expect(screen.getByTestId('inbox-bell-badge')).toHaveTextContent('1'),
    );
  });

  it('mixed read-state: the two surfaces agree on the unread subset', async () => {
    inboxRows = MIXED;
    receiptRows = receiptsFor(MIXED, MIXED_READ_IDS);

    render(<HomeSurfaces />);

    // Home lists the unread titles — the newest three, its column's preview
    // (objectui#12602) …
    for (const title of UNREAD_TITLES.slice(0, 3)) {
      await waitFor(() => expect(inHome(title).length).toBeGreaterThan(0));
    }
    // … and not one read title, on either surface's "waiting" reading. The
    // bell's unread filter is its default, so a read row must not be there
    // either — the same rows, the same verdict, from the same feed.
    for (const title of READ_TITLES) {
      expect(inHome(title)).toHaveLength(0);
      expect(inBell(title)).toHaveLength(0);
    }
  });

  it('reads the SAME badge number on both surfaces — 4 unread topics', async () => {
    // Five unread rows folding into four distinct topics. The bell has always
    // badged unread topics; Home now counts the same fold of the same rows, so
    // the two numbers a user can see at once are one number.
    inboxRows = MIXED;
    receiptRows = receiptsFor(MIXED, MIXED_READ_IDS);

    render(<HomeSurfaces />);

    await waitFor(() => expect(screen.getByTestId('inbox-bell-badge')).toHaveTextContent('4'));
    expect(homeBadge()).toBe('4');
  });

  it('an unread message with no receipt at all still counts (delivered ≠ read)', async () => {
    // The other polarity: read-state is asserted by a receipt in a READ state,
    // never inferred from a receipt's absence — a fresh message has no receipt
    // and is unread, which is what makes the join safe to gate the card on.
    inboxRows = NINE;
    receiptRows = [];

    render(<HomeSurfaces />);

    // Nine unread, and both surfaces say nine. Home's LIST is still capped —
    // three rows in the My-work column (objectui#12602) — the cap is a
    // presentation slice, and #4329 is the pin that it may not leak into the badge.
    await waitFor(() => expect(homeBadge()).toBe('9'));
    expect(within(home()).queryAllByText(/Approval request \d+ needs your decision/)).toHaveLength(3);
    expect(screen.getByTestId('inbox-bell-badge')).toHaveTextContent('9');
  });
});

describe('#4329 — the badge is the total, the list is the preview', () => {
  it('counts unread TOPICS, not the titles the list happens to show', async () => {
    // The discriminating fixture. Two unread topics that share a title: the
    // bell's fold sees two, a title fold sees one. Deriving Home's badge from
    // its own (pre-slice) list length would agree with the bell on every other
    // case in this file and disagree here — "agrees usually" is precisely the
    // shape of the defect #4316 was, so the badge takes the bell's own fold of
    // the bell's own rows instead of re-deriving a second one.
    inboxRows = TWIN_TITLES;
    receiptRows = [];

    render(<HomeSurfaces />);

    await waitFor(() => expect(screen.getByTestId('inbox-bell-badge')).toHaveTextContent('2'));
    expect(homeBadge()).toBe('2');
    // The LIST still collapses repeats by title — that is its digest-collapsing
    // rule and #4329 does not touch it. One row under a badge of two is the
    // badge/preview split doing its job, exactly as five rows under nine is.
    expect(inHome('Acme Corp needs you')).toHaveLength(1);
    expect(inBell('Acme Corp needs you')).toHaveLength(2);
  });

  it('adds the same pending-approvals count on both surfaces', async () => {
    // Approvals are the badge's other addend and their rule is unchanged: the
    // distinct pending request ids from the shared REST feed, added once on
    // each surface. Four unread topics + two approvals = six, twice.
    inboxRows = MIXED;
    receiptRows = receiptsFor(MIXED, MIXED_READ_IDS);
    approvalsPending(['ar_1', 'ar_2']);

    render(<HomeSurfaces />);

    await waitFor(() => expect(screen.getByTestId('inbox-bell-badge')).toHaveTextContent('6'));
    expect(homeBadge()).toBe('6');
    // …and the approvals column carries its own count, unchanged.
    expect(within(home()).getByTestId('home-my-work-approvals-count')).toHaveTextContent('2');
  });

  it('the approvals column carries the count the bell badges, from the same read (objectui#12602)', async () => {
    // The My-work section's first column lists the requests themselves; its
    // pill is their number, which is the bell's approvals addend by
    // construction — one request feeds both, and nothing else counts them.
    inboxRows = [];
    receiptRows = [];
    approvalsPending(['ar_1', 'ar_2', 'ar_3']);

    render(<HomeSurfaces />);

    await waitFor(() => expect(screen.getByTestId('inbox-bell-badge')).toHaveTextContent('3'));
    expect(within(home()).getByTestId('home-my-work-approvals-count')).toHaveTextContent('3');
    expect(within(home()).getAllByTestId('home-my-work-approval-row')).toHaveLength(3);
    expect(homeBadge()).toBe('3');
  });

  it('reports the same count past the bell’s "9+" display clamp', async () => {
    // Measured, and pinned as measured: twelve unread topics reach both
    // surfaces as twelve. The bell CLAMPS its rendering at "9+" because its
    // badge is a 20px circle in the top bar (#2765); Home's card badge has the
    // room and prints the number. Same count, two renderings of it — not two
    // counts, which is what #4329 was filed about. Left as-is deliberately:
    // "9+" and "12" do not contradict each other, and clamping Home would mean
    // teaching the shared card badge a display rule it has no other use for.
    inboxRows = TWELVE;
    receiptRows = [];

    render(<HomeSurfaces />);

    await waitFor(() => expect(homeBadge()).toBe('12'));
    expect(screen.getByTestId('inbox-bell-badge')).toHaveTextContent('9+');
    // The list is unmoved by any of it — the column's three rows
    // (objectui#12602; five in the action centre it replaced).
    expect(within(home()).queryAllByText(/Waiting item \d+/)).toHaveLength(3);
  });
});

describe('#4225 — one feed, one read, however many consumers mount', () => {
  beforeEach(() => {
    inboxRows = MIXED;
    receiptRows = receiptsFor(MIXED, MIXED_READ_IDS);
  });

  it('issues ONE sys_inbox_message read for the bell and Home together', async () => {
    render(<HomeSurfaces />);

    // Both surfaces have rendered from it …
    await waitFor(() => expect(inHome('Approval reminder: INV-1008').length).toBeGreaterThan(0));
    expect(inBell('Approval reminder: INV-1008').length).toBeGreaterThan(0);
    // … and exactly one read went out for the two of them. Two consumers, one
    // query: the duplicate-read the card was filed for.
    expect(inboxReads()).toHaveLength(1);
  });

  it('issues ONE sys_notification_receipt read too — the join is shared', async () => {
    render(<HomeSurfaces />);

    await waitFor(() => expect(receiptReads().length).toBeGreaterThan(0));
    expect(receiptReads()).toHaveLength(1);
  });

  it('reads the ADR-0030 `mine` window once, as the bell\'s superset', async () => {
    render(<HomeSurfaces />);

    await waitFor(() => expect(inboxReads().length).toBeGreaterThan(0));
    expect(inboxReads()[0].query).toMatchObject({
      $filter: { user_id: 'u1' },
      $orderby: { created_at: 'desc' },
      $top: 20,
    });
    expect(receiptReads()[0].query).toMatchObject({
      $filter: { user_id: 'u1', channel: 'inbox' },
    });
  });

  it('serves a second consumer mounting later from the same feed, without re-reading', async () => {
    const view = render(<AppHeader variant="home" />);
    await waitFor(() => expect(inboxReads()).toHaveLength(1));

    // Home mounts afterwards — the common case, the page body settling after
    // the header — and is served the cached rows rather than issuing its own.
    view.rerender(<HomeSurfaces />);

    await waitFor(() => expect(inHome('Approval reminder: INV-1008').length).toBeGreaterThan(0));
    expect(inboxReads()).toHaveLength(1);
  });
});

describe('#4225 — a failed inbox read reaches Home as an error, not as stale data', () => {
  /** objectstack#7344's rejection: the object exists, this caller may not read it. */
  const denied = () => {
    const err = new Error(
      "Access denied: operation 'find' on object 'sys_inbox_message' is not permitted",
    ) as Error & { httpStatus?: number; code?: string };
    err.httpStatus = 403;
    err.code = 'PERMISSION_DENIED';
    return Promise.reject(err);
  };

  it('does not let the store swallow a denial into stale-but-ready rows', async () => {
    // The store's pre-#4225 contract was "on error keep the last value" and say
    // nothing — which for a consumer is indistinguishable from a successful
    // re-read returning the same thing. Here the feed HAS rows in hand and then
    // the next read fails: the rows may stay, but the card must stop claiming
    // they are an answer.
    inboxRows = MIXED;
    receiptRows = receiptsFor(MIXED, MIXED_READ_IDS);
    render(<HomeSurfaces />);
    await waitFor(() => expect(inHome('Approval reminder: INV-1008').length).toBeGreaterThan(0));
    expect(homeUnanswered()).toBe(false);

    // Re-read the same feed, in the one way a mounted page really does it: the
    // tab regains focus. (A remount would NOT do — it lands inside the store's
    // freshness window and is served the cache, which is the dedupe working.)
    inboxBehaviour = denied;
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(homeUnanswered()).toBe(true));
    expect(within(home()).getByText('An unexpected error occurred.')).toBeInTheDocument();
    expect(within(home()).queryByText('No unread notifications')).not.toBeInTheDocument();
    // …and the rows are still on screen. "Not an answer any more" is the claim,
    // not "throw the user's inbox away" — the two are different states and the
    // status is what separates them.
    expect(inHome('Approval reminder: INV-1008').length).toBeGreaterThan(0);
  });

  it('still treats a MISSING inbox object as an answer, for both surfaces', async () => {
    // The 404-is-an-answer split, now made once inside the store instead of
    // three times across three call sites (#4225 rider). A community build
    // without service-messaging has no inbox, so nothing is waiting — get this
    // wrong and every such deployment reads an error on Home forever.
    inboxBehaviour = () => {
      const err = new Error('Object not found: sys_inbox_message') as Error & {
        httpStatus?: number;
        code?: string;
      };
      err.httpStatus = 404;
      err.code = 'OBJECT_NOT_FOUND';
      return Promise.reject(err);
    };

    render(<HomeSurfaces />);

    await waitFor(() =>
      expect(within(home()).getByText('No unread notifications')).toBeInTheDocument(),
    );
    expect(homeUnanswered()).toBe(false);
    expect(screen.queryByTestId('inbox-bell-badge')).not.toBeInTheDocument();
  });
});
