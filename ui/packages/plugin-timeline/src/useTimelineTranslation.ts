/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createSafeTranslation } from '@object-ui/i18n';

/**
 * Default English translations for ObjectTimeline. Mirrors the
 * createSafeTranslationHook pattern used by plugin-detail / plugin-list so
 * the timeline keeps working when rendered standalone (unit tests,
 * embed) without an I18nProvider on the React tree.
 */
export const TIMELINE_DEFAULT_TRANSLATIONS: Record<string, string> = {
  // objectui#11676 — the `overdue` bucket row is retired with its pack key: a
  // past day is `earlier` (see `dateBucket` in `ObjectTimeline.tsx`), and no
  // timeline heads a group "Overdue". `ObjectTimeline.pastBucket-11676.test.tsx`
  // pins the row and the key absent from all ten packs.
  'timeline.bucket.earlier': 'Earlier',
  'timeline.bucket.today': 'Today',
  'timeline.bucket.tomorrow': 'Tomorrow',
  'timeline.bucket.thisWeek': 'This week',
  'timeline.bucket.nextWeek': 'Next week',
  'timeline.bucket.later': 'Later',
  'timeline.bucket.noDate': 'No date',
  'timeline.bucket.unassigned': 'Unassigned',
  // `d9580f464` — the five `timeline.relative.*` rows are retired as residue.
  // They had no `en` leaf and no call site anywhere in the tree, so `fallbackT`
  // could never be asked for one: they rendered for nobody. Day-granularity
  // relative phrases are produced by `formatRelativeDate` (`@object-ui/core`)
  // through `Intl.RelativeTimeFormat`, which needs no copy row at all. The five
  // keys and their exact default strings are transcribed in
  // `__tests__/timeline-relative-defaults-retired-7874.test.ts`, which also pins
  // them absent — every i18n gate here runs call site -> key, so none of them
  // can see a dead row come back.
  // Gantt axis vocabulary (objectui#4520). These were `Week ${n}` and
  // `Q${q} ${year}` template literals in `renderer.tsx`, so a zh session read
  // an English bucket label beside the Chinese date axis objectui#4513 had just
  // fixed. The numbers are `{{holes}}` rather than concatenation because the
  // word order is the translation's to choose: `zh` puts the year first
  // (`2026年第3季度`), which no `Q${q} ${year}` template can produce.
  'timeline.scale.week': 'Week {{n}}',
  'timeline.scale.quarter': 'Q{{quarter}} {{year}}',
  'timeline.gantt.rowLabel': 'Items',
  // objectui#6759 — an UNUSABLE gantt date range refuses loudly, in the shape
  // objectui#6655 established one file away. Two strings rather than one
  // because they state two different facts and each has to name ITS OWN
  // offending value: a date that does not parse, and a range whose ends are
  // the wrong way round. `{{path}}` is the authored location
  // (`items[0].items[1].endDate`, or the pinned key), `{{value}}` the value
  // spelled as the author wrote it — both holes rather than concatenation,
  // for the same word-order reason `timeline.scale.*` above gives.
  'timeline.gantt.unusableRange.malformedDate':
    'Unusable gantt date range — {{path}} is {{value}}, which is not a valid date. Every gantt date has to parse: the startDate and endDate on every row item, plus any minDate / maxDate pinned on the schema.',
  'timeline.gantt.unusableRange.inverted':
    'Unusable gantt date range — minDate {{minDate}} is after maxDate {{maxDate}}. A pinned minDate / maxDate overrides the range computed from the rows, so this axis has no columns and no bar can be placed on it; swap the two values.',
  // objectui#7164 — a malformed ROW is refused through a THIRD string, never
  // through `malformedDate`: "items[0] is null, which is not a valid date"
  // names the wrong fault for a row that is not a row. Same two holes as
  // `malformedDate` — `{{path}}` is the authored location (`items`,
  // `items[2]`, `items[2].items`) and `{{value}}` the value spelled by
  // `spellGanttDateValue`, so no author code runs to describe it. This copy is
  // the byte-identical twin of `en.ts`'s, as the two strings above are.
  'timeline.gantt.unusableRange.malformedRow':
    'Unusable gantt rows — {{path}} is {{value}}, which is not a row shape. A gantt draws items as a list of rows, every row as an object with a label and its own items, and every row\'s items as a list of bars; a null, a number, a string or a plain object in any of those places cannot be drawn.',
  // objectui#6655 — the object-bound path REFUSES `variant: 'gantt'`.
  //
  // It composes one flat FEED item per record; the renderer's gantt branch
  // reads gantt ROWS (`row.items[].startDate`), so `calculateDateRange` used to
  // reduce an empty list and throw `RangeError: Invalid time value` mid-render.
  // The maintainer ruling (2026-08-29) chose to refuse loudly rather than to
  // compose rows from records, so this string IS the feature on that path and
  // has to name the limitation, not just report a failure.
  //
  // `{{variants}}` is a hole rather than prose because the list is derived from
  // the component's own declaration of what it can render — see
  // `OBJECT_BOUND_TIMELINE_VARIANTS` in `ObjectTimeline.tsx`.
  'timeline.unsupported.objectBoundGantt':
    'Unsupported variant "gantt" — an object-bound timeline renders the feed variants ({{variants}}). Gantt needs literal rows, each with its own nested items, so the gantt axis (scale) has no effect here.',
  // objectui#7459 — the object-bound path REFUSES a view that declares no date
  // axis, the twin of `ObjectGantt`'s "Gantt configuration required" screen.
  //
  // It became REACHABLE in the same change that retired the renderer's own
  // invented field name from the end of the resolver chain; before that a name
  // always resolved and this string could never have rendered. House posture
  // (maintainer, 2026-09-01, 总监批 #28): 日期轴永不虚构 — a date axis is
  // never fabricated.
  //
  // `{{fields}}` is a hole rather than prose for the reason
  // `timeline.unsupported.objectBoundGantt` above gives: the list is derived
  // from the component's own declaration of what it reads — see
  // `OBJECT_BOUND_TIMELINE_DATE_BINDINGS` in `ObjectTimeline.tsx` — so the
  // diagnostic cannot drift from the resolver. This copy is the byte-identical
  // twin of `en.ts`'s, as the strings above are.
  'timeline.unconfigured.noDateAxis':
    'Timeline date axis required — this view declares no date field, and an object-bound timeline will not invent one. Declare one of: {{fields}}. The first is the spec spelling; the rest are legacy aliases.',
};

