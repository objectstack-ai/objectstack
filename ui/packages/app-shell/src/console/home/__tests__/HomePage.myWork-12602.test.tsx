// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12602 — Home's "My work" section, section ③ of the artboard
 * "系统首页 · 四段式", on the real `HomePage` and the real `HomeActionCenter`.
 *
 * What these cases pin:
 *
 *   - the approvals waiting on the user are the FIRST column, listed by the
 *     service's labels, with the count `useHomeInbox` hands the page — the
 *     count the greeting's line and the bell read (that the bell and the
 *     column agree over the real shared store is
 *     `sharedInboxFeed.twoSurfaces.test.tsx`'s case); a row opens that
 *     request in the Approvals inbox;
 *   - the section is TWO columns, Approvals then Notifications: no source
 *     classifies an inbox row as "assigned to me" or carries a due date, so a
 *     row whose topic reads like an assignment still lands under
 *     Notifications and nothing reads "overdue" — the card's fork, reported on
 *     the PR, not guessed from a topic;
 *   - the pending-drafts row sits under the section's heading and runs the
 *     publish the retired banner ran, and nothing renders above the greeting
 *     any more;
 *   - the section renders nothing for a caller who may read neither source and
 *     has no draft to publish, and drops the column of a source the caller may
 *     not read.
 *
 * `t` echoes the KEY (and the arguments it was handed), so a hardcoded string
 * fails here; that every key exists in all ten packs is
 * `all-locales-key-parity.test.ts`'s and `check:i18n-keys`'s.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigateMock = vi.fn();
const publishAllMock = vi.fn(async () => ({ ok: true }));

const state = vi.hoisted(() => ({
  apps: [] as Array<Record<string, unknown>>,
  pendingApprovals: [] as Array<Record<string, unknown>>,
  pendingApprovalsCount: 0,
  pendingApprovalsReadable: true,
  notifications: [] as Array<Record<string, unknown>>,
  unreadTopicCount: 0,
  notificationsReadable: true,
  draftCount: 0 as number | null,
  draftEntries: [] as Array<Record<string, unknown>>,
  /** The package list's answer; `null` holds it on the wire, so no case settles it unasked. */
  packages: null as Array<{ id: string; name: string; writable: boolean; namespace: string | null }> | null,
}));

vi.mock('react-router-dom', async () => {
  const { createElement } = await import('react');
  return {
    useNavigate: () => navigateMock,
    Link: ({ to, ...rest }: { to: string } & Record<string, unknown>) =>
      createElement('a', { ...rest, href: to }),
  };
});

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      `«${key}»` +
      ['count', 'names', 'package']
        .filter((k) => opts?.[k] !== undefined)
        .map((k) => `[${k}=${String(opts?.[k])}]`)
        .join(''),
    language: 'en',
  }),
  useObjectLabel: () => {
    const label = (x: { name?: string; label?: string }) => String(x?.label || x?.name || '');
    return {
      appLabel: label,
      objectLabel: label,
      objectPluralLabel: label,
      dashboardLabel: label,
      pageLabel: label,
      reportLabel: label,
      viewLabel: (_object: string, _view: string, fallback?: string) => fallback ?? '',
    };
  },
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Dev Admin', email: 'dev.admin@example.com' } }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: [] }),
  isAskAgent: () => false,
  agentHasCapability: () => false,
}));

vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: state.apps, objects: [], dashboards: [], pages: [], reports: [], loading: false }),
}));
vi.mock('../../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ currentAppName: 'crm' }),
}));
vi.mock('../../../hooks/useCanAuthorMetadata', () => ({ useCanAuthorMetadata: () => true }));
// The page's one inbox seam: both sources, their answers and their read grants.
vi.mock('../../../hooks/useHomeInbox', () => ({
  useHomeInbox: () => ({
    pendingApprovals: state.pendingApprovals,
    pendingApprovalsCount: state.pendingApprovalsCount,
    pendingApprovalsStatus: 'ready',
    pendingApprovalsReadable: state.pendingApprovalsReadable,
    notifications: state.notifications,
    unreadTopicCount: state.unreadTopicCount,
    notificationsStatus: 'ready',
    notificationsReadable: state.notificationsReadable,
    activity: { value: [], status: 'ready', readable: true },
  }),
}));
vi.mock('../../../runtime-config', () => ({
  getRuntimeConfig: () => ({ branding: { productName: 'ObjectStack' } }),
  isMarketplaceEnabled: () => true,
  isAiStudioEnabled: () => true,
}));
vi.mock('../../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: [] }) }));
vi.mock('../../../hooks/useFavorites', () => ({ useFavorites: () => ({ favorites: [] }) }));
vi.mock('../../../hooks/useAiSurface', () => ({ resolveAiApiBase: () => '' }));
// The drafts row's two seams, the ones the retired banner read.
vi.mock('../../../preview/usePendingDrafts', () => ({
  usePendingDrafts: () => ({ count: state.draftCount, entries: state.draftEntries }),
}));
vi.mock('../../../preview/usePublishAllDrafts', () => ({
  usePublishAllDrafts: () => ({ publishAll: publishAllMock, publishing: false }),
}));
// The package list the row names a shared package from (objectui#13136); that
// it is read over the wire is `HomePage.pendingDraftsPackageName-13136`'s.
vi.mock('../../../views/studio-design/packages-io', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../views/studio-design/packages-io')>()),
  fetchPackages: () => (state.packages ? Promise.resolve(state.packages) : new Promise<never>(() => {})),
}));

