// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The bell opens a full-height panel on the right, with pending approvals
 * pinned on top and decidable in place (objectstack#34589).
 *
 * What these pin:
 *  - the panel is a right-side, full-height sheet with no overlay, and a click
 *    in the page beside it neither closes it nor is swallowed by it;
 *  - "Needs your action" heads the Notifications tab, one item per pending
 *    request, and each item's levers are the request's OWN declared actions
 *    (`DeclaredActionsBar` over `sys_approval_request` at `list_item`, with
 *    the served row as the dispatch record), not a third approvals client;
 *  - a decision taken there drops the row and the badge at once and asks the
 *    feed to re-read;
 *  - following a notification or "View details" keeps the panel open beside
 *    the page, and the panel yields when the record drawer opens;
 *  - at 375 px the panel fills the screen and a followed link closes it;
 *  - "mark read" is an icon shown on hover or focus, not a column.
 *
 * Real Radix sheet and tabs, real router and i18n pack. Only the declared
 * actions bar is stood in for: its own gates and dialogs are pinned in its own
 * suites, and what this panel owes is the wiring into it.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

const barProps: Array<Record<string, unknown>> = [];

vi.mock('../../views/DeclaredActionsBar', () => ({
  DeclaredActionsBar: (props: Record<string, any>) => {
    barProps.push(props);
    return (
      <div role="toolbar" data-testid="declared-actions-stub">
        <button type="button" onClick={() => props.onDone?.()}>
          Approve
        </button>
      </div>
    );
  },
}));

import { InboxPopover, type InboxNotification } from '../InboxPopover';
import type { PendingApprovalRequest } from '../../hooks/sharedUserFeeds';

const notifications: InboxNotification[] = [
  { id: 'n1', type: 'task.assigned', title: 'Task assigned', is_read: false, created_at: '2026-10-01T10:00:00Z', action_url: '/task/t1' },
  { id: 'n2', type: 'lead.assigned', title: 'Lead assigned', is_read: true, created_at: '2026-10-01T09:00:00Z' },
];

const request = (id: string, title: string): PendingApprovalRequest => ({
  id,
  processLabel: 'Purchase approval',
  recordTitle: title,
  createdAt: '2026-10-01T08:00:00Z',
  row: { id, status: 'pending', record_title: title, viewer: { can_act: true, can_override: false, is_submitter: false } },
});

const approvals = [request('req-1', 'PO-001'), request('req-2', 'PO-002')];

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <output data-testid="location">{`${location.pathname}${location.search}`}</output>
      <output data-testid="location-state">{JSON.stringify(location.state ?? null)}</output>
    </>
  );
}

function PageButtons() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/apps/setup/task?recordId=t1')}>
        Open drawer
      </button>
      <button type="button" data-testid="page-control">
        Page control
      </button>
    </>
  );
}

function bell(props: Partial<React.ComponentProps<typeof InboxPopover>> = {}) {
  return (
    <MemoryRouter initialEntries={['/apps/setup/task']}>
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
        <PageButtons />
        <LocationProbe />
        <InboxPopover
          notifications={notifications}
          unreadCount={1}
          pendingApprovalsCount={approvals.length}
          pendingApprovals={approvals}
          activity={{ value: [], status: 'ready', readable: true }}
          onMarkAllRead={() => {}}
          onMarkRead={() => {}}
          {...props}
        />
      </I18nProvider>
    </MemoryRouter>
  );
}

function openInbox(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: /^Notifications(,|$)/ }));
  return screen.getByRole('dialog');
}

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

beforeEach(() => {
  barProps.length = 0;
  setViewport(1440);
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  setViewport(1024);
});

