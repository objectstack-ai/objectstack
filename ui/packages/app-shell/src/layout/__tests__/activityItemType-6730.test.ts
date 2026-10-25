/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#6730 — the shell's `sys_activity.type` reading, pinned; and the
 * reason it is NOT the same reading `record:activity` uses.
 *
 * ## What this suite is for
 *
 * The card is a DRIFT card, not a bug report: before this PR nothing on either
 * side of the repo failed when the two hand-written readings of one column
 * disagreed, and they already had (`scheduled` reached the console record page
 * after objectui#5878 and never reached the bell). A second table is only safe
 * if something red-flags the disagreement, so this file is the instrument that
 * makes two vocabularies a DECISION rather than an accident:
 *
 *  1. the shell's table is TOTAL over the column's declared vocabulary, read
 *     from plugin-detail's real `ACTIVITY_TYPE_TO_FEED_TYPE` rather than from a
 *     hand-copied list — a new built-in upstream turns this red;
 *  2. the two readings DISAGREE in three specific, measured ways, so a future
 *     "just call `activityRowToFeedItem`" cleanup turns this red and reads why;
 *  3. the unrecognised case is explicit and is not `update`;
 *  4. the third copy of the `"NOW()"` timestamp quirk agrees with the folded
 *     copy objectui#5896 produced, value for value.
 *
 * ## Resolution note (why no build is needed to run this)
 *
 * `vitest.config.mts` aliases `@object-ui/plugin-detail` to
 * `packages/plugin-detail/src`, so both imports below read SOURCE, not `dist`.
 * `activityTimestamp` is not on plugin-detail's barrel (objectui#5896 published
 * the whole `FeedItem` reading on purpose, not its pieces) so it is reached by
 * the same relative-src shape another cross-package pin in this package already
 * uses (`anonSeedScope-5746.enumeration.test.tsx` -> `auth/src`). A test-only
 * edge: this is a devDependency, and no runtime import of plugin-detail exists
 * in the shell's header chrome — which is the whole point of pinning instead of
 * importing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ACTIVITY_TYPE_TO_FEED_TYPE } from '@object-ui/plugin-detail';
import type { SysActivityRow } from '@object-ui/plugin-detail';
import { activityTimestamp } from '../../../../plugin-detail/src/renderers/recordActivityFeed';
import {
  ACTIVITY_TYPE_TO_ACTIVITY_ITEM_TYPE,
  UNMAPPED_ACTIVITY_ITEM_TYPE,
  activityItemTypeOf,
  activityRowTimestamp,
  activityRowToActivityItem,
  resetUnmappedActivityTypeWarnings,
} from '../activityItemType';
import type { ActivityItemType } from '../activityItemType';

/**
 * The `unit` project runs with `isolate: false`, so this module's warn-once
 * bucket is shared with every other file in the worker. Clearing it per test is
 * what makes "warns once" assertable at all.
 */