const TEST_KEY = 'timeline.bucket.today';

/**
 * The translate fn shape this package threads into its pure helpers.
 *
 * `generateTimeScaleHeaders` is a module-level function and cannot host a hook,
 * so the component reads the channel and passes `t` down — the same seam
 * objectui#4513 opened for the resolved `locale` string, for the same reason.
 */
export type TimelineTranslate = (key: string, params?: Record<string, unknown>) => string;

/**
 * The English last resort for call sites that have no `t` to hand: the exported
 * helper's default parameter, and nothing else.
 *
 * It is the same lookup `createSafeTranslation` serves on a provider-less host,
 * spelled here because that one is a hook and this is a pure function. Both
 * halves are deliberate mirrors of `useSafeTranslation.ts` and must stay that
 * way — a divergence would only ever show up on hosts with no `I18nProvider`,
 * where we are least likely to see it:
 *
 *   - `||` (not `??`) for the chain, so an empty string falls through to the
 *     key exactly as the hook's `defaults[key] || …` chain does.
 *   - `split().join()` (not `replace`/`replaceAll`) for interpolation, which is
 *     literal on both sides and substitutes EVERY occurrence — i18next's own
 *     behaviour, and the objectui#3418 fix.
 */
export const translateTimelineDefault: TimelineTranslate = (key, params) =>
  Object.entries(params ?? {}).reduce(
    (value, [name, v]) => value.split(`{{${name}}}`).join(String(v)),
    TIMELINE_DEFAULT_TRANSLATIONS[key] || key,
  );

/**
 * Was a local re-implementation that wrapped the hook in try/catch — a
 * rules-of-hooks violation (objectui#2879, same class as #2595/#2596).
 * `useObjectTranslation` is provider-safe, so the probe alone is enough.
 */
export const useTimelineTranslation = createSafeTranslation(
  TIMELINE_DEFAULT_TRANSLATIONS,
  TEST_KEY,
);
