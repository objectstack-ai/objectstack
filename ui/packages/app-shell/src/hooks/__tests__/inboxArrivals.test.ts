/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#7011 — which inbox rows are ARRIVALS, and what one announcement says.
 *
 * ## Why the NEGATIVE cases are the load-bearing ones here
 *
 * A suite that only asserted "a new message produces an arrival" is passed by an
 * implementation that announces EVERY row it ever sees — history at login,
 * already-read rows, the same rows again next poll. That implementation is
 * materially WORSE than the silence the card was raised about: ten toasts on
 * every refresh is how a user learns to switch notifications off, and once they
 * have, the approvals and @-mentions this feature exists for are missed too.
 *
 * So the first fetch not announcing, and an already-read row not announcing,
 * are pinned at least as hard as the positive case — and the caricature
 * (a selector that answers the same thing for every input) is pinned in BOTH
 * directions: `announce everything` and `announce nothing` each go red below.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  claimInboxArrivals,
  digestArrivals,
  inboxArrivalMemory,
  rememberSeen,
  SEEN_MESSAGE_LIMIT,
  __resetInboxArrivals,
} from '../inboxArrivals';
import type { InboxNotification } from '../../layout/inboxGrouping';

/** A row as `mergeInboxRows` produces it. Ids are CONCRETE and distinguishable. */
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

const USER = 'u_alice';

beforeEach(() => {
  __resetInboxArrivals();
});

describe('claimInboxArrivals — the first answered read primes, it does not announce', () => {
  it('announces NOTHING for the historical unread the first read brings back', () => {
    const history = [row('m3'), row('m2'), row('m1')];

    const arrivals = claimInboxArrivals(USER, history);

    expect(arrivals).toEqual([]);
    // ...and it primed, rather than simply having seen nothing: the difference
    // matters, because "primed with zero rows" and "never scanned" behave
    // identically on the next call only if the memory really was written.
    expect(inboxArrivalMemory().key).toBe(USER);
    expect([...inboxArrivalMemory().seen]).toEqual(['m3', 'm2', 'm1']);
  });

  it('announces the row that arrives AFTER the priming read, and only that row', () => {
    claimInboxArrivals(USER, [row('m1')]);

    const arrivals = claimInboxArrivals(USER, [row('m2'), row('m1')]);

    // Concrete ids, so this cannot be satisfied by "returned something".
    expect(arrivals.map((a) => a.id)).toEqual(['m2']);
  });

  it('does not re-announce a row it has already announced', () => {
    claimInboxArrivals(USER, [row('m1')]);
    expect(claimInboxArrivals(USER, [row('m2'), row('m1')]).map((a) => a.id)).toEqual(['m2']);

    // The same window again — the poll's normal steady state.
    expect(claimInboxArrivals(USER, [row('m2'), row('m1')])).toEqual([]);
  });

  it('re-primes for a DIFFERENT signed-in user instead of announcing their inbox', () => {
    claimInboxArrivals(USER, [row('m1')]);

    // A second account on the same browser: their unread is history to them.
    const arrivals = claimInboxArrivals('u_bob', [row('m9'), row('m8')]);

    expect(arrivals).toEqual([]);
    expect(inboxArrivalMemory().key).toBe('u_bob');
  });
});

describe('claimInboxArrivals — only UNREAD rows announce', () => {
  it('ignores a newly-seen row that already carries a read receipt', () => {
    claimInboxArrivals(USER, [row('m1')]);

    const arrivals = claimInboxArrivals(USER, [row('m2', { is_read: true }), row('m1')]);

    expect(arrivals).toEqual([]);
  });

  it('still REMEMBERS the read row, so it cannot announce later if it flips', () => {
    claimInboxArrivals(USER, [row('m1')]);
    claimInboxArrivals(USER, [row('m2', { is_read: true }), row('m1')]);

    // A poll where the receipt has not come back yet must not resurrect it.
    expect(claimInboxArrivals(USER, [row('m2'), row('m1')])).toEqual([]);
  });

  it('announces the unread ones and drops the read ones from the SAME cycle', () => {
    claimInboxArrivals(USER, [row('m1')]);

    const arrivals = claimInboxArrivals(USER, [
      row('m4'),
      row('m3', { is_read: true }),
      row('m2'),
      row('m1'),
    ]);

    expect(arrivals.map((a) => a.id)).toEqual(['m4', 'm2']);
  });
});