import { HomePage } from '../HomePage';

const CRM = { name: 'crm', label: 'CRM', icon: 'Building2' };

/** Every URL the page handed the global `fetch` — none is expected. */
let fetchCalls: string[] = [];

beforeEach(() => {
  navigateMock.mockReset();
  publishAllMock.mockClear();
  state.apps = [CRM];
  state.pendingApprovals = [];
  state.pendingApprovalsCount = 0;
  state.pendingApprovalsReadable = true;
  state.notifications = [];
  state.unreadTopicCount = 0;
  state.notificationsReadable = true;
  state.draftCount = 0;
  state.draftEntries = [];
  state.packages = null;
  fetchCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      fetchCalls.push(String(input));
      return { ok: false, status: 404, json: async () => ({}) };
    }),
  );
});

afterEach(() => {
  expect(fetchCalls).toEqual([]);
  cleanup();
  vi.unstubAllGlobals();
});

const TWO_APPROVALS = [
  { id: 'apr_1', processLabel: 'Discount approval', recordTitle: 'QUO-0007', processName: 'discount', createdAt: new Date().toISOString() },
  { id: 'apr_2', processLabel: 'Contract approval', recordTitle: 'Globex renewal', processName: 'contract', createdAt: new Date().toISOString() },
];

/** The section's columns, in the order they are drawn. */
const columns = () =>
  Array.from(screen.getByTestId('home-my-work').querySelectorAll('[data-testid^="home-my-work-"][data-testid$="s"]'))
    .map((el) => el.getAttribute('data-testid'))
    .filter((id) => id === 'home-my-work-approvals' || id === 'home-my-work-notifications');

describe('the approvals column (objectui#12602)', () => {
  it('is the first column, lists the requests, and carries the count Home reads', () => {
    state.pendingApprovals = TWO_APPROVALS;
    state.pendingApprovalsCount = 2;
    render(<HomePage />);

    expect(columns()[0]).toBe('home-my-work-approvals');
    const approvals = screen.getByTestId('home-my-work-approvals');
    expect(within(approvals).getByTestId('home-my-work-approvals-count')).toHaveTextContent('2');
    // The count beside the greeting is the same number from the same seam.
    expect(screen.getByTestId('home-work-summary')).toHaveTextContent('[count=2]');
    const rows = within(approvals).getAllByTestId('home-my-work-approval-row');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Discount approval · QUO-0007'),
      expect.stringContaining('Contract approval · Globex renewal'),
    ]);
  });

  it('opens a request in the Approvals inbox of the app the user is in', async () => {
    state.pendingApprovals = TWO_APPROVALS;
    state.pendingApprovalsCount = 2;
    render(<HomePage />);

    await userEvent.setup().click(screen.getAllByTestId('home-my-work-approval-row')[1]);
    expect(navigateMock).toHaveBeenCalledWith('/apps/crm/system/approvals?request=apr_2');
  });

  it('says nothing is waiting at zero — on the approvals column only', () => {
    render(<HomePage />);
    expect(screen.getByTestId('home-my-work-approvals-notice')).toHaveTextContent('«home.myWork.approvalsEmpty»');
    expect(screen.queryByTestId('home-my-work-approvals-count')).toBeNull();
  });
});

describe('two columns until an inbox row can say what kind it is (objectui#12602)', () => {
  it('draws Approvals then Notifications, and no third column', () => {
    render(<HomePage />);
    expect(columns()).toEqual(['home-my-work-approvals', 'home-my-work-notifications']);
  });

  it('files a row whose topic reads like an assignment under Notifications, with no "overdue"', () => {
    // The kind is not on the record: guessing it from `topic` or the title is
    // exactly what the card rules out.
    state.notifications = [
      { id: 'n1', title: 'Lead assigned: Acme Corp', actionUrl: '/lead/l_1', createdAt: '2020-01-01T00:00:00Z' },
    ];
    state.unreadTopicCount = 1;
    render(<HomePage />);

    const notifications = screen.getByTestId('home-my-work-notifications');
    expect(within(notifications).getByText('Lead assigned: Acme Corp')).toBeInTheDocument();
    expect(within(screen.getByTestId('home-my-work-approvals')).queryByText('Lead assigned: Acme Corp')).toBeNull();
    expect(screen.getByTestId('home-my-work').textContent).not.toMatch(/overdue|逾期/i);
  });

  it('totals the two columns in the heading pill — the bell badge’s two addends', () => {
    state.pendingApprovals = TWO_APPROVALS;
    state.pendingApprovalsCount = 2;
    state.notifications = [{ id: 'n1', title: 'Weekly digest', createdAt: new Date().toISOString() }];
    state.unreadTopicCount = 9;
    render(<HomePage />);
    expect(screen.getByTestId('home-my-work-count')).toHaveTextContent('11');
    expect(screen.getByTestId('home-my-work-notifications-count')).toHaveTextContent('9');
  });

  it('opens the inbox the bell opens, from the heading and from the column', async () => {
    render(<HomePage />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('home-my-work-open-inbox'));
    await user.click(screen.getByTestId('home-my-work-notifications-view-all'));
    expect(navigateMock.mock.calls.map((c) => c[0])).toEqual([
      '/apps/crm/sys_inbox_message?view=mine',
      '/apps/crm/sys_inbox_message?view=mine',
    ]);
  });
});

