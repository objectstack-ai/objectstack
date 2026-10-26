// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13330 — the recovery-password reminder does not show on a
 * cloud-managed environment (`features.cloudManaged`, the
 * objectstack-ai/objectstack#25083 ruling, Q4 A).
 *
 * Each case drives the real component past its first-session grace with every
 * other condition that shows it (an SSO user with no local password, password
 * sign-in available), so the flag is the only variable. The absent and `false`
 * cases are the control: the same mount shows the reminder.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
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
} from '../recoveryReminderGate';

const t = (key: string) => key;
const FIRST_VISIT = Date.UTC(2026, 9, 20, 9, 0, 0);

async function mountPastFirstSession(features: Record<string, unknown> | undefined) {
  getAuthConfig.mockResolvedValue(features === undefined ? {} : { features });
  localStorage.setItem(RECOVERY_REMINDER_FIRST_SEEN_KEY, String(FIRST_VISIT));
  vi.setSystemTime(FIRST_VISIT + FIRST_SESSION_GRACE_MS + 60_000);
  render(<RecoveryPasswordReminder t={t} />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('RecoveryPasswordReminder on a cloud-managed environment (objectui#13330)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    localStorage.removeItem(RECOVERY_REMINDER_FIRST_SEEN_KEY);
    localStorage.removeItem(RECOVERY_REMINDER_DISMISSED_KEY);
    hasLocalPassword.mockReset().mockResolvedValue(false);
    getAuthConfig.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    localStorage.removeItem(RECOVERY_REMINDER_FIRST_SEEN_KEY);
    localStorage.removeItem(RECOVERY_REMINDER_DISMISSED_KEY);
  });

  it('does not show when features.cloudManaged is true', async () => {
    await mountPastFirstSession({ cloudManaged: true });
    expect(screen.queryByTestId('recovery-pw-reminder')).toBeNull();
  });

  it.each([
    ['absent', undefined],
    ['absent from features', {}],
    ['false', { cloudManaged: false }],
  ])('CONTROL: shows when the flag is %s', async (_label, features) => {
    await mountPastFirstSession(features as Record<string, unknown> | undefined);
    expect(screen.getByTestId('recovery-pw-reminder')).toBeInTheDocument();
  });
});
