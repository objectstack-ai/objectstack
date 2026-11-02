// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The account menu's notification switches are tappable on a phone
 * (objectstack#29076).
 *
 * The switch primitive is 44 × 24, under the 44 px tap floor, and it is a
 * shared primitive. So each row is the switch's `label`: a tap anywhere on the
 * row toggles it, and below `md` the row is 44 px tall. A disabled switch stays
 * off however the row is tapped.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u_alice' } }),
}));

import { NotificationPreferencesMenu } from '../NotificationPreferencesMenu';
import { __resetNotificationPreferences } from '../../hooks/notificationPreferences';

const requestPermission = vi.fn(async () => 'granted');

function stubNotification(permission: 'granted' | 'denied' | 'default') {
  class FakeNotification {
    static permission = permission;
    static requestPermission = requestPermission;
  }
  vi.stubGlobal('Notification', FakeNotification);
}

beforeEach(() => {
  requestPermission.mockClear();
  window.localStorage.clear();
  __resetNotificationPreferences();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const row = (testId: string) => screen.getByTestId(testId).closest('label') as HTMLLabelElement;

describe('NotificationPreferencesMenu at phone width (objectstack#29076)', () => {
  it('makes each switch the control of a 44 px row', () => {
    stubNotification('default');
    render(<NotificationPreferencesMenu />);
    for (const id of ['notification-toast-toggle', 'notification-desktop-toggle']) {
      const label = row(id);
      expect(label, id).not.toBeNull();
      expect(label.className).toContain('max-md:min-h-11');
    }
  });

  it('toggles in-app alerts from a tap on the row text', () => {
    stubNotification('default');
    render(<NotificationPreferencesMenu />);
    const toggle = screen.getByTestId('notification-toast-toggle');
    expect(toggle).toHaveAttribute('data-state', 'checked');

    fireEvent.click(screen.getByText('In-app alerts'));
    expect(toggle).toHaveAttribute('data-state', 'unchecked');
  });

  it('asks for desktop permission from a tap on the row text, the same gesture as the switch', () => {
    stubNotification('default');
    render(<NotificationPreferencesMenu />);
    fireEvent.click(screen.getByText('Desktop notifications'));
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('leaves a blocked desktop switch off and unasked when its row is tapped', () => {
    stubNotification('denied');
    render(<NotificationPreferencesMenu />);
    fireEvent.click(screen.getByText('Desktop notifications'));
    expect(requestPermission).not.toHaveBeenCalled();
    expect(screen.getByTestId('notification-desktop-toggle')).toHaveAttribute('data-state', 'unchecked');
  });
});