describe('the pending-drafts row (objectui#12602)', () => {
  const DRAFTS = [
    { type: 'object', name: 'ticket', label: 'Ticket', packageId: 'studio_test' },
    { type: 'app', name: 'ticket_desk', label: 'Ticket Desk', packageId: 'studio_test' },
    { type: 'page', name: 'help_center', packageId: 'studio_test' },
    { type: 'view', name: 'all_tickets', packageId: 'studio_test' },
  ];

  it('sits under the My-work heading and runs the publish the banner ran', async () => {
    state.draftCount = 4;
    state.draftEntries = DRAFTS;
    state.packages = [{ id: 'studio_test', name: 'Studio Test', writable: true, namespace: null }];
    render(<HomePage />);

    const row = within(screen.getByTestId('home-my-work')).getByTestId('home-pending-drafts');
    expect(row).toHaveTextContent('«home.pendingDrafts.title»[count=4]');
    // The first three names — label first, the name where none was served —
    // in the package they share, named as Studio names it (objectui#13136).
    await waitFor(() =>
      expect(row).toHaveTextContent('[names=Ticket«home.pendingDrafts.nameSeparator»Ticket Desk«home.pendingDrafts.nameSeparator»help_center][package=Studio Test]'),
    );

    await userEvent.setup().click(within(row).getByTestId('pending-drafts-publish'));
    expect(publishAllMock).toHaveBeenCalledTimes(1);
  });

  it('retires the banner: nothing renders above the greeting', () => {
    state.draftCount = 4;
    state.draftEntries = DRAFTS;
    render(<HomePage />);

    const greeting = screen.getByRole('heading', { level: 1 });
    const row = screen.getByTestId('home-pending-drafts');
    expect(greeting.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByTestId('pending-drafts-publish')).toHaveLength(1);
    expect(screen.queryByText(/home\.pendingDrafts\.message/)).toBeNull();
  });

  it('names no package when the drafts are spread over several', () => {
    state.draftCount = 2;
    state.draftEntries = [
      { type: 'object', name: 'ticket', packageId: 'a' },
      { type: 'object', name: 'invoice', packageId: 'b' },
    ];
    render(<HomePage />);
    expect(screen.getByTestId('home-pending-drafts')).toHaveTextContent('«home.pendingDrafts.waiting»');
    expect(screen.getByTestId('home-pending-drafts').textContent).not.toContain('[package=');
  });

  it('is still offered with no app yet — the moment the assistant drafted the first one', async () => {
    state.apps = [];
    state.draftCount = 1;
    state.draftEntries = [{ type: 'app', name: 'helpdesk', packageId: 'p' }];
    render(<HomePage />);
    await userEvent.setup().click(screen.getByTestId('pending-drafts-publish'));
    expect(publishAllMock).toHaveBeenCalledTimes(1);
  });

  it('is absent with nothing to publish', () => {
    render(<HomePage />);
    expect(screen.queryByTestId('home-pending-drafts')).toBeNull();
  });
});

describe('who sees the section (objectui#12602)', () => {
  it('renders nothing for a caller who may read neither source and has no draft', () => {
    state.pendingApprovalsReadable = false;
    state.notificationsReadable = false;
    render(<HomePage />);
    expect(screen.queryByTestId('home-my-work')).toBeNull();
    expect(screen.queryByText('«home.myWork.title»')).toBeNull();
  });

  it('drops the column, and the inbox link, of a source the caller may not read', () => {
    state.notificationsReadable = false;
    render(<HomePage />);
    expect(columns()).toEqual(['home-my-work-approvals']);
    expect(screen.queryByTestId('home-my-work-open-inbox')).toBeNull();
  });

  it('keeps the drafts row for a caller with drafts and no readable source', () => {
    state.pendingApprovalsReadable = false;
    state.notificationsReadable = false;
    state.draftCount = 1;
    state.draftEntries = [{ type: 'object', name: 'ticket', packageId: 'p' }];
    render(<HomePage />);
    expect(within(screen.getByTestId('home-my-work')).getByTestId('home-pending-drafts')).toBeInTheDocument();
  });
});
