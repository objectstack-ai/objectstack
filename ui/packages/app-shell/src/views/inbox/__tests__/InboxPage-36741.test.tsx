// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The full-page inbox (objectstack#36741). What these pin:
 *  - three tabs with the bell's counts, «Needs your action» on top of the
 *    notifications, which goes to the approvals tab;
 *  - the first row is selected on arrival, and selecting a notification marks
 *    its whole coalesced row read through the bell's own write, then re-reads
 *    the shared feed so the sidebar's badge drops;
 *  - the right pane embeds the record a notification is about, and the
 *    request an approval row names, through the record view;
 *  - «Unread only» keeps a row read on this visit listed;
 *  - J / K move the selection; a decided request hands it to the next one.
 *
 * The feeds and the record view are stood in for: their reads and their pages
 * are pinned in their own suites; what the page owes is the wiring.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import type { InboxNotification } from '../../../layout/inboxGrouping';
import type { PendingApprovalRequest } from '../../../hooks/sharedUserFeeds';

const bellState = vi.hoisted(() => ({
  current: {} as Record<string, any>,
  approvals: {} as Record<string, any>,
  refreshSharedInbox: (() => {}) as () => void,
}));

vi.mock('../../../hooks/useInboxBell', () => ({
  useInboxBell: () => bellState.current,
  postInboxReadReceipts: vi.fn(async () => {}),
}));

vi.mock('../../../hooks/sharedUserFeeds', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useSharedActivityFeed: () => ({
      value: [
        { id: 'act1', type: 'update', objectName: 'task', recordId: 't9', user: 'Ada', description: 'updated Task 9', timestamp: '2026-10-01T10:00:00Z' },
      ],
      status: 'ready',
      readable: true,
    }),
    readEarlierInboxMessages: vi.fn(async () => []),
    refreshSharedInbox: () => bellState.refreshSharedInbox(),
  };
});

vi.mock('../useInboxPageApprovals', () => ({
  useInboxPageApprovals: () => bellState.approvals,
}));

vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ user: { id: 'u1', email: 'u1@example.com' } }) };
});

vi.mock('../../RecordDetailView', () => ({
  RecordDetailView: (props: { objectNameOverride: string; recordIdOverride: string; embedded?: boolean }) => (
    <div data-testid="record-stub" data-embedded={String(!!props.embedded)}>
      {`${props.objectNameOverride}/${props.recordIdOverride}`}
    </div>
  ),
}));

import { InboxPage } from '../InboxPage';

const note = (id: string, extra: Partial<InboxNotification> = {}): InboxNotification => ({
  id,
  notification_id: `nid-${id}`,
  type: `topic.${id}`,
  title: `Title ${id}`,
  body: `Body ${id}`,
  is_read: false,
  created_at: '2026-10-01T10:00:00Z',
  ...extra,
});

const request = (id: string): PendingApprovalRequest => ({
  id,
  processLabel: 'Contract approval',
  recordTitle: `Contract ${id}`,
  createdAt: '2026-10-01T08:00:00Z',
  row: { id, object_name: 'contract', submitter_name: 'Zhang Wei' },
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function page(path: string) {
  const el = <InboxPage dataSource={null} objects={[]} />;
  return (
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
        <LocationProbe />
        <Routes>
          <Route path="/apps/:appName/inbox" element={el} />
          <Route path="/apps/:appName/inbox/:inboxTab" element={el} />
          <Route path="*" element={null} />
        </Routes>
      </I18nProvider>
    </MemoryRouter>
  );
}

const location = () => screen.getByTestId('location').textContent;
const rows = () => screen.getAllByTestId('inbox-page-row');

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

let markManyRead: ReturnType<typeof vi.fn>;
let refreshed: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setViewport(1280);
  markManyRead = vi.fn(async () => {});
  refreshed = vi.fn();
  bellState.refreshSharedInbox = refreshed as unknown as () => void;
  bellState.current = {
    notifications: [
      note('n1', { action_url: '/task/t1' }),
      note('d1', { type: 'digest', title: 'Daily digest', action_url: null }),
      note('d2', { type: 'digest', title: 'Daily digest', action_url: null }),
      note('n3', { is_read: true, action_url: '/system/approvals?request=r1' }),
    ],
    status: 'ready',
    unreadCount: 3,
    pendingApprovalsCount: 2,
    pendingApprovals: [],
    refreshPendingApprovals: vi.fn(),
    markAllRead: vi.fn(async () => {}),
    markRead: vi.fn(async () => {}),
    markManyRead,
  };
  bellState.approvals = { requests: [request('r1'), request('r2'), request('r3')], total: 3, status: 'ready' };
});

afterEach(() => {
  cleanup();
  setViewport(1024);
});

