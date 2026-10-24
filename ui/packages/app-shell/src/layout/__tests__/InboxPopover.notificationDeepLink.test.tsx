// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The bell popover follows a notification's deep link INTO an app
 * (objectui#5179) — the same defect Home's action centre carries, pinned in
 * `console/home/__tests__/HomePage.notificationDeepLink.test.tsx`.
 *
 * ## The defect
 *
 * `handleNotificationClick` hosted the app-relative `action_url` under
 * `currentAppName ?? params.appName` and navigated it BARE when neither names
 * an app. That is not a rare state: this popover mounts on `/home`,
 * `/organizations` and the full-page AI screen, all of which render OUTSIDE
 * `/apps/:appName/*` — so there is no route segment, and `currentAppName` is
 * undefined until the user has opened an app. On those surfaces the bare
 * `/showcase_task/t_42` matches no route, the console catch-all forwards it to
 * `/`, and the landing resolver drops the user on the default app's home.
 *
 * The two "see all" drills one screen up already resolve this correctly, via
 * `resolveHostAppSegment` (objectui#4074) — the SAME question, answered two
 * different ways in one file. This aligns them.
 *
 * A second, milder arm: `currentAppName` was used unchecked, so a remembered
 * app that has since been deactivated produced `/apps/<dead app>/...`. The
 * drills re-check it against the live active list; the deep link now does too.
 *
 * ## What these cases assert
 *
 * The RESOLVED TARGET — the argument `navigate()` receives (or the URL handed
 * to `window.open` for an external link) — per the card's ruling that
 * asserting "navigation happened" passes against the bug.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigateMock = vi.fn();

let currentAppNameFixture: string | undefined;
let routeAppNameFixture: string | undefined;
let appsFixture: any[] = [];

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ appName: routeAppNameFixture }),
}));

vi.mock('../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ currentAppName: currentAppNameFixture }),
}));

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: appsFixture, loading: false }),
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

const app = (name: string, extra: Record<string, unknown> = {}) => ({ name, label: name, ...extra });

const notif = (over: Partial<InboxNotification> & { id: string }): InboxNotification => ({
  type: 'collab.assignment',
  title: 'Assigned to you',
  is_read: false,
  created_at: '2026-08-10T10:00:00Z',
  ...over,
});

const markRead = vi.fn();

/** Click the seeded notification row and read the argument `navigate()` got. */
async function clickNotification(n: InboxNotification): Promise<string> {
  const user = userEvent.setup();
  render(
    <InboxPopover
      notifications={[n]}
      unreadCount={1}
      pendingApprovalsCount={0}
      activity={{ value: [], status: 'ready', readable: true }}
      onMarkAllRead={vi.fn()}
      onMarkRead={markRead}
    />,
  );
  await user.click(screen.getByText(n.title));
  expect(navigateMock).toHaveBeenCalledTimes(1);
  return navigateMock.mock.calls[0][0] as string;
}

describe('Bell notification rows follow the deep link to the record (objectui#5179)', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    markRead.mockReset();
    appsFixture = [app('setup'), app('crm')];
    currentAppNameFixture = 'crm';
    routeAppNameFixture = 'crm';
  });

  it('hosts the app-relative action_url under the app the user is in', async () => {
    const target = await clickNotification(notif({ id: 'n1', action_url: '/showcase_task/t_42' }));
    expect(target).toBe('/apps/crm/showcase_task/t_42');
  });

  it('resolves a host app on the surfaces that have no app segment at all', async () => {
    // `/home`, `/organizations` and the full-page AI screen all mount this bell
    // outside `/apps/:appName/*`. This is the arm that produced the reported
    // symptom: a bare path, the catch-all, then the app landing page.
    appsFixture = [app('crm'), app('hr')];
    currentAppNameFixture = undefined;
    routeAppNameFixture = undefined;
    const target = await clickNotification(notif({ id: 'n1', action_url: '/showcase_task/t_42' }));
    expect(target).toBe('/apps/crm/showcase_task/t_42');
    expect(target).not.toBe('/showcase_task/t_42');
  });

  it('does not resurrect a remembered app that is no longer active', async () => {
    appsFixture = [app('hr')];
    currentAppNameFixture = 'crm';
    routeAppNameFixture = undefined;
    expect(await clickNotification(notif({ id: 'n1', action_url: '/showcase_task/t_42' }))).toBe(
      '/apps/hr/showcase_task/t_42',
    );
  });

  it('marks the notification read on the same click that navigates', async () => {
    // The card's first control: mark-read is server-authoritative and fires.
    // It is what makes a wrong target destroy the pointer rather than merely
    // misdirect, so the fix must not trade one for the other.
    await clickNotification(notif({ id: 'n1', action_url: '/showcase_task/t_42' }));
    expect(markRead).toHaveBeenCalledWith('n1');
  });

  it('CONTROL: a target that already names its app is followed verbatim', async () => {
    expect(await clickNotification(notif({ id: 'n1', action_url: '/apps/acme/invoice/42' }))).toBe(
      '/apps/acme/invoice/42',
    );
  });

  it('CONTROL: an external link opens in a new tab and is never routed', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const user = userEvent.setup();
    render(
      <InboxPopover
        notifications={[notif({ id: 'n1', action_url: 'https://status.example.com/incident/7' })]}
        unreadCount={1}
        pendingApprovalsCount={0}
        activity={{ value: [], status: 'ready', readable: true }}
        onMarkAllRead={vi.fn()}
        onMarkRead={markRead}
      />,
    );
    await user.click(screen.getByText('Assigned to you'));
    expect(openSpy).toHaveBeenCalledWith(
      'https://status.example.com/incident/7',
      '_blank',
      'noopener,noreferrer',
    );
    expect(navigateMock).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
