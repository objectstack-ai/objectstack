// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The bell popover's two "see all" drills — which APP hosts them (objectui#4074).
 *
 * ## The defect
 *
 * `goToAllNotifications` and `goToAllActivity` sat BETWEEN two handlers that
 * already resolve the current app (`goToApprovals`, `handleNotificationClick`)
 * and hardcoded `setup` anyway:
 *
 *   - `goToAllNotifications` → `/apps/setup/sys_inbox_message?view=mine`
 *   - `goToAllActivity`      → `/apps/setup/sys_activity`
 *
 * The in-code comment argued the OBJECT is app-independent (ADR-0030 L5), which
 * is true and does not entail rendering it in `setup`: `sys_inbox_message` and
 * `sys_activity` resolve at `/apps/{any app}/{object}`, exactly like
 * `system/approvals` — the sibling one line above, whose objectstack#7234 fix
 * these cases mirror. Browser-measured on the card: a business user without
 * `setup` gets "You don't have access", and every user is silently switched out
 * of the app they were in (sidebar + app switcher flip to Setup).
 *
 * ## What these cases assert
 *
 * The RESOLVED TARGET — the argument `navigate()` receives — and nothing about
 * the far end. objectstack#7344 (no shipped permission set grants
 * `sys_inbox_message`) is a second, independent cause: the destination can still
 * render the no-access empty state after this fix. Asserting the far end here
 * would pin someone else's defect.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigateMock = vi.fn();

// The two "which app am I in" signals the popover reads, in its own order
// (`currentAppName ?? params.appName`). Both are fixtures here so the
// resolution can be driven from either side.
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

// Passthrough primitives so the popover body renders without driving Radix
// open/close in jsdom (the pattern `InboxPopover.badgeBreakdown.test.tsx` uses).
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
  type: 'project.digest',
  title: 'Scheduled project digest',
  is_read: false,
  created_at: '2026-08-10T10:00:00Z',
  ...over,
});

function renderPopover(props: Partial<React.ComponentProps<typeof InboxPopover>> = {}) {
  return render(
    <InboxPopover
      notifications={props.notifications ?? []}
      unreadCount={props.unreadCount ?? 0}
      pendingApprovalsCount={props.pendingApprovalsCount ?? 0}
      activity={props.activity ?? { value: [], status: 'ready', readable: true }}
      onMarkAllRead={props.onMarkAllRead ?? vi.fn()}
      onMarkRead={props.onMarkRead ?? vi.fn()}
    />,
  );
}

async function clickLabel(label: string, props: Partial<React.ComponentProps<typeof InboxPopover>> = {}) {
  const user = userEvent.setup();
  renderPopover(props);
  await user.click(screen.getByText(label));
  expect(navigateMock).toHaveBeenCalledTimes(1);
  return navigateMock.mock.calls[0][0] as string;
}

const clickViewAllNotifications = () => clickLabel('View all notifications');
const clickViewAllActivity = () => clickLabel('View all activity');

describe('InboxPopover "see all" drills resolve the host app (objectui#4074)', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    appsFixture = [app('setup'), app('crm')];
    currentAppNameFixture = 'crm';
    routeAppNameFixture = 'crm';
  });

  describe('View all notifications', () => {
    it('opens the inbox inside the app the user is in, not setup', async () => {
      expect(await clickViewAllNotifications()).toBe('/apps/crm/sys_inbox_message?view=mine');
    });

    it('keeps the ?view=mine qualifier that scopes the list to this user', async () => {
      // The popover shows the user's own notifications; dropping the qualifier
      // would drill from a user-scoped list into an org-wide one.
      expect(await clickViewAllNotifications()).toContain('?view=mine');
    });

    it('reads the route app segment when the shell has published no current app', async () => {
      currentAppNameFixture = undefined;
      routeAppNameFixture = 'crm';
      expect(await clickViewAllNotifications()).toBe('/apps/crm/sys_inbox_message?view=mine');
    });

    it('addresses the app by its package segment when it has one', async () => {
      appsFixture = [app('crm', { _packageId: 'acme-crm' })];
      currentAppNameFixture = 'acme-crm';
      routeAppNameFixture = 'acme-crm';
      expect(await clickViewAllNotifications()).toBe('/apps/acme-crm/sys_inbox_message?view=mine');
    });

    it('does not resurrect a remembered app that is no longer active', async () => {
      appsFixture = [app('hr')];
      currentAppNameFixture = 'crm';
      routeAppNameFixture = 'crm';
      expect(await clickViewAllNotifications()).toBe('/apps/hr/sys_inbox_message?view=mine');
    });

    it('CONTROL: a user whose app IS setup still lands in setup', async () => {
      appsFixture = [app('setup'), app('crm')];
      currentAppNameFixture = 'setup';
      routeAppNameFixture = 'setup';
      expect(await clickViewAllNotifications()).toBe('/apps/setup/sys_inbox_message?view=mine');
    });

    it('keeps the user in the app named by the URL when the app list has not loaded', async () => {
      // `useMetadata()` answers with an empty list both before the catalog
      // arrives and outside a provider. That is "unknown", not "this user has
      // no apps" — demoting a user who is demonstrably rendering inside
      // `/apps/crm/...` to `setup` would reintroduce this very defect in a
      // loading race.
      appsFixture = [];
      currentAppNameFixture = undefined;
      routeAppNameFixture = 'crm';
      expect(await clickViewAllNotifications()).toBe('/apps/crm/sys_inbox_message?view=mine');
    });
  });

  describe('View all activity', () => {
    it('opens the activity list inside the app the user is in, not setup', async () => {
      expect(await clickViewAllActivity()).toBe('/apps/crm/sys_activity');
    });

    it('stays org-wide — no ?view= qualifier, matching what the tab shows', async () => {
      expect(await clickViewAllActivity()).not.toContain('?view=');
    });

    it('falls back to the first active app when nothing names the current one', async () => {
      appsFixture = [app('crm'), app('hr')];
      currentAppNameFixture = undefined;
      routeAppNameFixture = undefined;
      const target = await clickViewAllActivity();
      expect(target).toBe('/apps/crm/sys_activity');
      expect(target).not.toContain('/apps/setup/');
    });
  });

  describe('CONTROLS — the handlers on either side stay exactly as they were', () => {
    it('goToApprovals still resolves the current app', async () => {
      const target = await clickLabel('Open Approvals Inbox');
      expect(target).toBe('/apps/crm/system/approvals');
    });

    it('handleNotificationClick still follows an explicit action_url', async () => {
      const target = await clickLabel('Scheduled project digest', {
        notifications: [notif({ id: 'n1', action_url: '/apps/acme/invoice/42' })],
        unreadCount: 1,
      });
      expect(target).toBe('/apps/acme/invoice/42');
    });

    it('handleNotificationClick still prefixes a relative action_url with the current app', async () => {
      const target = await clickLabel('Scheduled project digest', {
        notifications: [notif({ id: 'n1', action_url: '/invoice/42' })],
        unreadCount: 1,
      });
      expect(target).toBe('/apps/crm/invoice/42');
    });
  });
});
