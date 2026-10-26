/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * #7233 — the bell badge is `unread notification topics + pending approvals`
 * and clamps at "9+", so on a loaded console it is one opaque number that a
 * user cannot reconcile against Home's "pending approvals" card (which reads
 * the same `pendingApprovalsCount`). The popover already *tabs* the two
 * streams and puts a count pill on each tab, but those pills clamp at "9+"
 * too — three "9+"s that add up to nothing.
 *
 * These pin the breakdown line: the exact, unclamped addends, next to the
 * exact total, so "9+" is explainable as N notifications + M pending
 * approvals.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Interpolating stub: the real packs carry `{{count}}` / `{{total}}`, so a
// stub that returned `defaultValue` verbatim would make every numeric
// assertion below vacuous (it would assert on the literal "{{total}}"). It does
// not plural-select — the singular forms are pinned against the real `en`
// pack in `InboxPopover.badgePlural-13133.test.tsx`.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  // `formatRelativeTime` is reached through `utils/relativeTime` for every
  // rendered row — keep the real module and override only the hook.
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    language: 'en',
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
        String(options?.[name] ?? ''),
      ),
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ appName: 'setup' }),
}));

vi.mock('../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ currentAppName: 'setup' }),
}));

// Passthrough primitives so the popover body renders without driving Radix
// open/close in jsdom (the pattern WorkspaceSwitcher.test.tsx uses).
vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Button: ({ children, ...p }: any) => <button type="button" {...p}>{children}</button>,
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <button type="button">{children}</button>,
  TabsContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('lucide-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Bell: () => <span />,
  CheckSquare: () => <span />,
  Activity: () => <span />,
  ChevronRight: () => <span />,
}));

import { InboxPopover, type InboxNotification } from '../InboxPopover';

const notif = (over: Partial<InboxNotification> & { id: string }): InboxNotification => ({
  type: 'project.digest',
  title: 'Scheduled project digest',
  is_read: false,
  created_at: '2026-08-10T10:00:00Z',
  ...over,
});

/** N distinct unread topics (each its own `(topic, title)` pair). */
const distinctUnread = (n: number): InboxNotification[] =>
  Array.from({ length: n }, (_, i) =>
    notif({ id: `t${i}`, type: `topic.${i}`, title: `Topic ${i}` }),
  );

function renderPopover(props: {
  notifications: InboxNotification[];
  pendingApprovalsCount: number;
  unreadCount?: number;
}) {
  return render(
    <InboxPopover
      notifications={props.notifications}
      unreadCount={props.unreadCount ?? props.notifications.filter((n) => !n.is_read).length}
      pendingApprovalsCount={props.pendingApprovalsCount}
      activity={{ value: [], status: 'ready', readable: true }}
      onMarkAllRead={vi.fn()}
      onMarkRead={vi.fn()}
    />,
  );
}

describe('InboxPopover — bell badge breakdown (#7233)', () => {
  it('explains a clamped "9+" badge as exact notifications + pending approvals', () => {
    renderPopover({ notifications: distinctUnread(12), pendingApprovalsCount: 3 });

    // The badge itself still clamps — the formula is unchanged by this fix.
    expect(screen.getByTestId('inbox-bell-badge')).toHaveTextContent('9+');

    // …and the popover spells out what that "9+" is made of, unclamped.
    expect(screen.getByTestId('inbox-badge-breakdown-total')).toHaveTextContent('15 total');
    expect(screen.getByTestId('inbox-badge-breakdown-notifications')).toHaveTextContent(
      '12 notifications',
    );
    expect(screen.getByTestId('inbox-badge-breakdown-approvals')).toHaveTextContent(
      '3 pending approvals',
    );
  });

  it('states the two addends and the total consistently (total === N + M)', () => {
    renderPopover({ notifications: distinctUnread(4), pendingApprovalsCount: 2 });

    const read = (id: string) => {
      const text = screen.getByTestId(id).textContent ?? '';
      const n = Number(text.match(/\d+/)?.[0]);
      expect(Number.isNaN(n)).toBe(false);
      return n;
    };
    const total = read('inbox-badge-breakdown-total');
    const unread = read('inbox-badge-breakdown-notifications');
    const approvals = read('inbox-badge-breakdown-approvals');

    expect(unread + approvals).toBe(total);
    expect(screen.getByTestId('inbox-bell-badge')).toHaveTextContent(String(total));
  });

  it('reports the approvals half straight from pendingApprovalsCount (the count Home shows)', () => {
    // Home's approvals card and the Approvals Inbox tab read the same number;
    // #7213 measured home saying 8 while the bell said "9+". The breakdown has
    // to show that 8 verbatim, never the notification-inflated total.
    renderPopover({ notifications: distinctUnread(2), pendingApprovalsCount: 8 });

    expect(screen.getByTestId('inbox-badge-breakdown-approvals')).toHaveTextContent(
      '8 pending approvals',
    );
    expect(screen.getByTestId('inbox-badge-breakdown-total')).toHaveTextContent('10 total');
  });

  it('counts coalesced repeats as one topic, matching the badge formula (#2765)', () => {
    // 10 identical digests + 2 distinct topics = 3 unread topics, not 12.
    const repeats = Array.from({ length: 10 }, (_, i) => notif({ id: `d${i}` }));
    renderPopover({
      notifications: [
        ...repeats,
        notif({ id: 'a1', type: 'task.assigned', title: 'New task assigned' }),
        notif({ id: 'm1', type: 'comment.mention', title: 'You were mentioned' }),
      ],
      pendingApprovalsCount: 1,
    });

    expect(screen.getByTestId('inbox-badge-breakdown-notifications')).toHaveTextContent(
      '3 notifications',
    );
    expect(screen.getByTestId('inbox-badge-breakdown-total')).toHaveTextContent('4 total');
  });

  it('renders no breakdown when there is no badge to explain', () => {
    renderPopover({
      notifications: [notif({ id: 'r1', is_read: true })],
      pendingApprovalsCount: 0,
    });

    expect(screen.queryByTestId('inbox-bell-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('inbox-badge-breakdown')).not.toBeInTheDocument();
  });
});
