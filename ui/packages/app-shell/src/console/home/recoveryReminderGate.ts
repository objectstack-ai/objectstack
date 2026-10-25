// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * When the environment home's backup-password reminder may show
 * (objectui#11659). Kept apart from `RecoveryPasswordReminder.tsx` so that
 * module exports a component only.
 *
 * @module
 */

/** Set once the user dismisses the reminder; it never shows again on this device. */
export const RECOVERY_REMINDER_DISMISSED_KEY = 'os:recovery-pw-dismissed';

/** Epoch milliseconds of the user's first home visit on this device. */
export const RECOVERY_REMINDER_FIRST_SEEN_KEY = 'os:recovery-pw-first-seen';

/**
 * How long after the first home visit the reminder stays quiet: longer than any
 * single sitting, short enough that the next day's visit shows it.
 */
export const FIRST_SESSION_GRACE_MS = 12 * 60 * 60 * 1000;

/**
 * Below this a stored value is not an epoch-milliseconds timestamp (it is
 * 2001-09-09). The legacy flag this key used to hold, `'1'`, sits below it.
 */
const EPOCH_MS_FLOOR = 1_000_000_000_000;

export type ReminderStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Is the user past their FIRST SESSION on this device (objectui#11659)?
 *
 * The first call records the time of the first home visit and answers `false`;
 * later calls answer `true` once `FIRST_SESSION_GRACE_MS` has passed since it.
 *
 * Why elapsed time, and not a count of home visits or a per-tab marker:
 *
 * - A visit count is what this replaced, and it is the defect the card
 *   measured. The flag was set on the first home mount and the reminder shown
 *   on the second; a new user lands on home, builds their first app, comes back
 *   to home — the second mount, inside the first sitting — and the reminder sat
 *   on top of 「我的应用」 right after the first app was built.
 * - `sessionStorage` is per tab. A "new session" read from it fires in any
 *   second tab the user opens during that same first sitting.
 * - The client holds no session id to compare: `AuthClientSession` carries the
 *   bearer token, and an SSO re-entry can mint a new one within one sitting.
 *
 * Elapsed time is the one signal that cannot fire inside the first sitting.
 * The ruling allows the reminder from the second session or the second day; a
 * second session on the same day may still find it quiet, which errs on the
 * side the ruling protects.
 *
 * A stored value that is not a timestamp — the legacy `'1'` flag, or anything
 * unreadable — is re-recorded as now, so the grace period starts over rather
 * than reading as "long ago". No storage, or storage that throws (a private
 * window), answers `false`: when it cannot tell, it does not nag.
 */
export function isPastFirstSession(storage: ReminderStorage | undefined, now: number): boolean {
  if (!storage) return false;
  let raw: string | null;
  try {
    raw = storage.getItem(RECOVERY_REMINDER_FIRST_SEEN_KEY);
  } catch {
    return false;
  }
  const firstSeen = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(firstSeen) || firstSeen < EPOCH_MS_FLOOR) {
    try {
      storage.setItem(RECOVERY_REMINDER_FIRST_SEEN_KEY, String(now));
    } catch {
      /* ignore */
    }
    return false;
  }
  return now - firstSeen >= FIRST_SESSION_GRACE_MS;
}

export function deviceStorage(): Storage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function isDismissed(storage: ReminderStorage | undefined): boolean {
  try {
    return storage?.getItem(RECOVERY_REMINDER_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}
