/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:activity` — the declared filters actually filter (objectui#3165).
 *
 * These assert the pure half directly: the `sys_activity` → `FeedItem` map and
 * `applyFeedConfig`. Asserting them here rather than only through the DOM is
 * deliberate — the defect #3165 fixes was that `types` / `limit` /
 * `showCompleted` / `unifiedTimeline` were DECLARED inputs with nothing behind
 * them, and "the panel rendered something" is exactly the evidence that stayed
 * green while that was true.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { FeedFilterMode as SpecFilterMode, FeedItemType as SpecFeedItemType } from '@objectstack/spec/data';
import type { FeedItem } from '@object-ui/types';
import {
  ACTIVITY_TYPE_TO_FEED_TYPE,
  DEFAULT_ACTIVITY_LIMIT,
  activityRowToFeedItem,
  activityTimestamp,
  applyFeedConfig,
  mergeFeedItems,
  normalizeFeedTypes,
  normalizeFilterMode,
  normalizeLimit,
  DELIBERATELY_UNADOPTED_FEED_TYPES,
  PRODUCED_FEED_TYPES,
  resetUnknownActivityTypeWarnings,
  resetUnproducedFeedTypeWarnings,
  resetUnrecognisedFeedTypeWarnings,
  resetUnrecognisedFilterModeWarnings,
  UNMAPPED_ACTIVITY_FEED_TYPE,
} from '../recordActivityFeed';

const item = (over: Partial<FeedItem> & Pick<FeedItem, 'id' | 'type'>): FeedItem => ({
  actor: 'Ada',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

/**
 * The platform's BUILT-IN `sys_activity.type` set.
 *
 * ## Provenance — read this before editing the list
 *
 * Source: objectstack `packages/plugins/plugin-audit/src/objects/sys-activity.object.ts`,
 * the `type: Field.select([...])` declaration. Read at objectstack commit
 * `91b1342` ("declare sys_activity.type 'scheduled' and record its writer",
 * objectstack#11522) on 2026-08-24. That file is the ONLY declaration of this
 * vocabulary in the platform — `@objectstack/spec` declares `FeedItemType`, the
 * vocabulary this map's VALUES come from, and never the keys.
 *
 * ## Why it is a hand census and not a live read
 *
 * There is no live source for it in reach: `@objectstack/plugin-audit` is a
 * server plugin, and the packages this repo depends on (`@objectstack/spec`,
 * `client`, `formula`, `lint`) do not carry the declaration. Reading it live
 * would mean a UI package taking a dependency on a services plugin.
 *
 * ⚠️ So this list CAN go stale, and measurably has: `scheduled` was declared
 * upstream on 2026-08-24 and the previous census still had it filed as
 * "undeclared but written". Two things keep that from being a data loss rather
 * than a labelling one, and both are load-bearing:
 *
 *  1. the fallback below — an undeclared or newly-declared value RENDERS, so a
 *     stale census costs a specific icon, never a vanished row; and
 *  2. objectstack#11807 — the platform-side ask to publish this vocabulary
 *     where a UI package can read it, which is what would let this list be
 *     deleted.
 *
 * ⛔ Do not derive this list from `ACTIVITY_TYPE_TO_FEED_TYPE`. A pin that reads
 * its expectation out of the thing it is pinning cannot fail.
 */
const PLATFORM_BUILTIN_ACTIVITY_TYPES = [
  'assigned', 'commented', 'completed', 'created', 'deleted', 'login',
  'logout', 'mentioned', 'scheduled', 'shared', 'system', 'updated',
] as const;

/**
 * A value no built-in declares — what an author extends the column with.
 *
 * `sys_activity.type` is author-extensible (objectstack#11507, ruled direction
 * 4 on 2026-08-24): every field on the object is `readonly: true`, objectql's
 * `validateRecord` skips readonly fields on both write branches, and ADR-0052
 * §5b.2 forwards an author's `activityMilestones[].type` into the column
 * verbatim. So a value like this is STORED, queryable, and legitimate.
 */
const AUTHOR_EXTENDED_TYPE = 'crm_contract_signed';

describe('sys_activity row → FeedItem', () => {
  /**
   * SUPERSET, one direction only: **the map covers every built-in**.
   *
   * In words, because the direction is easy to get backwards: every value the
   * platform DECLARES must have an entry in `ACTIVITY_TYPE_TO_FEED_TYPE` — a
   * feed type, or a deliberate `undefined` exclusion. A new built-in with no
   * entry turns this red, which is what forces the map to keep up.
   *
   * ⛔ The converse — every map key must be declared upstream — is NOT asserted,
   * and neither is set equality in any spelling. Under the objectstack#11507
   * direction-4 ruling (2026-08-24) `sys_activity.type` is author-extensible,
   * so map keys outside the declaration are legitimate by construction.
   * objectui#5840 removed the old equality pin because pinning to the closed
   * declaration meant dropping stored rows; ⛔ do not put it back. What replaces
   * it is this leg plus the fallback leg below — either alone is worse than
   * neither: a superset pin on its own re-creates the closed-vocabulary
   * failure slowly, and a fallback on its own lets the map fall behind.
   */
  it('covers every BUILT-IN type — superset, not equality (objectstack#11507)', () => {
    for (const type of PLATFORM_BUILTIN_ACTIVITY_TYPES) {
      expect(
        Object.prototype.hasOwnProperty.call(ACTIVITY_TYPE_TO_FEED_TYPE, type),
        `'${type}' is declared by plugin-audit's sys_activity.type and has no entry in `
          + 'ACTIVITY_TYPE_TO_FEED_TYPE. Every built-in needs a decision here: a feed '
          + 'type, or an explicit `undefined` that says the exclusion was meant.',
      ).toBe(true);
    }
    for (const mapped of Object.values(ACTIVITY_TYPE_TO_FEED_TYPE)) {
      if (mapped) expect(SpecFeedItemType.options).toContain(mapped);
    }
  });

  it('does NOT require the map to be contained by the declaration', () => {
    // The other direction, stated as an assertion rather than as a comment so
    // that "re-add the equality check" has to delete a passing test to happen.
    // An author-extended value has no entry and still renders (see the fallback
    // leg), and a mapped key that upstream later drops is not an error here.
    const declared = new Set<string>(PLATFORM_BUILTIN_ACTIVITY_TYPES);
    expect(declared.has(AUTHOR_EXTENDED_TYPE)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(
      ACTIVITY_TYPE_TO_FEED_TYPE, AUTHOR_EXTENDED_TYPE,
    )).toBe(false);
    expect(activityRowToFeedItem({ id: 'ext', type: AUTHOR_EXTENDED_TYPE }, 'System'))
      .not.toBeNull();
  });

  /**
   * Regression control on the map's OWN table, not on the platform's.
   *
   * This is `toEqual` over the map and it is deliberately not the pin the
   * ruling forbids: it compares the map to the readings this repo recorded, so
   * a future edit that RE-POINTS or drops an existing type has to say so here.
   * It says nothing about which values the platform declares — that is the
   * superset leg above, and only that leg moves when upstream moves.
   */
  it('leaves every mapped type pointing where it did', () => {
    expect({ ...ACTIVITY_TYPE_TO_FEED_TYPE }).toEqual({
      created: 'field_change',
      updated: 'field_change',
      deleted: 'field_change',
      assigned: 'field_change',
      shared: 'field_change',
      system: 'system',
      completed: 'task',
      scheduled: 'event',
      commented: undefined,
      mentioned: undefined,
      login: undefined,
      logout: undefined,
    });
  });

  it('drops the rows that are not record activity', () => {
    for (const type of ['commented', 'mentioned', 'login', 'logout']) {
      expect(activityRowToFeedItem({ id: '1', type }, 'System')).toBeNull();
    }
  });

  it('carries actor, summary and the ADR-0052 source pointer onto the feed item', () => {
    const mapped = activityRowToFeedItem(
      {
        id: 'act-1',
        type: 'updated',
        summary: 'Stage: draft → qualified',
        timestamp: '2026-03-04T05:06:07.000Z',
        actor_name: 'Grace',
        actor_avatar_url: 'https://example.test/g.png',
        source_object: 'sys_email',
        source_id: 'email-9',
      },
      'System',
    );
    expect(mapped).toEqual({
      id: 'act-1',
      type: 'field_change',
      actor: 'Grace',
      actorAvatarUrl: 'https://example.test/g.png',
      body: 'Stage: draft → qualified',
      createdAt: '2026-03-04T05:06:07.000Z',
      sourceObject: 'sys_email',
      sourceId: 'email-9',
    });
  });

  it('falls back to the system actor label when the row has no actor', () => {
    expect(activityRowToFeedItem({ id: 'a', type: 'system' }, '系统')?.actor).toBe('系统');
  });

  it('falls back to created_at when the driver leaked the literal NOW() default', () => {
    expect(activityTimestamp({ timestamp: 'NOW()', created_at: '2026-02-02T00:00:00.000Z' }))
      .toBe('2026-02-02T00:00:00.000Z');
    expect(activityTimestamp({ timestamp: null, created_at: '2026-02-03T00:00:00.000Z' }))
      .toBe('2026-02-03T00:00:00.000Z');
  });
});

