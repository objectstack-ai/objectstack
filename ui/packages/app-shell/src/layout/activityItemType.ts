/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * The app-shell reading of a `sys_activity` row — the pure half (objectui#6730).
 *
 * `sys_activity` is read by two packages with two DIFFERENT target types:
 *
 *  - `@object-ui/plugin-detail` builds a `FeedItem` (the closed 13-value
 *    `FeedItemType` spec enum) for the `record:activity` block and, through
 *    `activityRowToFeedItem`, for `RecordDetailView`'s merged feed;
 *  - this package builds an {@link ActivityItem} for the AppHeader bell's
 *    Activity tab, Home's activity card and the exported `ActivityFeed` panel.
 *
 * Everything here is DOM-free on purpose, exactly as `recordActivityFeed.ts`
 * is on the other side: the reading is the part worth asserting directly, and
 * a test that has to mount a Sheet to find out what a `scheduled` row becomes
 * is a test nobody writes.
 *
 * ## ⛔ These two vocabularies CROSS. Do not "converge" them (objectui#6730)
 *
 * The obvious cleanup — have this surface call `activityRowToFeedItem` and be
 * done — is wrong, and it is wrong in a way that costs rows. Measured against
 * `ACTIVITY_TYPE_TO_FEED_TYPE` as it stands:
 *
 *  1. **`FeedItem` is COARSER where `ActivityItem` is fine.** `created`,
 *     `updated`, `deleted`, `assigned` and `shared` all map to the single
 *     `field_change` feed type. This vocabulary splits that group three ways —
 *     `create` / `update` / `delete` — with three icons, three labels and three
 *     independent notification toggles. `field_change` cannot be decomposed
 *     back into them, so `sys_activity.type -> FeedItemType -> ActivityItem`
 *     is lossy: every create and every delete would arrive as an update.
 *  2. **`FeedItem` DROPS what `ActivityItem` names.** `commented` and
 *     `mentioned` map to `undefined` there — a deliberate exclusion, because
 *     that content lives in `sys_comment` with reactions and threading
 *     attached. Here they are the `comment` kind, one of four. Routing through
 *     the shared constructor returns `null` for them, i.e. the bell's Activity
 *     tab would silently lose every comment row.
 *  3. **`FeedItem` is FINER where this vocabulary is coarse.** `system`,
 *     `task` and `event` are three feed types; here they land in one bucket.
 *
 * So neither type is a projection of the other: each refines the other
 * somewhere and coarsens it somewhere else. A shared reading would have to be a
 * third table keyed on `sys_activity.type` with two value columns, which is not
 * a convergence — it is the same two decisions written next to each other, plus
 * a cross-package runtime dependency from the shell's header chrome onto a
 * record-detail widget plugin.
 *
 * What IS shared is pinned by tests rather than by imports, which is the whole
 * point: `activityItemType-6730.test.ts` reads plugin-detail's real
 * `ACTIVITY_TYPE_TO_FEED_TYPE` (a devDependency — no runtime edge) and asserts
 * that every value the column is DECLARED to carry has an entry here too, and
 * that the two readings still disagree in the three ways above. A new built-in
 * upstream turns that pin red; a future "convergence" turns it red as well,
 * and the message says why.
 *
 * ## The unrecognised case is explicit, and it is not `update`
 *
 * Before objectui#6730 every value outside the four named ones fell through to
 * `update`. That is not a missing decision, it is a WRONG one stated out loud:
 * a `scheduled` meeting and an author's `contract_countersigned` both rendered
 * as "somebody updated this record". `sys_activity.type` is author-extensible
 * (objectstack `88b9d749a`, direction 4, ruled 2026-08-24 — the column's fields are
 * `readonly: true` so objectql never validates them on write, and ADR-0052
 * §5b.2 forwards `activityMilestones[].type` into it verbatim), so unrecognised
 * values are not mistakes to be papered over; they are real activity nobody has
 * ruled on yet.
 *
 * The in-repo precedent for that is `UNMAPPED_ACTIVITY_FEED_TYPE`: a generic
 * bucket plus one diagnostic per distinct value. This module follows it.
 */

/**
 * What the shell's activity surfaces can present a row AS.
 *
 * Four presentation kinds plus a generic bucket. Adding a member is a real
 * cost — `ActivityFeed` keeps three `Record<ActivityItemType, …>` tables
 * (icon, label, notification toggle), so `tsc` refuses a member without a
 * presentation, which is the property that makes the bucket safe to add.
 *
 * ⚠️ `system` shares a SPELLING with `UNMAPPED_ACTIVITY_FEED_TYPE` and nothing
 * else. This union is not, and must not become, a projection of the spec's
 * `FeedItemType` — that would bind an app-shell internal type to a published
 * enum, which is a contract decision this module has no standing to make.
 */
export type ActivityItemType = 'create' | 'update' | 'delete' | 'comment' | 'system';

/**
 * One activity row as the shell's surfaces consume it.
 *
 * Declared here rather than beside the `ActivityFeed` component so the reading
 * above stays importable without pulling React in; `ActivityFeed` re-exports
 * it, so every existing `import type { ActivityItem } from './ActivityFeed.js'`
 * keeps resolving.
 */
export interface ActivityItem {
  id: string;
  type: ActivityItemType;
  objectName: string;
  recordId?: string;
  user: string;
  description: string;
  timestamp: string;
}

/**
 * `sys_activity.type` -> {@link ActivityItemType}.
 *
 * The rule, so that a new entry is a reading rather than a guess:
 *
 *  - `create` / `update` / `delete` mean **the record's own stored state
 *    changed**, split by which way. That is exactly plugin-detail's
 *    `field_change` group, refined — `assigned` and `shared` are updates
 *    because both write to the record (owner, sharing rules), which is also
 *    why they sit in that group on the other side.
 *  - `comment` means **somebody said something**. `mentioned` is a comment that
 *    named you; the shell has no separate presentation for that and does not
 *    need one.
 *  - `system` is the generic bucket: a value this four-kind vocabulary has no
 *    honest kind for. `completed`, `scheduled`, `login` and `logout` are here
 *    on purpose — plugin-detail gives them `task` / `event` / dropped, and none
 *    of those is a create, an update, a delete or a comment. Before #6730 all
 *    four claimed `update`.
 *
 * The table is TOTAL over the built-in vocabulary (`map ⊇ built-ins`), pinned
 * against plugin-detail's table by `activityItemType-6730.test.ts`. It is
 * deliberately NOT set-equal to it: the column is author-extensible, so an
 * equality pin would be false by construction — the same reading objectui#5840
 * and objectui#5969 landed on for the other copy.
 */
export const ACTIVITY_TYPE_TO_ACTIVITY_ITEM_TYPE: Readonly<Record<string, ActivityItemType>> = {
  created: 'create',
  updated: 'update',
  deleted: 'delete',
  assigned: 'update',
  shared: 'update',
  commented: 'comment',
  mentioned: 'comment',
  system: 'system',
  completed: 'system',
  scheduled: 'system',
  login: 'system',
  logout: 'system',
};

/**
 * The presentation a value outside {@link ACTIVITY_TYPE_TO_ACTIVITY_ITEM_TYPE}
 * renders through.
 *
 * ⚠️ A FLOOR under the table, never a substitute for it — the same caveat
 * `UNMAPPED_ACTIVITY_FEED_TYPE` carries. What keeps a catch-all honest is that
 * it cannot swallow a value somebody has ruled on: the superset pin forces
 * every built-in to keep its own entry above, so this can only ever receive
 * values nobody has mapped, and {@link activityRowToActivityItem} names each
 * one once so somebody can.
 *
 * Note it is a bucket, not a drop. Dropping the row is the objectui#5840
 * failure mode — stored, queryable, invisible — reached by a different route.
 */
export const UNMAPPED_ACTIVITY_ITEM_TYPE: ActivityItemType = 'system';

/** `sys_activity.type` values already named as unmapped. Module scope so one
 *  unknown type warns ONCE, not once per row: a 20-row page of the same
 *  extended type is one missing decision, not twenty. */
const warnedUnmappedActivityTypes = new Set<string>();

/** Test seam: forget which unmapped types have already been named. */
export function resetUnmappedActivityTypeWarnings(): void {
  warnedUnmappedActivityTypes.clear();
}

/**
 * Say out loud that a row reached the shell's feed through the generic bucket.
 *
 * Deliberately NOT fired for a value the table maps to `system` on purpose
 * (`system`, `completed`, `scheduled`, `login`, `logout`): those are decisions,
 * and warning about a decision teaches authors to ignore the channel. It fires
 * only for a value outside the table entirely — which is why the lookup below
 * asks `hasOwnProperty` rather than comparing the result to the bucket.
 */
function warnUnmappedActivityType(type: string): void {
  if (warnedUnmappedActivityTypes.has(type)) return;
  warnedUnmappedActivityTypes.add(type);
  console.warn(
    `[app-shell] rendered a sys_activity row with type "${type}" through the generic `
      + `"${UNMAPPED_ACTIVITY_ITEM_TYPE}" presentation: no activity item type is mapped `
      + 'for it. `sys_activity.type` is author-extensible (ruled '
      + '2026-08-24) and is not validated on write, so a producer can store a value the '
      + 'platform never declared — the row is shown rather than dropped, and it no longer '
      + 'claims to be an update. Map it in ACTIVITY_TYPE_TO_ACTIVITY_ITEM_TYPE '
      + '(@object-ui/app-shell, layout/activityItemType.ts) to give it its own '
      + 'presentation.',
  );
}

/**
 * Read `sys_activity.type` as an {@link ActivityItemType}.
 *
 * Three outcomes and only two spellings, which is why the diagnostic hangs off
 * the lookup and not off the result: a MAPPED `system` and an UNMAPPED value
 * both produce `'system'`, and only the second one is missing a decision.
 */
export function activityItemTypeOf(rawType: string): ActivityItemType {
  const mapped = Object.prototype.hasOwnProperty.call(ACTIVITY_TYPE_TO_ACTIVITY_ITEM_TYPE, rawType)
    ? ACTIVITY_TYPE_TO_ACTIVITY_ITEM_TYPE[rawType]
    : undefined;
  if (mapped) return mapped;
  warnUnmappedActivityType(rawType);
  return UNMAPPED_ACTIVITY_ITEM_TYPE;
}

/**
 * `timestamp`, falling back to `created_at` when the column holds the literal
 * `"NOW()"` — plugin-audit writes the unevaluated default through on some
 * paths, and `new Date('NOW()')` is `Invalid Date`, which renders as a blank
 * relative time.
 *
 * This is the THIRD copy of that quirk in the repo; objectui#5896 folded the
 * other two into `activityTimestamp` (@object-ui/plugin-detail). It stays a
 * copy rather than an import because the quirk is the only part of the reading
 * that is target-type-independent, and importing it would put a runtime edge
 * from the shell's header chrome onto a record-detail widget plugin for one
 * five-line predicate — plugin-detail is a PEER dependency of this package, so
 * that edge is a real install-time requirement, not a free one. There is no
 * package that owns "how to read a `sys_activity` column" today; until there
 * is, the honest instrument is a pin, and
 * `activityItemType-6730.test.ts` asserts this function agrees with
 * `activityTimestamp` value-for-value over the quirk's whole input table.
 */
export function activityRowTimestamp(row: {
  timestamp?: unknown;
  created_at?: unknown;
}): string {
  const when = row.timestamp;
  if (!when || when === 'NOW()' || Number.isNaN(Date.parse(String(when)))) {
    return String(row.created_at ?? '');
  }
  return String(when);
}

/**
 * One raw `sys_activity` row -> one {@link ActivityItem}, or `null` when the
 * row is not something these surfaces can show.
 *
 * `null` covers exactly what `mapActivityRows` used to drop with a `.filter()`
 * ahead of its `.map()`: a row that names no action (`type` is not a string) or
 * says nothing (`summary` blank). Raw rows carry plugin-audit's column names
 * (`summary` / `actor_name` / `object_name` / `timestamp`); casting one straight
 * through leaves every field `undefined`, which is what once rendered the
 * Activity tab as blank rows showing only a relative time.
 *
 * Exported as the whole reading — table, floor, timestamp and the constructor
 * that applies all three — for the reason objectui#5896 gave on the other side:
 * publishing the lookup table alone left the mirror one level up, and the
 * constructions drifted where the tables did not.
 */
export function activityRowToActivityItem(row: unknown): ActivityItem | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.type !== 'string') return null;
  const description = String(r.summary ?? '').trim();
  if (description.length === 0) return null;
  return {
    id: String(r.id),
    type: activityItemTypeOf(r.type),
    objectName: String(r.object_name ?? ''),
    recordId: r.record_id != null ? String(r.record_id) : undefined,
    user: String(r.actor_name ?? ''),
    description: String(r.summary ?? ''),
    timestamp: activityRowTimestamp(r),
  };
}
