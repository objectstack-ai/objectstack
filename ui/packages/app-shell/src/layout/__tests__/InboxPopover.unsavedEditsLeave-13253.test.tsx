// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13253 — the inbox popover's drills ask before dropping a page's
 * unsaved edits.
 *
 * View approvals, View all notifications, the activity drill and a
 * notification's own link each navigate from a popover button, which no page's
 * link guard sees, so they left a dirty page with no question. Each now goes
 * through the shell's seam, `confirmUnsavedLeave`.
 *
 * The real `InboxPopover` over the real seam. Routing is the recorder
 * `InboxPopover.approvalsSegment-11818.test.tsx` uses (what `navigate()`
 * receives), and the page's edit is a registration made the way a page makes
 * it (`registerUnsavedEdits`).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigateMock = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ appName: 'crm' }),
}));

vi.mock('../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ currentAppName: 'crm' }),
}));

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [{ name: 'crm', label: 'CRM' }], loading: false }),
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
}));

// Passthrough primitives so the popover body renders without driving Radix
// open/close in jsdom (the pattern `InboxPopover.viewAllTarget.test.tsx` uses).
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

import { InboxPopover, type InboxNotification } from '../InboxPopover';
import { registerUnsavedEdits } from '../../chrome/unsavedEdits';

const QUESTION = 'Leave this page and drop your edit?';

const NOTE: InboxNotification = {
  id: 'n1',
  type: 'collab.assignment',
  title: 'Assigned to you',
  is_read: false,
  created_at: '2026-08-10T10:00:00Z',
  action_url: '/crm_deal/42',
};

function mount() {
  render(
    <InboxPopover
      notifications={[NOTE]}
      unreadCount={1}
      pendingApprovalsCount={3}
      activity={{ value: [], status: 'ready', readable: true }}
      onMarkAllRead={vi.fn()}
      onMarkRead={vi.fn()}
    />,
  );
}

const confirmSpy = vi.fn((_message?: string) => false);
let release: (() => void) | undefined;

beforeEach(() => {
  navigateMock.mockReset();
  confirmSpy.mockReset();
  confirmSpy.mockReturnValue(false);
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: confirmSpy });
});

afterEach(() => {
  release?.();
  release = undefined;
  cleanup();
});

describe('the inbox popover asks before leaving a page with unsaved edits (objectui#13253)', () => {
  it.each([
    ['View approvals', '/apps/crm/system/approvals'],
    ['View all notifications', '/apps/crm/sys_inbox_message?view=mine'],
    ['Assigned to you', '/apps/crm/crm_deal/42'],
  ])('a dirty page: "%s" asks; Cancel never navigates, OK goes to %s', async (label, target) => {
    release = registerUnsavedEdits(QUESTION);
    mount();
    const user = userEvent.setup();

    await user.click(screen.getByText(label));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(QUESTION);
    expect(navigateMock).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByText(label));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith(target);
  });

  it('CONTROL: on a clean page "View approvals" goes at once and nothing asks', async () => {
    mount();
    await userEvent.setup().click(screen.getByText('View approvals'));
    expect(navigateMock).toHaveBeenCalledWith('/apps/crm/system/approvals');
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
