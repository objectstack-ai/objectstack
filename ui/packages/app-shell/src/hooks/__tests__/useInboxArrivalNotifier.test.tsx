/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#7011 — the inbox announces arrivals, and announces nothing else.
 *
 * ## Harness: two APIs that happy-dom does not hand you, and the lit controls
 *
 * Both of this feature's decisions read a browser API that is not simply there
 * in this environment, and a test that silently no-ops because the API is
 * absent is the classic false green for exactly this feature — it would report
 * "no desktop notification was raised" for a run in which raising one was never
 * possible.
 *
 *  - **`Notification`** does not exist in happy-dom at all. It is stubbed with
 *    {@link FakeNotification} through `vi.stubGlobal`, which is why
 *    `desktopNotifications.ts` reads `globalThis.Notification` at CALL time
 *    rather than capturing it at module load. The stub is LIT by
 *    `it('the Notification stub is live', …)` below — it constructs one through
 *    the module under test and asserts the instance arrived — so every later
 *    "no notification was raised" reading is a measurement rather than an
 *    absence.
 *  - **`document.visibilityState`** is a getter on the prototype and is not
 *    assignable. {@link setVisibility} redefines it as an own property and
 *    asserts the new reading before returning, so a case can never proceed on a
 *    visibility it failed to set. The original descriptor is restored per case.
 *
 * ## Why the negative pins are the discriminating ones
 *
 * An implementation that toasts every row it sees passes "a new message
 * produces a toast" and is worse than the silence this card was raised for. The
 * pins that reject it are the ones below that assert NOTHING happened: history
 * on the first read, an already-read row, a hidden tab, an ungranted browser.
 * Each is written against concrete, distinguishable ids and permissions so it
 * cannot pass by comparing two absent values.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

/**
 * `vi.mock` factories are hoisted above every `const` in this file, so anything
 * a factory dereferences at module-load time must be hoisted with them —
 * otherwise the mocked module is evaluated while these bindings are still in
 * their temporal dead zone and the whole SUITE fails to load (which vitest
 * reports as `0 test`, not as a failing assertion).
 */
const { navigate, presentNotificationToast, requestPermission } = vi.hoisted(() => ({
  navigate: vi.fn(),
  presentNotificationToast: vi.fn(),
  requestPermission: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => navigate,
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u_alice', name: 'Ada', email: 'ada@example.com' } }),
}));

/**
 * The toast is observed at the bridge rather than in the DOM. That module is,
 * by its own contract, "the ONLY place a notification becomes a sonner call",
 * so a call to it IS the toast — and observing it here is what lets the
 * "one toast, not N" case count calls instead of counting DOM nodes, where a
 * `queryByText` would throw on multiple matches precisely when the assertion
 * is most interesting.
 */
vi.mock('../../chrome/notificationToast', () => ({ presentNotificationToast }));

import { useInboxArrivalNotifier } from '../useInboxArrivalNotifier';
import { __resetInboxArrivals } from '../inboxArrivals';
import {
  writeNotificationPreferences,
  NOTIFICATION_PREFERENCES_KEY,
  __resetNotificationPreferences,
} from '../notificationPreferences';
import { requestDesktopNotificationPermission } from '../desktopNotifications';
import { NotificationPreferencesMenu } from '../../layout/NotificationPreferencesMenu';
import type { InboxNotification } from '../../layout/inboxGrouping';
import type { SharedFeedStatus } from '../sharedUserFeeds';

// ── Notification API stub ────────────────────────────────────────────────────

interface RaisedNotification {
  title: string;
  options?: Record<string, unknown>;
  onclick: ((event: unknown) => unknown) | null;
  close: ReturnType<typeof vi.fn>;
}

let raised: RaisedNotification[] = [];

class FakeNotification {
  static permission: 'granted' | 'denied' | 'default' = 'default';
  static requestPermission = requestPermission;
  onclick: ((event: unknown) => unknown) | null = null;
  close = vi.fn();
  constructor(title: string, options?: Record<string, unknown>) {
    raised.push(this as unknown as RaisedNotification);
    (this as unknown as RaisedNotification).title = title;
    (this as unknown as RaisedNotification).options = options;
  }
}

// ── document.visibilityState ─────────────────────────────────────────────────

const ORIGINAL_VISIBILITY = Object.getOwnPropertyDescriptor(
  Document.prototype,
  'visibilityState',
);

