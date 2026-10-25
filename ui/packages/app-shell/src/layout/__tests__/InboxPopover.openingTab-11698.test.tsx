// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The inbox opens on the tab that has something in it (objectui#11698).
 *
 * The popover's tab was a `useState('notifications')` that nothing ever moved,
 * while the bell badge it sits under is `unreadTopics + pendingApprovalsCount`.
 * So with 0 unread notifications and 3 pending approvals the bell read "3" and
 * the first thing the click showed was "You're all caught up" — the three
 * items were one tab to the right.
 *
 * On open the popover now picks, in order: the tab the user last chose in this
 * browser-tab session if that tab has something in it, otherwise the first tab
 * that does (Notifications, then Approvals, then Activity), otherwise the
 * user's last choice, otherwise Notifications. "Has something in it" is what
 * each tab shows by default: an unread notification topic (the Unread filter
 * is the default, and it is the badge's first addend), a pending approval (the
 * badge's second addend), an activity row. Only a tab the user picks counts as
 * a choice; the tab the popover picked for them on open does not.
 *
 * Nothing is mocked: the real Radix popover and tabs, the real router and the
 * real i18n provider, so the selected tab is the one Radix reports as
 * `aria-selected`, and the panel text is the English pack's.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

import { InboxPopover, type InboxNotification } from '../InboxPopover';
import type { ActivityItem } from '../ActivityFeed';

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

const CAUGHT_UP = "You're all caught up";

const unread = (n: number): InboxNotification[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    type: `topic.${i}`,
    title: `Topic ${i}`,
    is_read: false,
    created_at: '2026-10-01T10:00:00Z',
  }));

const activity = (n: number): ActivityItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    type: 'update',
    objectName: 'account',
    user: 'Priya',
    description: `updated record ${i}`,
    timestamp: '2026-10-01T10:00:00Z',
  }));

interface Inbox {
  notifications: InboxNotification[];
  pendingApprovalsCount: number;
  activities: ActivityItem[];
  /** The caller's read grant on `sys_activity` (objectui#12081); absent = holds it. */
  readable?: boolean;
}

function bell(inbox: Inbox) {
  return (
    <MemoryRouter>
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
        <InboxPopover
          notifications={inbox.notifications}
          unreadCount={inbox.notifications.filter((n) => !n.is_read).length}
          pendingApprovalsCount={inbox.pendingApprovalsCount}
          activity={{ value: inbox.activities, status: 'ready', readable: inbox.readable ?? true }}
          onMarkAllRead={() => {}}
          onMarkRead={() => {}}
        />
      </I18nProvider>
    </MemoryRouter>
  );
}

const trigger = () => screen.getByRole('button', { name: 'Open inbox' });

/** Click the bell open and report the selected tab and the visible panel text. */
function open(): { selected: string; panel: string } {
  fireEvent.click(trigger());
  const dialog = screen.getByRole('dialog');
  const selected = within(dialog).getByRole('tab', { selected: true }).textContent ?? '';
  const panel = within(dialog).getByRole('tabpanel').textContent ?? '';
  return { selected, panel };
}

function close() {
  fireEvent.click(trigger());
  expect(screen.queryByRole('dialog')).toBeNull();
}

/** Pick a tab the way a pointer does (Radix tabs activate on a primary mouse down). */
function choose(name: RegExp) {
  act(() => {
    fireEvent.mouseDown(within(screen.getByRole('dialog')).getByRole('tab', { name }), {
      button: 0,
      ctrlKey: false,
    });
  });
  expect(within(screen.getByRole('dialog')).getByRole('tab', { selected: true }).textContent).toMatch(name);
}

