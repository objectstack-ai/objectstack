/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#7011 — the permission prompt has exactly ONE trigger: this toggle.
 *
 * ## What this file is really guarding
 *
 * `Notification.requestPermission()` is answered once per origin, and `denied`
 * is permanent as far as the page is concerned — no later release recovers it.
 * So "asked from a deliberate user gesture" is not a UX preference, it is the
 * difference between a channel this product has and one it has spent. The
 * companion pin (`hooks/__tests__/useInboxArrivalNotifier.test.tsx`) asserts the
 * PRESENTER never asks; this one asserts the toggle does — because a pin that
 * only ever counts zero passes just as well on an implementation that removed
 * the call entirely, and that implementation ships a switch that does nothing.
 *
 * ## Harness
 *
 * `Notification` is absent in happy-dom, so it is stubbed per case with a
 * concrete, distinguishable verdict; the "no API at all" case then removes it
 * again, which is a real browser state (and the only one where the row must be
 * disabled for a reason other than a denial).
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u_alice' } }),
}));

import { NotificationPreferencesMenu } from '../NotificationPreferencesMenu';
import {
  NOTIFICATION_PREFERENCES_KEY,
  readNotificationPreferences,
  writeNotificationPreferences,
  __resetNotificationPreferences,
} from '../../hooks/notificationPreferences';

const requestPermission = vi.fn();

function stubNotification(permission: 'granted' | 'denied' | 'default') {
  class FakeNotification {
    static permission = permission;
    static requestPermission = requestPermission;
  }
  vi.stubGlobal('Notification', FakeNotification);
  return FakeNotification;
}

beforeEach(() => {
  requestPermission.mockReset();
  window.localStorage.clear();
  // Module-scoped store: reset it, or a case reads the previous one's switches.
  __resetNotificationPreferences();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('the shipped defaults', () => {
  it('offers in-app alerts ON and desktop notifications OFF', () => {
    stubNotification('default');
    render(<NotificationPreferencesMenu />);

    expect(screen.getByTestId('notification-toast-toggle')).toHaveAttribute('data-state', 'checked');
    expect(screen.getByTestId('notification-desktop-toggle')).toHaveAttribute('data-state', 'unchecked');
  });

  it('⭐ rendering the switches does NOT ask for permission', () => {
    stubNotification('default');
    render(<NotificationPreferencesMenu />);

    // Reading the verdict to grey the row is not requesting it.
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe('the in-app alerts switch', () => {
  it('persists the user turning it off, per user id', () => {
    stubNotification('default');
    render(<NotificationPreferencesMenu />);

    fireEvent.click(screen.getByTestId('notification-toast-toggle'));

    expect(readNotificationPreferences('u_alice').toast).toBe(false);
    // Scoped: another account on this browser is unaffected.
    expect(readNotificationPreferences('u_bob').toast).toBe(true);
    expect(window.localStorage.getItem(`${NOTIFICATION_PREFERENCES_KEY}:u:u_alice`)).toContain('"toast":false');
  });
});

describe('⭐ the desktop switch is the one and only permission prompt', () => {
  it('asks exactly once, when the user turns it on', async () => {
    stubNotification('default');
    requestPermission.mockResolvedValue('granted');
    render(<NotificationPreferencesMenu />);

    fireEvent.click(screen.getByTestId('notification-desktop-toggle'));

    await waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));
  });

  it('records the preference from the VERDICT when the user grants it', async () => {
    const Fake = stubNotification('default');
    requestPermission.mockImplementation(async () => {
      // A real browser updates `Notification.permission` alongside the verdict.
      (Fake as { permission: string }).permission = 'granted';
      return 'granted';
    });
    render(<NotificationPreferencesMenu />);

    fireEvent.click(screen.getByTestId('notification-desktop-toggle'));

    await waitFor(() => expect(readNotificationPreferences('u_alice').desktop).toBe(true));
    await waitFor(() =>
      expect(screen.getByTestId('notification-desktop-toggle')).toHaveAttribute('data-state', 'checked'),
    );
  });

  it('leaves the switch OFF when the user blocks the prompt — the switch tells the truth', async () => {
    const Fake = stubNotification('default');
    requestPermission.mockImplementation(async () => {
      (Fake as { permission: string }).permission = 'denied';
      return 'denied';
    });
    render(<NotificationPreferencesMenu />);

    fireEvent.click(screen.getByTestId('notification-desktop-toggle'));

    await waitFor(() => expect(readNotificationPreferences('u_alice').desktop).toBe(false));
    expect(screen.getByTestId('notification-desktop-toggle')).toHaveAttribute('data-state', 'unchecked');
  });

  it('greys the row and points at browser settings once permission is denied', () => {
    stubNotification('denied');
    render(<NotificationPreferencesMenu />);

    const toggle = screen.getByTestId('notification-desktop-toggle');
    expect(toggle).toBeDisabled();
    expect(screen.getByTestId('notification-desktop-hint')).toHaveTextContent(/browser settings/i);
    // ...and it does not re-ask, because nothing this app does can change it.
    fireEvent.click(toggle);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('greys the row and says so where the browser has no Notification API', () => {
    vi.stubGlobal('Notification', undefined);
    render(<NotificationPreferencesMenu />);

    expect(screen.getByTestId('notification-desktop-toggle')).toBeDisabled();
    expect(screen.getByTestId('notification-desktop-hint')).toHaveTextContent(/does not support/i);
  });

  it('a switch shown ON is one the browser will actually honour', () => {
    // A stored `desktop: true` whose permission was revoked in browser chrome
    // must not render as ON: the row would promise deliveries that cannot come.
    writeNotificationPreferences('u_alice', { toast: true, desktop: true });
    stubNotification('denied');

    render(<NotificationPreferencesMenu />);

    expect(screen.getByTestId('notification-desktop-toggle')).toHaveAttribute('data-state', 'unchecked');
  });
});