/**
 * objectui#5840 — a `scheduled` meeting reaches the timeline, and the fix is an
 * ADDITION rather than a loosening.
 *
 * Both directions are asserted on purpose. "`scheduled` now renders" alone
 * would stay green if the map had been replaced by a catch-all bucket, which is
 * the wrong fix (an unmeasured type rendering as `system` is new wrong data,
 * not recovered data). So the unknown-type leg below is not decoration: it is
 * what makes the pair discriminate between the fix that was made and the fix
 * that was rejected.
 *
 * ⚠️ objectui#5969 changed what that unknown-type leg asserts, and the reason
 * the sentence above survives is that the objection it records still stands.
 * Under the objectstack#11507 direction-4 ruling an unknown value now renders
 * through a defined FALLBACK rather than being dropped — but a catch-all is
 * still not a substitute for reading a type and mapping it, which is why the
 * superset leg exists and why `scheduled` keeps its own `event` presentation
 * here instead of landing in the bucket. The pair still discriminates; what it
 * discriminates between is now "mapped on purpose" and "shown pending a
 * decision", rather than "mapped on purpose" and "invisible".
 */
describe('a scheduled activity reaches the feed (objectui#5840)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetUnknownActivityTypeWarnings();
  });

  it('maps a scheduled meeting row onto an `event` feed item, carrying its ADR-0052 pointer', () => {
    const mapped = activityRowToFeedItem(
      {
        id: 'act-9',
        type: 'scheduled',
        summary: 'Discovery call (30 min)',
        timestamp: '2026-04-01T09:00:00.000Z',
        actor_name: 'Grace',
        source_object: 'crm_event',
        source_id: 'evt-3',
      },
      'System',
    );
    expect(mapped).toEqual({
      id: 'act-9',
      type: 'event',
      actor: 'Grace',
      actorAvatarUrl: undefined,
      body: 'Discovery call (30 min)',
      createdAt: '2026-04-01T09:00:00.000Z',
      sourceObject: 'crm_event',
      sourceId: 'evt-3',
    });
  });

  it('produces a feed type the spec actually declares, so `types` can name it', () => {
    // The other half of #5840's complaint: `event` was a declared FeedItemType
    // that nothing could produce, so `types: ['event']` was a permanently empty
    // tab. It is reachable now.
    expect(SpecFeedItemType.options).toContain('event');
    expect(ACTIVITY_TYPE_TO_FEED_TYPE.scheduled).toBe('event');
  });

  const scheduledItem: FeedItem = item({ id: 'e1', type: 'event' });

  it('survives the default filters — an upcoming meeting is not "completed"', () => {
    // Reaching activityRowToFeedItem is not enough: the row is only visible if
    // it also survives the pipeline every page runs. `showCompleted` defaults
    // to false, and a scheduled meeting must NOT be caught by it — that is the
    // whole difference from the held branch of the same producer.
    expect(applyFeedConfig([scheduledItem], {}, 50, 'record:activity').items.map((i) => i.id)).toEqual(['e1']);
  });

  it('survives `types: [\'event\']`, the filter an author writes to show meetings', () => {
    expect(applyFeedConfig([scheduledItem], { types: ['event'] }, 50, 'record:activity').items.map((i) => i.id))
      .toEqual(['e1']);
  });

  it('survives unifiedTimeline:false — a meeting is not a field change', () => {
    expect(applyFeedConfig([scheduledItem], { unifiedTimeline: false }, 50, 'record:activity').items.map((i) => i.id))
      .toEqual(['e1']);
  });

  it('is excluded when the author asks for other kinds, like any other item', () => {
    // Control for the three legs above: they pass because `event` is genuinely
    // carried through the pipeline, not because the pipeline stopped filtering.
    expect(applyFeedConfig([scheduledItem], { types: ['comment'] }, 50, 'record:activity').items).toEqual([]);
  });

  /**
   * FALLBACK leg of the objectstack#11507 pin — the second half of the ruling.
   *
   * The observable is POSITIVE, not "did not throw": the row is present, it
   * carries its own summary and actor, and its feed type is the declared
   * fallback. "Unknown types do not crash" would also be true of a feed that
   * drops every row, which is exactly what this replaces.
   *
   * The counter-probe rides in the same run: a built-in with its own reading
   * still gets THAT reading, not the bucket. Without it, a map replaced
   * wholesale by the fallback would read as green here.
   */
  it('RENDERS an author-extended type through the fallback presentation', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mapped = activityRowToFeedItem(
      {
        id: 'ext-1',
        type: AUTHOR_EXTENDED_TYPE,
        summary: 'Contract countersigned',
        timestamp: '2026-05-06T07:08:09.000Z',
        actor_name: 'Grace',
      },
      'System',
    );
    // Present, and carrying the row — not a husk, and not `null`.
    expect(mapped).not.toBeNull();
    expect(mapped).toMatchObject({
      id: 'ext-1',
      type: UNMAPPED_ACTIVITY_FEED_TYPE,
      actor: 'Grace',
      body: 'Contract countersigned',
      createdAt: '2026-05-06T07:08:09.000Z',
    });

    // COUNTER-PROBE — a built-in keeps its own presentation, so "everything
    // renders" cannot be reached by pointing the whole map at the fallback.
    expect(activityRowToFeedItem({ id: 'b1', type: 'created' }, 'System')?.type)
      .toBe('field_change');
    expect(activityRowToFeedItem({ id: 'b2', type: 'scheduled' }, 'System')?.type)
      .toBe('event');
    // ...and the fallback is DISTINGUISHABLE from the one it was compared with.
    expect(UNMAPPED_ACTIVITY_FEED_TYPE).not.toBe('field_change');

    // Shown, but not silently: the missing decision is still announced once.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(AUTHOR_EXTENDED_TYPE);
  });

  it('renders a row whose type is missing entirely rather than dropping it', () => {
    // A stored row with no `type` is still a stored row. Same posture: visible
    // through the fallback, announced once.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(activityRowToFeedItem({ id: 'z2', summary: 'no type' }, 'System'))
      .toMatchObject({ id: 'z2', type: UNMAPPED_ACTIVITY_FEED_TYPE, body: 'no type' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns once per unknown type, not once per row', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 5; i += 1) {
      expect(activityRowToFeedItem({ id: `z${i}`, type: 'teleported' }, 'System'))
        .not.toBeNull();
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('teleported');
  });

  it('stays SILENT for the types it deliberately drops', () => {
    // A warning about a decision teaches authors to ignore the channel. Only a
    // value outside the table entirely is a missing decision.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const type of ['commented', 'mentioned', 'login', 'logout']) {
      expect(activityRowToFeedItem({ id: '1', type }, 'System')).toBeNull();
    }
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('input normalisation reads its vocabulary from the spec', () => {
  it('accepts every FeedFilterMode the spec declares, and only those', () => {
    // Spied and reset because the unrecognised legs below now also emit a
    // diagnostic (objectui#5891). This case pins the RETURN VALUE only; the
    // emission is pinned in its own suite, which owns the dedupe bucket.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const mode of SpecFilterMode.options) {
      expect(normalizeFilterMode(mode, 'record:activity')).toBe(mode);
    }
    // An unrecognised value is SKIPPED, not passed through — a <Select> handed
    // a value with no matching item renders blank (objectui#3151's posture).
    expect(normalizeFilterMode('x', 'record:activity')).toBe('all');
    expect(normalizeFilterMode(undefined, 'record:activity')).toBe('all');
    expect(normalizeFilterMode(7, 'record:activity')).toBe('all');
    resetUnrecognisedFilterModeWarnings();
    warn.mockRestore();
  });

  it('accepts every FeedItemType the spec declares, read from the spec itself', () => {
    // The allow-list vocabulary is never hand-typed here: a pin that re-states
    // the enum it is pinning cannot fail when the enum moves.
    //
    // The warn is muted rather than asserted here: naming all thirteen kinds
    // reaches the unproduced-kind channel (objectui#5877), which has its own
    // suite below. What THIS test is about is that all thirteen are ACCEPTED,
    // and they still are — the diagnostic changes nothing about the return.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const declared = [...SpecFeedItemType.options];
    expect(normalizeFeedTypes(declared, 'record:activity')).toEqual(declared);
    resetUnproducedFeedTypeWarnings();
    warn.mockRestore();
  });

  it('distinguishes "no `types` authored" from "nothing survived" (objectui#5841)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // `undefined` is now reserved for ONE meaning: the author wrote no filter.
    expect(normalizeFeedTypes(undefined, 'record:activity')).toBeUndefined();
    expect(normalizeFeedTypes(null, 'record:activity')).toBeUndefined();

    // Everything else is an authored filter, and an authored filter that keeps
    // nothing is `[]` — a filter that selects nothing, never "no filter".
    expect(normalizeFeedTypes([], 'record:activity')).toEqual([]);
    expect(normalizeFeedTypes(['crm_task'], 'record:activity')).toEqual([]);
    expect(normalizeFeedTypes(['comment', 'crm_task', 'task'], 'record:activity')).toEqual(['comment', 'task']);

    // Brackets dropped. Also refused rather than ignored: `types` that cannot be
    // read is not a request to remove the filter.
    expect(normalizeFeedTypes('comment', 'record:activity')).toEqual([]);

    resetUnrecognisedFeedTypeWarnings();
    warn.mockRestore();
  });

  it('admits only a positive integer NUMBER as `limit`, defaulting to the spec default', () => {
    // ⚠️ These four refused values are NOT this resolver's coverage, and reading
    // them as such is how objectui#10096 survived: `0`, `-3`, `undefined` and
    // `'lots'` all answer the default whether the resolver REFUSES a
    // non-integer or FLOORS one, so as a set they cannot tell the two apart.
    // The cases that discriminate live in
    // `recordActivityFeed.rowLimitRefusal-10096.test.tsx`; keep them there
    // rather than assuming this list grew to cover them.
    expect(normalizeLimit(5)).toBe(5);
    // objectui#10145 (ruled STOP): a numeric STRING is a value the spec refuses
    // (`z.number()`), so it is no longer read — it falls back like any other
    // refused value. Flipped from `.toBe(5)`; the lit control is the line above.
    expect(normalizeLimit('5')).toBe(DEFAULT_ACTIVITY_LIMIT);
    expect(normalizeLimit(0)).toBe(DEFAULT_ACTIVITY_LIMIT);
    expect(normalizeLimit(-3)).toBe(DEFAULT_ACTIVITY_LIMIT);
    expect(normalizeLimit(undefined)).toBe(DEFAULT_ACTIVITY_LIMIT);
    expect(normalizeLimit('lots')).toBe(DEFAULT_ACTIVITY_LIMIT);
    expect(DEFAULT_ACTIVITY_LIMIT).toBe(20); // @objectstack/spec RecordActivityProps.limit
  });
});

describe('applyFeedConfig — the declared inputs change what is rendered', () => {
  const feed: FeedItem[] = [
    item({ id: 'c1', type: 'comment', createdAt: '2026-01-01T00:00:00.000Z' }),
    item({ id: 'f1', type: 'field_change', createdAt: '2026-01-02T00:00:00.000Z' }),
    item({ id: 't1', type: 'task', createdAt: '2026-01-03T00:00:00.000Z' }),
    item({ id: 's1', type: 'system', createdAt: '2026-01-04T00:00:00.000Z' }),
  ];
  const ids = (f: { items: FeedItem[] }) => f.items.map((i) => i.id);

  it('shows everything but completed activities by default (spec: showCompleted=false)', () => {
    expect(ids(applyFeedConfig(feed, {}, 50, 'record:activity'))).toEqual(['c1', 'f1', 's1']);
  });

  it('showCompleted:true admits the completed activities', () => {
    expect(ids(applyFeedConfig(feed, { showCompleted: true }, 50, 'record:activity'))).toEqual(['c1', 'f1', 't1', 's1']);
  });

  it('unifiedTimeline:false un-mixes field changes from the comment stream', () => {
    expect(ids(applyFeedConfig(feed, { unifiedTimeline: false, showCompleted: true }, 50, 'record:activity')))
      .toEqual(['c1', 't1', 's1']);
    // …and true is the spec default, i.e. mixed.
    expect(ids(applyFeedConfig(feed, { unifiedTimeline: true, showCompleted: true }, 50, 'record:activity')))
      .toEqual(['c1', 'f1', 't1', 's1']);
  });

  it('types is an allow-list over feed item types', () => {
    expect(ids(applyFeedConfig(feed, { types: ['comment'] }, 50, 'record:activity'))).toEqual(['c1']);
    expect(ids(applyFeedConfig(feed, { types: ['comment', 'system'] }, 50, 'record:activity'))).toEqual(['c1', 's1']);
  });

  it('a `types` list of nothing but typos renders nothing, not everything (objectui#5841)', () => {
    // Replaces the pin that asserted the opposite. That expectation WAS the
    // defect: `['commnet']` selected no kind, and serving every kind instead is
    // the one answer the author cannot have meant.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(ids(applyFeedConfig(feed, { types: ['commnet'] }, 50, 'record:activity'))).toEqual([]);
    resetUnrecognisedFeedTypeWarnings();
    warn.mockRestore();
  });

  it('limit pages the feed newest-first and reports hasMore', () => {
    const page = applyFeedConfig(feed, { showCompleted: true }, 2, 'record:activity');
    // Chronological render order, but the PAGE is the newest two.
    expect(ids(page)).toEqual(['t1', 's1']);
    expect(page.total).toBe(4);
    expect(page.hasMore).toBe(true);

    const all = applyFeedConfig(feed, { showCompleted: true }, 4, 'record:activity');
    expect(all.hasMore).toBe(false);
  });

  it('counts the page AFTER filtering, so limit means "items the author sees"', () => {
    // 3 comments + 3 field changes; with field changes excluded a limit of 3
    // must yield all three comments, not "3 of the 6 raw rows".
    const mixed: FeedItem[] = [
      item({ id: 'c1', type: 'comment', createdAt: '2026-01-01T00:00:00.000Z' }),
      item({ id: 'f1', type: 'field_change', createdAt: '2026-01-02T00:00:00.000Z' }),
      item({ id: 'c2', type: 'comment', createdAt: '2026-01-03T00:00:00.000Z' }),
      item({ id: 'f2', type: 'field_change', createdAt: '2026-01-04T00:00:00.000Z' }),
      item({ id: 'c3', type: 'comment', createdAt: '2026-01-05T00:00:00.000Z' }),
      item({ id: 'f3', type: 'field_change', createdAt: '2026-01-06T00:00:00.000Z' }),
    ];
    const page = applyFeedConfig(mixed, { unifiedTimeline: false }, 3, 'record:activity');
    expect(ids(page)).toEqual(['c1', 'c2', 'c3']);
    expect(page.hasMore).toBe(false);
  });

  it('never mutates the feed it was handed', () => {
    const source = feed.slice();
    applyFeedConfig(source, { types: ['comment'] }, 1, 'record:activity');
    expect(source).toHaveLength(4);
  });
});

/**
 * objectui#5841 — a sanitiser may NARROW an author's request or refuse it, but
 * it must never silently WIDEN it.
 *
 * Three authored intents used to collapse into one rendering, and the collapse
 * was invisible because its result was PLAUSIBLE: a populated timeline reads as
 * working, so a page shipped for as long as nobody counted the rows. The table
 * below is the ruled behaviour, and the two controls are what stop the suite
 * from passing for the wrong reason — "renders empty" is trivially satisfiable
 * by a pipeline that has stopped filtering at all, so a run that did not also
 * pin the unchanged legs would not discriminate.
 */
describe('an unusable `types` filter narrows or refuses, never widens (objectui#5841)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetUnrecognisedFeedTypeWarnings();
  });

  const feed: FeedItem[] = [
    item({ id: 'c1', type: 'comment', createdAt: '2026-01-01T00:00:00.000Z' }),
    item({ id: 'f1', type: 'field_change', createdAt: '2026-01-02T00:00:00.000Z' }),
    item({ id: 's1', type: 'system', createdAt: '2026-01-03T00:00:00.000Z' }),
  ];
  const ids = (f: { items: FeedItem[] }) => f.items.map((i) => i.id);
  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

  /**
   * An object name where a feed kind belongs — the shape that was measured in a
   * real app. Its unrecognisedness is DERIVED from the spec, never asserted by
   * hand: if `crm_task` ever became a declared feed type this guard fails loudly
   * instead of the suite quietly testing nothing.
   */
  const UNRECOGNISED = 'crm_task';
  it('the value this suite treats as unrecognised is outside the spec vocabulary', () => {
    expect(SpecFeedItemType.options).not.toContain(UNRECOGNISED);
    expect(SpecFeedItemType.options).toContain('comment');
  });

  it('CONTROL — `types` omitted still means no filter: every kind renders', () => {
    expect(ids(applyFeedConfig(feed, {}, 50, 'record:activity'))).toEqual(['c1', 'f1', 's1']);
  });

  it('CONTROL — a recognised list still filters to exactly those kinds', () => {
    const warn = quiet();
    expect(ids(applyFeedConfig(feed, { types: ['comment', 'system'] }, 50, 'record:activity')))
      .toEqual(['c1', 's1']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('`types: []` filters to NOTHING — the author said "no kinds"', () => {
    expect(ids(applyFeedConfig(feed, { types: [] }, 50, 'record:activity'))).toEqual([]);
  });

  it('a list whose every member is unrecognised filters to NOTHING', () => {
    quiet();
    expect(ids(applyFeedConfig(feed, { types: [UNRECOGNISED] }, 50, 'record:activity'))).toEqual([]);
  });

  it('a MIXED list keeps the recognised members and drops the rest', () => {
    quiet();
    expect(ids(applyFeedConfig(feed, { types: ['comment', UNRECOGNISED] }, 50, 'record:activity')))
      .toEqual(['c1']);
  });

  it('`types` that is not a list at all is refused, not ignored', () => {
    // `types: 'comment'` — brackets dropped. The kind is spelled correctly, so
    // this cannot be caught by vocabulary alone; ignoring it rendered the whole
    // audit stream.
    quiet();
    expect(ids(applyFeedConfig(feed, { types: 'comment' }, 50, 'record:activity'))).toEqual([]);
  });

  it('names the unrecognised kinds, once, however many times the feed re-renders', () => {
    const warn = quiet();
    for (let i = 0; i < 5; i += 1) {
      applyFeedConfig(feed, { types: [UNRECOGNISED] }, 50, 'record:activity');
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(UNRECOGNISED);
    // The message is actionable: it carries the vocabulary the author needed.
    expect(String(warn.mock.calls[0][0])).toContain('comment');
  });

  it('names EVERY unrecognised kind in the list, in one diagnostic', () => {
    const warn = quiet();
    applyFeedConfig(feed, { types: [UNRECOGNISED, 'crm_deal', 'comment'] }, 50, 'record:activity');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(UNRECOGNISED);
    expect(String(warn.mock.calls[0][0])).toContain('crm_deal');
  });

  it('stays SILENT for a well-formed filter — including the empty one', () => {
    // `types: []` is honoured exactly, so there is nothing to report. Warning
    // about a request that was carried out teaches authors to ignore the channel
    // (same posture the unknown-activity-type warning takes above).
    //
    // ⚠️ This leg used to author `[...SpecFeedItemType.options]` — all thirteen
    // declared kinds — as its "well-formed" case. That is no longer silent, and
    // the change is the whole of objectui#5877: eight of the thirteen have no
    // producer on any ObjectUI surface, so a filter naming them selects nothing
    // and now says so on a SEPARATE channel (suite below). The property THIS
    // test exists for is untouched and is asserted on kinds that are actually
    // produced — a filter this pipeline can honour end to end stays quiet.
    const warn = quiet();
    applyFeedConfig(feed, {}, 50, 'record:activity');
    applyFeedConfig(feed, { types: [] }, 50, 'record:activity');
    applyFeedConfig(feed, { types: [...PRODUCED_FEED_TYPES] }, 50, 'record:activity');
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the two warning channels apart — one does not silence the other', () => {
    // The vocabularies overlap: `crm_task` is a plausible unmapped
    // `sys_activity.type` AND a plausible unrecognised `types` entry. A shared
    // dedupe bucket would let whichever fired first swallow the other.
    const warn = quiet();
    activityRowToFeedItem({ id: 'z', type: UNRECOGNISED }, 'System');
    applyFeedConfig(feed, { types: [UNRECOGNISED] }, 50, 'record:activity');
    expect(warn).toHaveBeenCalledTimes(2);
    resetUnknownActivityTypeWarnings();
  });
});

/**
 * objectui#5877 — a declared feed kind with no producer must not render a
 * permanently empty tab in silence.
 *
 * `types: ['approval']` parses, typechecks, builds and renders nothing, and
 * before this suite nothing anywhere said why. Both directions are asserted,
 * because a warn-on-everything implementation satisfies the first one alone:
 * an unproduced kind MUST warn, and a produced kind MUST NOT. The populations
 * are derived from the spec enum and from the producers themselves — a suite
 * that re-types the census cannot fail when the census moves.
 */
describe('a `types` entry naming a kind nothing produces says so (objectui#5877)', () => {
  beforeEach(() => {
    // The buckets are module state and earlier suites in this file author
    // thirteen-kind lists, so a fresh bucket is part of the fixture, not
    // cleanup — a poisoned bucket makes every assertion below vacuously pass.
    resetUnproducedFeedTypeWarnings();
    resetUnrecognisedFeedTypeWarnings();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetUnproducedFeedTypeWarnings();
    resetUnrecognisedFeedTypeWarnings();
  });

  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
  const said = (warn: ReturnType<typeof quiet>, call = 0) => String(warn.mock.calls[call]?.[0] ?? '');

  const declared = [...SpecFeedItemType.options];
  const produced = declared.filter((k) => PRODUCED_FEED_TYPES.has(k));
  const unproduced = declared.filter((k) => !PRODUCED_FEED_TYPES.has(k));

  const feed: FeedItem[] = [
    item({ id: 'c1', type: 'comment', createdAt: '2026-01-01T00:00:00.000Z' }),
    item({ id: 'f1', type: 'field_change', createdAt: '2026-01-02T00:00:00.000Z' }),
    item({ id: 's1', type: 'system', createdAt: '2026-01-03T00:00:00.000Z' }),
  ];

  /**
   * The census this card was dispatched to re-derive, pinned as SETS rather
   * than as a count so a red run names which kind moved.
   *
   * Measured on merge-base `e3d117ae1` over the whole repository (every
   * non-test `.ts`/`.tsx` under `packages/`, `apps/`, `examples/`, `scripts/`,
   * `e2e/`) — see `feedTypeProducerCensus-5877.test.ts`, which re-runs that
   * scan rather than trusting this list. Giving a kind a producer is meant to
   * turn this red: the census is the diagnostic's input, and it moving without
   * anyone noticing is exactly how the warn would start lying.
   */
  it('the census — 13 declared kinds, 5 produced, 8 not', () => {
    expect(declared).toHaveLength(13);
    expect(produced.slice().sort()).toEqual(['comment', 'event', 'field_change', 'system', 'task']);
    expect(unproduced.slice().sort()).toEqual([
      'approval', 'call', 'email', 'file', 'note', 'record_create', 'record_delete', 'sharing',
    ]);
  });

  it('`system` is PRODUCED — the unmapped fallback is a producer, not a gap', () => {
    // The correction that made this card's original census stale. #6112 gave
    // `activityRowToFeedItem` a defined fallback so an unclassified activity
    // type reports a MISSING DECISION instead of vanishing; a warn that fired
    // on `system` would contradict that design.
    const warn = quiet();
    expect(PRODUCED_FEED_TYPES.has(UNMAPPED_ACTIVITY_FEED_TYPE)).toBe(true);
    normalizeFeedTypes(['system'], 'record:activity');
    expect(warn).not.toHaveBeenCalled();
  });

  it('WARNS for a genuinely unproduced kind — the card\'s own example', () => {
    const warn = quiet();
    normalizeFeedTypes(['approval'], 'record:activity');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(said(warn)).toContain('"approval"');
    expect(said(warn)).toContain('NO PRODUCER');
  });

  it('CONTROL — stays SILENT for every produced kind, one at a time and together', () => {
    // The direction that fails a warn-on-everything implementation. Asserted
    // per kind AND as a list, because a whole-list check passes for an
    // implementation that warns on exactly one member.
    const warn = quiet();
    for (const kind of produced) normalizeFeedTypes([kind], 'record:activity');
    normalizeFeedTypes(produced, 'record:activity');
    expect(warn).not.toHaveBeenCalled();
  });

  it('CONTROL — every unproduced kind warns, one at a time', () => {
    // The mirror of the control above: no member of the unproduced set is
    // quietly exempt, so the diagnostic covers the population rather than the
    // one kind the first test happened to name.
    for (const kind of unproduced) {
      const warn = quiet();
      normalizeFeedTypes([kind], 'record:activity');
      expect(warn, `expected a diagnostic for the unproduced kind "${kind}"`).toHaveBeenCalledTimes(1);
      expect(said(warn)).toContain(`"${kind}"`);
      warn.mockRestore();
      resetUnproducedFeedTypeWarnings();
    }
  });

  it('reports a DELIBERATELY unadopted kind as a decision, never as a defect', () => {
    // The distinction the card turns on: `record_create` / `record_delete` /
    // `sharing` are not missing, they are not adopted, and reporting a decision
    // as a defect is how authors learn to ignore a channel.
    const warn = quiet();
    normalizeFeedTypes([...DELIBERATELY_UNADOPTED_FEED_TYPES], 'record:activity');
    expect(warn).toHaveBeenCalledTimes(1);
    const message = said(warn);
    expect(message).toContain('DELIBERATELY NOT ADOPTED');
    expect(message).toContain('a decision rather than a gap');
    expect(message).toContain('shared map');
    // …and it does NOT reach for the other population's wording.
    expect(message).not.toContain('NO PRODUCER');
  });

  it('keeps the two populations apart inside ONE diagnostic', () => {
    const warn = quiet();
    normalizeFeedTypes(['sharing', 'approval'], 'record:activity');
    expect(warn).toHaveBeenCalledTimes(1);
    const message = said(warn);
    expect(message).toContain('DELIBERATELY NOT ADOPTED');
    expect(message).toContain('"sharing"');
    expect(message).toContain('NO PRODUCER');
    expect(message).toContain('"approval"');
    // The honest limitation, stated in the message rather than in a comment
    // nobody reads: an unproduced kind is not thereby known to be an oversight.
    expect(message).toContain('not recorded anywhere');
  });

  it('names the host exception rather than claiming the census is exhaustive', () => {
    // A host that supplies `items` or its own DiscussionContext produces kinds
    // no census taken in this repository can bound. Saying so is what keeps the
    // warning honest for the surface it cannot see.
    const warn = quiet();
    normalizeFeedTypes(['email'], 'record:activity');
    expect(said(warn)).toContain('HOST');
    expect(said(warn)).toContain('Feed item types ObjectUI produces today:');
  });

  it('HONOURS the entry — this is a diagnostic, not a refusal', () => {
    const warn = quiet();
    // Returned as authored, so nothing that renders changes: a declared kind is
    // still a legal filter, and the block still filters to it.
    expect(normalizeFeedTypes(['approval'], 'record:activity')).toEqual(['approval']);
    expect(normalizeFeedTypes(['approval', 'comment'], 'record:activity')).toEqual(['approval', 'comment']);
    expect(warn).toHaveBeenCalledTimes(1); // deduped: `approval` named once
  });

  it('dedupes per distinct kind, and names only the fresh ones', () => {
    const warn = quiet();
    normalizeFeedTypes(['approval'], 'record:activity');
    normalizeFeedTypes(['approval'], 'record:activity');
    expect(warn).toHaveBeenCalledTimes(1);
    normalizeFeedTypes(['approval', 'call'], 'record:activity');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(said(warn, 1)).toContain('"call"');
    expect(said(warn, 1)).not.toContain('"approval"');
  });

  it('is its OWN channel — the unrecognised warning does not silence it', () => {
    // Same hazard the other two channels keep apart: one bucket would let
    // whichever fired first swallow the other, and these two vocabularies meet
    // in one authored list all the time.
    const warn = quiet();
    normalizeFeedTypes(['crm_task', 'approval'], 'record:activity');
    expect(warn).toHaveBeenCalledTimes(2);
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('unrecognised') && m.includes('"crm_task"'))).toBe(true);
    expect(messages.some((m) => m.includes('NO PRODUCER') && m.includes('"approval"'))).toBe(true);
  });

  it('fires through applyFeedConfig — the path the block actually renders on', () => {
    // Asserting the sanitiser alone would leave the diagnostic unreachable from
    // the pipeline; this is the call `record:activity` makes on every render.
    const warn = quiet();
    const applied = applyFeedConfig(feed, { types: ['approval'] }, 50, 'record:activity');
    expect(applied.items).toEqual([]); // the permanently empty tab, unchanged
    expect(warn).toHaveBeenCalledTimes(1);
    expect(said(warn)).toContain('"approval"');
  });

  it('the produced set is DERIVED from the producers, not a second hand list', () => {
    // The property that makes an added producer retire its own diagnostic in
    // the same edit: every value the map can yield is in the set, and so is the
    // fallback. A hand-kept copy would pass a value check while drifting.
    for (const mapped of Object.values(ACTIVITY_TYPE_TO_FEED_TYPE)) {
      if (mapped) expect(PRODUCED_FEED_TYPES.has(mapped)).toBe(true);
    }
    expect(PRODUCED_FEED_TYPES.has(UNMAPPED_ACTIVITY_FEED_TYPE)).toBe(true);
    // …and it never claims a kind the spec does not declare.
    for (const kind of PRODUCED_FEED_TYPES) expect(declared).toContain(kind);
  });
});