describe('InboxPopover — a right-side full-height panel (objectstack#34589)', () => {
  it('opens on the right at full height, 440 px wide, with no overlay over the page', () => {
    render(bell());
    const panel = openInbox();
    expect(panel.getAttribute('data-testid')).toBe('inbox-panel');
    const classes = panel.className.split(/\s+/);
    for (const cls of ['inset-y-0', 'right-0', 'h-full', 'md:w-[440px]', 'flex-col']) {
      expect(classes, cls).toContain(cls);
    }
    // the popover's 320 px list cap is gone: the rows scroll in the height left
    expect(panel.innerHTML).not.toContain('max-h-80');
    expect(within(panel).getByTestId('inbox-notifications-scroll').className).toContain('flex-1');
    // no dimming layer is mounted over the page
    expect(document.querySelector('.bg-black\\/80')).toBeNull();
  });

  it('stays open when the page beside it is clicked, and the click reaches the page', async () => {
    render(bell());
    openInbox();
    // Radix arms its outside-pointer listener a task after opening; let it.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const control = screen.getByTestId('page-control');
    const onClick = vi.fn();
    control.addEventListener('click', onClick);
    fireEvent.pointerDown(control);
    fireEvent.mouseDown(control);
    fireEvent.click(control);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('yields when the record drawer opens, so the two never stack on the right', () => {
    render(bell());
    openInbox();
    fireEvent.click(screen.getByRole('button', { name: 'Open drawer' }));
    expect(screen.getByTestId('location').textContent).toContain('recordId=t1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('InboxPopover — pending approvals pinned on top, decided in place (objectstack#34589)', () => {
  it('heads the Notifications tab with "Needs your action", one item per request', () => {
    render(bell());
    const panel = openInbox();
    const scroll = within(panel).getByTestId('inbox-notifications-scroll');
    const section = within(scroll).getByTestId('inbox-needs-you');
    // first in the scrolling list, above every notification row
    expect(scroll.firstElementChild).toBe(section);
    expect(within(section).getByRole('heading', { name: 'Needs your action' })).toBeTruthy();
    expect(within(section).getAllByTestId('inbox-approval-item')).toHaveLength(2);
    expect(within(section).getByText('Purchase approval · PO-001')).toBeTruthy();
  });

  it("runs each request's own declared actions at list_item, with the served row as the dispatch record", () => {
    render(bell());
    openInbox();
    expect(barProps).toHaveLength(2);
    expect(barProps.map((p) => p.objectName)).toEqual(['sys_approval_request', 'sys_approval_request']);
    expect(barProps.map((p) => p.location)).toEqual(['list_item', 'list_item']);
    // the row carrying the server-computed `viewer` block the actions gate on
    expect(barProps[0].record).toBe(approvals[0].row);
    expect(barProps[1].record).toBe(approvals[1].row);
  });

  it('drops a decided request and its share of the badge at once, and asks the feed to re-read', () => {
    const onApprovalDecided = vi.fn();
    render(bell({ onApprovalDecided }));
    const badge = screen.getByTestId('inbox-bell-badge');
    expect(badge.textContent).toBe('3'); // 1 unread topic + 2 approvals
    const panel = openInbox();
    const [first] = within(panel).getAllByTestId('inbox-approval-item');
    act(() => {
      fireEvent.click(within(first).getByRole('button', { name: 'Approve' }));
    });
    expect(onApprovalDecided).toHaveBeenCalledTimes(1);
    expect(within(panel).getAllByTestId('inbox-approval-item')).toHaveLength(1);
    expect(within(panel).queryByText('Purchase approval · PO-001')).toBeNull();
    expect(screen.getByTestId('inbox-bell-badge').textContent).toBe('2');
  });

  it('opens "View details" in the Approvals inbox and stays open beside the page', () => {
    render(bell());
    const panel = openInbox();
    const [first] = within(panel).getAllByTestId('inbox-approval-item');
    fireEvent.click(within(first).getByRole('button', { name: 'View details' }));
    expect(screen.getByTestId('location').textContent).toMatch(/\/system\/approvals\?request=req-1$/);
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('lists the same requests in the Approvals tab', () => {
    render(bell({ notifications: [], unreadCount: 0 }));
    // nothing unread: the panel opens on Approvals (objectui#11698)
    const panel = openInbox();
    expect(within(panel).getByRole('tab', { name: /Approvals/, selected: true })).toBeTruthy();
    expect(within(panel).getByTestId('inbox-approvals-list')).toBeTruthy();
    expect(within(panel).getAllByTestId('inbox-approval-item')).toHaveLength(2);
  });
});

describe('InboxPopover — following a link and marking read (objectstack#34589)', () => {
  it('keeps the panel open while the notification opens its record in the page', () => {
    const onMarkRead = vi.fn();
    render(bell({ onMarkRead }));
    const panel = openInbox();
    fireEvent.click(within(panel).getByText('Task assigned'));
    expect(onMarkRead).toHaveBeenCalledWith('n1');
    expect(screen.getByTestId('location').textContent).toMatch(/\/task\/t1$/);
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('marks one row read from an icon shown on hover or focus, not a standing column', () => {
    const onMarkRead = vi.fn();
    render(bell({ onMarkRead }));
    const panel = openInbox();
    const mark = within(panel).getByRole('button', { name: 'Mark read' });
    const classes = mark.className.split(/\s+/);
    for (const cls of ['opacity-0', 'group-hover:opacity-100', 'focus-visible:opacity-100']) {
      expect(classes, cls).toContain(cls);
    }
    expect(mark.textContent).toBe('');
    fireEvent.click(mark);
    expect(onMarkRead).toHaveBeenCalledWith('n1');
    // a read row offers no lever
    expect(within(panel).getAllByRole('button', { name: 'Mark read' })).toHaveLength(1);
  });
});

describe('InboxPopover at 375 px (objectstack#34589)', () => {
  it('fills the screen, keeps the mark-read icon shown, and closes on a followed link', () => {
    setViewport(375);
    render(bell());
    const panel = openInbox();
    const classes = panel.className.split(/\s+/);
    for (const cls of ['w-full', 'max-w-none', 'h-full', 'inset-y-0']) {
      expect(classes, cls).toContain(cls);
    }
    // no hover on a phone: the icon is shown below md, and tappable
    const mark = within(panel).getByRole('button', { name: 'Mark read' });
    expect(mark.className).toContain('max-md:opacity-100');
    expect(mark.className).toContain('max-md:h-11');
    // the panel covers the page, so following a link closes it
    fireEvent.click(within(panel).getByText('Task assigned'));
    expect(screen.getByTestId('location').textContent).toMatch(/\/task\/t1$/);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('InboxPopover — "View details" hands the request page the pending queue (objectstack#35505)', () => {
  it('opens the request with the queue the panel lists and the approvals inbox as the way back', () => {
    render(bell());
    const panel = openInbox();
    const [, second] = within(panel).getAllByTestId('inbox-approval-item');
    fireEvent.click(within(second).getByRole('button', { name: 'View details' }));

    const where = screen.getByTestId('location').textContent ?? '';
    expect(where).toMatch(/\/system\/approvals\?request=req-2$/);
    const inbox = where.slice(0, where.indexOf('?'));
    expect(JSON.parse(screen.getByTestId('location-state').textContent ?? 'null')).toMatchObject({
      approvalQueue: true,
      from: { pathname: inbox, siblings: ['req-1', 'req-2'] },
    });
  });

  it('CONTROL: "View all" opens the inbox itself and hands no queue', () => {
    render(bell({ notifications: [], unreadCount: 0 }));
    const panel = openInbox();
    fireEvent.click(within(panel).getByRole('button', { name: /View approvals|Open Approvals Inbox/ }));
    expect(screen.getByTestId('location').textContent).toMatch(/\/system\/approvals$/);
    expect(screen.getByTestId('location-state').textContent).toBe('null');
  });
});
