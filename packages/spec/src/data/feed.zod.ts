// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Activity-timeline UI config enums, and the `sys_activity.type` built-in set.
 *
 * The `service-feed` backend was retired (ADR-0052 §5 / #1955); `sys_comment` /
 * `sys_activity` are the canonical record-collaboration/timeline backend. The two
 * enums here configure the record activity component (`RecordActivityProps` in
 * `../ui/component.zod.ts`). `FeedFilterMode` is pure UI configuration, but
 * `FeedItemType` is not backend-free: it has no backend *import*, yet it is the
 * TARGET of the map UI consumers apply to the `sys_activity.type` column — a
 * backend *coupling* — and that column's vocabulary is OPEN and
 * author-extensible (maintainer ruling 2026-08-24, #11507). `FeedItemType` is
 * therefore the built-in guidance half of that map, never the value domain of
 * an authoring surface: `RecordActivityProps.types` accepts contributed kinds
 * beyond it (#11658), and consumers must map unknown `sys_activity.type` values
 * to a fallback rather than drop them. `SYS_ACTIVITY_BUILTIN_TYPES` below is
 * the published built-in vocabulary of the `sys_activity.type` column,
 * co-located with `FeedItemType` because UI consumers map one onto the other.
 * (A later `feed` → `activity` rename is tracked separately.)
 */

/**
 * Feed Item Type
 * Unified activity types for the record timeline.
 * Covers comments, field changes, tasks, events, and system activities.
 */
export const FeedItemType = z.enum([
  'comment',
  'field_change',
  'task',
  'event',
  'email',
  'call',
  'note',
  'file',
  'record_create',
  'record_delete',
  'approval',
  'sharing',
  'system',
]);
export type FeedItemType = z.input<typeof FeedItemType>;

/**
 * Feed Filter Mode
 * Controls which feed item types to display in the timeline.
 */
export const FeedFilterMode = z.enum([
  'all',
  'comments_only',
  'changes_only',
  'tasks_only',
]);
export type FeedFilterMode = z.input<typeof FeedFilterMode>;

/**
 * The platform's BUILT-IN set of `sys_activity.type` values — the single source
 * the `sys_activity` object declaration (`@objectstack/plugin-audit`) and UI
 * consumers read, so the built-in vocabulary can no longer drift between them
 * (#11807: objectui's hand-copied census missed `scheduled` on the very day
 * #11522 declared it).
 *
 * ## Built-in set, NOT the column's value domain
 *
 * `sys_activity.type` is an OPEN, author-extensible vocabulary (maintainer
 * ruling 2026-08-24, #11507): this list is the floor the platform itself writes
 * and offers in pickers/filters, never the ceiling of legal values. An app may
 * contribute its own values — the sanctioned authoring channel is
 * `activityMilestones[].type` (ADR-0052 §5b.2, `z.string()`, forwarded
 * verbatim), and an app's server-side action can insert one directly — and an
 * undeclared value is stored verbatim, not rejected.
 *
 * What that binds for a consumer of this constant:
 *
 * - ⛔ Never use it to validate, reject, or filter OUT values. A row whose
 *   `type` is not in this set is legitimate; render it (generic fallback), do
 *   not drop it. Every CLOSED map over this vocabulary is a bug (#11507).
 * - It is deliberately a plain `as const` tuple rather than a `z.enum`: a Zod
 *   schema here would read as a validator and quietly re-close the vocabulary.
 * - This is a different vocabulary from {@link FeedItemType}: `FeedItemType` is
 *   the UI timeline item-type enum; UI code MAPS `sys_activity.type` onto it
 *   and must map unknown values to a fallback, not drop them.
 *
 * Adding or removing an entry is a contract change on a published surface (that
 * is the point — drift becomes a red gate instead of a rendering bug): it must
 * ship with a changeset, and the writer census in
 * `plugin-audit/src/objects/sys-activity-type-vocabulary.test.ts` must be
 * re-done in the same PR (that test goes red until it is).
 */
export const SYS_ACTIVITY_BUILTIN_TYPES = [
  'created',
  'updated',
  'deleted',
  'commented',
  'mentioned',
  'shared',
  'assigned',
  'completed',
  'scheduled',
  'login',
  'logout',
  'system',
] as const;

/**
 * One built-in `sys_activity.type` value — derived from
 * {@link SYS_ACTIVITY_BUILTIN_TYPES}. The column's runtime value domain is
 * wider (`string`): the vocabulary is open and author-extensible (#11507), so
 * code that READS rows must type the column as `string` and treat this union as
 * the known-built-in narrowing only.
 */
export type SysActivityBuiltinType = (typeof SYS_ACTIVITY_BUILTIN_TYPES)[number];
