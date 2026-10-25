/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ObjectGantt Component
 * 
 * A specialized Gantt chart component that works with ObjectQL data sources.
 * Displays tasks with date ranges, progress, and dependencies.
 * Implements the gantt view type from @objectstack/spec view.zod ListView schema.
 * 
 * Features:
 * - Gantt chart timeline visualization
 * - Task progress tracking (0-100%)
 * - Task dependencies visualization
 * - Date range display
 * - Auto-scrolling timeline
 * - Works with object/value data providers
 */

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import type { ObjectGanttSchema, DataSource, GanttConfig } from '@object-ui/types';
import { GanttConfigSchema } from '@objectstack/spec/ui';
// Aliased on import, following PR #4169's convention: this repo has its OWN
// `resolveI18nLabel` over a DIFFERENT vocabulary (the KEYED `{ key, defaultValue }`
// ref, `resolveKeyedI18nLabel` in `@object-ui/react`), and neither accepts the
// other's shape. This one resolves the spec's INLINE locale MAP.
import { resolveI18nLabel as resolveInlineI18nLabel } from '@objectstack/spec/ui';
import { resolveFieldScale } from '@objectstack/spec/data';
import {
  useNavigationOverlay,
  useSettledSchema,
  NonGridRowCeilingNote,
  useDataInvalidation,
  useFilterScope,
  useResolvedFilter,
} from '@object-ui/react';
import { useLocalization, useDisplayLocale, resolveFieldCurrency, formatDisplayNumber } from '@object-ui/i18n';
import {
  RECORD_OVERLAY_DEFAULT_WIDTH,
  RecordDetailPanel,
  deriveRecordPageHref,
} from '@object-ui/plugin-detail';
import { usePermissions } from '@object-ui/permissions';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  NavigationOverlay,
  RefreshIndicator,
  legacyRecordDrawerWidthKey,
  recordOverlayWidthStorageKey,
  useOverlayAnchor,
  cn,
} from '@object-ui/components';
import {
  extractRecords,
  buildExpandFields,
  convertSortToQueryParams,
  getRecordDisplayName,
  resolveDataSource,
  createFieldColorResolver,
  resolveRecordSourceConfig,
  resolveRecordSourceObjectName,
  resolveAffordance,
  type SchemaLike,
  applyNonGridRowCeiling,
  nonGridRowCeilingQuery,
  type NonGridCeilingResult,
  isRealCalendarDate,
  toDateInputValue,
  toDisplayDate,
  toDisplayEndDate,
  toInclusiveEndDay,
} from '@object-ui/core';
import {
  getSemanticColorName,
  getSemanticHex,
  humanizeLabel,
  formatDate,
  formatDateTime,
  formatPercent,
  percentCellScale,
  formatCurrency,
} from '@object-ui/fields';
import { GanttView, type GanttTask, type GanttDependency, type GanttLinkType, type GanttTaskType } from './GanttView';
import { invertFrom, invertTo, makeTzShift } from './tzShift';
import { ResourceWorkload } from './ResourceWorkload';
import { QuickFilterBar, type QuickFilterField, type QuickFilterOption } from './QuickFilterBar';
import type { WorkingCalendar } from './scheduling';
import { normalizeShiftSegments, type ShiftSegmentsConfig } from './shifts';
import { useGanttTranslation } from './useGanttTranslation';

/**
 * One quick-filter dimension. Generic by design: the page configures
 * which record fields become filter dropdowns; the plugin resolves each one's
 * options from the object schema (select options / lookup reference records) so
 * no business field names are baked into the (MIT) plugin.
 */
export interface QuickFilterDef {
  /** Record field / dot-path the dimension filters on. */
  field: string;
  /** Trigger label (falls back to the schema field label / humanized name). */
  label?: string;
  /**
   * Explicit option override. Highest priority — use for fixed enums that are
   * not modeled as select options (e.g. a work-order category). Plain strings become
   * value === label; objects allow a distinct display label.
   */
  options?: Array<string | { value: string | number; label?: string }>;
}

/**
 * The gantt config as THIS renderer consumes it: `GanttConfig` from
 * `@object-ui/types` — the spec's `GanttConfigSchema`, which since
 * objectstack#15469 declares the whole vocabulary — with `quickFilters` and
 * `timeSegments` narrowed to the plugin's runtime types, and the spec-declared
 * members re-documented with the behaviour this renderer gives them.
 *
 * ⚠️ Nothing here may declare a key `GanttConfig` does not (objectui#6051). Nine
 * members that lived ONLY here — `lockField`, `objectField`, `summaryExtent`,
 * `defaultCollapsedDepth`, `borderColorField`, `dependencyTypes`, `timeZone`,
 * `exportFileName`, `interactions` — were lifted into `@object-ui/types`, because
 * a type private to this package can be referenced by neither authoring face.
 * Each key is now declared once and both faces derive from it: the `gantt` block
 * and the flattened top-level spelling on `ObjectGanttSchema`.
 */
type GanttConfigEx = GanttConfig & GanttConfigRestated;

/**
 * The members this renderer states ON TOP of {@link GanttConfig} — twelve, as
 * measured against the shipped `GanttConfig` on `main` (objectui#6471; the card
 * counted eleven before objectui#6051/#6472 landed part of the lift).
 *
 * All twelve RESTATE a key `GanttConfig` already declares, and since
 * objectstack#15469 closed the schema all twelve — `timeSegments` included —
 * arrive from the spec's `GanttConfigSchema` (29 keys); every one is mutually
 * assignable with its twin. That includes
 * `quickFilters` and `timeSegments`, which objectui#6471 called load-bearing
 * NARROWINGS: measured on `main` they narrow nothing. What those two still do is
 * NAME this plugin's runtime types (`QuickFilterDef[]` /
 * {@link ShiftSegmentsConfig}), so a spec bump that moves either side surfaces as
 * a decision. `ObjectGantt.configPin.test.ts` holds that measurement — read it
 * there rather than re-deriving it here.
 *
 * ## Why a member is kept rather than deleted — TWO reasons, either sufficient
 *
 * 1. PROSE, where there is any. The spec emits no per-member docs
 *    (`z.input<typeof GanttConfigSchema>` carries none) and JSDoc cannot be
 *    attached to a member a type merely inherits, so for most members the
 *    docblock below is the fullest description of what this renderer DOES with
 *    the key. It does NOT reach every member: four are bare here —
 *    `parentField`, `baselineEndField`, `assigneeField`, `effortField` — the last
 *    three covered by a neighbour's docblock, `parentField` by nothing. Nor is
 *    this prose unique any more: since objectui#6472 the flattened face
 *    (`ObjectGanttSchema` in `@object-ui/types`) documents all twelve, and
 *    objectui#6561 expanded `parentField`'s entry there.
 *
 * 2. PIN OPERAND — this reason reaches EVERY member, and for `parentField` it is
 *    the only one. The pin below is derived over `keyof GanttConfigRestated`: a
 *    member that exists is compared against its twin, and a member that is
 *    deleted simply stops being compared.
 *
 * ⛔ So the test for whether a member may be deleted is NOT "does it carry its
 * own JSDoc". Applied to `parentField` that test answers "deletable", and it is
 * wrong. Deleting `parentField` is not silent — it fails three assertions in
 * `ObjectGantt.configPin.test.ts`: the `RESTATED` census, the non-vacuity control
 * that names it, and the fixture. But all three fail INSIDE the pin, which is the
 * file a reader edits to turn a red build green; follow those errors and the tree
 * goes green with one member fewer under the pin. Delete a member here only when
 * its twin on `GanttConfig` goes with it.
 *
 * ⚠️ NAMED rather than inlined into the intersection above, and that is the
 * whole mechanism: inside `GanttConfigEx` there is nothing left to compare,
 * because `GanttConfigEx[K]` is ALREADY `GanttConfig[K] & <local>[K]` and is
 * therefore assignable to `GanttConfig[K]` by construction — an assertion written
 * against `GanttConfigEx` passes no matter how far the two declarations drift.
 * Naming the local half is what gives `ObjectGantt.configPin.test.ts` two
 * independent operands, so a spec bump that re-types one of the twelve breaks the
 * build at the pin instead of silently intersecting the old type back in.
 */
export type GanttConfigRestated = {
  parentField?: string;
  /**
   * Record field whose value maps onto a node kind (see {@link normalizeTaskType}):
   * `task` / `summary` (project/phase) / `milestone` / `group`. `group` (or
   * `folder`) renders a pure tree header with NO bar — for project / product
   * style levels that only group, never schedule.
   */
  typeField?: string;
  /** Baseline (planned) start/end fields → planned-vs-actual reference bars. */
  baselineStartField?: string;
  baselineEndField?: string;
  /**
   * Dynamic Group by. When set, leaf tasks are bucketed by this
   * field and rendered under one synthesized summary row per distinct value
   * (replacing the parent hierarchy). Select options / lookups resolve to their
   * display label, matching list/kanban grouping.
   */
  groupByField?: string;
  /**
   * Resource / Workload view. When true, the chart renders a
   * per-resource load histogram instead of the timeline grid: each task loads
   * its `assigneeField` resource by `effortField` units (default 1) over its
   * span, and any column whose summed load exceeds `capacity` is flagged as
   * over-allocated. `assigneeField` is required for this view to bucket by.
   */
  resourceView?: boolean;
  assigneeField?: string;
  effortField?: string;
  /** Per-resource capacity ceiling (default 1). Loads above this flag overload. */
  capacity?: number;
  /**
   * Quick filters. A row of multi-select dropdowns rendered above the
   * chart; each narrows the visible task bars by one dimension. Options resolve
   * from the object schema (select options or lookup reference records) so the
   * lists are the full domain, not just values present in the current data.
   */
  quickFilters?: QuickFilterDef[];
  /**
   * When true (default), filtering recomputes the timeline range so it zooms to
   * the filtered tasks' interval. Set false to keep the range pinned to the full
   * (unfiltered) task set while filtering only hides bars.
   */
  autoZoomToFilter?: boolean;
  /**
   * Shift segmentation. When set, the day-mode timeline splits each shift-day
   * (starting at `dayStart`) into the configured bands (day | night | …):
   * a two-tier header (date over band), per-band column tints, and
   * drag/resize snapping to band boundaries. Pure config data — no shift concept
   * is hardcoded. `label` is display text the caller has already localized.
   * Off by default → existing gantts are unchanged. Example:
   * `{ dayStart: '08:00', bands: [
   *     { key: 'day', label: 'Day shift', start: '08:00', end: '20:00' },
   *     { key: 'night', label: 'Night shift', start: '20:00', end: '08:00' } ] }`.
   */
  timeSegments?: ShiftSegmentsConfig;
};

/** Map a record's type value onto a GanttTaskType (undefined = infer). */
export function normalizeTaskType(raw: unknown): GanttTaskType | undefined {
  if (raw == null) return undefined;
  const key = String(raw).toLowerCase().trim();
  if (key === 'milestone') return 'milestone';
  // Pure grouping header: a tree node with no timeline bar. Use for
  // project / product style levels that only group, never schedule.
  if (key === 'group' || key === 'folder') return 'group';
  if (key === 'summary' || key === 'project' || key === 'phase') return 'summary';
  if (key === 'task') return 'task';
  return undefined;
}

/**
 * Normalize a record's dependencies field into GanttDependency[].
 * Accepts:
 * - CSV string: "task1, task2"
 * - array of ids: ["task1", 42]
 * - array of objects: [{ id: "task1", type: "ss" }] — `task`/`target`/`_id`
 *   accepted as id aliases; type aliases like "finish_to_start"/"end-to-start"
 *   map onto fs/ss/ff/sf.
 */
const LINK_TYPE_ALIASES: Record<string, GanttLinkType> = {
  fs: 'fs', ss: 'ss', ff: 'ff', sf: 'sf',
  finish_to_start: 'fs', start_to_start: 'ss', finish_to_finish: 'ff', start_to_finish: 'sf',
  end_to_start: 'fs', end_to_end: 'ff', start_to_end: 'sf',
};