describe('mergeFeedItems', () => {
  it('de-duplicates by id and sorts chronologically', () => {
    const merged = mergeFeedItems(
      [item({ id: 'b', type: 'comment', createdAt: '2026-01-02T00:00:00.000Z' })],
      [
        item({ id: 'a', type: 'comment', createdAt: '2026-01-01T00:00:00.000Z' }),
        item({ id: 'b', type: 'comment', createdAt: '2026-01-02T00:00:00.000Z', body: 'newer' }),
      ],
    );
    expect(merged.map((i) => i.id)).toEqual(['a', 'b']);
    expect(merged[1].body).toBe('newer');
  });
});

/**
 * objectui#5891 — the `filterMode` fold is SAID OUT LOUD.
 *
 * Ruled in-lane by triage (2026-08-25) as option A: the `'all'` fallback stays
 * (there is no defensible narrower default, and passing an unrecognised value
 * through renders a blank dropdown — objectui#3151's posture), and what is
 * repaired is its INVISIBILITY. So the deliverable is a diagnostic, not a
 * behaviour change, and this suite is written accordingly.
 *
 * ⚠️ The trap this suite exists to avoid: a pin that asserts only "still
 * returns `'all'`" is green before AND after the fix, forever — it never
 * touches the verdict channel the card is about. Every case below therefore
 * spies on the channel the diagnostic writes to, and the suite asserts BOTH
 * directions: an unrecognised value emits (once, naming itself and the declared
 * modes), and a recognised or absent one emits NOTHING.
 *
 * ⚠️ The dedupe bucket is module scope, so a case could see an empty channel
 * purely because an earlier case already consumed the one warning for that
 * value. Two independent guards: the bucket is cleared in `afterEach` through
 * the exported seam, AND every case uses a value no other case uses.
 */