beforeEach(() => {
  resetUnmappedActivityTypeWarnings();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the mapping is pinned for every type the column can carry', () => {
  /**
   * The whole table, spelled out. Not a loop over the source object — that
   * would pass whatever the source says. Changing any line here is meant to be
   * a decision somebody wrote down.
   */
  it('maps every declared value explicitly', () => {
    expect(ACTIVITY_TYPE_TO_ACTIVITY_ITEM_TYPE).toEqual({
      // The record's own stored state changed, split by which way. This is
      // plugin-detail's `field_change` group, refined.
      created: 'create',
      updated: 'update',
      deleted: 'delete',
      assigned: 'update',
      shared: 'update',
      // Somebody said something. plugin-detail drops these on purpose.
      commented: 'comment',
      mentioned: 'comment',
      // No honest create/update/delete/comment presentation exists for these.
      // Every one of them claimed `update` before objectui#6730.
      system: 'system',
      completed: 'system',
      scheduled: 'system',
      login: 'system',
      logout: 'system',
    });
  });

  /**
   * The superset pin (`map ⊇ built-ins`), measured against the other reading's
   * real table rather than a copied list — the same shape objectui#5969 landed
   * on for that side. It is deliberately ONE-directional: `sys_activity.type`
   * is author-extensible (objectstack#11507 direction 4, ruled 2026-08-24), so
   * an equality pin would be false by construction.
   */
  it('has an entry for every value the platform declares', () => {
    const builtIns = Object.keys(ACTIVITY_TYPE_TO_FEED_TYPE);
    // The control: the upstream table is non-empty and reachable, so an empty
    // `missing` below is an answer rather than an artefact of a failed import.
    expect(builtIns.length).toBeGreaterThan(8);
    expect(builtIns).toContain('scheduled');

    const missing = builtIns.filter(
      (t) => !Object.prototype.hasOwnProperty.call(ACTIVITY_TYPE_TO_ACTIVITY_ITEM_TYPE, t),
    );
    expect(missing).toEqual([]);
  });

  it('every entry resolves through the reading, and `scheduled` is no longer an update', () => {
    for (const [raw, expected] of Object.entries(ACTIVITY_TYPE_TO_ACTIVITY_ITEM_TYPE)) {
      expect(activityItemTypeOf(raw)).toBe(expected);
    }
    // The value objectui#5878 fixed on the console record page and left broken
    // here — the card's second finding, pinned by name.
    expect(activityItemTypeOf('scheduled')).not.toBe('update');
  });
});

describe('the unrecognised case is explicit, and it is a bucket rather than a claim', () => {
  it('renders an author-extended value through the generic bucket', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(activityItemTypeOf('contract_countersigned')).toBe(UNMAPPED_ACTIVITY_ITEM_TYPE);
    // The regression this card is about: it used to be a specific, wrong claim.
    expect(activityItemTypeOf('contract_countersigned')).not.toBe('update');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('contract_countersigned');
  });

  it('is a bucket, NOT a drop — the row still reaches the surface', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const item = activityRowToActivityItem({
      id: 'a1',
      type: 'contract_countersigned',
      summary: 'Countersigned by Legal',
      object_name: 'crm_contract',
      actor_name: 'Zhang San',
      timestamp: '2026-08-20T10:00:00Z',
    });
    expect(item).not.toBeNull();
    expect(item?.type).toBe(UNMAPPED_ACTIVITY_ITEM_TYPE);
    expect(item?.description).toBe('Countersigned by Legal');
  });

  it('warns ONCE per distinct value, and never for a value the table maps', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 5; i++) activityItemTypeOf('teleported');
    expect(warn).toHaveBeenCalledTimes(1);

    activityItemTypeOf('beamed_up');
    expect(warn).toHaveBeenCalledTimes(2);

    // `system` produces the SAME value as the fallback and is still a decision,
    // so it must stay silent. This is why the reading asks `hasOwnProperty`
    // instead of comparing its result to the bucket.
    activityItemTypeOf('system');
    activityItemTypeOf('scheduled');
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('⛔ the two readings CROSS — this is why they are not converged', () => {
  /**
   * Each assertion below is one half of the answer to the card's first
   * question. If a future change makes any of them false, converging the two
   * surfaces may be back on the table — but it is a decision, taken here.
   */
  it('`FeedItem` is coarser: create/update/delete all collapse to one feed type', () => {
    const collapsed = ['created', 'updated', 'deleted', 'assigned', 'shared'];
    const feedTypes = new Set(collapsed.map((t) => ACTIVITY_TYPE_TO_FEED_TYPE[t]));
    expect(feedTypes).toEqual(new Set(['field_change']));

    // …while this vocabulary splits the same five three ways. Routing through
    // `activityRowToFeedItem` would make every create and every delete arrive
    // as an update, because `field_change` cannot be decomposed.
    const itemTypes = new Set(collapsed.map((t) => ACTIVITY_TYPE_TO_ACTIVITY_ITEM_TYPE[t]));
    expect(itemTypes).toEqual(new Set<ActivityItemType>(['create', 'update', 'delete']));
  });

  it('`FeedItem` drops what this vocabulary names: comments', () => {
    // A deliberate `undefined` on the other side — that content lives in
    // `sys_comment`. `activityRowToFeedItem` returns null for these rows.
    expect(ACTIVITY_TYPE_TO_FEED_TYPE.commented).toBeUndefined();
    expect(ACTIVITY_TYPE_TO_FEED_TYPE.mentioned).toBeUndefined();
    // Here they are one of the four presentation kinds. Converging would cost
    // the bell's Activity tab every comment row.
    expect(activityItemTypeOf('commented')).toBe('comment');
    expect(activityItemTypeOf('mentioned')).toBe('comment');
  });

  it('`FeedItem` is finer where this vocabulary is coarse', () => {
    const finer = ['system', 'completed', 'scheduled'];
    expect(new Set(finer.map((t) => ACTIVITY_TYPE_TO_FEED_TYPE[t])).size).toBe(3);
    expect(new Set(finer.map((t) => ACTIVITY_TYPE_TO_ACTIVITY_ITEM_TYPE[t])).size).toBe(1);
  });
});