describe('claimInboxArrivals — what the signed-in user caused does not announce (objectui#8667)', () => {
  // Two CONCRETE, distinguishable actors. `USER` is the reader; `OTHER` is
  // someone else. Two absent actors would compare equal and prove nothing.
  const OTHER = 'u_bob';

  it('suppresses the row the reader caused and announces the one someone else caused', () => {
    claimInboxArrivals(USER, [row('m1')]);

    const arrivals = claimInboxArrivals(USER, [
      row('m3', { actor_id: USER }),
      row('m2', { actor_id: OTHER }),
      row('m1'),
    ]);

    expect(arrivals.map((a) => a.id)).toEqual(['m2']);
  });

  it('decides by WHO IS READING: the same row is silent to its actor and announces to anyone else', () => {
    // Alice assigned the task, so the row carries her id. To Alice it is noise…
    claimInboxArrivals(USER, [row('m1')]);
    expect(claimInboxArrivals(USER, [row('m2', { actor_id: USER }), row('m1')])).toEqual([]);

    // …and to Bob, reading a row with the very same actor id, it is news.
    __resetInboxArrivals();
    claimInboxArrivals(OTHER, [row('m1')]);
    const arrivals = claimInboxArrivals(OTHER, [row('m2', { actor_id: USER }), row('m1')]);
    expect(arrivals.map((a) => a.id)).toEqual(['m2']);
  });

  it('still REMEMBERS the suppressed row, so it cannot announce on a later poll', () => {
    claimInboxArrivals(USER, [row('m1')]);
    claimInboxArrivals(USER, [row('m2', { actor_id: USER }), row('m1')]);

    expect([...inboxArrivalMemory().seen]).toEqual(['m2', 'm1']);
    // The discriminating poll drops the actor: had the row been SKIPPED rather
    // than remembered, nothing would stop it announcing now.
    expect(claimInboxArrivals(USER, [row('m2'), row('m1')])).toEqual([]);
  });

  it('announces a row whose actor is NULL: a digest row has no single actor, which is not "me"', () => {
    claimInboxArrivals(USER, [row('m1')]);

    const arrivals = claimInboxArrivals(USER, [row('m2', { actor_id: null }), row('m1')]);

    expect(arrivals.map((a) => a.id)).toEqual(['m2']);
  });

  it('announces a row with NO actor_id key at all, so an older server behaves exactly as before', () => {
    claimInboxArrivals(USER, [row('m1')]);
    const legacy = row('m2');
    // The control is only a control if the key is genuinely absent.
    expect(Object.hasOwn(legacy, 'actor_id')).toBe(false);

    const arrivals = claimInboxArrivals(USER, [legacy, row('m1')]);

    expect(arrivals.map((a) => a.id)).toEqual(['m2']);
  });
});

describe('claimInboxArrivals — a claim is a claim: the second consumer of one snapshot gets nothing', () => {
  it('hands the arrivals to the first scanner only', () => {
    claimInboxArrivals(USER, [row('m1')]);
    const snapshot = [row('m2'), row('m1')];

    // The header bell and the `global:notifications` block, same commit.
    const first = claimInboxArrivals(USER, snapshot);
    const second = claimInboxArrivals(USER, snapshot);

    expect(first.map((a) => a.id)).toEqual(['m2']);
    expect(second).toEqual([]);
  });
});

describe('rememberSeen — bounded, and it never lets a windowed row age out', () => {
  it('keeps the newest ids and drops the oldest past the limit', () => {
    const previous = Array.from({ length: SEEN_MESSAGE_LIMIT }, (_, i) => `old_${i}`);

    const next = rememberSeen(previous, ['fresh_1', 'fresh_2']);

    expect(next).toHaveLength(SEEN_MESSAGE_LIMIT);
    expect(next.slice(-2)).toEqual(['fresh_1', 'fresh_2']);
    expect(next).not.toContain('old_0');
    expect(next).not.toContain('old_1');
  });

  it('moves a still-windowed id to the young end rather than leaving it to age out', () => {
    // `Set.add` on an existing member does NOT reorder — that is the exact bug
    // this function exists to make unrepresentable, so it is pinned by ORDER.
    const next = rememberSeen(['a', 'b', 'c'], ['b']);

    expect(next).toEqual(['a', 'c', 'b']);
  });

  it('survives a window larger than the limit without losing the newest rows', () => {
    const window = Array.from({ length: 4 }, (_, i) => `w_${i}`);

    expect(rememberSeen(['old'], window, 2)).toEqual(['w_2', 'w_3']);
  });
});

describe('digestArrivals — one cycle says one thing, collapsed by the inbox\'s own rule', () => {
  it('is null when nothing arrived', () => {
    expect(digestArrivals([])).toBeNull();
  });

  it('collapses repeats of one (topic, title) into ONE group', () => {
    const digest = digestArrivals([
      row('m3', { type: 'project.digest', title: 'Scheduled project digest' }),
      row('m2', { type: 'project.digest', title: 'Scheduled project digest' }),
      row('m1', { type: 'project.digest', title: 'Scheduled project digest' }),
    ]);

    expect(digest).not.toBeNull();
    expect(digest!.count).toBe(3);
    expect(digest!.groups).toHaveLength(1);
    expect(digest!.groups[0].items).toHaveLength(3);
    // The newest row is the click target — the one a user would open.
    expect(digest!.target.id).toBe('m3');
  });

  it('keeps genuinely different messages as different groups', () => {
    const digest = digestArrivals([
      row('m2', { type: 'approval.requested', title: 'Approval needed: PO-88' }),
      row('m1', { type: 'collab.mention', title: 'Ada mentioned you' }),
    ]);

    expect(digest!.groups.map((g) => g.type)).toEqual(['approval.requested', 'collab.mention']);
    expect(digest!.count).toBe(2);
  });
});