describe('InboxPopover — opens on the first tab with items (objectui#11698)', () => {
  /** THE PIN from the card: 0 notifications, 3 pending approvals. */
  it('0 notifications and 3 pending approvals: the badge reads 3 and opening shows Approvals', () => {
    render(bell({ notifications: [], pendingApprovalsCount: 3, activities: activity(2) }));
    expect(screen.getByTestId('inbox-bell-badge')).toHaveTextContent('3');

    const { selected, panel } = open();
    expect(selected).toMatch(/approvals/i);
    expect(panel).toContain('3 pending approvals');
    expect(panel).toContain('View approvals');
    expect(screen.getByRole('dialog').textContent).not.toContain(CAUGHT_UP);
  });

  it('2 notifications and 3 pending approvals: Notifications comes first', () => {
    render(bell({ notifications: unread(2), pendingApprovalsCount: 3, activities: activity(2) }));
    const { selected, panel } = open();
    expect(selected).toMatch(/notifications/i);
    expect(panel).toContain('Topic 0');
  });

  it('only activity: opening shows Activity, not an empty Notifications tab', () => {
    render(bell({ notifications: [], pendingApprovalsCount: 0, activities: activity(2) }));
    const { selected, panel } = open();
    expect(selected).toMatch(/activity/i);
    expect(panel).toContain('updated record 0');
  });

  it('read notifications are not items: the Unread filter would show them as caught up', () => {
    const allRead = unread(2).map((n) => ({ ...n, is_read: true }));
    render(bell({ notifications: allRead, pendingApprovalsCount: 3, activities: [] }));
    expect(open().selected).toMatch(/approvals/i);
  });

  it('everything empty: falls back to Notifications', () => {
    render(bell({ notifications: [], pendingApprovalsCount: 0, activities: [] }));
    const { selected, panel } = open();
    expect(selected).toMatch(/notifications/i);
    expect(panel).toContain(CAUGHT_UP);
  });

  it('re-picks on every open while the user has chosen nothing (the popover pick is not a choice)', () => {
    const { rerender } = render(bell({ notifications: [], pendingApprovalsCount: 3, activities: [] }));
    expect(open().selected).toMatch(/approvals/i);
    close();

    // A notification arrives while the popover is closed.
    rerender(bell({ notifications: unread(1), pendingApprovalsCount: 3, activities: [] }));
    expect(open().selected).toMatch(/notifications/i);
  });

  it('does not move the tab under the user while the popover stays open', () => {
    const { rerender } = render(bell({ notifications: [], pendingApprovalsCount: 3, activities: [] }));
    expect(open().selected).toMatch(/approvals/i);

    rerender(bell({ notifications: unread(1), pendingApprovalsCount: 3, activities: [] }));
    expect(within(screen.getByRole('dialog')).getByRole('tab', { selected: true }).textContent).toMatch(
      /approvals/i,
    );
  });
});

describe("InboxPopover — keeps the user's tab within the session (objectui#11698)", () => {
  it('reopening keeps the tab the user picked, over the first tab with items', () => {
    render(bell({ notifications: unread(2), pendingApprovalsCount: 3, activities: activity(2) }));
    expect(open().selected).toMatch(/notifications/i);
    choose(/activity/i);
    close();

    const { selected, panel } = open();
    expect(selected).toMatch(/activity/i);
    expect(panel).toContain('updated record 0');
  });

  it('a remounted bell in the same browser-tab session keeps the pick (Home and an app mount different bells)', () => {
    render(bell({ notifications: unread(2), pendingApprovalsCount: 3, activities: activity(2) }));
    open();
    choose(/approvals/i);
    cleanup();

    render(bell({ notifications: unread(2), pendingApprovalsCount: 3, activities: activity(2) }));
    expect(open().selected).toMatch(/approvals/i);
  });

  it('a picked tab that is now empty yields to the first tab with items: never "caught up" under a non-zero badge', () => {
    const { rerender } = render(bell({ notifications: unread(1), pendingApprovalsCount: 3, activities: [] }));
    open();
    choose(/approvals/i);
    choose(/notifications/i);
    close();

    // The user read the notification elsewhere; the approvals are still pending.
    rerender(bell({ notifications: [], pendingApprovalsCount: 3, activities: [] }));
    expect(screen.getByTestId('inbox-bell-badge')).toHaveTextContent('3');
    const { selected } = open();
    expect(selected).toMatch(/approvals/i);
    expect(screen.getByRole('dialog').textContent).not.toContain(CAUGHT_UP);
  });

  it('with every tab empty, the picked tab is kept', () => {
    const { rerender } = render(bell({ notifications: [], pendingApprovalsCount: 0, activities: activity(1) }));
    open();
    choose(/approvals/i);
    close();

    rerender(bell({ notifications: [], pendingApprovalsCount: 0, activities: [] }));
    expect(open().selected).toMatch(/approvals/i);
  });
});

/**
 * objectui#12081 — a caller who may not read `sys_activity` is offered no
 * Activity tab. "With every tab empty, the picked tab is kept" would otherwise
 * reopen the popover onto a tab that is no longer there: a remembered pick
 * outlives the grant it was made under (sessionStorage, across every layout's
 * bell), so the pick is set aside rather than honoured.
 */
describe('InboxPopover — no Activity tab without the read grant (objectui#12081)', () => {
  it('offers no Activity tab to a caller without the grant', () => {
    render(bell({ notifications: [], pendingApprovalsCount: 0, activities: [], readable: false }));
    open();
    const tabs = within(screen.getByRole('dialog')).getAllByRole('tab').map((t) => t.textContent ?? '');
    expect(tabs.some((t) => /activity/i.test(t))).toBe(false);
    expect(screen.getByRole('dialog').textContent).not.toContain('No recent activity');
  });

  it('a remembered Activity pick does not reopen onto the tab once the caller is not offered it', () => {
    const { rerender } = render(bell({ notifications: [], pendingApprovalsCount: 0, activities: activity(1) }));
    open();
    choose(/activity/i);
    close();

    rerender(bell({ notifications: [], pendingApprovalsCount: 0, activities: [], readable: false }));
    const { selected } = open();
    expect(selected).toMatch(/notifications/i);
  });
});