describe('the `"NOW()"` quirk agrees with the copy objectui#5896 folded', () => {
  /**
   * The whole input table of the quirk, asserted against BOTH implementations.
   * Two copies of a five-line predicate are only safe while something says they
   * still agree; there is no package that owns "how to read a `sys_activity`
   * column" for both a widget plugin and the shell's chrome, so this pin is the
   * instrument until there is one.
   */
  const CASES: readonly SysActivityRow[] = [
    { timestamp: '2026-08-20T10:00:00Z', created_at: '2026-01-01T00:00:00Z' },
    { timestamp: 'NOW()', created_at: '2026-01-01T00:00:00Z' },
    { timestamp: 'NOW()', created_at: null },
    { timestamp: '', created_at: '2026-01-01T00:00:00Z' },
    { timestamp: null, created_at: '2026-01-01T00:00:00Z' },
    { timestamp: undefined, created_at: '2026-01-01T00:00:00Z' },
    { timestamp: 'not a date', created_at: '2026-01-01T00:00:00Z' },
    { timestamp: undefined, created_at: undefined },
    { timestamp: 'NOW()', created_at: undefined },
  ];

  it('produces the same string as `activityTimestamp` for every input', () => {
    for (const row of CASES) {
      expect(activityRowTimestamp(row)).toBe(activityTimestamp(row));
    }
  });

  it('resolves the sentinel to `created_at`, and a real timestamp to itself', () => {
    // Stated independently so this suite still says what the behaviour IS if
    // both copies ever drift together.
    expect(activityRowTimestamp({ timestamp: 'NOW()', created_at: '2026-01-01T00:00:00Z' }))
      .toBe('2026-01-01T00:00:00Z');
    expect(activityRowTimestamp({ timestamp: '2026-08-20T10:00:00Z', created_at: 'x' }))
      .toBe('2026-08-20T10:00:00Z');
    expect(activityRowTimestamp({ timestamp: 'NOW()' })).toBe('');
  });
});

describe('the row constructor keeps what `mapActivityRows` used to do inline', () => {
  it('maps plugin-audit column names onto the item shape', () => {
    expect(
      activityRowToActivityItem({
        id: 7,
        type: 'created',
        summary: 'Created the lead',
        object_name: 'crm_lead',
        record_id: 42,
        actor_name: 'Li Si',
        timestamp: '2026-08-20T10:00:00Z',
      }),
    ).toEqual({
      id: '7',
      type: 'create',
      objectName: 'crm_lead',
      recordId: '42',
      user: 'Li Si',
      description: 'Created the lead',
      timestamp: '2026-08-20T10:00:00Z',
    });
  });

  it('rejects rows that name no action or say nothing', () => {
    expect(activityRowToActivityItem(null)).toBeNull();
    expect(activityRowToActivityItem('nope')).toBeNull();
    expect(activityRowToActivityItem({ id: '1', summary: 'no type' })).toBeNull();
    expect(activityRowToActivityItem({ id: '1', type: 'created' })).toBeNull();
    expect(activityRowToActivityItem({ id: '1', type: 'created', summary: '   ' })).toBeNull();
  });
});