export function normalizeDependencies(raw: unknown): GanttDependency[] {
  if (raw == null || raw === '') return [];
  if (typeof raw === 'string') {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (typeof raw === 'number') return [raw];
  if (!Array.isArray(raw)) return [];
  const out: GanttDependency[] = [];
  for (const item of raw) {
    if (item == null || item === '') continue;
    if (typeof item === 'object') {
      const id = (item as any).id ?? (item as any)._id ?? (item as any).task ?? (item as any).target;
      if (id == null || id === '') continue;
      const typeKey = String((item as any).type ?? '').toLowerCase().replace(/-/g, '_');
      const type = LINK_TYPE_ALIASES[typeKey];
      out.push(type ? { id, type } : { id });
    } else {
      out.push(item as string | number);
    }
  }
  return out;
}

export interface ObjectGanttProps {
  /**
   * The gantt node. Typed as {@link ObjectGanttSchema} (objectui#5903) — the
   * declaration this component's schema reads actually resolve against.
   *
   * It used to be `ObjectGridSchema`, and that is why ten genuine reads had to
   * be spelled `(schema as any).K`: the keys are not grid keys, so the only
   * thing that admitted them was `BaseSchema`'s index signature, under a cast
   * that hid even that. Removing the casts without moving the type would have
   * changed nothing — the reads would still land on the index signature.
   *
   * objectui#6051 declared what the FLAT branch reads: the 24 flattened
   * `GanttConfig` keys `getGanttConfig`'s first branch consumes, plus the
   * `staticData` / `filter` / `sort` the fetch path reads. The grid-style
   * `{ gantt: { … } }` block kept working exactly as before and was still read
   * through the index signature — declaring it was the one change that would not
   * have been additive, so it was severed to objectui#6475, which has since
   * declared it (`gantt?: GanttConfig`). The registered
   * renderer (`index.tsx`) still passes `schema: any`, so no runtime shape is
   * turned away either way.
   */
  schema: ObjectGanttSchema;
  dataSource?: DataSource;
  className?: string;
  onTaskClick?: (record: any) => void;
  /**
   * TWO parameters since objectui#9357, and the second is not decoration: this
   * prop reaches `useNavigationOverlay` as its `onRowClick`, and `handleClick`
   * invokes it as `onRowClick(record, event)` — the modifier payload a host
   * needs to implement Cmd/Ctrl/middle-click for itself. Declaring one
   * parameter hid the second on the ONE line a host reads. Spelled `any` and
   * not `HandleClickModifiers` for the reason objectui#9341 measured on
   * `ObjectKanbanSchema.onCardClick`: that interface lives in
   * `@object-ui/react`, the published twins in `@object-ui/types` may not name
   * it, and a host that discovered the payload from the implementation
   * annotated it `React.MouseEvent` — which a narrower declaration refuses
   * contravariantly. `BaseSchema`'s own `onClick` / `onChange` / `onSubmit`
   * already use this spelling for exactly this situation.
   */
  onRowClick?: (record: any, event?: any) => void;
  onEdit?: (record: any) => void;
  onDelete?: (record: any) => void;
  /**
   * Veto hook for task edits, forwarded to {@link GanttView}. Called with the
   * gantt task and the pending changes on every commit path (drag, resize,
   * group move, progress, inline edit, auto-reschedule); return false (sync or
   * async) to cancel that task's update before it reaches the data source.
   */
  onBeforeTaskUpdate?: (
    task: GanttTask,
    changes: Partial<Pick<GanttTask, 'title' | 'start' | 'end' | 'progress'>>,
  ) => boolean | Promise<boolean>;
}

/**
 * Pull a human-readable message out of a failed write. ApiDataSource embeds
 * the raw response body at the end of its Error message
 * (`ApiDataSource: HTTP 403 Forbidden — {"error":…,"message":…}`), so a JSON
 * tail with `message`/`error` wins; otherwise null (caller falls back to the
 * generic i18n text).
 */
function extractServerMessage(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const idx = msg.indexOf('{');
  if (idx >= 0) {
    try {
      const body = JSON.parse(msg.slice(idx));
      const m = body?.message ?? body?.error;
      if (typeof m === 'string' && m.trim()) return m;
    } catch {
      /* body wasn't JSON — fall through */
    }
  }
  return null;
}

/**
 * The chart's own calendar, as `GanttView` renders it (objectui#10866).
 *
 * `GanttView` re-bases every `Date` it is handed into the configured business
 * `timeZone` (`makeTzShift`), and hands every emitted change back through the
 * inverse. That is right for an instant and wrong for a DAY: a date-only value
 * names a calendar day and carries no instant, so re-basing it moved the bar
 * off its day for any viewer whose zone is not the chart's. The two helpers
 * below keep a day a day across that shim, and are the identity when no
 * `timeZone` is configured — the showcase's case, and every chart's default.
 */
type ChartZone = ReturnType<typeof makeTzShift>;

/**
 * A stored date value → the `Date` handed to `GanttView`.
 *
 * `toDisplayDate` reads a date-only value at LOCAL midnight of the day it
 * names, where the engine's own parse read UTC midnight and drew the bar a day
 * early west of UTC. For a business-zone chart that midnight is then handed
 * over as the instant `GanttView` re-bases EXACTLY back onto it (`invertTo`),
 * so the bar stands on the named day of the chart's calendar for every viewer,
 * on a DST day too: the shim's own round trip, `to(from(midnight))`, fell on
 * 23:00 of the day before there. A value with a time is an instant and passes
 * through unshifted, as before.
 */
function readTaskDate(raw: unknown, chartZone: ChartZone): Date {
  const date = toDisplayDate(raw as string);
  return typeof raw === 'string' && isRealCalendarDate(raw) ? invertTo(chartZone, date) : date;
}

/**
 * A stored END value (`end`, `baselineEnd`) → the `Date` handed to
 * `GanttView`: the end read both gantt surfaces share, `toDisplayEndDate`
 * (`@object-ui/core`, objectui#11141), in place of {@link readTaskDate}'s
 * start-of-day read, and then the chart-zone step a start takes.
 *
 * A date-only end is INCLUSIVE (objectui#11112's ruling): a stored
 * `2024-01-15` is drawn through January 15th, to the 16th's local midnight,
 * so a successor starting `2024-01-16` begins where it ends and the view's
 * half-open instants (`styleFor`, `scheduling.ts`) see no gap. That midnight is
 * handed over through `invertTo` exactly as a start's is, so the bar ends on
 * the named day's end in the chart's calendar for every viewer. A value with
 * a time is an instant and keeps it. ⛔ No day is stepped here: the step is
 * the core helper's, so this surface and the timeline's gantt cannot drift.
 */
function readTaskEnd(raw: unknown, chartZone: ChartZone): Date {
  const end = toDisplayEndDate(raw as string);
  if (typeof raw !== 'string' || !isRealCalendarDate(raw)) return end;
  const handed = invertTo(chartZone, end);
  if (chartZone.to(handed).getTime() === end.getTime()) return handed;
  // The chart zone's clock skips the midnight this day ends at (it steps
  // forward at 00:00, as `America/Santiago`'s does), so `invertTo` found no
  // instant drawn there and handed the one drawn at 01:00 of the NEXT day,
  // which `toInclusiveEndDay` names as that next day: a drag would write the
  // end back a day late. The bar is ended at the last instant drawn on its own
  // day instead, the one just before that midnight, which the view draws on
  // the day's edge and names, and writes back, as the stored day.
  return invertTo(chartZone, new Date(end.getTime() - 1));
}

/**
 * The value a drag writes into one of the task's date fields.
 *
 * A field declared `date` holds a calendar day, the spec's `YYYY-MM-DD`
 * storage form, so it is written as the day the bar was dropped on in the
 * chart's calendar (for an `edge` of `'end'`, the day the bar runs through,
 * `toInclusiveEndDay`, objectui#11141): the display-space `Date` the view
 * emitted, recovered EXACTLY from the instant it hands over (`invertFrom`;
 * the shim's own `to(instant)` fell on 23:00 of the day before on a DST day),
 * read with LOCAL getters. ⛔ Never `toISOString()` for it — the UTC spelling of a local
 * midnight names the PREVIOUS day everywhere east of UTC.
 * Any other declared type (`datetime`) keeps its instant, exactly as before.
 *
 * With no declared type to ask (an inline `value` provider has no object schema), the
 * stored value's own shape answers: the same split {@link readTaskDate} and
 * {@link readTaskEnd} made when they read the value, so a write never
 * disagrees with the read.
 */
function toStoredDateValue(
  date: Date,
  declaredType: unknown,
  stored: unknown,
  chartZone: ChartZone,
  edge: 'start' | 'end' = 'start',
): string {
  const dateOnly =
    typeof declaredType === 'string'
      ? declaredType === 'date'
      : typeof stored === 'string' && isRealCalendarDate(stored);
  if (!dateOnly) return date.toISOString();
  const day = invertFrom(chartZone, date);
  // An END is the exact inverse of `readTaskEnd` (objectui#11141): the view
  // hands back the exclusive end instant, so a bar ending on a day's local
  // midnight names the day BEFORE it, the day it runs through. A stored
  // `2024-01-15` is read as the 16th's midnight and written back as the 15th,
  // so a read, a drag and a write never move a stored day.
  return toDateInputValue(edge === 'end' ? toInclusiveEndDay(day) : day);
}

/**
 * Dev-only guard for the authoring diagnostics below. Mirrors `plugin-map`'s
 * (`ObjectMap.tsx`): the warnings are feedback for whoever wrote the schema, and
 * a production bundle should not pay for them.
 */
const isDev = (): boolean =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.NODE_ENV !== 'production';

/**
 * `keyof T` with the string / number INDEX SIGNATURE stripped out.
 *
 * Load-bearing, not tidiness. `GanttConfig` derives from the spec's
 * `GanttConfigSchema`, which carries an index signature, so a bare
 * `keyof GanttConfig` widens to `string` — and every guard written against it
 * (the `satisfies` below, the coverage pin in
 * `ObjectGantt.blockPrecedence.test.tsx`) then constrains NOTHING while looking
 * exactly like a guard that does. That is the same blind instrument
 * objectui#6051's declaration pin records: an index signature absorbs precisely
 * the evidence a type annotation would have produced. Measured here — the pin
 * came back `string` before this alias existed.
 */
type KnownKeys<T> = keyof {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

/** The DECLARED members of `GanttConfig` — its index signature removed. */
export type KnownGanttConfigKey = KnownKeys<GanttConfig>;

/**
 * The FLAT spelling of `GanttConfig`'s keys — what `getGanttConfig`'s flat
 * branch reads, and what `ObjectView` / `ListView` EMIT.
 *
 * Both flatteners build an `object-gantt` schema by spreading `options.gantt`'s
 * CONTENTS at the top level (`plugin-view/src/ObjectView.tsx` `case 'gantt'`,
 * `plugin-list/src/ListView.tsx` `case 'gantt'`); the product carries these keys
 * and NO `gantt` key at all. That is an internal transport form, not a second
 * authoring surface — and it is why the precedence flip below strands neither
 * producer.
 *
 * DERIVED from `GanttConfigSchema` in full — the same zod object the block
 * branch validates against — so a key added to the spec reaches the shadow
 * diagnostic without a second edit (the discipline `FLAT_MAP_CONFIG_KEYS` set in
 * objectui#5177). Until objectstack#15469 that derivation covered only part of
 * the vocabulary and a second literal, `GANTT_CONFIG_EXTENSION_KEYS`, named the
 * ten keys the renderer read through the schema's then-open `.passthrough()`
 * window. The spec now declares all ten, so the list is one source again and the
 * literal is retired (objectui#7845) — keeping it would have made every one of
 * the ten a DUPLICATE entry here, which is what the no-duplicates pin in
 * `ObjectGantt.blockPrecedence.test.tsx` measured. `dependencyField` is the
 * legacy singular alias the flat branch still reads beside `dependenciesField`;
 * it is not a `GanttConfig` key, so it is named on its own.
 */
export const FLAT_GANTT_CONFIG_KEYS = [
  ...(Object.keys(GanttConfigSchema.shape) as (keyof typeof GanttConfigSchema.shape)[]),
  'dependencyField' as const,
];

/**
 * Warn once per distinct shadowing, not once per evaluation: `getGanttConfig`
 * runs on every render of the chart (hover, zoom, quick-filter changes all
 * re-render it), and a warning that floods the console is a warning that gets
 * muted. Same discipline as `plugin-map`'s `warnedShadowedFlatKeys`.
 */
const warnedShadowedFlatGanttKeys = new Set<string>();

/**
 * The `gantt` block won and the flat top-level keys alongside it were ignored —
 * say which ones, in dev.
 *
 * Silence is what the precedence rule costs if it is not diagnosed: two
 * spellings of ONE vocabulary (objectui#6051 proved they are one — both derive
 * from `GanttConfig`) in a single schema, one of them inert. The ruling picks
 * the author's block over the flatten product deliberately — maintainer on
 * objectui#5018 (2026-08-17) for `plugin-map`, inherited here by objectui#6469 —
 * so the diagnostic names what was dropped instead of leaving the author to
 * infer it from a chart that renders the other spelling's values.
 *
 * It cannot fire on the ordinary ObjectView / ListView path, and that matters
 * more here than it did for the map: the flat branch is the HOT path for gantt,
 * because a hand-authored `gantt` block reaching this component through either
 * view layer has already been flattened before `getGanttConfig` sees it. Both
 * flatteners emit the flat keys and NO `gantt` key, so this function's block
 * branch — the only caller of this warning — is not even reached for their
 * output. Reaching it means one schema carries both spellings, which is exactly
 * the case the flip changes.
 */
function warnOnShadowedFlatGanttKeys(schema: ObjectGanttSchema): void {
  if (!isDev()) return;

  // `key` is a `GanttConfigSchema` key or the legacy `dependencyField`, and
  // `ObjectGanttSchema` declares every one of those, so the read is typed as it
  // stands; no conversion is needed (objectui#11355).
  const shadowed = FLAT_GANTT_CONFIG_KEYS.filter((key) => schema[key] !== undefined);
  if (shadowed.length === 0) return;

  const memo = `${schema.type ?? 'gantt'}::${schema.objectName ?? ''}::${shadowed.join(',')}`;
  if (warnedShadowedFlatGanttKeys.has(memo)) return;
  warnedShadowedFlatGanttKeys.add(memo);

  console.warn(
    '[ObjectGantt] The `gantt` block configures this chart, so these top-level keys are ' +
      `IGNORED: ${shadowed.map((k) => `\`${k}\``).join(', ')}. The \`gantt\` block is the ` +
      'authoring shape; the flat top-level spelling is the internal form ObjectView/ListView ' +
      'produce when they flatten `options.gantt`, and what the author wrote outranks it. The ' +
      'block is taken WHOLE — the flat keys are not merged into it — so move anything you ' +
      'still need into `gantt`, or drop the `gantt` block. objectui#6469.',
  );
}

/**
 * Helper to get gantt configuration from schema
 *
 * PRECEDENCE (objectui#6469, inheriting the maintainer ruling on objectui#5018,
 * 2026-08-17): the `gantt` block is checked FIRST and wins outright; the
 * flattened top-level spelling is consulted only when no `gantt` block is
 * present. This REVERSES the pre-#6469 order, under which the flat branch
 * returned early and every key inside an authored `gantt` block was discarded
 * with no diagnostic at all. `plugin-map` had the identical two-faces shape
 * ruled the other way (PR #5156); gantt's answer had never been ruled — it was
 * just what the early `return` happened to do.
 *
 * Safe for the producer path: neither flattener emits a `gantt` key, so their
 * output still takes branch 2 exactly as before — see `FLAT_GANTT_CONFIG_KEYS`.
 *
 * The block is taken WHOLE, not merged over the flat keys. That is the ruling's
 * shape ("what the author wrote outranks it"), and merging would be the lenient
 * consumer fallback AGENTS.md #0.1 forbids. One consequence is gantt-specific
 * and worth stating, because the map case cannot produce it: the spec's
 * `GanttConfigSchema` REQUIRES `startDateField` / `endDateField` / `titleField`
 * (`ObjectMapConfigSchema` requires nothing), so an INCOMPLETE block now
 * outranks a complete flat spelling, and that block is REFUSED (below). Both
 * diagnostics fire on that node — `Invalid gantt configuration` from the
 * `safeParse` below, and the shadow warning naming the flat keys that lost.
 *
 * A block that fails `GanttConfigSchema` is refused, never drawn (objectui#13459).
 * It used to be warned about in the console and then returned as-is, so a block
 * with a misspelt or missing key still rendered something plausible and the
 * author never learnt it was wrong. `invalidBlock` carries the parse issues to
 * the refusal screen instead; `config` is `null` on that branch, so nothing
 * downstream can read the unvalidated block. Same posture as `ObjectTimeline`'s
 * refusal: the renderer says what is wrong rather than guessing what was meant.
 */
function getGanttConfig(schema: ObjectGanttSchema): {
  config: GanttConfigEx | null;
  invalidBlock: readonly string[] | null;
} {
  // 1. The `gantt` block (the ObjectGridSchema-style shape) — the authoring
  // face, and the winner whenever it is present.
  if (schema.gantt) {
    const result = GanttConfigSchema.safeParse(schema.gantt);
    warnOnShadowedFlatGanttKeys(schema);
    if (!result.success) {
      console.warn(`[ObjectGantt] Invalid gantt configuration:`, result.error.format());
      return { config: null, invalidBlock: describeGanttBlockIssues(result.error.issues) };
    }
    return { config: schema.gantt as GanttConfigEx, invalidBlock: null };
  }

  // 2. The internal flat form — the ObjectView / ListView flatten product.
  // Taken only when BOTH date fields are present, unchanged by the flip; a
  // partial flat spelling still falls through to `null`. Deliberately NOT
  // `safeParse`d, also unchanged: this branch never validated, and adding
  // validation to it is a separate question from precedence.
  if (schema.startDateField && schema.endDateField) {
      const flat: GanttConfigEx = {
          startDateField: schema.startDateField,
          endDateField: schema.endDateField,
          titleField: schema.titleField || 'name',
          progressField: schema.progressField,
          dependenciesField: schema.dependenciesField || schema.dependencyField,
          colorField: schema.colorField,
          borderColorField: schema.borderColorField,
          parentField: schema.parentField,
          typeField: schema.typeField,
          lockField: schema.lockField,
          objectField: schema.objectField,
          summaryExtent: schema.summaryExtent,
          defaultCollapsedDepth: schema.defaultCollapsedDepth,
          tooltipFields: schema.tooltipFields,
          baselineStartField: schema.baselineStartField,
          baselineEndField: schema.baselineEndField,
          groupByField: schema.groupByField,
          resourceView: schema.resourceView,
          assigneeField: schema.assigneeField,
          effortField: schema.effortField,
          capacity: schema.capacity,
          quickFilters: schema.quickFilters,
          autoZoomToFilter: schema.autoZoomToFilter,
          viewMode: schema.viewMode,
          timeSegments: schema.timeSegments,
          interactions: schema.interactions,
          exportFileName: schema.exportFileName,
          timeZone: schema.timeZone,
          dependencyTypes: schema.dependencyTypes,
      };
      return { config: flat, invalidBlock: null };
  }

  return { config: null, invalidBlock: null };
}

