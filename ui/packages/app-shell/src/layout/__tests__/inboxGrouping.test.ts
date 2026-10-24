/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * #2765 — the message center coalesces repeats of the same (topic, title) so a
 * recurring notification (e.g. a scheduled digest that fires once a minute)
 * collapses into one expandable "Scheduled project digest ×N" row instead of
 * flooding the inbox. These lock the grouping contract that drives that UI and
 * the distinct-topic badge count.
 */
import { describe, it, expect } from 'vitest';
import { groupNotifications, type InboxNotification } from '../inboxGrouping';

const n = (over: Partial<InboxNotification> & { id: string }): InboxNotification => ({
  type: 'project.digest',
  title: 'Scheduled project digest',
  is_read: false,
  ...over,
});

describe('groupNotifications', () => {
  it('coalesces repeats of the same (topic, title) into one group', () => {
    const groups = groupNotifications([
      n({ id: '3', created_at: '2026-07-22T10:03:00Z' }),
      n({ id: '2', created_at: '2026-07-22T10:02:00Z' }),
      n({ id: '1', created_at: '2026-07-22T10:01:00Z' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(3);
    expect(groups[0].title).toBe('Scheduled project digest');
    // Newest member drives the header timestamp.
    expect(groups[0].latestCreatedAt).toBe('2026-07-22T10:03:00Z');
  });

  it('keeps distinct topics/titles as separate groups in first-seen order', () => {
    const groups = groupNotifications([
      n({ id: 'd1' }),
      n({ id: 'a1', type: 'task.assigned', title: 'New task assigned: Ship it' }),
      n({ id: 'd2' }),
    ]);
    // Two groups: the digest (first seen) then the assignment. The later digest
    // folds into the existing group rather than opening a new one.
    expect(groups.map((g) => g.title)).toEqual([
      'Scheduled project digest',
      'New task assigned: Ship it',
    ]);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items).toHaveLength(1);
  });

  it('counts only unread members per group', () => {
    const groups = groupNotifications([
      n({ id: '3' }),
      n({ id: '2', is_read: true }),
      n({ id: '1', is_read: true }),
    ]);
    expect(groups[0].items).toHaveLength(3);
    expect(groups[0].unreadCount).toBe(1);
  });

  it('does NOT collide a same title carried under different topics', () => {
    const groups = groupNotifications([
      n({ id: 'a', type: 'project.alpha', title: 'Update' }),
      n({ id: 'b', type: 'project.beta', title: 'Update' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('gives rows with neither topic nor title their own bucket (no catch-all)', () => {
    const groups = groupNotifications([
      n({ id: 'x', type: '', title: '' }),
      n({ id: 'y', type: '', title: '' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.items.length === 1)).toBe(true);
  });

  it('returns no groups for an empty list', () => {
    expect(groupNotifications([])).toEqual([]);
  });
});

describe('objectui#5203 — `actor_name` is not part of InboxNotification', () => {
  it('TYPE PIN: re-declaring the field fails this file', () => {
    const row: InboxNotification = {
      id: 'n1',
      type: 'collab.assignment',
      title: 'Assigned to you',
      // @ts-expect-error objectui#5203 removed `actor_name` from the shape — it
      // had no producer (`mergeInboxRows` never mapped it), no consumer, and no
      // column on `sys_inbox_message` to map FROM. Re-declaring it makes this
      // line compile and fails the pin.
      actor_name: 'Li Si',
    };
    // Same discipline as the objectui#5190 pin in
    // `InboxPopover.linklessFallback.test.tsx`: the assertion above is erased at
    // runtime, so `tsc -p tsconfig.test.json` (this package's `type-check`
    // script, and the CI `Type Check` job) is what actually checks it. The
    // runtime line below only keeps the suite honest about having run.
    expect(row.id).toBe('n1');
  });

  it('groups a row that carries the retired key anyway, ignoring it', () => {
    // A stray row from some future producer cannot resurrect the field by
    // arriving with it: grouping keys off `(type, title)` and the key is simply
    // not part of the contract. Cast because the shape no longer declares it.
    const stray = { ...n({ id: 's1' }), actor_name: 'Li Si' } as InboxNotification;
    const groups = groupNotifications([stray, n({ id: 's2' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual(['s1', 's2']);
  });
});