/** Set the tab's visibility and PROVE it took, before the case relies on it. */
function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  // The lit control for this instrument: an unsettable getter would leave the
  // case measuring the default, and every visibility assertion after it would
  // be about a tab that never changed.
  expect(document.visibilityState).toBe(state);
}

function restoreVisibility(): void {
  Reflect.deleteProperty(document, 'visibilityState');
  if (ORIGINAL_VISIBILITY && !Object.getOwnPropertyDescriptor(document, 'visibilityState')) return;
  if (ORIGINAL_VISIBILITY) Object.defineProperty(Document.prototype, 'visibilityState', ORIGINAL_VISIBILITY);
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function row(id: string, over: Partial<InboxNotification> = {}): InboxNotification {
  return {
    id,
    notification_id: `ntf_${id}`,
    receipt_id: null,
    type: 'collab.assignment',
    title: `Assigned to you: ${id}`,
    body: null,
    action_url: `/showcase_task/${id}`,
    is_read: false,
    created_at: '2026-09-08T10:00:00Z',
    ...over,
  };
}

const markRead = vi.fn();

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter initialEntries={['/home']}>{children}</MemoryRouter>
);

interface Props {
  notifications: InboxNotification[];
  status: SharedFeedStatus;
}

function mountNotifier(initial: Props) {
  return renderHook(
    (props: Props) => useInboxArrivalNotifier({ ...props, markRead }),
    { initialProps: initial, wrapper },
  );
}

/** Let the effects flush. No fake timers anywhere in this file — see below. */
const settle = async () => { await act(async () => { await Promise.resolve(); }); };

beforeEach(() => {
  __resetInboxArrivals();
  raised = [];
  navigate.mockClear();
  markRead.mockClear();
  presentNotificationToast.mockClear();
  requestPermission.mockClear();
  requestPermission.mockImplementation(async () => FakeNotification.permission);
  FakeNotification.permission = 'default';
  vi.stubGlobal('Notification', FakeNotification);
  window.localStorage.clear();
  // The preference store is module-scoped (one live value per tab), so a case
  // would otherwise inherit the previous case's switches.
  __resetNotificationPreferences();
  setVisibility('visible');
});

afterEach(() => {
  // The feed is not mounted here (the hook takes rows as arguments), so nothing
  // can poll after a case returns and there are no fake timers to restore —
  // which is the point of giving this hook its rows rather than a feed.
  vi.unstubAllGlobals();
  restoreVisibility();
  window.localStorage.clear();
});

describe('instrument controls — both stubbed APIs are live', () => {
  it('the Notification stub is live: the module under test can raise one', async () => {
    FakeNotification.permission = 'granted';
    writeNotificationPreferences('u_alice', { toast: true, desktop: true });
    setVisibility('hidden');

    const view = mountNotifier({ notifications: [], status: 'ready' });
    await settle();
    view.rerender({ notifications: [row('m1')], status: 'ready' });
    await settle();

    // If this is 0, every "nothing was raised" case below is meaningless.
    expect(raised).toHaveLength(1);
    expect(raised[0].title).toBe('Assigned to you: m1');
  });

  it('the requestPermission spy is wired to the module the settings toggle calls', async () => {
    FakeNotification.permission = 'default';
    await requestDesktopNotificationPermission();
    // Lit: the same spy the "never requested on load" pins assert stays at 0.
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });
});

describe('constraint 1 — historical unread updates the badge, it does not pop', () => {
  it('announces nothing for the rows the FIRST answered read brings back', async () => {
    const history = [row('m3'), row('m2'), row('m1')];

    mountNotifier({ notifications: history, status: 'ready' });
    await settle();

    expect(presentNotificationToast).not.toHaveBeenCalled();
    expect(raised).toHaveLength(0);
  });

  it('still announces the NEXT message, so priming is not silence forever', async () => {
    const view = mountNotifier({ notifications: [row('m1')], status: 'ready' });
    await settle();
    expect(presentNotificationToast).not.toHaveBeenCalled();

    view.rerender({ notifications: [row('m2'), row('m1')], status: 'ready' });
    await settle();

    expect(presentNotificationToast).toHaveBeenCalledTimes(1);
    expect(presentNotificationToast.mock.calls[0][0]).toMatchObject({
      title: 'Assigned to you: m2',
    });
  });

  it('does not prime off a NON-answer: a loading snapshot is not this cycle\'s rows', async () => {
    // The store keeps the last value through `loading` / `error`. Priming off
    // one would either announce the whole inbox when the real answer lands, or
    // (worse) swallow it. Only `ready` may be scanned.
    const view = mountNotifier({ notifications: [row('m1')], status: 'loading' });
    await settle();

    view.rerender({ notifications: [row('m1')], status: 'ready' });
    await settle();

    // The `ready` snapshot is the FIRST scan, so it primes: no announcement.
    expect(presentNotificationToast).not.toHaveBeenCalled();

    view.rerender({ notifications: [row('m2'), row('m1')], status: 'ready' });
    await settle();
    expect(presentNotificationToast).toHaveBeenCalledTimes(1);
  });
});