/**
 * One line per `GanttConfigSchema` issue, `path: message`, for the refusal
 * screen. The path is spelled from the block (`gantt.quickFilters.0.field`) so
 * the author can find the key; an issue on the block itself names `gantt`.
 */
function describeGanttBlockIssues(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): string[] {
  return issues.map((issue) => `${['gantt', ...issue.path.map(String)].join('.')}: ${issue.message}`);
}

export const ObjectGantt: React.FC<ObjectGanttProps> = ({
  schema,
  dataSource,
  className,
  onTaskClick,
  onRowClick,
  onBeforeTaskUpdate,
  ...rest
}) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  /**
   * Did the platform row ceiling bite on the rows currently drawn, and how
   * large was the whole filtered result set (objectui#7210)?
   *
   * State rather than a value derived from `data.length`: once the rows are
   * capped, `data.length === NON_GRID_ROW_CEILING` is exactly what a result
   * set of exactly the ceiling ALSO looks like, so the fact has to be carried
   * from the response that knew it. Every path that sets `data` sets this too.
   *
   * ⚠️ The exempt path is now the HOST `data` prop and only it — rows a host
   * component handed down are not ours to cap. An inline `value` set IS capped
   * (objectui#8769): it goes through the same adapter query as every other
   * provider, so the ceiling arrives with the same `$top` and the same
   * footnote. Ruling a′'s budget is measured in DOM elements per record and
   * its own table was measured over the inline provider, so an inline row
   * costs what a fetched row costs and the ruling text carves out no provider.
   */
  const [rowCeiling, setRowCeiling] = useState<NonGridCeilingResult | null>(null);
  // Tenant default currency (ADR-0053) for currency tooltips lacking a code.
  const { currency: tenantCurrency } = useLocalization();
  // The one date/number locale resolver: tenant regional default → active UI
  // language → 'en' (objectui#4272). Read unconditionally at component level.
  const displayLocale = useDisplayLocale();
  const { t } = useGanttTranslation();

  // Surface write-back failures (drag / link / delete / inline edit) as an error
  // toast — silent revert alone leaves the user wondering why nothing stuck (#2473).
  // The server's own message (e.g. a 403 "only the managing owner may modify
  // this shift plan") leads;
  // the generic i18n text is the fallback.
  const notifyWriteError = useCallback((err: unknown) => {
    toast.error(t('gantt.writeFailed'), {
      description: extractServerMessage(err) ?? undefined,
    });
  }, [t]);

  // `'view-data'` — the arm `object-gantt`'s published `data` row declares
  // (objectui#8348): `ComponentPropsMap['object-gantt'].data` in the INSTALLED
  // `@objectstack/spec`, the discriminated union over four strict OBJECT arms,
  // which ruling batch #136 item 3 (Q1-C) had the protocol gain. Until it was
  // installable this block was judged through this repo's own
  // `ObjectGanttSchema.data`, spelled the same. ⛔ Not restated as a fact about
  // a version: `dataArmSpecRow-8348.test.ts` derives the arm from the
  // installed row and turns red if a release moves it. A bare array under
  // `data` is not on it, so it is no longer a record source and the ladder
  // falls through to `staticData` / `objectName`; it was inert before (it
  // carried no `provider`, so no fetch branch below ever matched it), which is
  // why nothing a published document can express moves here.
  const rawDataConfig = resolveRecordSourceConfig(schema, 'view-data');
  // The authored data config's deep VALUE, as one primitive — the memo's only
  // dependency, hoisted out of the dependency array so it has a name. ⛔ It is
  // NOT the key the record fetch runs on; see `adapterInputsKey` below for why
  // the wide key is the wrong one there.
  const dataConfigKey = JSON.stringify(rawDataConfig);
  // Memoize dataConfig using deep comparison to prevent infinite loops
  const dataConfig = useMemo(() => {
    return rawDataConfig;
  }, [dataConfigKey]);

  const { config: ganttConfig, invalidBlock: invalidGanttBlock } = getGanttConfig(schema);
  const dataProvider = dataConfig?.provider;
  const hasInlineData = dataProvider === 'value';
  /*
   * There is deliberately no `dataItems` binding here any more
   * (objectui#8769). It existed because `reload` READ the inline payload
   * directly, and it was in `reload`'s dependency list as the one primitive
   * standing in for `dataConfig` — `reload` may not key on `dataConfig`
   * itself, because `useMemo` carries no semantic guarantee (React may
   * discard its cache and recompute) and a discard alone was enough to give
   * `reload` a fresh identity and re-fire the mount effect below
   * (objectui#6592).
   *
   * `reload` no longer reads the payload: the inline provider goes through
   * `effectiveDataSource` like every other provider. That memo intentionally
   * keeps `dataConfig` as a dependency (not just its `object`/`items`
   * primitives), because `resolveDataSource` reads a provider-shaped slice of
   * it, which cannot be flattened to a fixed primitive list. Authored items
   * therefore still reach
   * `reload`: new items → new `dataConfig` (deep-compared above) → new
   * adapter → new `reload`. The primitive is redundant, and a binding
   * documented as "the field `reload` reads" that `reload` does not read is
   * the kind of comment the next reader would trust.
   */

  // Resolve the ViewData config into a concrete DataSource adapter:
  //   provider: 'object' → the context DataSource passed via props (unchanged)
  //   provider: 'value'  → an in-memory ValueDataSource
  // Every read AND write-back below goes through this single adapter.
  // There is no `api` arm: the view-level `api` data source is retired in
  // `@objectstack/spec` (objectstack#23082), so a block that still names it is
  // an unknown provider to `resolveDataSource` and no request is built from
  // its `read` / `write` (objectui#12325).
  const effectiveDataSource = useMemo(
    () => resolveDataSource(dataConfig, dataSource ?? null),
    // dataConfig is already memoized by deep value above.
    [dataConfig, dataSource],
  );
  /**
   * The adapter, reachable from the fetch path WITHOUT that path depending on
   * its IDENTITY (objectui#10036; AGENTS.md §5 commandment #10, ruled on
   * objectui#8640).
   *
   * `useMemo` is a performance hint: React may throw the cache away and
   * recompute even when the dependency list compares equal, and `useCallback`
   * is the same hint over a function. The memo above is not value-stable
   * under that — `resolveDataSource` returns the context adapter UNCHANGED for
   * `provider: 'object'`, but CONSTRUCTS a new `ValueDataSource` for
   * `'value'`. So on that provider a
   * discard alone handed `reload` a brand-new adapter for a byte-identical
   * authored config, rebuilt `reload`, and re-fired the mount effect below —
   * one redundant round trip, per discard, on a component nobody had touched.
   * That is the same mechanism the `dataItems` note above records for
   * objectui#6592; one banned identity came off `reload`'s dependency list
   * there and this one stayed on it.
   *
   * ⇒ `reload` READS the adapter through this ref and KEYS on the values that
   * determine it: `adapterInputsKey` below, plus `dataSource` —
   * this memo's own dependency list, with the memoised `dataConfig` replaced by
   * the VALUES `resolveDataSource` reads out of it. A genuine change to any of
   * them still rebuilds `reload` and still refetches; a discard alone no longer
   * can.
   */
  const effectiveDataSourceRef = useRef(effectiveDataSource);
  effectiveDataSourceRef.current = effectiveDataSource;

  /**
   * What `resolveDataSource` ACTUALLY READS out of the authored config, per
   * provider arm, as one primitive.
   *
   * ⛔ Deliberately NOT `dataConfigKey`, the whole config's deep value. The
   * note above `dataItems` says such a flattening "cannot be flattened to a
   * fixed primitive list" — true of a fixed LIST. A per-arm VALUE, however,
   * is expressible, and it has to be
   * the per-arm one rather than the whole config, because the whole config is
   * WIDER than the adapter's inputs. `ObjectGantt.discardedConfigMemo.test.tsx`
   * measures the difference: it moves an inert field inside `schema.data` that
   * "is read by nothing under test", and the fetch must not re-fire. Keying on
   * the whole config makes that authored-but-inert byte a refetch trigger on
   * the `object` provider, where the adapter is the context DataSource and the
   * config contributes nothing to it at all.
   *
   * ⚠️ The arms below mirror `resolveDataSource` (`@object-ui/core`) — `items`
   * for `'value'`, nothing but the fallback for `'object'` and for an unknown
   * provider (the retired `'api'` included, objectui#12325). Everything else
   * the record query derives from the config reaches the list through its own binding
   * (`resource`, `dataProvider`, `hasInlineData`), so this key answers for the
   * ADAPTER and only the adapter.
   */
  const adapterInputsKey = JSON.stringify(
    rawDataConfig?.provider === 'value'
      ? { provider: 'value', items: rawDataConfig.items }
      : { provider: rawDataConfig?.provider ?? null },
  );

  // Unified resource name for find/update/delete: the bound object for
  // 'object', `schema.objectName` otherwise.
  const resource = resolveRecordSourceObjectName(schema, dataConfig) ?? '';

  /**
   * The object schema, and whether the read for THIS object has SETTLED —
   * one piece of state, through the shared hook (objectui#7225, maintainer
   * ruling B; the gantt gating is ask 2 of that card, handled here with
   * objectui#7210 because it is the same component).
   *
   * This replaces a local `useState` plus an effect whose exits — `if
   * (!effectiveDataSource) return;`, `if (!resource) return;`, and its
   * `catch` — returned WITHOUT settling anything (objectui#7232). That was
   * harmless only while the record query was ungated: nothing was listening.
   * The gate below listens, and an exit that never settles would hold the
   * chart's query open forever — a chart that never loads, on a code path
   * that reads as correct. The hook settles on every exit by construction,
   * which is why the gate can be added at all.
   *
   * An inline `value` data set reads no metadata and never did, so it is
   * expressed as "there is no source to read from" (`dataSource: undefined`)
   * rather than as a second enable flag — the recipe the hook's doc comment
   * prescribes.
   */
  const { ready: objectSchemaReady, def: objectSchema } = useSettledSchema<any>(
    resource,
    hasInlineData ? undefined : effectiveDataSource,
  );

  // Permissions context, read here rather than inside `reload` below: a
  // `useCallback`'s DEPENDENCY ARRAY is evaluated during render, so `perms` has
  // to be a binding that already exists by the time render reaches it
  // (objectui#7230, the structural note PR #7229 recorded for `ListView`).
  const perms = usePermissions();

  /**
   * The full-text search the record query carries (objectui#10250).
   *
   * `search` is the term, sent as `$search`; `searchableFields` narrows the
   * server-resolved searchable set and is sent as `$searchFields` — only
   * alongside a term, exactly as a list's own query sends the pair (ADR-0061:
   * the client sends the term, the server decides which fields it matches). A
   * `ListView` gantt writes both from its toolbar Search box: the chart
   * queries for itself, so the node is the only door the term has.
   *
   * Both are held as PRIMITIVES for the dependency lists below. The term is a
   * string; the field list is keyed on its serialised value, so a host handing
   * a fresh but equal array does not refetch (AGENTS.md #10 — key on the
   * payload, never on an identity).
   */
  const searchTerm = typeof schema.search === 'string' && schema.search !== '' ? schema.search : undefined;
  const searchFields = searchTerm && Array.isArray(schema.searchableFields) && schema.searchableFields.length > 0
    ? schema.searchableFields
    : undefined;
  const searchFieldsKey = searchFields ? JSON.stringify(searchFields) : '';

  // Load (and re-load) data through the resolved adapter. The two options are
  // independent choices (objectui#7237):
  //
  //   - `inPlace` decides whether the chart stays MOUNTED. In place, the run
  //     sets `refreshing`, which draws the refreshing state over the chart, and
  //     GanttView keeps its scroll, collapsed groups and in-flight edits.
  //     Otherwise it sets `loading`, which swaps in the placeholder. Only the
  //     first load does that; see `loadedOnceRef`.
  //   - `silent` decides what a FAILURE does. A background re-read of the SAME
  //     query (write-readback, the toolbar refresh, an invalidation; #2436
  //     items 6 and 7) logs it and keeps the last good rows, which still
  //     answer that query. A silent reload is always in place. One exception:
  //     a silent run that overtakes a changed query still in flight reports
  //     like it (objectui#10633, `reportOwedRef`).
  //
  // Concurrent reloads are sequenced: only the newest request may commit its
  // result, so a slow earlier response can't clobber a fresher one.
  const [refreshing, setRefreshing] = useState(false);
  // objectui#10666 — the node's own `filter`, with every context token
  // (`{current_user_id}`, `{current_org_id}`, the date macros) resolved ONCE
  // through `@object-ui/core`'s shared `resolveFilterPlaceholders`, against the
  // session scope the host provides, and HELD by structure (`useResolvedFilter`
  // in `@object-ui/react`). A directly authored gantt sent the literal token on
  // `$filter` before. `reload` and both of its dependency lists read THIS,
  // never the raw `schema.filter`, so a re-render that rebuilds an equal filter
  // does not re-query.
  const filterScope = useFilterScope();
  const queryFilter = useResolvedFilter(schema.filter, filterScope);
  const reloadSeqRef = useRef(0);
  /**
   * Has any reload committed rows yet? (objectui#7237, ruling A′)
   *
   * This separates the initial load, which keeps the loading placeholder, from
   * every later change to the query. A later change refreshes in place, so the
   * chart is never torn down to the placeholder after it has painted. A ref, not
   * state: nothing renders from it, and it only ever flips once, from false to
   * true.
   */
  const loadedOnceRef = useRef(false);
  /**
   * Does the run in flight owe a report if it fails? (objectui#10633)
   *
   * A non-silent run owes one: its query changed. A silent run owes one only
   * when it SUPERSEDES a run that still owes one. The data-invalidation bus,
   * the toolbar refresh or a write-readback can start a silent re-read while a
   * changed query is in flight. That re-read reads the changed query and makes
   * the changed run stale, so the changed run's answer and its failure are both
   * discarded. If the re-read then failed quietly, the previous query's rows
   * would stay up with nothing saying so. The re-read therefore inherits the
   * report, and passes it on if another silent run overtakes it. The current
   * run releases the obligation when it settles. A standalone silent re-read,
   * with nothing pending, owes nothing and stays quiet.
   *
   * Inherited here, in the run sequence, and not by re-issuing the re-read as
   * non-silent at its call site: every silent caller overtakes the same way,
   * and a non-silent re-issue would also drop `inPlace` unless it were carried
   * over by hand.
   */
  const reportOwedRef = useRef(false);
  /**
   * Rows a HOST component handed down as a `data` prop, or `null` when it
   * handed none (objectui#7333).
   *
   * ⭐ An EMPTY array is `null` here. It is "no host rows yet", ⛔ not "the
   * host owns zero rows". Both sites that read this prop — the short-circuit
   * at the head of `reload` and `recordQueryDerivesExpand` below — used to
   * take `[]` as an authoritative answer (`[]` is truthy, and
   * `Array.isArray([])` holds): the chart adopted it and returned before its
   * own query, and painted an EMPTY chart in place of the rows its `data`
   * config names. A host array that has not been filled yet looks exactly like
   * that. So an empty array leaves the chart reading from its own source, as it
   * does with no host array at all; a NON-EMPTY one is adopted as it always
   * was. Pinned in `ObjectGantt.emptyHostData-7333.test.tsx`.
   *
   * One predicate, evaluated once per render, for BOTH sites. `reload` reads it
   * through `hostRowsRef` rather than closing over `rest`: `reload` does not
   * key on the host rows, so a closed-over value is the one from whichever
   * render last rebuilt `reload`. When a host's rows arrive after an empty
   * first render, `recordQueryDerivesExpand` flips and fires the fetch effect,
   * and that run must see the rows that flipped it, not the `[]` before them.
   *
   * ⚠️ The registry path never hands this prop: the registered `object-gantt`
   * renderer forwards no host prop (`ObjectGantt.hostDataProp-7210.test.tsx`
   * pins that), and `ObjectGanttProps` does not declare `data`. What reaches it
   * is a direct caller that spreads one in.
   */
  const hostRowsProp: unknown = (rest as Record<string, unknown>).data;
  const hostRows = Array.isArray(hostRowsProp) && hostRowsProp.length > 0 ? hostRowsProp : null;
  const hostRowsRef = useRef(hostRows);
  hostRowsRef.current = hostRows;
  const reload = useCallback(async ({ silent = false, inPlace = silent }: { silent?: boolean; inPlace?: boolean } = {}) => {
    const seq = ++reloadSeqRef.current;
    const isCurrent = () => reloadSeqRef.current === seq;
    const reportsFailure = !silent || reportOwedRef.current;
    reportOwedRef.current = reportsFailure;
    try {
      if (inPlace) setRefreshing(true);
      else setLoading(true);
      // 1. Rows a host handed down — non-empty only (objectui#7333); see
      // `hostRows` above for why this reads the ref.
      const handedRows = hostRowsRef.current;
      if (handedRows) {
        if (isCurrent()) {
          setData(handedRows);
          setRowCeiling(null);
          // Committed rows clear an earlier failure (objectui#10578) — the
          // reasoning sits on the adapter's commit below.
          setError(null);
          loadedOnceRef.current = true;
        }
        return;
      }

      // ⭐ THERE IS NO SECOND EXIT FOR THE INLINE PROVIDER (objectui#8769).
      //
      // `provider: 'value'` used to return here with `setData(dataItems)` —
      // BEFORE the `find` below, which is the ONE site that lowers
      // `schema.filter` to `$filter`, `schema.sort` to `$orderby` and the
      // objectui#7210 ceiling to `$top`. So an authored `filter` reached
      // nothing and the chart drew EVERY inline row: the fail-OPEN direction,
      // because the key that was dropped is the key that NARROWS. Accepting a
      // declared key one cannot honour is the defect; the adapter can honour
      // all three, so it honours them.
      //
      // `resolveDataSource` already answers this provider with a
      // `ValueDataSource`, which implements `$filter` / `$orderby` / `$skip` /
      // `$top` / `$select` over its own array — so nothing below is
      // provider-specific and no combinator had to be written here
      // (objectui#8513 stays where it is). The matcher is LOCAL: it never
      // reaches `convertFiltersToAST`, so a comparand that converter refuses
      // is excluded-and-logged here rather than thrown at render.
      // Read through the ref, NOT through the memo's identity — see the block
      // above `effectiveDataSourceRef` (objectui#10036). The ref is refreshed
      // on every render, so this is always the adapter the current render
      // resolved; what it is not is a reason to rebuild this callback.
      const adapter = effectiveDataSourceRef.current;
      if (!adapter || typeof adapter.find !== 'function') {
        throw new Error('DataSource required for the object provider');
      }

      // 'object' → the context adapter (resolved above).
      // Auto-inject $expand for lookup/master_detail fields when a schema is
      // available.
      //
      // [objectui#7230] FIELD-LEVEL SECURITY ON `$expand`, the gate
      // objectui#7215 / PR #7229 put on the two projection sites in its scope.
      // `$select` on a denied lookup asks for a bare foreign key; `$expand`
      // asks the server to RESOLVE the relation and return the related record.
      //
      // ⚠️ NO COLUMN LIST IS PASSED HERE, which is what makes this site sharp:
      // `buildExpandFields` reads an absent column list as "no column
      // restriction" and falls back to EVERY declared relation on the object,
      // denied ones included — the maximal ask, by default rather than by
      // configuration.
      //
      // Graded as objectui#7215 graded it: defence-in-depth against
      // ObjectStack's own server (`FieldMasker.maskRecord` deletes the very key
      // objectql writes the expansion back under, and the sub-read takes the
      // referenced object's full CRUD + RLS + FLS — objectstack#7626), and
      // load-bearing for a backend that does not strip.
      //
      // ⭐ THE GATE IS ON THE OUTPUT. There is no input to gate on this site,
      // and the output contains only DECLARED reference-bearing fields, so the
      // "`checkField` answers false for an undeclared key" trap is structurally
      // unreachable. An unanswered policy filters nothing; `perms` is in this
      // callback's dependency list, so the expansion is rebuilt the moment the
      // answer arrives. Pinned in `ObjectGantt.expandFls-7230.test.tsx`.
      const expandable = buildExpandFields(objectSchema?.fields);
      const expand = !perms?.isLoaded || !resource
        ? expandable
        : expandable.filter((f) => perms.checkField(resource, f, 'read'));
      const result = await adapter.find(resource, {
        $filter: queryFilter,
        $orderby: convertSortToQueryParams(schema.sort),
        // The platform ceiling (objectui#7210, ruling a′). The gantt still
        // fetches the whole FILTERED result set — a truthful
        // `min(start) → max(end)` range and the group rollups need all of it,
        // which is why paging this at `pagination.pageSize` was rejected — but
        // "the whole result set" now stops at a number instead of at whatever
        // the table happens to hold. One probe row past the ceiling is what
        // makes the cut DETECTABLE; `applyNonGridRowCeiling` slices it back off.
        // ⛔ Not authorable: an authored `limit` / `pagination.pageSize` still
        // cannot reach this query, by the same ruling.
        ...nonGridRowCeilingQuery(),
        ...(expand.length > 0 ? { $expand: expand } : {}),
        // objectui#10250 — the term and its field narrowing, sent together
        // or not at all. See `searchTerm` above.
        ...(searchTerm
          ? {
              $search: searchTerm,
              ...(searchFields ? { $searchFields: searchFields } : {}),
            }
          : {}),
      });
      const capped = applyNonGridRowCeiling(result);
      if (isCurrent()) {
        setData(capped.rows);
        setRowCeiling(capped);
        // objectui#10578 — `error` is an early return in the render, so a
        // report nothing clears keeps the chart off screen until a remount.
        // It is cleared HERE, when the current run commits rows, silent or not:
        // those rows answer the current query, so no earlier failure describes
        // the screen any more. A superseded run's answer is discarded, and so
        // is its clear.
        //
        // ⛔ Not when a run STARTS, although `ObjectGrid`'s load clears there.
        // A start clear is safe only if the run that cleared also reports its
        // own failure, and here a SILENT reload can overtake it and then fail
        // unreported (objectui#7237's silent mode, which `ObjectGrid` does not
        // have). The error would be gone and the rows of an older query would
        // be back with nothing saying so. Until rows land, the report stays.
        setError(null);
        loadedOnceRef.current = true;
      }
    } catch (err) {
      if (!reportsFailure) {
        // Background refresh failure keeps the last good data on screen.
        console.error('[ObjectGantt] Failed to refresh data:', err);
      } else if (isCurrent()) {
        // A failed query that CHANGED (in place or not) is reported. The rows
        // on screen answer the previous query, and once the refreshing state
        // clears nothing would tell the user that (objectui#7237). A silent
        // run that took over a changed query's report reports here too
        // (objectui#10633, `reportOwedRef`).
        setError(err as Error);
      }
    } finally {
      // Only the NEWEST reload owns the loading flags, for the same reason
      // the result writes above are guarded. An unguarded clear here let a
      // SUPERSEDED reload release the placeholder while the fresh query was
      // still in flight, so the chart painted empty in between
      // (objectui#7231).
      //
      // The current reload clears BOTH flags, not just the one its own
      // `silent` mode set: reaching this point as the current run means
      // nothing is in flight any more — a newer reload would have made this
      // one stale, and an older one has no claim on the flags. Clearing only
      // this run's own mode would strand the other one whenever the
      // superseded reload ran in the OTHER mode (a silent invalidation reload
      // overtaken by a query change before the first paint would leave
      // `refreshing` on for the life of the component).
      if (isCurrent()) {
        reportOwedRef.current = false;
        setRefreshing(false);
        setLoading(false);
      }
    }
    // ⭐ THE VALUE LIST (objectui#10036). The first three replace what used to
    // be a single `effectiveDataSource` entry: they are that memo's OWN
    // dependencies, with the memoised `dataConfig` swapped for the values
    // `resolveDataSource` reads out of it. Every input that can change the
    // adapter is still named, and no `useMemo` / `useCallback` identity is.
    // The fetch effect below repeats this list for the same reason; the pins in
    // `ObjectGantt.discardedReloadIdentity-10036.test.tsx` hold the two in
    // parity by exercising each entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `searchFields` is keyed by its serialised value, `searchFieldsKey`; the host rows are read through `hostRowsRef` (objectui#7333)
  }, [adapterInputsKey, dataSource, resource, hasInlineData, dataProvider, queryFilter, schema.sort, searchTerm, searchFieldsKey, objectSchema, perms]);

  /**
   * Does the query this effect is about to issue DERIVE anything from the
   * object schema? Only the adapter branch does. Rows a host handed down and
   * an inline `value` set both paint with no metadata read at all, so gating
   * them would hold a paint on a resolution that buys them nothing. Same
   * scoping ObjectCalendar's gate uses, and for the same reason.
   *
   * "Rows a host handed down" is `hostRows`, the predicate `reload` reads — an
   * EMPTY host array is not one (objectui#7333), so it keeps the gate and the
   * invalidation subscription of the query the chart still issues.
   */
  const recordQueryDerivesExpand = hostRows === null && !hasInlineData;

  // ⭐ objectui#7225 ask 2 (objectui#6482's undischarged gating half) — the
  // object schema GATES this query; it does not refine it afterwards.
  //
  // Before this line the gantt issued TWO unbounded queries per load: `reload`
  // lists `objectSchema` in its dependency list, so the effect ran once with
  // the schema still unresolved (`buildExpandFields` saw no fields, so the
  // query carried no `$expand` at all) and again once it landed. Measured on
  // this component with an instrumented adapter, three latency profiles — 2
  // `find` calls and 1 `getObjectSchema` per load, expand sets `[null,
  // ['owner']]` — the cost is NOT the mild "round trip bought and thrown
  // away" the kanban showed: whenever the metadata read is the slower of the
  // two, which is the common case on a cold `MetadataCache`, the user sees the
  // full THREE-STEP PAINT — raw foreign-key ids, back to the loading
  // placeholder, then the expanded rows. That is the profile #6482's
  // per-component standard names as the one where gating pays.
  //
  // ⛔ Gating is not capping. The row ceiling is objectui#7210's ruling and
  // lives on the query itself (`$top` above); this decides WHEN the query
  // fires, not how many rows it may bring back.
  /**
   * ⛔ …and this effect may not name `reload` either (objectui#10036).
   *
   * `reload` is a `useCallback` result, so it is the same performance hint one
   * link further out: a discarded cache hands back a fresh function WHATEVER
   * its own dependency list says — an empty list included. Keying the fetch on
   * that identity therefore leaves React licensed to re-fire it for nothing,
   * no matter how carefully `reload`'s own list is written. ⇒ Both sides of
   * the seam, or neither holds: the callback is reached through a ref and this
   * effect keys on the SAME value list `reload` keys on.
   */
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  /**
   * objectui#7237, ruling A′ — the first run is the initial load and keeps the
   * loading placeholder. Every run after rows have painted is a REAL change to
   * the query (sort, filter, permissions, search, the bound source), and it
   * refreshes IN PLACE: GanttView stays mounted with its scroll, collapsed
   * groups and in-flight edits, the refreshing state sits over the chart, and
   * the rows are replaced when the answer lands. ⛔ Never a teardown to the
   * placeholder once the chart has painted.
   *
   * In place but NOT silent: the query changed, so a failure is reported
   * rather than leaving the previous query's rows on screen.
   */
  useEffect(() => {
    if (recordQueryDerivesExpand && !objectSchemaReady) return;
    reloadRef.current(loadedOnceRef.current ? { inPlace: true } : {});
  }, [adapterInputsKey, dataSource, resource, hasInlineData, dataProvider, queryFilter, schema.sort, searchTerm, searchFieldsKey, objectSchema, perms, recordQueryDerivesExpand, objectSchemaReady]);

  /**
   * objectui#10035 — the refresh input this gantt had none of, so a host could
   * show it a write only by remounting it (AGENTS.md #8's corollary: refresh
   * data, don't rebuild UI). The nonce moves when the data-invalidation bus
   * reports a change to the object this gantt reads.
   *
   * ⭐ A SILENT reload, deliberately not the fetch effect above. That effect's
   * first reload flips `loading`, which swaps `GanttView` for the placeholder
   * — the same loss of scroll, collapsed groups and zoom a remount causes, one
   * level down — and its later ones report a failure, which is right for a
   * changed query and wrong for a re-read of the same one. `reload({ silent:
   * true })` is the path the toolbar refresh and every write-readback here
   * already take for exactly that reason, and it keeps `reload`'s sequencing,
   * so an invalidation that lands mid-load cannot let a stale answer win.
   *
   * Subscribed only when the rows come from an adapter this gantt queries
   * (`recordQueryDerivesExpand`): a host `data` array and an inline `value`
   * set are not ours to refresh. Each nonce is answered at most once
   * (`handledInvalidationRef`): one that lands while the object-schema gate
   * above is still closed is marked handled and dropped, because the gated
   * first load has not run yet and reads rows written before it — so the gate
   * opening later can never add a second query beside that load.
   */
  const invalidationNonce = useDataInvalidation(recordQueryDerivesExpand && resource ? resource : undefined);
  const handledInvalidationRef = useRef(0);
  useEffect(() => {
    if (invalidationNonce === handledInvalidationRef.current) return;
    handledInvalidationRef.current = invalidationNonce;
    if (recordQueryDerivesExpand && !objectSchemaReady) return;
    void reloadRef.current({ silent: true });
  }, [invalidationNonce, recordQueryDerivesExpand, objectSchemaReady]);

  // Transform data to gantt tasks
  const tasks = useMemo(() => {
    if (!ganttConfig || !data.length) {
      return [];
    }

    const { startDateField, endDateField, titleField, progressField, dependenciesField, colorField, borderColorField, parentField, typeField, lockField, tooltipFields, baselineStartField, baselineEndField, quickFilters } = ganttConfig;
    const fieldDefs: Record<string, any> = objectSchema?.fields ?? {};
    // The chart's calendar, keyed on the authored zone itself (objectui#10866).
    const chartZone = makeTzShift(ganttConfig.timeZone);
    // One resolver per declared colour field, built once for the whole
    // dataset rather than per row: rung 1 (the field's own option colour)
    // plus rung 2 (the value already IS a colour literal). See
    // `@object-ui/core#createFieldColorResolver` (objectui#7243).
    const resolveColorFieldValue = createFieldColorResolver(fieldDefs[colorField ?? '']);
    const resolveBorderColorFieldValue = createFieldColorResolver(fieldDefs[borderColorField ?? '']);

    // Fallback value→label maps from the view's quickFilters config. When the
    // data comes from an inline `value` provider there is no object schema, so select
    // fields have no option defs — but the same view often declares the exact
    // label pairs as quick-filter options (e.g. status: completed → "Completed").
    // Reuse them so the tooltip shows display labels, not raw machine values.
    const quickFilterLabels = new Map<string, Map<string, string>>();
    for (const qf of quickFilters ?? []) {
      if (!qf?.field || !Array.isArray(qf.options) || !qf.options.length) continue;
      const m = new Map<string, string>();
      for (const opt of qf.options) {
        if (typeof opt === 'string') m.set(opt, opt);
        else if (opt && opt.value != null) m.set(String(opt.value), opt.label ?? String(opt.value));
      }
      if (m.size) quickFilterLabels.set(qf.field, m);
    }

    // Resolve a value through nested paths like "account.name". Returns the
    // first non-empty string from the path (so lookups that resolve to either a
    // FK string or an embedded object both work).
    const resolvePath = (record: any, path: string): unknown => {
      if (!path) return undefined;
      const parts = path.split('.');
      let cur: any = record;
      for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
      }
      return cur;
    };

    // Title resolution (ADR-0079):
    //   1. configured `titleField` (supports dotted paths, e.g. `account.name`);
    //   2. a couple of common embedded-lookup labels that the object-level
    //      resolver can't see (the gantt often renders related records);
    //   3. the unified `@object-ui/core#getRecordDisplayName` — objectSchema
    //      titleFormat → displayNameField → type-aware field derivation →
    //      `Record #<id>` floor. This is what stops a task object whose name
    //      lives in e.g. `activity_name` (no `name`/title field) from rendering
    //      "Untitled".
    const resolveTitle = (record: any): string => {
      const direct: unknown[] = [
        resolvePath(record, titleField),
        // Common single embedded lookup labels (e.g. account.name on a contract).
        record?.account?.name,
        record?.opportunity?.name,
        record?.contact && [record.contact.first_name, record.contact.last_name].filter(Boolean).join(' '),
      ];
      for (const v of direct) {
        if (v != null && String(v).trim() !== '') return String(v);
      }
      return getRecordDisplayName(objectSchema, record);
    };

    // Label for a tooltip field: explicit override → object schema label →
    // humanized field name (so "due_date" reads as "Due Date").
    const resolveFieldLabel = (fieldName: string, explicit?: string): string => {
      if (explicit) return explicit;
      const def = fieldDefs[fieldName] ?? fieldDefs[fieldName.split('.')[0]];
      if (def?.label) return def.label;
      return humanizeLabel(fieldName);
    };

    // Format a tooltip value by its field type, mirroring how list/grid cells
    // render the same data: select options resolve to their label, lookups to
    // the embedded record's name, dates/numbers/currency/percent through the
    // shared @object-ui/fields formatters.
    const formatFieldValue = (value: unknown, fieldName: string): string => {
      if (value == null || value === '') return '—';
      const def = fieldDefs[fieldName] ?? fieldDefs[fieldName.split('.')[0]];
      const type: string | undefined = def?.type;
      const options: Array<{ value: unknown; label: string }> | undefined = def?.options;
      if (Array.isArray(options) && options.length) {
        const opt = options.find((o) => String(o.value) === String(value));
        if (opt) return opt.label;
      }
      // No schema options (an inline `value` provider has no object schema) → quick-filter
      // options declared for the same field carry the display labels.
      if (typeof value !== 'object') {
        const qfLabel = quickFilterLabels.get(fieldName)?.get(String(value));
        if (qfLabel != null) return qfLabel;
      }
      // No field def at all → sniff ISO date / datetime strings so raw
      // `2026-08-14T08:00:00.000Z` payloads still format like real date fields.
      if (type == null && typeof value === 'string') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value, undefined, { locale: displayLocale });
        if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value) && !isNaN(new Date(value).getTime())) {
          return formatDateTime(value, { locale: displayLocale });
        }
      }
      switch (type) {
        case 'date':
          return formatDate(value as any, undefined, { locale: displayLocale });
        case 'datetime':
          return formatDateTime(value as any, { locale: displayLocale });
        // The numeric rows take the same `displayLocale` as the temporal ones
        // above (objectui#4553). Without it these reached
        // `new Intl.NumberFormat(undefined, …)`, i.e. the MACHINE's locale —
        // neither of the repo's two locale channels — so one tooltip rendered
        // two conventions: a German session read `5. Jan. 2024` on the date row
        // and `1,234.50` on the amount row beside it, where German groups with
        // `.` and marks the decimal with `,`. Inverted separators do not read
        // as an unstyled number; they read as a DIFFERENT number.
        //
        // objectui#11254 — and the WIDTH is the field's, read through
        // `resolveFieldScale` (ruling A′ on objectstack-ai/objectstack#19628).
        // This row handed `formatNumber` an `undefined` width, so that
        // function's own parameter default (two places) decided: a `scale: 3`
        // field read `1.50`, a `scale: 0` field read `1.50`, and an undeclared
        // `number` read `1.50` beside a list cell reading `1.5`. `formatNumber`
        // cannot say "no fixed width" (it fixes both bounds to one number), so
        // the row renders through `formatDisplayNumber` with the two arms
        // `NumberCellRenderer` spells: a resolved width fixes both bounds, and
        // `undefined` (the protocol has no absent-`scale` row for any of these
        // types, `integer` included) is the value's natural precision.
        // ⛔ No `?? N` beside the resolver: `undefined` is its answer.
        //
        // ⚠️ Width only. No `scale` reaches the grouping policy here, so the
        // row keeps grouping as it did; the list cell's ordinal rule for a
        // declared `scale: 0` and its authored `useGrouping` are not this
        // card's subject.
        case 'number':
        case 'integer':
        case 'float':
        case 'decimal': {
          const width = resolveFieldScale({ type: def?.type, scale: def?.scale });
          return formatDisplayNumber(
            Number(value),
            width === undefined
              ? { locale: displayLocale, minimumFractionDigits: 0, maximumFractionDigits: 20 }
              : { locale: displayLocale, minimumFractionDigits: width, maximumFractionDigits: width },
          );
        }
        case 'currency':
          // The CODE was already resolved correctly (objectui#4542 made the memo
          // watch it); the locale that renders that code is what was missing.
          return formatCurrency(
            Number(value),
            resolveFieldCurrency(def as any, tenantCurrency),
            displayLocale,
          );
        // `percent` completes the switch (objectui#4553 phase 2). It could not
        // be threaded when the other two were: `formatPercent` took no locale
        // parameter and never touched `Intl`, so it rendered in NO locale at
        // all — ASCII `.`, never grouped, `1235%` on every machine. That was
        // fixed at the producer rather than reimplemented here, which would
        // have forked percent formatting away from the list cell renderer and
        // the dashboard that share `percentDisplayValue`.
        //
        // objectui#11254 — and the WIDTH is the field's, read through
        // `resolveFieldScale` (ruling A′ on objectstack-ai/objectstack#19628):
        // the declared `scale` when well-formed, otherwise the protocol's row
        // for a percent. This row handed `formatPercent` an `undefined` width,
        // so the function's own parameter default decided, and a percent
        // declaring `scale: 2` read whole percents here beside a list cell
        // reading two decimals. The cell asks the same function, so the two
        // agree by reference.
        //
        // objectui#11475 — and the STORAGE is the field's: `percentCellScale`
        // is the spec's `percentScaleOf` over this def (a fraction unless it
        // declares a `max` above 1), the answer the list cell reads. The shared
        // scaling used to guess from the value's magnitude, so a
        // fraction-stored `1` (100%) read `1%` in this tooltip.
        case 'percent':
          return formatPercent(
            Number(value),
            percentCellScale(def),
            resolveFieldScale({ type: def?.type, scale: def?.scale }),
            displayLocale,
          );
        case 'boolean':
        case 'checkbox':
          return value ? 'Yes' : 'No';
        default:
          // Multi-value lookup / multiselect: a populated relation array is
          // [{name},{name}] — also `typeof 'object'`, but with no
          // name/label/title/id of its own. Map each element to its display
          // value (scalars pass through) and join, so e.g. an "assigned owners"
          // lookup renders the assignees instead of collapsing to '—'.
          if (Array.isArray(value)) {
            const parts = value
              .map((el) => {
                if (el == null) return '';
                if (typeof el === 'object') {
                  const o = el as any;
                  return String(o.name ?? o.label ?? o.title ?? o.id ?? '');
                }
                return String(el);
              })
              .filter(Boolean);
            return parts.length ? parts.join(', ') : '—';
          }
          if (typeof value === 'object') {
            const o = value as any;
            return String(o.name ?? o.label ?? o.title ?? o.id ?? '—');
          }
          return String(value);
      }
    };

    const buildTooltipFields = (record: any): Array<{ label: string; value: string }> | undefined => {
      if (!tooltipFields || !tooltipFields.length) return undefined;
      const rows: Array<{ label: string; value: string }> = [];
      for (const entry of tooltipFields) {
        const fieldName = typeof entry === 'string' ? entry : entry?.field;
        if (!fieldName) continue;
        const explicitLabel = typeof entry === 'object' ? entry.label : undefined;
        const raw = resolvePath(record, fieldName);
        // Per-level tooltips: mixed trees list the UNION of every
        // level's fields here; a row omits the ones that don't apply to it, so
        // an absent value must drop the line, not render a placeholder dash.
        if (raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0)) continue;
        rows.push({
          label: resolveFieldLabel(fieldName, explicitLabel),
          value: formatFieldValue(raw, fieldName),
        });
      }
      return rows.length ? rows : undefined;
    };

    return data.map((record, index) => {
      const startDate = record[startDateField];
      const endDate = record[endDateField];
      const baselineStartRaw = baselineStartField ? record[baselineStartField] : undefined;
      const baselineEndRaw = baselineEndField ? record[baselineEndField] : undefined;
      const baselineStart = baselineStartRaw ? readTaskDate(baselineStartRaw, chartZone) : undefined;
      const baselineEnd = baselineEndRaw ? readTaskEnd(baselineEndRaw, chartZone) : undefined;
      const title = resolveTitle(record);
      const progress = progressField ? record[progressField] : 0;
      const dependencies = dependenciesField ? record[dependenciesField] : [];
      // Bar color resolution (objectui#7243). `colorField` NAMES A FIELD to
      // derive a colour from — it is not itself a colour, and the value stored
      // in that field usually isn't one either. The rungs, shared with
      // plugin-timeline and plugin-calendar via `createFieldColorResolver`:
      //   1. the field's own option `color` for this record's value —
      //      the colour the author actually declared;
      //   2. the value itself when it already IS a colour literal;
      //   3. the semantic-token derivation, which also maps a palette NAME
      //      ('red') to that palette's hex — what the key's contract has always
      //      promised ("hex or semantic name").
      // Only when `colorField` is absent or its value is empty do we fall back
      // to the record's status / state / priority so the chart reflects the
      // same colour story as list/kanban; if neither exists GanttView paints
      // the platform default blue.
      //
      // ⛔ The raw value must never reach `color` again. That was this card's
      // defect: `backgroundColor: "open"` is not a colour, so the browser
      // dropped the declaration and every bar rendered identically — DECLARING
      // the documented key was strictly worse than omitting it, silently.
      const colorValue = colorField ? record[colorField] : undefined;
      let color = resolveColorFieldValue(colorValue);
      if (!color && colorValue != null && colorValue !== '') {
        // Rung 3 for the declared field's own value. `getSemanticColorName`
        // always answers for a non-empty value (semantic map, else its stable
        // hash), so a declared `colorField` always paints something real.
        color = getSemanticHex(getSemanticColorName(String(colorValue), colorValue));
      }
      if (!color) {
        const fallbackVal =
          record.status ?? record.state ?? record.priority ?? record.severity;
        if (fallbackVal != null && fallbackVal !== '') {
          const name = getSemanticColorName(undefined, fallbackVal);
          if (name) color = getSemanticHex(name);
        }
      }
      // Alert stroke: the option colour first (same rung 1 as the bar — an
      // authored option colour is an authored option colour whichever slot it
      // paints), then today's behaviour: semantic palette names map to their
      // hex, anything else (hex, css color) passes through untouched.
      //
      // Deliberately NO rung 3 here. The stroke is opt-in and exceptional —
      // deriving one for every record would draw an alert on records that have
      // none, which is a repaint, not a fix.
      const borderColorRaw = borderColorField ? record[borderColorField] : undefined;
      const borderColor =
        borderColorRaw != null && borderColorRaw !== ''
          ? resolveBorderColorFieldValue(borderColorRaw)
            ?? getSemanticHex(String(borderColorRaw), String(borderColorRaw))
          : undefined;

      return {
        id: record.id || record._id || `task-${index}`,
        title,
        // A date-only day stands on that day (objectui#10866, `readTaskDate`),
        // and a date-only end runs through its day (objectui#11141,
        // `readTaskEnd`).
        start: startDate ? readTaskDate(startDate, chartZone) : new Date(),
        end: endDate ? readTaskEnd(endDate, chartZone) : new Date(),
        // Whether the record carried real dates (vs the placeholder "today"
        // above) — summaryExtent:'self' falls back to rollup when it didn't.
        hasOwnDates: !!(startDate && endDate),
        progress: Math.min(100, Math.max(0, progress || 0)), // Clamp between 0-100
        dependencies: normalizeDependencies(dependencies),
        parent: parentField ? record[parentField] ?? null : undefined,
        type: typeField ? normalizeTaskType(record[typeField]) : undefined,
        locked: lockField ? !!record[lockField] : undefined,
        color,
        borderColor,
        baselineStart: baselineStart && !isNaN(baselineStart.getTime()) ? baselineStart : undefined,
        baselineEnd: baselineEnd && !isNaN(baselineEnd.getTime()) ? baselineEnd : undefined,
        fields: buildTooltipFields(record),
        data: record,
      };
    }).filter(task => !isNaN(task.start.getTime()) && !isNaN(task.end.getTime()));
    // `displayLocale` is a dependency because the tooltip strings are FORMATTED
    // in here: without it a language switch would leave already-built tooltips
    // on the previous locale.
    //
    // `tenantCurrency` is one for exactly the same reason, in the other channel
    // (objectui#4542): the `'currency'` case resolves its code down to the
    // tenant default eagerly in here. That default arrives from
    // `GET /api/v1/auth/me/localization`, which is cosmetic and non-blocking and
    // therefore answers AFTER first paint — so the memo has to be able to re-run
    // on it alone. It is not covered by `displayLocale`: a tenant that
    // configures a currency but no locale (the common shape) leaves that value
    // untouched, and the tooltip would keep its pre-resolution rendering.
  }, [data, ganttConfig, objectSchema, displayLocale, tenantCurrency]);

  // Dynamic Group by accessor. Resolves each task's grouping
  // value off its backing record, mapping select options / lookups to their
  // display label — the same value story as list/kanban grouping. Returns null
  // for empty values so those tasks fall into GanttView's "ungrouped" bucket.
  const groupByAccessor = useMemo(() => {
    const field = ganttConfig?.groupByField;
    if (!field) return undefined;
    const fieldDefs: Record<string, any> = objectSchema?.fields ?? {};
    const resolvePath = (record: any, path: string): unknown => {
      if (!path) return undefined;
      let cur: any = record;
      for (const p of path.split('.')) {
        if (cur == null) return undefined;
        cur = cur[p];
      }
      return cur;
    };
    const labelFor = (value: unknown): string => {
      const def = fieldDefs[field] ?? fieldDefs[field.split('.')[0]];
      const options: Array<{ value: unknown; label: string }> | undefined = def?.options;
      if (Array.isArray(options) && options.length) {
        const opt = options.find((o) => String(o.value) === String(value));
        if (opt) return opt.label;
      }
      if (typeof value === 'object' && value !== null) {
        const o = value as any;
        return String(o.name ?? o.label ?? o.title ?? o.id ?? value);
      }
      return String(value);
    };
    return (task: GanttTask): { key: string | number; label: string } | null => {
      const raw = resolvePath((task as any).data, field);
      if (raw == null || raw === '') return null;
      // Group key uses the embedded record's id for lookups so two labels that
      // collide still split correctly; otherwise the scalar value.
      const key =
        typeof raw === 'object' && raw !== null
          ? String((raw as any).id ?? (raw as any)._id ?? labelFor(raw))
          : (raw as string | number);
      return { key, label: labelFor(raw) };
    };
  }, [ganttConfig?.groupByField, objectSchema]);

  // Resource / Workload view. `assigneeAccessor` buckets each
  // task by its resource field (select option / lookup → display label, same as
  // grouping); `effortAccessor` reads the per-task load (default 1). Both read
  // off the backing record so the histogram reflects the real assignment data.
  const assigneeAccessor = useMemo(() => {
    const field = ganttConfig?.assigneeField;
    if (!field) return undefined;
    const fieldDefs: Record<string, any> = objectSchema?.fields ?? {};
    const resolvePath = (record: any, path: string): unknown => {
      if (!path) return undefined;
      let cur: any = record;
      for (const p of path.split('.')) {
        if (cur == null) return undefined;
        cur = cur[p];
      }
      return cur;
    };
    const labelFor = (value: unknown): string => {
      const def = fieldDefs[field] ?? fieldDefs[field.split('.')[0]];
      const options: Array<{ value: unknown; label: string }> | undefined = def?.options;
      if (Array.isArray(options) && options.length) {
        const opt = options.find((o) => String(o.value) === String(value));
        if (opt) return opt.label;
      }
      if (typeof value === 'object' && value !== null) {
        const o = value as any;
        return String(o.name ?? o.label ?? o.title ?? o.id ?? value);
      }
      return String(value);
    };
    return (task: GanttTask): { key: string | number; label: string } | null => {
      const raw = resolvePath((task as any).data, field);
      if (raw == null || raw === '') return null;
      const key =
        typeof raw === 'object' && raw !== null
          ? String((raw as any).id ?? (raw as any)._id ?? labelFor(raw))
          : (raw as string | number);
      return { key, label: labelFor(raw) };
    };
  }, [ganttConfig?.assigneeField, objectSchema]);

  const effortAccessor = useMemo(() => {
    const field = ganttConfig?.effortField;
    if (!field) return undefined;
    return (task: GanttTask): number => {
      const raw = (task as any).data?.[field];
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : 1;
    };
  }, [ganttConfig?.effortField]);

  // Working calendar: when the schema opts into weekend-skipping or supplies a
  // holiday list, duration/reschedule math is measured in working days. The
  // holidays array (ISO yyyy-mm-dd strings) becomes a Set for O(1) lookups.
  const workingCalendar = useMemo<WorkingCalendar | undefined>(() => {
    const sw = schema.skipWeekends;
    const hol = schema.holidays;
    if (!sw && (!hol || hol.length === 0)) return undefined;
    return {
      skipWeekends: !!sw,
      holidays: hol && hol.length ? new Set(hol) : undefined,
    };
  }, [schema]);

  // Shift segmentation. Normalize the declarative `timeSegments` config
  // once into the model GanttView lays band columns / snaps drags against. null
  // (no/invalid config) leaves the timeline an ordinary day axis.
  const shiftSegments = useMemo(
    () => normalizeShiftSegments(ganttConfig?.timeSegments),
    [ganttConfig?.timeSegments],
  );

  // ── Quick filters ────────────────────────────────────────────────────────
  // Resolve each task's value for a filter dimension into a stable key. Lookups
  // resolve to the embedded record's id (matching the lookup option values);
  // scalars / select values use their string form. Mirrors the grouping key
  // logic so a filter and a group-by on the same field agree.
  const resolveFilterKey = useCallback((record: any, field: string): string | null => {
    if (!record || !field) return null;
    let cur: any = record;
    for (const p of field.split('.')) {
      if (cur == null) return null;
      cur = cur[p];
    }
    if (cur == null || cur === '') return null;
    if (typeof cur === 'object') {
      const o = cur as any;
      return String(o.id ?? o._id ?? o.value ?? o.name ?? '');
    }
    return String(cur);
  }, []);

  const quickFilterDefs = ganttConfig?.quickFilters;

  // Lookup/master_detail dimensions pull their full option domain from the
  // referenced object (reference) via the data source — so the dropdown
  // shows every possible value, not only those present in the loaded rows.
  const [lookupOptions, setLookupOptions] = useState<Record<string, QuickFilterOption[]>>({});
  useEffect(() => {
    if (!quickFilterDefs?.length || !dataSource || typeof dataSource.find !== 'function') return;
    const fieldDefs: Record<string, any> = objectSchema?.fields ?? {};
    let cancelled = false;
    (async () => {
      const next: Record<string, QuickFilterOption[]> = {};
      for (const def of quickFilterDefs) {
        if (def.options) continue; // explicit override — no fetch
        const fd = fieldDefs[def.field] ?? fieldDefs[def.field.split('.')[0]];
        const type: string | undefined = fd?.type;
        if (type !== 'lookup' && type !== 'master_detail') continue;
        // ONE arm: `reference`, the only target spelling the protocol
        // declares. `@objectstack/spec`'s `FieldSchema` refuses `reference_to`,
        // `referenceTo` and `target` by name with `unrecognized_keys`, each
        // carrying its own "did you mean -> `reference`?" rename.
        //
        // The `referenceTo` arm went in objectui#6837 slice 2; the
        // `reference_to` arm goes here, in half 2, under the maintainer's
        // 2026-08-31 ruling that protocol normalization belongs on the SERVER
        // (objectstack#13847 rewrites stored `reference_to` -> `reference` on
        // the serve path and in `os migrate meta`). A def that still spells
        // only a legacy key is canonicalised ONCE at the ingestion choke point
        // (`normalizeSchemaReferenceKeys`, which now also warns in dev) —
        // never by a renderer-side alias. Pinned in
        // `ObjectGantt.referenceArms-6837.test.tsx`.
        const refObject: string | undefined = fd?.reference;
        if (!refObject) continue;
        try {
          const result = await dataSource.find(refObject, { $top: 1000 });
          const records = extractRecords(result);
          next[def.field] = records.map((r: any) => ({
            value: String(r.id ?? r._id ?? r.value ?? ''),
            label: String(r.name ?? r.label ?? r.title ?? r.id ?? r._id ?? ''),
          }));
        } catch (err) {
          console.warn(`[ObjectGantt] Failed to load quick-filter options for "${def.field}":`, err);
        }
      }
      if (!cancelled) setLookupOptions((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(quickFilterDefs), dataSource, objectSchema]);

  // Resolve the final option list per dimension, by priority:
  //   1. explicit `options` on the def (fixed enums like a work-order category)
  //   2. select/enum field options from the object schema (full domain)
  //   3. fetched lookup reference records (full domain, async above)
  //   4. distinct values present in the loaded data (fallback)
  const resolvedQuickFilters = useMemo<QuickFilterField[]>(() => {
    if (!quickFilterDefs?.length) return [];
    const fieldDefs: Record<string, any> = objectSchema?.fields ?? {};
    return quickFilterDefs.map((def) => {
      const fd = fieldDefs[def.field] ?? fieldDefs[def.field.split('.')[0]];
      const label = def.label ?? fd?.label ?? humanizeLabel(def.field);
      // Assigned by every branch of the exhaustive if/else chain below.
      let options: QuickFilterOption[];

      if (def.options?.length) {
        options = def.options.map((o) =>
          typeof o === 'object'
            ? { value: String(o.value), label: String(o.label ?? o.value) }
            : { value: String(o), label: String(o) },
        );
      } else if (Array.isArray(fd?.options) && fd.options.length) {
        options = fd.options.map((o: any) => ({
          value: String(o.value ?? o),
          label: String(o.label ?? o.value ?? o),
        }));
      } else if (lookupOptions[def.field]?.length) {
        options = lookupOptions[def.field];
      } else {
        // Distinct fallback: derive labels from the records themselves.
        const seen = new Map<string, string>();
        for (const record of data) {
          const key = resolveFilterKey(record, def.field);
          if (key == null) continue;
          if (!seen.has(key)) {
            // Pull a readable label off the raw value (embedded lookup name or scalar).
            let cur: any = record;
            for (const p of def.field.split('.')) cur = cur?.[p];
            const lbl =
              cur && typeof cur === 'object'
                ? String((cur as any).name ?? (cur as any).label ?? (cur as any).title ?? key)
                : key;
            seen.set(key, lbl);
          }
        }
        options = [...seen.entries()].map(([value, lbl]) => ({ value, label: lbl }));
      }
      return { field: def.field, label, options };
    });
  }, [quickFilterDefs, objectSchema, lookupOptions, data, resolveFilterKey]);

  // `saveLayout` covers the quick-filter chips too: GanttView persists its own
  // snapshot under persistLayoutKey and fires onLayoutChange; the chips live up
  // here, so they get a sibling localStorage key and restore on mount.
  //
  // ⛔ This line does NOT delegate to `resolveRecordSourceObjectName`, and its
  // inverted order relative to `resource` above is not the drift `b041b9c0c`
  // collapsed: the two were never answering the same question. What this
  // resolves is a localStorage KEY (`gantt-layout:<key>:filters`), not a record
  // source — re-pointing it silently orphans every saved layout and filter-chip
  // set of any view carrying BOTH bindings. A storage-key migration is a
  // separate, user-visible change, so `b041b9c0c` excluded this
  // site from the collapse and left the precedence exactly as it is.
  const persistLayoutKey =
    schema.persistLayout === false
      ? undefined
      : `${schema.objectName || (dataConfig?.provider === 'object' ? dataConfig.object : '') || 'gantt'}:${schema.viewName || 'default'}`;
  const filtersStorageKey = persistLayoutKey ? `gantt-layout:${persistLayoutKey}:filters` : null;
  const [filterValues, setFilterValues] = useState<Record<string, string[]>>(() => {
    if (!filtersStorageKey || typeof window === 'undefined') return {};
    try {
      const parsed = JSON.parse(window.localStorage.getItem(filtersStorageKey) || 'null');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const out: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string');
      }
      return out;
    } catch {
      return {};
    }
  });
  const persistFilters = useCallback(() => {
    if (!filtersStorageKey || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(filtersStorageKey, JSON.stringify(filterValues));
    } catch {
      /* storage unavailable / full — non-fatal */
    }
  }, [filtersStorageKey, filterValues]);
  const handleFilterChange = useCallback((field: string, values: string[]) => {
    setFilterValues((prev) => ({ ...prev, [field]: values }));
  }, []);
  const clearFilters = useCallback(() => setFilterValues({}), []);

  // Detail-page href for a row, honouring objectField (mixed-object trees):
  // the link must follow the ROW's object, not the view's bound one — a child-object
  // row opened under the bound object's route otherwise builds a 404 URL.
  // deriveRecordPageHref needs the routed object's segment in the current path
  // (a foreign row object never appears there), so derive from the routed
  // object and swap the segment. Used by the drawer's full-page link.
  // With objectField configured, a row without a value is a synthetic group
  // header composed by the endpoint (its id isn't a real record id) — no
  // detail page or drawer exists for it.
  const isSyntheticRow = useCallback(
    (rec: Record<string, any> | undefined): boolean =>
      !!ganttConfig?.objectField && !String(rec?.[ganttConfig.objectField] ?? '').trim(),
    [ganttConfig?.objectField],
  );

  const recordDetailHref = useCallback(
    (rec: Record<string, any>): { objectName: string; recordId: string | number; href: string | null } | null => {
      const rowObject = ganttConfig?.objectField
        ? String(rec[ganttConfig.objectField] ?? '').trim()
        : '';
      const objectName = rowObject || resource;
      const recordId = rec.id ?? rec._id;
      if (!objectName || recordId == null) return null;
      const routedHref = resource ? deriveRecordPageHref(resource, recordId) : null;
      const href =
        !resource || objectName === resource
          ? routedHref
          : routedHref?.replace(`/${resource}/record/`, `/${objectName}/record/`) ?? null;
      return { objectName, recordId, href };
    },
    [ganttConfig?.objectField, resource],
  );

  // Apply the active filters in memory: a task matches when, for every dimension
  // with a non-empty selection, its resolved key is among the selected values.
  // Tree-aware: every ancestor of a match is retained too — group/parent rows
  // rarely match themselves (they carry no filterable record), and dropping
  // them would orphan the matches and flatten the tree.
  const displayTasks = useMemo(() => {
    const active = Object.entries(filterValues).filter(([, v]) => v.length > 0);
    if (!active.length) return tasks;
    const byId = new Map(tasks.map((t) => [String(t.id), t]));
    const keep = new Set<string>();
    for (const t of tasks) {
      const matches = active.every(([field, vals]) => {
        const key = resolveFilterKey((t as any).data, field);
        return key != null && vals.includes(key);
      });
      if (!matches) continue;
      let cur: GanttTask | undefined = t;
      while (cur && !keep.has(String(cur.id))) {
        keep.add(String(cur.id));
        cur = cur.parent != null ? byId.get(String(cur.parent)) : undefined;
      }
    }
    return tasks.filter((t) => keep.has(String(t.id)));
  }, [tasks, filterValues, resolveFilterKey]);

  // Auto-zoom is free: GanttView derives the timeline range from the tasks it
  // receives, so passing the (smaller) filtered set rescales the axis. To pin
  // the range instead (autoZoomToFilter === false), compute a fixed window from
  // the FULL task set and hand it to GanttView so filtering only hides bars.
  //
  // `end` is the last instant a bar covers, not a bar's end: a task's `end` is
  // the EXCLUSIVE end of its span (a date-only end is handed over as the next
  // day's midnight, `readTaskEnd`, objectui#11141), and `GanttView` runs an
  // `endDate` through the end of the day it falls on. Handing it an end itself
  // would add an empty day column after the last day any task runs through.
  const lockedRange = useMemo<{ start: Date; end: Date } | null>(() => {
    if (ganttConfig?.autoZoomToFilter !== false || !tasks.length) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const t of tasks) {
      const start = t.start.getTime();
      const end = t.end.getTime();
      min = Math.min(min, start);
      max = Math.max(max, end > start ? end - 1 : start);
    }
    return { start: new Date(min), end: new Date(max) };
  }, [tasks, ganttConfig?.autoZoomToFilter]);

  // Default to a right-side drawer so clicking a task opens an editable
  // detail panel inline (no full-page navigation). Schema can override by
  // providing its own `navigation` config (e.g., page mode).
  //
  // No width is spelled here on purpose. `width` is `@deprecated [objectstack-ai/objectstack#2578 ->
  // size]` in the spec that owns this shape, and `resolveOverlayWidth` gives
  // an explicit `width` priority OVER `size` — so spelling it kept the
  // deprecated branch load-bearing on the path most gantts take (no declared
  // `navigation`), and made the size buckets unreachable there. Omitting both
  // leaves `resolveOverlayWidth` returning `undefined`, which is what
  // RecordDetailDrawer's own `width` default is for; that default is the
  // identical `min(960px, 60vw)`, so this is a zero-pixel change on every
  // viewport. Pinned by ObjectGantt.navWidthDefault.test.tsx — both halves,
  // because the equivalence now depends on the drawer's default too.
  //
  // Deliberately NOT converged on `size: 'lg'`: that bucket is
  // `min(92vw, 960px)`, which agrees with the above only at viewport >=
  // 1600px and is up to 53% wider below it. Whether the renderers should move
  // to the bucket was asked here (#6259) and then carried across
  // kanban/calendar/RecordDetailDrawer as one decision (#6303); both of those
  // cards closed on their `width` half, and the bucket half was RULED AGAINST
  // on its own card: objectui#6584, 2026-08-27 — stays on the CSS literal; no
  // bucket convergence. All four surfaces keep today's pixels. The question is
  // CLOSED, not open — do not re-open it as a cleanup. If bucket-vocabulary
  // unification ever becomes a product direction that is a fresh ruling, with
  // visual-regression evidence across all four surfaces in one stroke.
  const navConfig = schema.navigation ?? { mode: 'drawer' };
  const navIsOverlay = navConfig.mode === 'drawer' || navConfig.mode === 'modal' || navConfig.mode === 'split' || navConfig.mode === 'popover';

  // objectui#7334 — the NON-OVERLAY half of an authored `navigation`, and the
  // reason this component needed one at all.
  //
  // `useNavigationOverlay` routes a click three ways once the mode is known:
  // it owns the four overlay modes itself; `new_window` calls `onNavigate` and
  // otherwise falls through to a `window.open`; and `page` calls `onNavigate`
  // and then **returns with no fallback**. This component supplied no
  // `onNavigate`, and its own registration hands it no host `onRowClick`
  // either (`ObjectGanttRenderer` forwards `schema` and `dataSource` only —
  // objectui#7210 / objectui#7222). So `page` had BOTH carriers empty at once.
  //
  // That was invisible until the sibling half of objectui#7334 started
  // forwarding the authored `navigation` down the gantt view-schema path: the
  // mode was unreachable before, and reaching it turned an authored
  // `{ mode: 'page' }` from "a drawer opens, which is the wrong thing" into "a
  // click does nothing at all". A silent dead click is worse than a loud wrong
  // one, so the sink lands on the same card rather than as a follow-up.
  //
  // ⛔ NOT a host prop forwarded to the chart. Nothing is taken from
  // `ObjectGanttRenderer`, no `{...props}` is spread anywhere, and
  // objectui#7210 half 2 stays untouched and unruled. The destination is the
  // one this component ALREADY computes for the drawer's full-page link, so a
  // `page` click and the drawer's "open full page" affordance cannot diverge.
  //
  // ⚠️ `recordDetailHref` is row-based, not id-based, because a mixed-object
  // gantt (`ganttConfig.objectField`) routes a row to ITS OWN object rather
  // than the view's — the id alone cannot answer which object a row belongs
  // to. The hook hands back only the record id, so the row is looked up again
  // here; when it cannot be found the view's own object is the honest
  // fallback, which is exactly what a single-object gantt always resolves to.
  //
  // Same-tab navigation uses the history + `popstate` pair rather than
  // `location.assign`, matching `DashboardRenderer` and `PageHeader`: every
  // href `deriveRecordPageHref` builds is app-relative, so a full document
  // load would throw away the SPA it is navigating inside.
  const navigateToRecord = useCallback(
    (recordId: string | number, action?: string) => {
      if (typeof window === 'undefined') return;
      const key = String(recordId);
      const row = tasks.find((t) => {
        const rec = t.data as Record<string, any> | undefined;
        return !!rec && String(rec.id ?? rec._id) === key;
      })?.data as Record<string, any> | undefined;
      const href = row
        ? recordDetailHref(row)?.href ?? null
        : resource
          ? deriveRecordPageHref(resource, recordId)
          : null;
      // No derivable destination ⇒ do nothing, exactly as before. An invented
      // URL would be the fabrication the invented-binding work (`5f4514f7b`) spent this file's other
      // branches removing.
      if (!href) return;
      if (action === 'new_window') {
        window.open(href, '_blank');
        return;
      }
      window.history.pushState({}, '', href);
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    [tasks, recordDetailHref, resource],
  );

  const navigation = useNavigationOverlay({
    navigation: navConfig,
    objectName: schema.objectName,
    onNavigate: navigateToRecord,
    onRowClick: navIsOverlay ? undefined : onRowClick,
  });

  // objectui#9299 item 3 — `popover` anchors to the bar/row the user clicked.
  // The capture handler goes on this component's own container below, because
  // `GanttView` hands `onTaskClick` a task and not a DOM event.
  const { anchorRef, anchorCaptureProps } = useOverlayAnchor();

  // #2473: a foreign-object row (its `objectField` names another object than
  // the bound one) has no schema loaded, so the drawer degraded to humanized
  // English labels. When the drawer opens, fetch the REAL record (and its
  // schema) through the context DataSource; fall back to the raw row when
  // there's no context DS or the fetch fails (inline `value` demos keep
  // working unchanged).
  const [drawerFetch, setDrawerFetch] = useState<{ key: string; record: any; schema: any } | null>(null);
  const drawerRec = navigation.isOverlay && navigation.isOpen
    ? (navigation.selectedRecord as Record<string, any> | null)
    : null;
  useEffect(() => {
    if (!drawerRec) { setDrawerFetch(null); return; }
    const detail = recordDetailHref(drawerRec);
    if (!detail) { setDrawerFetch(null); return; }
    const { objectName, recordId } = detail;
    const needsRealRecord = objectName !== resource;
    if (!needsRealRecord || !dataSource || typeof dataSource.findOne !== 'function') {
      setDrawerFetch(null);
      return;
    }
    const key = `${objectName}:${recordId}`;
    let cancelled = false;
    (async () => {
      try {
        // Schema comes from the SAME context DataSource as the record — the
        // component-level `objectSchema` state is the BOUND object's, not
        // this row's.
        const [record, schema] = await Promise.all([
          dataSource.findOne(objectName, String(recordId)),
          typeof dataSource.getObjectSchema === 'function'
            ? dataSource.getObjectSchema(objectName).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (!cancelled) setDrawerFetch(record ? { key, record, schema } : null);
      } catch (err) {
        console.error('[ObjectGantt] Failed to fetch drawer record, falling back to row payload:', err);
        if (!cancelled) setDrawerFetch(null);
      }
    })();
    return () => { cancelled = true; };
  }, [drawerRec, recordDetailHref, resource, dataSource]);

  // Persist a drag-driven reschedule back to the data source. Mirrors
  // ObjectCalendar.handleEventDropDefault: optimistic local patch, then
  // dataSource.update; on failure we revert and log.
  const handleTaskUpdateDefault = useCallback(
    async (task: GanttTask, changes: { start?: Date; end?: Date; title?: string; progress?: number }) => {
      if (!ganttConfig) return;
      if (!effectiveDataSource || typeof effectiveDataSource.update !== 'function') return;

      const { startDateField, endDateField, titleField, progressField } = ganttConfig;
      // A `date` field is written as the calendar day, a `datetime` as the
      // instant (objectui#10866, `toStoredDateValue`).
      const fieldDefs = objectSchema?.fields as Record<string, { type?: unknown } | undefined> | undefined;
      const stored: Record<string, unknown> = task.data ?? {};
      const chartZone = makeTzShift(ganttConfig.timeZone);
      const patch: Record<string, unknown> = {};
      if (changes.start instanceof Date) {
        patch[startDateField] = toStoredDateValue(changes.start, fieldDefs?.[startDateField]?.type, stored[startDateField], chartZone);
      }
      if (changes.end instanceof Date) {
        patch[endDateField] = toStoredDateValue(changes.end, fieldDefs?.[endDateField]?.type, stored[endDateField], chartZone, 'end');
      }
      if (typeof changes.title === 'string' && titleField) patch[titleField] = changes.title;
      if (typeof changes.progress === 'number' && progressField) patch[progressField] = changes.progress;
      if (Object.keys(patch).length === 0) return;

      const recordId = (task as any).data?.id ?? (task as any).data?._id ?? task.id;
      if (recordId == null) return;

      // Optimistic update — replace the matching record in local state.
      const prevSnapshot = data;
      setData((prev) =>
        prev.map((r) =>
          String(r.id ?? r._id) === String(recordId) ? { ...r, ...patch } : r,
        ),
      );

      try {
        await effectiveDataSource.update(resource, String(recordId), patch);
        // Read back so server-computed fields (parent rollups, alert
        // colors, recalculated durations) refresh — the optimistic patch
        // only knows what the client wrote (#2436 item 6).
        void reload({ silent: true });
      } catch (err) {
        console.error('[ObjectGantt] Failed to persist task update:', err);
        setData(prevSnapshot); // revert
        notifyWriteError(err);
      }
    },
    [ganttConfig, effectiveDataSource, resource, data, reload, notifyWriteError, objectSchema],
  );

  // Re-serialize a normalized dependency list back onto a record field,
  // preserving the field's original shape where possible: a CSV string stays
  // CSV *as long as* no link carries a non-default (non-FS) type — types can't
  // round-trip through CSV, so the moment one appears we promote to the object
  // array form (`[{ id, type }, …]`). Plain FS links serialize as bare ids.
  const serializeDependencies = (raw: unknown, deps: GanttDependency[]): unknown => {
    const hasTypes = deps.some((d) => typeof d === 'object' && d.type && d.type !== 'fs');
    if (!hasTypes && typeof raw === 'string') {
      return deps.map((d) => String(typeof d === 'object' ? d.id : d)).join(',');
    }
    if (!hasTypes) {
      return deps.map((d) => (typeof d === 'object' ? d.id : d));
    }
    return deps.map((d) =>
      typeof d === 'object'
        ? (d.type && d.type !== 'fs' ? { id: d.id, type: d.type } : d.id)
        : d,
    );
  };

  const persistDependencies = useCallback(
    async (targetId: string | number, raw: unknown, nextDeps: GanttDependency[]) => {
      const depField = ganttConfig?.dependenciesField;
      if (!depField) return;
      if (!effectiveDataSource || typeof effectiveDataSource.update !== 'function') return;
      const nextValue = serializeDependencies(raw, nextDeps);
      const prevSnapshot = data;
      setData((prev) =>
        prev.map((r) =>
          String(r.id ?? r._id) === String(targetId) ? { ...r, [depField]: nextValue } : r,
        ),
      );
      try {
        await effectiveDataSource.update(resource, String(targetId), { [depField]: nextValue });
        void reload({ silent: true }); // write-readback — see handleTaskUpdateDefault
      } catch (err) {
        console.error('[ObjectGantt] Failed to persist dependency:', err);
        setData(prevSnapshot); // revert
        notifyWriteError(err);
      }
    },
    [ganttConfig, effectiveDataSource, resource, data, reload, notifyWriteError],
  );

  // Persist a created/updated dependency (create + link type): upsert the source
  // (predecessor) id onto the target record's dependencies field with the given
  // link type. Re-invoking with a different type updates that link's type.
  const handleDependencyCreate = useCallback(
    async (source: GanttTask, target: GanttTask, type: GanttLinkType = 'fs') => {
      const sourceId = (source as any).data?.id ?? (source as any).data?._id ?? source.id;
      const targetId = (target as any).data?.id ?? (target as any).data?._id ?? target.id;
      if (sourceId == null || targetId == null) return;
      const depField = ganttConfig?.dependenciesField;
      if (!depField) return;

      const record = data.find((r) => String(r.id ?? r._id) === String(targetId));
      const raw = record?.[depField];
      const existing = normalizeDependencies(raw);
      const idOf = (d: GanttDependency) => String(typeof d === 'object' ? d.id : d);
      const cur = existing.find((d) => idOf(d) === String(sourceId));
      const curType = cur && typeof cur === 'object' ? (cur.type ?? 'fs') : 'fs';
      if (cur && curType === type) return; // already linked with this type — no-op

      const entry: GanttDependency = type === 'fs' ? sourceId : { id: sourceId, type };
      const nextDeps = cur
        ? existing.map((d) => (idOf(d) === String(sourceId) ? entry : d))
        : [...existing, entry];
      await persistDependencies(targetId, raw, nextDeps);
    },
    [ganttConfig, data, persistDependencies],
  );

  // Persist a removed dependency (delete): drop the source id from the target
  // record's dependencies field. Optimistic with revert, same as create.
  const handleDependencyDelete = useCallback(
    async (source: GanttTask, target: GanttTask) => {
      const sourceId = (source as any).data?.id ?? (source as any).data?._id ?? source.id;
      const targetId = (target as any).data?.id ?? (target as any).data?._id ?? target.id;
      if (sourceId == null || targetId == null) return;
      const depField = ganttConfig?.dependenciesField;
      if (!depField) return;

      const record = data.find((r) => String(r.id ?? r._id) === String(targetId));
      const raw = record?.[depField];
      const existing = normalizeDependencies(raw);
      const idOf = (d: GanttDependency) => String(typeof d === 'object' ? d.id : d);
      const nextDeps = existing.filter((d) => idOf(d) !== String(sourceId));
      if (nextDeps.length === existing.length) return; // nothing to remove
      await persistDependencies(targetId, raw, nextDeps);
    },
    [ganttConfig, data, persistDependencies],
  );

  // -- Quick-create dialog removed --
  // The toolbar's "+ New Task" button only collected 3 fields (title +
  // start + end) which silently failed on objects with required fields
  // outside that set. The page-level header already exposes a fully-
  // fielded create form, so we defer to that instead of maintaining a
  // half-broken inline path.

  // -- Delete confirmation --
  // GanttView's row kebab calls onTaskDelete(task) -> we open an AlertDialog,
  // then issue dataSource.delete on confirm. Optimistic local removal; revert
  // on failure.
  const [pendingDelete, setPendingDelete] = useState<GanttTask | null>(null);
  const [deleting, setDeleting] = useState(false);

  const requestDelete = useCallback((task: GanttTask) => {
    setPendingDelete(task);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    if (!effectiveDataSource?.delete) {
      setPendingDelete(null);
      return;
    }
    const recordId =
      (pendingDelete as any).data?.id ?? (pendingDelete as any).data?._id ?? pendingDelete.id;
    if (recordId == null) {
      setPendingDelete(null);
      return;
    }

    setDeleting(true);
    const prevSnapshot = data;
    setData((prev) =>
      prev.filter((r) => String(r.id ?? r._id) !== String(recordId)),
    );
    try {
      // ApiDataSource.delete reports failure as `false` instead of throwing —
      // without this check a rejected delete keeps the optimistic removal.
      const ok = await effectiveDataSource.delete(resource, String(recordId));
      if (ok === false) throw new Error(t('gantt.writeFailed'));
      setPendingDelete(null);
      void reload({ silent: true }); // write-readback — parent rollups shrink after a child delete
    } catch (err) {
      console.error('[ObjectGantt] Failed to delete:', err);
      setData(prevSnapshot); // revert
      setPendingDelete(null);
      notifyWriteError(err);
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete, effectiveDataSource, resource, data, reload, notifyWriteError, t]);

  // objectui#12082 — the chart's in-chart writes are rows of the
  // affordance-to-grant map (`resolveAffordance` in `@object-ui/core`), asked of
  // the object every write below goes to (`resource`): a bar's drag / resize /
  // progress, its title edited in place and its dependency links update the
  // task record (`rowEdit`), and the row kebab's Delete deletes it
  // (`rowDelete`). Each is the object's policy, the effective operation set and
  // the caller's grant. `GanttView` draws an affordance only when it is handed
  // its handler, so a closed row is a handler withheld in the JSX below — the
  // same way `readOnly` and `lockField` already close them. They used to read
  // no grant at all, so a read-only caller could drag a bar, link two tasks or
  // delete a row and the server refused the write. With no permission provider
  // mounted both rows read open, as before. The record overlay's inline edit
  // reads its own row in `RecordDetailPanel`.
  const writeAffordanceSource = {
    objectSchema: objectSchema as SchemaLike | null | undefined,
    objectName: resource,
    perms,
  };
  const taskEditGranted = resolveAffordance('rowEdit', writeAffordanceSource).allowed;
  const taskDeleteGranted = resolveAffordance('rowDelete', writeAffordanceSource).allowed;

  if (loading) {
    return (
      <div className={className}>
        <div className="flex items-center justify-center h-96">
          <div className="text-muted-foreground">Loading Gantt chart...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={className}>
        <div className="flex items-center justify-center h-96">
          <div className="text-destructive">Error: {error.message}</div>
        </div>
      </div>
    );
  }

  if (invalidGanttBlock) {
    return (
      <div className={className}>
        <div className="flex items-center justify-center h-96">
          {/* English, like the "configuration required" refusal below: both
              address the view's author, not the end user. */}
          <div className="text-destructive" role="alert" data-testid="gantt-invalid-config">
            Invalid gantt configuration — the `gantt` block does not match the spec, so the
            chart is not drawn. Fix: {invalidGanttBlock.join('; ')}
          </div>
        </div>
      </div>
    );
  }

  if (!ganttConfig) {
    return (
      <div className={className}>
        <div className="flex items-center justify-center h-96">
          <div className="text-muted-foreground">
            Gantt configuration required. Please specify startDateField, endDateField, and titleField.
          </div>
        </div>
      </div>
    );
  }

  /**
   * The record overlay — ONE payload in whichever shell the author declared.
   *
   * ⭐ objectui#9299. This used to be `<RecordDetailDrawer>`, which brought its
   * own `Sheet` and had no `mode` parameter to receive the resolved
   * `navigation.mode` — so an authored `modal`, `split` or `popover` silently
   * rendered the drawer (measured on PR objectui#9296). The payload now mounts
   * through the shared `NavigationOverlay`, which is the same shell `ObjectGrid`
   * and `ObjectTree` use, so the four declared modes mean the same thing on
   * every view type.
   *
   * `mainContent` is what `split` needs: the overlay puts it in the left panel
   * beside the record panel, and here that is the chart itself (item 2).
   * `popoverAnchorRef` is what `popover` needs: the bar the user clicked
   * (item 3).
   */
  const renderRecordOverlay = (mainContent?: React.ReactNode): React.ReactNode => {
    if (!navigation.isOverlay || !navigation.isOpen || !navigation.selectedRecord) return null;
    const rec = navigation.selectedRecord as Record<string, any>;
    const detail = recordDetailHref(rec);
    if (!detail || isSyntheticRow(rec)) return null;
    const { objectName, recordId } = detail;
    const fullPageHref = detail.href ?? undefined;
    const titleText = ganttConfig?.titleField
      ? String(rec[ganttConfig.titleField] ?? t('gantt.drawer.fallbackTitle'))
      : t('gantt.drawer.fallbackTitle');
    // Row-level lock (lockField) and global readOnly must also lock the
    // drawer: omitting onFieldSave/onDelete renders it strictly read-only.
    const recLocked =
      !!schema.readOnly ||
      (ganttConfig?.lockField ? !!rec[ganttConfig.lockField] : false);
    // #2473: prefer the fetched business record + schema over the raw row
    // payload (see the drawerFetch effect above for why they can differ).
    const fetched = drawerFetch?.key === `${objectName}:${recordId}` ? drawerFetch : null;
    const drawerRecord = fetched?.record ?? rec;
    const drawerSchema = fetched?.schema
      ?? (objectName === resource ? (objectSchema as any) : undefined);
    // Field saves on a fetched record write the BUSINESS object through the
    // context DataSource (the gantt endpoint only understands composed
    // rows); everything else keeps the gantt-endpoint write path.
    const saveDS = fetched && dataSource ? dataSource : effectiveDataSource;
    return (
      <NavigationOverlay
        {...navigation}
        title={titleText}
        mainContent={mainContent}
        popoverAnchorRef={anchorRef}
        // One drag-resize implementation, one key, and the width a user had
        // already chosen under the retired `objectui.drawerWidth.OBJECT`
        // carries over (item 4).
        storageKey={recordOverlayWidthStorageKey(objectName)}
        legacyStorageKey={legacyRecordDrawerWidthKey(objectName)}
        // ⛔ Not `navigation.width` alone: an unauthored width has to land on
        // the ruled default (objectui#6584) rather than on the overlay's own
        // `42rem` floor, which would narrow this surface.
        width={navigation.width ?? RECORD_OVERLAY_DEFAULT_WIDTH}
      >
        {() => (
          <div className="px-6 pt-6 pb-6">
            <RecordDetailPanel
              record={drawerRecord}
              objectName={objectName}
              recordId={recordId}
              dataSource={saveDS ?? undefined}
              objectSchema={drawerSchema}
              onClose={navigation.close}
              fullPageHref={fullPageHref}
              onFieldSave={recLocked ? undefined : async (field, value) => {
                if (!saveDS?.update) return;
                try {
                  await saveDS.update(objectName, String(recordId), { [field]: value });
                } catch (err) {
                  // DetailView rolls back and shows the (cleaned) message inline
                  // next to the field — surface the server's reason, not the raw
                  // "ApiDataSource: HTTP 403 …" transport string.
                  const serverMsg = extractServerMessage(err);
                  throw serverMsg ? new Error(serverMsg) : err;
                }
                if (fetched) {
                  setDrawerFetch((prev) =>
                    prev && prev.key === fetched.key
                      ? { ...prev, record: { ...prev.record, [field]: value } }
                      : prev,
                  );
                }
                setData((prev) => prev.map((r) =>
                  String(r.id ?? r._id) === String(recordId)
                    ? { ...r, [field]: value }
                    : r,
                ));
                void reload({ silent: true }); // write-readback — see handleTaskUpdateDefault
              }}
              onDelete={recLocked ? undefined : async () => {
                if (!effectiveDataSource?.delete) return;
                try {
                  // ApiDataSource.delete reports failure as `false`, not a throw.
                  const ok = await effectiveDataSource.delete(objectName, String(recordId));
                  if (ok === false) throw new Error(t('gantt.writeFailed'));
                } catch (err) {
                  notifyWriteError(err);
                  throw err;
                }
                setData((prev) => prev.filter((r) =>
                  String(r.id ?? r._id) !== String(recordId),
                ));
              }}
            />
          </div>
        )}
      </NavigationOverlay>
    );
  };

  const ganttView = (
    <div className={cn('flex h-full min-h-0 flex-col', className)} {...anchorCaptureProps}>
      {resolvedQuickFilters.length > 0 && (
        <QuickFilterBar
          filters={resolvedQuickFilters}
          value={filterValues}
          onChange={handleFilterChange}
          onClear={clearFilters}
          resultCount={displayTasks.length}
          totalCount={tasks.length}
          // Bundle keys, not literals: hardcoding these pinned the bar to
          // Chinese in every locale while the rest of the gantt toolbar
          // localized (objectstack#5427), and violated the English-only
          // codebase rule. `resultSummary` uses SINGLE-brace placeholders
          // resolved by a literal `.replace` — the same convention as
          // `gantt.autoScheduleDlg.body`, which `all-locales-key-parity`'s
          // placeholder check recognises via its SINGLE regex. Do not respell
          // them as i18next `{{...}}` interpolation.
          labels={{
            all: t('gantt.quickFilter.all'),
            clear: t('gantt.quickFilter.clear'),
            empty: t('gantt.quickFilter.empty'),
            resultSummary: (shown, total) =>
              t('gantt.quickFilter.resultSummary')
                .replace('{shown}', String(shown))
                .replace('{total}', String(total)),
          }}
        />
      )}
      {/* Fill the host's flex cell instead of guessing with a viewport calc:
          `100vh - 200px` overshoots whenever the chrome above (tabs, toolbar,
          quick filters) exceeds 200px, and the overflow-hidden host then CLIPS
          the pane's bottom edge — swallowing the horizontal scrollbar.
          flex-1/min-h-0 tracks the real available height;
          the min-h keeps standalone embeds (no sized parent) usable. */}
      <div className="relative flex-1 min-h-[420px]">
        {/* objectui#7237 (ruling A′) — the visible refreshing state ON the
            chart while an in-place reload runs, so the rows still on screen
            read as the previous answer rather than as the current one. The
            same indeterminate bar ObjectGrid, ListView and ObjectChart draw
            over their rows; `refreshing` is the flag the toolbar refresh
            button already reads. */}
        <RefreshIndicator active={refreshing} ariaLabel={t('gantt.aria.refreshing')} />
        {ganttConfig?.resourceView && assigneeAccessor ? (
          <ResourceWorkload
            tasks={displayTasks}
            assignee={assigneeAccessor}
            effort={effortAccessor}
            capacity={ganttConfig?.capacity ?? 1}
            viewMode={ganttConfig?.viewMode || 'day'}
          />
        ) : (
        <GanttView
          tasks={displayTasks}
          // Authored granularity (objectui#5074) — undefined when the author
          // omitted it, so GanttView's own seeding order stays intact:
          // explicit prop → persisted layout (persistLayoutKey) → 'day'.
          // ⛔ Do not "simplify" this to `|| 'day'`: a default here would defeat
          // the persisted-layout seeding for every schema that omits the key.
          viewMode={ganttConfig?.viewMode}
          startDate={lockedRange?.start}
          endDate={lockedRange?.end}
          onTaskClick={(task) => {
            // Synthetic group rows have no backing record — opening the
            // drawer would only show the raw composed payload (#2473).
            if (!isSyntheticRow(task.data as Record<string, any> | undefined)) {
              navigation.handleClick(task.data);
            }
            onTaskClick?.(task.data);
          }}
          onTaskUpdate={taskEditGranted ? handleTaskUpdateDefault : undefined}
          onTaskDelete={taskDeleteGranted ? requestDelete : undefined}
          onDependencyCreate={taskEditGranted && ganttConfig?.dependenciesField ? handleDependencyCreate : undefined}
          onDependencyDelete={taskEditGranted && ganttConfig?.dependenciesField ? handleDependencyDelete : undefined}
          markers={schema.markers}
          autoSchedule={!!ganttConfig?.dependenciesField}
          rescheduleOnConflict={!!ganttConfig?.dependenciesField}
          criticalPathDefault={!!schema.criticalPath}
          workingCalendar={workingCalendar}
          shiftSegments={shiftSegments}
          showBaselines={schema.showBaselines !== false}
          readOnly={!!schema.readOnly}
          mobileReadOnly={schema.mobileReadOnly !== false}
          persistLayoutKey={persistLayoutKey}
          onLayoutChange={filtersStorageKey ? persistFilters : undefined}
          groupBy={groupByAccessor}
          defaultCollapsedDepth={ganttConfig?.defaultCollapsedDepth}
          summaryExtent={ganttConfig?.summaryExtent}
          interactions={ganttConfig?.interactions}
          dependencyTypes={ganttConfig?.dependencyTypes}
          timeZone={ganttConfig?.timeZone}
          onBeforeTaskUpdate={onBeforeTaskUpdate}
          exportFileName={
            // Explicit view config first (e.g. "Shift Plan Gantt") — the host strips
            // `label` off the schema it hands us — then the bound object's
            // label, then its API name.
            //
            // `schema.label` is `BaseSchema['label']` = `string | I18nLabel` since
            // #4580's revised Q1-A ruling — `I18nLabel` being the spec's INLINE
            // locale MAP (`{ en: 'Shift Plan', 'zh-CN': '排班计划' }`). `String()`
            // renders a map as `[object Object]`, so a gantt whose label was
            // authored as a map exported `[object Object]-<ts>.png` (#6052).
            // `resolveI18nLabel` from `@objectstack/spec/ui` is the producer's own
            // resolver for that vocabulary; the locale is the same
            // `useDisplayLocale()` the tooltip formatters already take. It answers
            // `undefined` on an absent label or a total miss, which is why it sits
            // INSIDE the `??` chain — a miss falls through to the next link exactly
            // as a missing label always did.
            //
            // `objectSchema?.label`, the very next link, deliberately does NOT get
            // the same treatment: that is the DATA object's label, declared
            // `label: z.string().optional()` on the spec's `ObjectSchemaBase` —
            // a `strictObject`, so a locale map there is REJECTED by the producer,
            // not resolved by us. Resolving it here would be accepting a second
            // vocabulary at the consumer, which AGENTS.md #0.1 rules out; if that
            // object-metadata slot ever needs locale maps, it widens in the spec
            // first and this link follows.
            String(
              ganttConfig?.exportFileName
                ?? resolveInlineI18nLabel(schema.label, displayLocale)
                ?? objectSchema?.label
                ?? schema.objectName
                ?? ''
            ) || undefined
          }
          inlineEdit
          onRefresh={
            // Only meaningful when there's a live source to re-read (the
            // object provider); inline `value` items and the data prop are
            // owned by the host.
            dataConfig?.provider === 'object' &&
            typeof effectiveDataSource?.find === 'function'
              ? () => reload({ silent: true })
              : undefined
          }
          refreshing={refreshing}
        />
        )}
      </div>
      {/* objectui#7210 — the ceiling must never be crossed quietly. A gantt
          drawn from the first N rows of a larger result set is still a
          confident-looking schedule with a plausible range; the note is the
          only thing on screen that distinguishes it from a complete one.
          The note carries `shrink-0` itself, beneath the `flex-1` chart
          pane, so it cannot be clipped out of a fixed-height host the way a
          plain sibling would be (the construction objectui#7148's
          `ChartFootnote` measured); it takes the result and nothing else
          (objectui#7508). */}
      {rowCeiling && <NonGridRowCeilingNote result={rowCeiling} />}
      {/* Delete confirmation */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open && !deleting) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('gantt.delete.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? t('gantt.delete.body', { title: pendingDelete.title })
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('gantt.delete.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void confirmDelete(); }}
              disabled={deleting}
              data-testid="gantt-delete-confirm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? t('gantt.delete.deleting') : t('gantt.delete.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  // `split` (item 2): the chart IS the main content — it moves into the
  // overlay's left panel with the record panel beside it, rather than being
  // covered by a drawer. Guarded on an OPEN overlay because the split shell
  // renders nothing when closed; with nothing open the chart renders on its
  // own exactly as before.
  if (
    navigation.isOverlay
    && navigation.mode === 'split'
    && navigation.isOpen
    && navigation.selectedRecord
  ) {
    const splitOverlay = renderRecordOverlay(ganttView);
    // `null` here means this record has no overlay at all (a synthetic group
    // row) — the chart still has to render.
    if (splitOverlay) return <>{splitOverlay}</>;
  }

  return (
    <>
      {ganttView}
      {renderRecordOverlay()}
    </>
  );
};
