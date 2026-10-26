// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The backup-password reminder does not appear in the user's first session
 * (objectui#11659 ruling 3).
 *
 * The defect the cloud acceptance run measured: a new zh user built their first
 * app and came back to the environment home, and 「建议设置一个备用密码」 sat on
 * top of 「我的应用」. The reminder used to be gated on a home-VISIT count — the
 * first home mount set a flag, the second showed the banner — and "come back to
 * home after building" is the second mount inside the first sitting.
 *
 * The gate now reads elapsed time since the first home visit
 * (`isPastFirstSession`, which states why). These cases drive the real
 * component over a real `localStorage`, with the clock moved by hand.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

const hasLocalPassword = vi.fn();
const getAuthConfig = vi.fn();
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ hasLocalPassword, getAuthConfig }),
}));

import { RecoveryPasswordReminder } from '../RecoveryPasswordReminder';
import {
  FIRST_SESSION_GRACE_MS,
  RECOVERY_REMINDER_DISMISSED_KEY,
  RECOVERY_REMINDER_FIRST_SEEN_KEY,
  isPastFirstSession,
} from '../recoveryReminderGate';

const t = (key: string) => key;
const SIGNUP = Date.UTC(2026, 9, 5, 9, 0, 0);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** A plain in-memory Storage double — the gate's whole contract with storage. */
function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

/** Mount the reminder at `now` and let its auth promises settle. */
async function mountAt(now: number) {
  vi.setSystemTime(now);
  const view = render(<RecoveryPasswordReminder t={t} />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

describe('isPastFirstSession (objectui#11659)', () => {
  it('records the first home visit and answers false', () => {
    const storage = memoryStorage();
    expect(isPastFirstSession(storage, SIGNUP)).toBe(false);
    expect(storage.map.get(RECOVERY_REMINDER_FIRST_SEEN_KEY)).toBe(String(SIGNUP));
  });

  it('stays false for the rest of the first sitting, however many home visits it holds', () => {
    const storage = memoryStorage();
    isPastFirstSession(storage, SIGNUP);
    for (const later of [1 * MINUTE, 30 * MINUTE, 3 * HOUR, FIRST_SESSION_GRACE_MS - 1]) {
      expect(isPastFirstSession(storage, SIGNUP + later)).toBe(false);
    }
    // The first visit's time is not moved by the later ones.
    expect(storage.map.get(RECOVERY_REMINDER_FIRST_SEEN_KEY)).toBe(String(SIGNUP));
  });

  it('answers true from the next day on', () => {
    const storage = memoryStorage({ [RECOVERY_REMINDER_FIRST_SEEN_KEY]: String(SIGNUP) });
    expect(isPastFirstSession(storage, SIGNUP + FIRST_SESSION_GRACE_MS)).toBe(true);
    expect(isPastFirstSession(storage, SIGNUP + 24 * HOUR)).toBe(true);
  });

  it('re-records the legacy visit flag instead of reading it as long ago', () => {
    const storage = memoryStorage({ [RECOVERY_REMINDER_FIRST_SEEN_KEY]: '1' });
    expect(isPastFirstSession(storage, SIGNUP)).toBe(false);
    expect(storage.map.get(RECOVERY_REMINDER_FIRST_SEEN_KEY)).toBe(String(SIGNUP));
  });

  it('does not nag when it cannot tell (no storage, or storage that throws)', () => {
    expect(isPastFirstSession(undefined, SIGNUP)).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(isPastFirstSession(throwing, SIGNUP + 48 * HOUR)).toBe(false);
  });
});

describe('RecoveryPasswordReminder is quiet in the first session (objectui#11659)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    localStorage.removeItem(RECOVERY_REMINDER_FIRST_SEEN_KEY);
    localStorage.removeItem(RECOVERY_REMINDER_DISMISSED_KEY);
    hasLocalPassword.mockReset().mockResolvedValue(false);
    getAuthConfig.mockReset().mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    localStorage.removeItem(RECOVERY_REMINDER_FIRST_SEEN_KEY);
    localStorage.removeItem(RECOVERY_REMINDER_DISMISSED_KEY);
  });

  it('home → build the first app → home again: no reminder on either visit', async () => {
    const first = await mountAt(SIGNUP);
    expect(screen.queryByTestId('recovery-pw-reminder')).toBeNull();
    first.unmount();

    // The user builds their first app and returns to home in the same sitting.
    // This second home mount is where the reminder used to appear.
    await mountAt(SIGNUP + 20 * MINUTE);
    expect(screen.queryByTestId('recovery-pw-reminder')).toBeNull();
  });

  it('shows from the next day on, for an SSO user with no local password', async () => {
    const first = await mountAt(SIGNUP);
    first.unmount();

    await mountAt(SIGNUP + 20 * HOUR);
    expect(screen.getByTestId('recovery-pw-reminder')).toBeInTheDocument();
    expect(screen.getByText('home.recoveryReminder.message')).toBeInTheDocument();
  });

  it('still never shows to a user who already has a local password', async () => {
    hasLocalPassword.mockResolvedValue(true);
    const first = await mountAt(SIGNUP);
    first.unmount();

    await mountAt(SIGNUP + 20 * HOUR);
    expect(screen.queryByTestId('recovery-pw-reminder')).toBeNull();
  });
});