describe('constraint 2 — several messages in one cycle announce once', () => {
  it('raises ONE toast for three rows arriving together, not three', async () => {
    const view = mountNotifier({ notifications: [], status: 'ready' });
    await settle();

    view.rerender({
      notifications: [
        row('m4', { type: 'approval.requested', title: 'Approval needed: PO-88' }),
        row('m3', { type: 'collab.mention', title: 'Ada mentioned you' }),
        row('m2'),
      ],
      status: 'ready',
    });
    await settle();

    expect(presentNotificationToast).toHaveBeenCalledTimes(1);
    expect(presentNotificationToast.mock.calls[0][0].title).toContain('3');
  });

  it('reuses the inbox (topic, title) collapse: one repeated topic is ONE thing', async () => {
    const digestRow = (id: string) =>
      row(id, { type: 'project.digest', title: 'Scheduled project digest' });
    const view = mountNotifier({ notifications: [], status: 'ready' });
    await settle();

    view.rerender({
      notifications: [digestRow('m3'), digestRow('m2'), digestRow('m1')],
      status: 'ready',
    });
    await settle();

    expect(presentNotificationToast).toHaveBeenCalledTimes(1);
    // Not "3 new messages" — the bell would show these as one collapsed group.
    expect(presentNotificationToast.mock.calls[0][0].title).toBe('Scheduled project digest');
  });
});

describe('constraint 4 — a message the signed-in user caused does not pop (objectui#8667)', () => {
  // The comparand is the signed-in user's ID as `useAuth` reports it
  // ('u_alice' in this file's mock), not their name or email. Both actors are
  // concrete and distinct, so neither case can pass by comparing two absences.
  it('stays silent for a self-caused row, then announces the next row someone else caused', async () => {
    const view = mountNotifier({ notifications: [row('m1')], status: 'ready' });
    await settle();

    view.rerender({ notifications: [row('m2', { actor_id: 'u_alice' }), row('m1')], status: 'ready' });
    await settle();
    expect(presentNotificationToast).not.toHaveBeenCalled();

    view.rerender({
      notifications: [row('m3', { actor_id: 'u_bob' }), row('m2', { actor_id: 'u_alice' }), row('m1')],
      status: 'ready',
    });
    await settle();

    // Exactly the other person's row: the self-caused one was remembered, not
    // held back to be announced alongside it.
    expect(presentNotificationToast).toHaveBeenCalledTimes(1);
    expect(presentNotificationToast.mock.calls[0][0]).toMatchObject({
      title: 'Assigned to you: m3',
    });
  });
});

describe('constraint 5 — toast and desktop notification are mutually exclusive', () => {
  it('a VISIBLE tab gets the toast and NO system notification', async () => {
    FakeNotification.permission = 'granted';
    writeNotificationPreferences('u_alice', { toast: true, desktop: true });
    setVisibility('visible');

    const view = mountNotifier({ notifications: [], status: 'ready' });
    await settle();
    view.rerender({ notifications: [row('m1')], status: 'ready' });
    await settle();

    expect(presentNotificationToast).toHaveBeenCalledTimes(1);
    // The lit control above proved this counter can reach 1 in this file.
    expect(raised).toHaveLength(0);
  });

  it('a HIDDEN tab gets the system notification and NO toast', async () => {
    FakeNotification.permission = 'granted';
    writeNotificationPreferences('u_alice', { toast: true, desktop: true });
    setVisibility('hidden');

    const view = mountNotifier({ notifications: [], status: 'ready' });
    await settle();
    view.rerender({ notifications: [row('m1')], status: 'ready' });
    await settle();

    expect(raised).toHaveLength(1);
    expect(presentNotificationToast).not.toHaveBeenCalled();
  });
});

