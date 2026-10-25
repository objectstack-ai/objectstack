// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A notification with NO link still opens something from the bell, and the two
 * dead back-compat fields are gone (objectui#5190).
 *
 * ## The defect
 *
 * `handleNotificationClick` called `onMarkRead(n.id)` and then, when nothing
 * resolved a target, `return`ed. A linkless row was therefore CONSUMED — the
 * mark-read is server-authoritative — while the user was taken nowhere and the
 * popover stayed open on the row it had just greyed out.
 *
 * Linkless rows are not a corner case: `service-messaging` leaves `action_url`
 * undefined whenever an emit carries neither a `payload.url` nor a `source`
 * (pinned upstream as "leaves action_url undefined when there is neither a url
 * nor a source"). Home's action centre already handles exactly this state
 * deliberately — it opens the full inbox (objectui#4074) — so the bell was the
 * unruled half of one behaviour, and this aligns it to the ruled half.
 *
 * The second half of the card: `InboxNotification` declared
 * `source_object`/`source_id` and this handler read them as a pre-ADR-0030
 * fallback, but `mergeInboxRows` — the single producer of every row the bell
 * and Home render — maps neither, and `sys_inbox_message` declares `action_url`
 * with no source columns to map from. Declared-and-never-filled, so removed.
 *
 * ## What these cases assert
 *
 * The RESOLVED TARGET `navigate()` receives, the popover's open state across
 * the click, and that the row is still marked read — the three things that
 * together distinguish "opened the inbox" from the silent consumption above.
 * `?view=mine` is asserted verbatim because it is what makes the destination
 * the user-scoped page the row came from rather than the org-wide list.
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

// Passthrough primitives, as in the sibling suites — except `Popover`, which
// here REPORTS the controlled `open` prop and exposes an opener that drives
// `onOpenChange`. The sibling mocks swallow both, which is fine for asserting a
// navigation target but makes "the popover closes" unobservable, and staying
// open on a spent row is half of what this card reported.
vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Button: ({ children, ...p }: any) => <button type="button" {...p}>{children}</button>,
  Popover: ({ open, onOpenChange, children }: any) => (
    <div data-testid="popover" data-open={String(Boolean(open))}>
      <button type="button" data-testid="open-popover" onClick={() => onOpenChange?.(true)}>
        open inbox popover
      </button>
      {children}
    </div>
  ),
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

/**
 * Open the popover, click the seeded row, and hand back everything the card is
 * about: what `navigate()` got and whether the popover is still open.
 */
async function clickNotification(n: InboxNotification) {
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
  await user.click(screen.getByTestId('open-popover'));
  expect(screen.getByTestId('popover')).toHaveAttribute('data-open', 'true');
  await user.click(screen.getByText(n.title));
  return {
    target: navigateMock.mock.calls[0]?.[0] as string | undefined,
    isOpen: screen.getByTestId('popover').getAttribute('data-open') === 'true',
  };
}

describe('A linkless bell notification opens the full inbox (objectui#5190)', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    markRead.mockReset();
    appsFixture = [app('setup'), app('crm')];
    currentAppNameFixture = 'crm';
    routeAppNameFixture = 'crm';
  });

  it('navigates to the user-scoped inbox when the row carries no action_url', async () => {
    const { target } = await clickNotification(notif({ id: 'n1' }));
    expect(target).toBe('/apps/crm/sys_inbox_message?view=mine');
  });

  it('closes the popover instead of sitting open on the consumed row', async () => {
    const { isOpen } = await clickNotification(notif({ id: 'n1' }));
    expect(isOpen).toBe(false);
  });

  it('still marks the linkless row read — the fallback adds a destination, it does not trade one behaviour for the other', async () => {
    await clickNotification(notif({ id: 'n1' }));
    expect(markRead).toHaveBeenCalledWith('n1');
  });

  it('treats a blank action_url as linkless, not as a route to ""', async () => {
    // `resolveNotificationTarget` returns null for a blank url precisely so the
    // caller can fall back rather than navigate a fabricated target.
    const { target } = await clickNotification(notif({ id: 'n1', action_url: '   ' }));
    expect(target).toBe('/apps/crm/sys_inbox_message?view=mine');
  });

  it('hosts the fallback under a RESOLVED app segment, never an empty one', async () => {
    // The bell mounts on `/home`, `/organizations` and the AI screen, none of
    // which name an app — the state that made objectui#5179 a bare path. The
    // fallback resolves a host app there like every other drill in this file;
    // `/apps//sys_inbox_message` would match no route.
    appsFixture = [app('hr'), app('crm')];
    currentAppNameFixture = undefined;
    routeAppNameFixture = undefined;
    const { target } = await clickNotification(notif({ id: 'n1' }));
    expect(target).toBe('/apps/hr/sys_inbox_message?view=mine');
    expect(target).not.toContain('/apps//');
  });

  it('sends the fallback to the same page the "View all notifications" drill does', async () => {
    // One question, one answer: the footer drill and the linkless click are the
    // same navigation, so they must not be able to drift apart.
    const { target } = await clickNotification(notif({ id: 'n1' }));
    const user = userEvent.setup();
    await user.click(screen.getByText('View all notifications'));
    expect(navigateMock.mock.calls.at(-1)?.[0]).toBe(target);
  });

  it('CONTROL: a row that DOES carry a link still goes to the record', async () => {
    // The fallback must not swallow the linked path — that would trade this
    // card's defect for objectui#5179's.
    const { target, isOpen } = await clickNotification(
      notif({ id: 'n1', action_url: '/showcase_task/t_42' }),
    );
    expect(target).toBe('/apps/crm/showcase_task/t_42');
    expect(isOpen).toBe(false);
  });
});

describe('The pre-ADR-0030 source_object/source_id arm is gone (objectui#5190)', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    markRead.mockReset();
    appsFixture = [app('setup'), app('crm')];
    currentAppNameFixture = 'crm';
    routeAppNameFixture = 'crm';
  });

  it('no longer builds a target out of a source pointer — such a row is linkless', async () => {
    // Cast because the fields are no longer part of the declared shape; a row
    // like this cannot come from `mergeInboxRows`, which never mapped them. The
    // behavioural half of the deletion: reinstating the arm turns this red.
    const stray = notif({ id: 'n1' }) as InboxNotification & Record<string, unknown>;
    stray.source_object = 'showcase_task';
    stray.source_id = 't_42';
    const { target } = await clickNotification(stray);
    expect(target).toBe('/apps/crm/sys_inbox_message?view=mine');
    expect(target).not.toBe('/apps/crm/showcase_task/t_42');
  });

  it('TYPE PIN: the fields are not part of InboxNotification', () => {
    const row: InboxNotification = {
      id: 'n1',
      type: 'collab.assignment',
      title: 'Assigned to you',
      // @ts-expect-error objectui#5190 removed `source_object` from the shape —
      // re-declaring it makes this line compile and fails the pin.
      source_object: 'showcase_task',
    };
    const row2: InboxNotification = {
      id: 'n2',
      type: 'collab.assignment',
      title: 'Assigned to you',
      // @ts-expect-error objectui#5190 removed `source_id` from the shape.
      source_id: 't_42',
    };
    // Runtime half is trivial; `tsc -p tsconfig.test.json` is what checks the
    // assertions above (see this package's `type-check` script).
    expect([row.id, row2.id]).toEqual(['n1', 'n2']);
  });
});