describe('an unrecognised `filterMode` still folds onto `all`, but says so (objectui#5891)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetUnrecognisedFilterModeWarnings();
  });

  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

  /**
   * The near-miss the card was filed for: the declared spelling is
   * `comments_only`. Its unrecognisedness is DERIVED from the spec rather than
   * asserted by hand — if it ever became declared, the guard below fails loudly
   * instead of this suite quietly testing nothing.
   */
  const NEAR_MISS = 'comments-only';

  it('the value this suite treats as a near-miss is outside the declared vocabulary', () => {
    expect(SpecFilterMode.options).not.toContain(NEAR_MISS);
    // …and it really is a near-miss of a declared mode, not an arbitrary string.
    expect(SpecFilterMode.options).toContain(NEAR_MISS.replace('-', '_'));
  });

  it('names the offending value AND every declared mode, exactly once', () => {
    const warn = quiet();

    expect(normalizeFilterMode(NEAR_MISS, 'record:activity')).toBe('all');

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    // The author has to be able to see WHICH value was dropped…
    expect(message).toContain(NEAR_MISS);
    // …and WHAT they could have written instead. The list is read from the
    // spec here for the same reason the source reads it from the spec: a pin
    // that re-states the enum it is pinning cannot fail when the enum moves.
    expect(message).toContain(SpecFilterMode.options.join(', '));
    // And the widening is stated, because that is the severity of the fold.
    expect(message).toContain('WIDEST');
  });

  it('warns once per distinct value, not once per call', () => {
    // A page re-runs this on every render; an authoring mistake is ONE mistake.
    const warn = quiet();
    for (let i = 0; i < 5; i += 1) {
      expect(normalizeFilterMode('changes-only', 'record:activity')).toBe('all');
    }
    expect(warn).toHaveBeenCalledTimes(1);

    // A DIFFERENT typo is a different mistake and is still named.
    expect(normalizeFilterMode('tasksOnly', 'record:activity')).toBe('all');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1][0])).toContain('tasksOnly');
  });

  it('reports a value of the wrong TYPE by its type, and still opens on `all`', () => {
    const warn = quiet();
    expect(normalizeFilterMode(7, 'record:activity')).toBe('all');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('number');
  });

  it('stays SILENT for every mode the spec declares', () => {
    // The control that stops the emit assertions above from passing for the
    // wrong reason: a helper that warned unconditionally would satisfy them.
    const warn = quiet();
    for (const mode of SpecFilterMode.options) {
      expect(normalizeFilterMode(mode, 'record:activity')).toBe(mode);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('stays SILENT when no `filterMode` was authored at all', () => {
    // Absent is not a mistake, and a warning about a non-mistake teaches
    // authors to ignore the channel — the reason the sibling `sys_activity`
    // diagnostic does not fire for deliberate exclusions either.
    const warn = quiet();
    expect(normalizeFilterMode(undefined, 'record:activity')).toBe('all');
    expect(normalizeFilterMode(null, 'record:activity')).toBe('all');
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps its channel apart from the `types` channel', () => {
    // Same reasoning as the `types` ↔ `sys_activity.type` pair: one channel
    // having spoken must not silence another that shares a spelling.
    const warn = quiet();
    normalizeFilterMode('comment', 'record:activity');       // a declared FeedItemType, not a filter mode
    normalizeFeedTypes(['comments_only'], 'record:activity'); // a declared filter mode, not a feed type
    expect(warn).toHaveBeenCalledTimes(2);
    resetUnrecognisedFeedTypeWarnings();
  });
});