describe('acceptance 4 — an ungranted browser is completely silent, exactly as before', () => {
  it('raises nothing when the user opted in but the browser has not granted', async () => {
    FakeNotification.permission = 'default';
    writeNotificationPreferences('u_alice', { toast: true, desktop: true });
    setVisibility('hidden');

    const view = mountNotifier({ notifications: [], status: 'ready' });
    await settle();
    view.rerender({ notifications: [row('m1')], status: 'ready' });
    await settle();

    expect(raised).toHaveLength(0);
    expect(presentNotificationToast).not.toHaveBeenCalled();
  });

  it('raises nothing when the browser granted but the user has not opted in', async () => {
    FakeNotification.permission = 'granted';
    // The shipped default: desktop off.
    setVisibility('hidden');

    const view = mountNotifier({ notifications: [], status: 'ready' });
    await settle();
    view.rerender({ notifications: [row('m1')], status: 'ready' });
    await settle();

    expect(raised).toHaveLength(0);
  });
});

describe('⭐ the non-regression axis — permission is NEVER requested by the presenter', () => {
  it('does not request on mount, on a feed refresh, or on the first message', async () => {
    FakeNotification.permission = 'default';
    writeNotificationPreferences('u_alice', { toast: true, desktop: true });
    setVisibility('hidden');

    // Mount.
    const view = mountNotifier({ notifications: [], status: 'loading' });
    await settle();
    expect(requestPermission).not.toHaveBeenCalled();

    // The feed answers (a refresh).
    view.rerender({ notifications: [row('m1')], status: 'ready' });
    await settle();
    expect(requestPermission).not.toHaveBeenCalled();

    // The first message actually arrives — the moment a lazy implementation
    // would be tempted to ask, because asking here would "make it work".
    view.rerender({ notifications: [row('m2'), row('m1')], status: 'ready' });
    await settle();
    expect(requestPermission).not.toHaveBeenCalled();

    // And again while VISIBLE, so the toast path is covered by the same claim.
    setVisibility('visible');
    view.rerender({ notifications: [row('m3'), row('m2'), row('m1')], status: 'ready' });
    await settle();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe('acceptance 1 — clicking the announcement opens the message and marks it read', () => {
  it('the toast action marks the row read and deep-links to it', async () => {
    const view = mountNotifier({ notifications: [], status: 'ready' });
    await settle();
    view.rerender({ notifications: [row('m1')], status: 'ready' });
    await settle();

    const item = presentNotificationToast.mock.calls[0][0];
    act(() => { item.actions[0].onClick(); });

    expect(markRead).toHaveBeenCalledWith('m1');
    // No apps in this harness's metadata, so the host segment resolves to the
    // setup app — the assertion is that the row's `action_url` was resolved
    // through `resolveNotificationTarget`, not hand-built.
    expect(navigate).toHaveBeenCalledWith('/apps/setup/showcase_task/m1');
  });

  it('a row with NO action_url opens the full inbox instead of navigating nowhere', async () => {
    const view = mountNotifier({ notifications: [], status: 'ready' });
    await settle();
    view.rerender({ notifications: [row('m1', { action_url: null })], status: 'ready' });
    await settle();

    act(() => { presentNotificationToast.mock.calls[0][0].actions[0].onClick(); });

    expect(markRead).toHaveBeenCalledWith('m1');
    expect(navigate).toHaveBeenCalledWith('/apps/setup/sys_inbox_message?view=mine');
  });

  it('clicking the system notification focuses the window, then opens the message', async () => {
    FakeNotification.permission = 'granted';
    writeNotificationPreferences('u_alice', { toast: true, desktop: true });
    setVisibility('hidden');
    const focus = vi.fn();
    vi.stubGlobal('focus', focus);

    const view = mountNotifier({ notifications: [], status: 'ready' });
    await settle();
    view.rerender({ notifications: [row('m1')], status: 'ready' });
    await settle();

    expect(raised).toHaveLength(1);
    act(() => { raised[0].onclick?.(new Event('click')); });

    expect(focus).toHaveBeenCalled();
    expect(markRead).toHaveBeenCalledWith('m1');
    expect(navigate).toHaveBeenCalledWith('/apps/setup/showcase_task/m1');
    expect(raised[0].close).toHaveBeenCalled();
  });
});

describe('the switches govern the announcement, not the memory', () => {
  it('announces nothing while in-app alerts are off', async () => {
    writeNotificationPreferences('u_alice', { toast: false, desktop: false });

    const view = mountNotifier({ notifications: [], status: 'ready' });
    await settle();
    view.rerender({ notifications: [row('m1')], status: 'ready' });
    await settle();

    expect(presentNotificationToast).not.toHaveBeenCalled();
  });

  it('does not replay the backlog when the switch is turned back on', async () => {
    writeNotificationPreferences('u_alice', { toast: false, desktop: false });
    const view = mountNotifier({ notifications: [], status: 'ready' });
    await settle();
    view.rerender({ notifications: [row('m2'), row('m1')], status: 'ready' });
    await settle();

    // The user switches alerts on. The rows they missed were SEEN by the
    // session — they were simply not announced — so nothing replays.
    writeNotificationPreferences('u_alice', { toast: true, desktop: false });
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: `${NOTIFICATION_PREFERENCES_KEY}:u:u_alice`,
        newValue: JSON.stringify({ toast: true, desktop: false }),
        storageArea: window.localStorage,
      }),
    );
    await settle();
    view.rerender({ notifications: [row('m2'), row('m1')], status: 'ready' });
    await settle();

    expect(presentNotificationToast).not.toHaveBeenCalled();

    // ...but the NEXT message is announced, so this is not "off forever".
    view.rerender({ notifications: [row('m3'), row('m2'), row('m1')], status: 'ready' });
    await settle();
    expect(presentNotificationToast).toHaveBeenCalledTimes(1);
  });
});

describe('⭐ flipping a switch reaches the presenter in the SAME tab', () => {
  /**
   * The regression this pins was found in a real browser, not here, and it made
   * the desktop half of the feature completely inert: the settings menu and the
   * notifier each held their own `useState` copy of the preferences, so the menu
   * flipped its copy and wrote localStorage while the presenter kept believing
   * `desktop: false` until the page was reloaded. `useStorageSync` cannot cover
   * it — the `storage` event fires only in OTHER tabs, by design — so the two
   * surfaces now read ONE module-scoped store.
   *
   * Written as one tree with both surfaces in it, because a hook mounted alone
   * cannot disagree with itself and that is exactly why the unit pins missed it.
   */
  function NotifierProbe({ notifications, status }: Props) {
    useInboxArrivalNotifier({ notifications, status, markRead });
    return null;
  }

  function Both(props: Props) {
    return (
      <MemoryRouter initialEntries={['/home']}>
        <NotificationPreferencesMenu />
        <NotifierProbe {...props} />
      </MemoryRouter>
    );
  }

  it('turning desktop notifications on makes the very next hidden-tab arrival announce', async () => {
    FakeNotification.permission = 'granted';
    setVisibility('hidden');

    const view = render(<Both notifications={[]} status="ready" />);
    await settle();

    // Before the switch: the shipped default is off, so the tab is silent.
    view.rerender(<Both notifications={[row('m1')]} status="ready" />);
    await settle();
    expect(raised).toHaveLength(0);

    // The user turns it on. No reload, no remount of the presenter.
    fireEvent.click(screen.getByTestId('notification-desktop-toggle'));
    await waitFor(() =>
      expect(screen.getByTestId('notification-desktop-toggle')).toHaveAttribute('data-state', 'checked'),
    );

    view.rerender(<Both notifications={[row('m2'), row('m1')]} status="ready" />);
    await settle();

    expect(raised.map((n) => n.title)).toEqual(['Assigned to you: m2']);
  });

  it('turning in-app alerts off silences the very next visible-tab arrival', async () => {
    setVisibility('visible');
    const view = render(<Both notifications={[]} status="ready" />);
    await settle();

    view.rerender(<Both notifications={[row('m1')]} status="ready" />);
    await settle();
    expect(presentNotificationToast).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('notification-toast-toggle'));
    await waitFor(() =>
      expect(screen.getByTestId('notification-toast-toggle')).toHaveAttribute('data-state', 'unchecked'),
    );

    view.rerender(<Both notifications={[row('m2'), row('m1')]} status="ready" />);
    await settle();

    expect(presentNotificationToast).toHaveBeenCalledTimes(1);
  });
});