describe('InboxPage — the full-page inbox (objectstack#36741)', () => {
  it('draws the three tabs with the bell’s counts and «Needs your action» first', () => {
    render(page('/apps/crm/inbox'));
    expect(screen.getByTestId('inbox-page-tab-count-notifications').textContent).toBe('2');
    expect(screen.getByTestId('inbox-page-tab-count-approvals').textContent).toBe('3');
    expect(screen.getByTestId('inbox-page-tab-activity')).toBeTruthy();
    fireEvent.click(screen.getByTestId('inbox-page-needs-you'));
    expect(location()).toMatch(/^\/apps\/crm\/inbox\/approvals/);
  });

  it('selects the first row on arrival, marks it read through the bell, and re-reads the shared feed', async () => {
    render(page('/apps/crm/inbox'));
    expect(location()).toBe('/apps/crm/inbox?item=n1');
    expect(markManyRead).toHaveBeenCalledWith(['n1']);
    await act(async () => {});
    expect(refreshed).toHaveBeenCalled();
    // The pane embeds the record the notification is about.
    const stub = screen.getByTestId('record-stub');
    expect(stub.textContent).toBe('task/t1');
    expect(stub.getAttribute('data-embedded')).toBe('true');
  });

  it('opens the full record from the pane', () => {
    render(page('/apps/crm/inbox?item=n1'));
    fireEvent.click(screen.getByTestId('inbox-detail-open-full'));
    expect(location()).toBe('/apps/crm/task/record/t1');
  });

  it('keeps a coalesced row one row, lists each occurrence, and marks them all read', () => {
    render(page('/apps/crm/inbox?item=d1'));
    const digest = rows().find((r) => r.textContent?.includes('Daily digest'))!;
    expect(within(digest).getByText('×2')).toBeTruthy();
    expect(screen.getByTestId('inbox-detail-occurrences').querySelectorAll('li')).toHaveLength(2);
    expect(markManyRead).toHaveBeenCalledWith(['d1', 'd2']);
  });

  it('«Unread only» hides a row already read, and lists it again when switched off', () => {
    render(page('/apps/crm/inbox?item=n1'));
    expect(rows().some((r) => r.textContent?.includes('Title n3'))).toBe(false);
    fireEvent.click(screen.getByTestId('inbox-page-unread-only'));
    expect(rows().some((r) => r.textContent?.includes('Title n3'))).toBe(true);
  });

  it('keeps a row read on this visit listed under «Unread only»', () => {
    const view = render(page('/apps/crm/inbox?item=n1'));
    bellState.current = {
      ...bellState.current,
      notifications: bellState.current.notifications.map((n: InboxNotification) => (n.id === 'n1' ? { ...n, is_read: true } : n)),
    };
    view.rerender(page('/apps/crm/inbox?item=n1'));
    expect(rows().some((r) => r.getAttribute('data-item-id') === 'n1')).toBe(true);
  });

  it('a notification about a request embeds that request', () => {
    render(page('/apps/crm/inbox?item=n3'));
    fireEvent.click(screen.getByTestId('inbox-page-unread-only'));
    expect(screen.getByTestId('record-stub').textContent).toBe('sys_approval_request/r1');
  });

  it('J / K move the selection, and not while typing', () => {
    render(page('/apps/crm/inbox?item=n1'));
    fireEvent.keyDown(window, { key: 'j' });
    expect(location()).toBe('/apps/crm/inbox?item=d1');
    fireEvent.keyDown(window, { key: 'k' });
    expect(location()).toBe('/apps/crm/inbox?item=n1');
    const field = document.createElement('textarea');
    document.body.appendChild(field);
    fireEvent.keyDown(field, { key: 'j' });
    expect(location()).toBe('/apps/crm/inbox?item=n1');
    field.remove();
  });

  it('lists the waiting requests and embeds the selected one', () => {
    render(page('/apps/crm/inbox/approvals'));
    expect(location()).toBe('/apps/crm/inbox/approvals?item=r1');
    expect(rows()).toHaveLength(3);
    expect(rows()[0].textContent).toContain('Contract approval');
    expect(rows()[0].textContent).toContain('Zhang Wei');
    expect(screen.getByTestId('record-stub').textContent).toBe('sys_approval_request/r1');
  });

  it('hands the selection to the next request once the selected one is decided', () => {
    const view = render(page('/apps/crm/inbox/approvals?item=r2'));
    bellState.approvals = { requests: [request('r1'), request('r3')], total: 2, status: 'ready' };
    view.rerender(page('/apps/crm/inbox/approvals?item=r2'));
    expect(location()).toBe('/apps/crm/inbox/approvals?item=r3');
    expect(screen.getByTestId('record-stub').textContent).toBe('sys_approval_request/r3');
  });

  it('shows the record an activity row happened on', () => {
    render(page('/apps/crm/inbox/activity'));
    expect(location()).toBe('/apps/crm/inbox/activity?item=act1');
    expect(screen.getByTestId('record-stub').textContent).toBe('task/t9');
  });
});
