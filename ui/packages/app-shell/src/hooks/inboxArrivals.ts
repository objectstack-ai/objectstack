/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * inboxArrivals — which inbox rows are NEW ARRIVALS worth announcing, and what
 * one announcement says about them (objectui#7011).
 *
 * The inbox feed (`sharedUserFeeds`) polls `sys_inbox_message` and writes the
 * rows into a store; until this module existed nothing turned "the store grew a
 * row" into anything a user could perceive. Announcing is the presentation
 * layer's job, and it is entirely a question about DIFFS — which is why the
 * decision lives here as a pure module rather than inline in the hook that
 * presents: the four rules that decide it are the four ways the feature gets
 * user-hostile, and each one is worth a test that can fail on its own.
 *
 *  1. **The first answered read never announces.** Historical unread at login
 *     or after a refresh is not an arrival — it is the state of the inbox. A
 *     presenter that pops for it fires ten toasts on every page refresh, which
 *     is the fastest way to get notifications switched off for good, after
 *     which the approvals and @-mentions the feature exists for are missed too.
 *     So the first `ready` snapshot for a session identity PRIMES the seen set
 *     and returns nothing.
 *  2. **Only unread rows announce.** A row that arrives already carrying a
 *     read receipt has been consumed somewhere else (another tab, the record
 *     page, `mark all read`); announcing it re-raises something the user has
 *     already dealt with.
 *  3. **One cycle announces once.** Several rows landing in one poll collapse
 *     into a single announcement, and they collapse by the inbox's OWN
 *     `(topic, title)` rule (`groupNotifications`) rather than a second rule
 *     invented here — the bell already answers "how many distinct things is
 *     this really?" that way, and two answers to that question would drift.
 *  4. **What the user caused themselves does not announce (objectui#8667).**
 *     Assigning yourself a task, or any flow that lists its initiator among the
 *     recipients, writes an inbox row whose `actor_id` is the reader's own id.
 *     The message is right and the moment is noise: the user is looking at the
 *     thing they just did. Such a row is still SEEN, so it cannot announce on
 *     a later poll either. Only a concrete id equal to the signed-in user's
 *     suppresses; `null` (a digest row, which has no single actor) and an
 *     absent value (a server older than the column, objectstack#16974) mean
 *     "no known actor" and announce exactly as before.
 *
 * ## Why the seen set is module-scoped rather than a ref
 *
 * `useInboxBell` is mounted by BOTH the header bell and the `global:notifications`
 * page block, and a page may mount both at once. A per-hook ref would make each
 * mount its own announcer: two toasts for one message, and a route change that
 * remounts the header would re-prime and re-announce everything on screen.
 * A module-scoped set makes the dedupe STRUCTURAL, the same reasoning
 * `sharedUserFeeds` records for its own store: whichever consumer scans first
 * takes the arrivals, every later consumer in the same cycle finds them already
 * seen, and the set survives remounts because it belongs to the SESSION, not to
 * a component instance.
 *
 * @module
 */

import { groupNotifications, type InboxNotification, type NotificationGroup } from '../layout/inboxGrouping.js';

/**
 * How many message ids the session remembers.
 *
 * The feed's window is 20 rows, so this is 25 windows of headroom — an id can
 * only age out long after it has left the window, and rows still IN the window
 * are re-appended on every scan (see {@link rememberSeen}), so an aged-out id
 * can never be one the next poll could show again. Bounded because a session
 * left open for a day at a 10 s cadence would otherwise grow the set forever.
 */
export const SEEN_MESSAGE_LIMIT = 500;

/** Stable empty result — an effect that re-runs must not see a fresh array. */
const NO_ARRIVALS: readonly InboxNotification[] = Object.freeze([]);

/**
 * The session's announcement memory.
 *
 * `key` is the session identity the seen ids belong to (the signed-in user id).
 * A different key means a different person is looking at this browser, so their
 * unread is history to them too: re-prime rather than announce.
 */
const memory: { key: string | null; seen: string[] } = { key: null, seen: [] };

/**
 * Remember `current`, keeping the set bounded and keeping every currently
 * windowed id at the YOUNG end.
 *
 * Order matters and `Set.add` would get it wrong: adding an id that is already
 * present does not move it, so a long-lived row could age out of a
 * front-trimmed set while still being in the feed's window — and would then
 * announce itself a second time. Rebuilding as "older ids that are not in the
 * window, then the whole window" makes that unrepresentable.
 */
export function rememberSeen(
  previous: readonly string[],
  current: readonly string[],
  limit: number = SEEN_MESSAGE_LIMIT,
): string[] {
  const inWindow = new Set(current);
  const merged = [...previous.filter((id) => !inWindow.has(id)), ...current];
  return merged.length > limit ? merged.slice(merged.length - limit) : merged;
}

/**
 * Take this cycle's arrivals and mark every row seen.
 *
 * Claiming is a MUTATION on purpose: the caller that scans first owns the
 * announcement, and a second consumer scanning the same snapshot is handed
 * nothing. It is also why the claim happens BEFORE the caller checks whether
 * announcements are switched on — a user who enables toasts mid-session must
 * not be greeted by every message that arrived while they were off.
 *
 * @param key   The signed-in user id. It is the identity the memory belongs to
 *              AND the comparand for rule 4: the same id the feed filters
 *              `sys_inbox_message.user_id` by, and the id space the inbox
 *              channel writes `actor_id` in.
 * @param rows  The feed's current rows, newest first. Only pass rows from a
 *              snapshot whose status is `ready`: a `loading` or `error`
 *              snapshot carries the LAST value, and treating that as this
 *              cycle's answer would prime the memory off a stale read.
 */
export function claimInboxArrivals(
  key: string,
  rows: readonly InboxNotification[],
): readonly InboxNotification[] {
  const ids = rows.map((row) => row.id);

  if (key !== memory.key) {
    // First answered read for this identity: this IS the inbox, not an event.
    memory.key = key;
    memory.seen = rememberSeen([], ids);
    return NO_ARRIVALS;
  }

  const known = new Set(memory.seen);
  // Unseen AND unread — the card's own definition of what arrived. A row that
  // is new to this session but already read was consumed elsewhere. And not
  // caused by the reader (rule 4). Every row, suppressed or not, is still
  // remembered below: `ids` is the whole window.
  const arrivals = rows.filter(
    (row) => !known.has(row.id) && !row.is_read && !causedBy(row, key),
  );
  memory.seen = rememberSeen(memory.seen, ids);
  return arrivals.length > 0 ? arrivals : NO_ARRIVALS;
}

/**
 * Did `userId` cause this row themselves (rule 4)?
 *
 * Only a concrete id equal to `userId` answers yes. `null` and `undefined`
 * never do: they mean "no known actor", and reading either one as anything
 * beyond "announce as before" would let a digest row, or a row from a server
 * older than the column, be silenced on a guess.
 */
function causedBy(row: InboxNotification, userId: string): boolean {
  return typeof row.actor_id === 'string' && row.actor_id === userId;
}

/**
 * What the session currently remembers — a read-only view for pins, so a test
 * can distinguish "primed and announced nothing" from "never scanned".
 */
export function inboxArrivalMemory(): { key: string | null; seen: readonly string[] } {
  return { key: memory.key, seen: memory.seen };
}

/** Test seam — forget the session, so cases do not inherit each other's scans. */
export function __resetInboxArrivals(): void {
  memory.key = null;
  memory.seen = [];
}

/** One cycle's arrivals, reduced to what a single announcement needs. */
export interface ArrivalDigest {
  /** Newest arrival — the row an announcement navigates to and marks read. */
  target: InboxNotification;
  /** How many rows arrived in this cycle. */
  count: number;
  /**
   * The arrivals under the inbox's own `(topic, title)` collapse. One group is
   * one real thing to say; several groups are several, and the announcement
   * summarizes rather than picking a winner.
   */
  groups: NotificationGroup[];
}

/**
 * Reduce a cycle's arrivals to one digest, or `null` when nothing arrived.
 *
 * Rows arrive newest-first (the feed orders `created_at desc`), so the target
 * is simply the first — the message the user would look at if they only looked
 * at one.
 */
export function digestArrivals(arrivals: readonly InboxNotification[]): ArrivalDigest | null {
  if (arrivals.length === 0) return null;
  return {
    target: arrivals[0],
    count: arrivals.length,
    groups: groupNotifications([...arrivals]),
  };
}
