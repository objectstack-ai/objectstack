/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useObjectTranslation } from '@object-ui/react';

/**
 * Default English translations for ObjectGantt. Mirrors the
 * createSafeTranslationHook pattern used by plugin-detail / plugin-timeline so
 * the Gantt keeps working when rendered standalone (unit tests, embed)
 * without an I18nProvider on the React tree.
 */
export const GANTT_DEFAULT_TRANSLATIONS: Record<string, string> = {
  'gantt.column.taskName': 'Task Name',
  'gantt.column.start': 'Start',
  'gantt.column.end': 'End',
  'gantt.toolbar.prevPeriod': 'Previous period',
  'gantt.toolbar.nextPeriod': 'Next period',
  'gantt.toolbar.zoomIn': 'Zoom in',
  'gantt.toolbar.zoomOut': 'Zoom out',
  'gantt.toolbar.jumpToToday': 'Jump to today',
  'gantt.toolbar.today': 'Today',
  'gantt.toolbar.thisWeek': 'This week',
  'gantt.toolbar.thisMonth': 'This month',
  'gantt.toolbar.exportPdf': 'Export PDF',
  'gantt.toolbar.saveLayout': 'Save layout',
  'gantt.toolbar.showTaskList': 'Show task list',
  'gantt.toolbar.hideTaskList': 'Hide task list',
  'gantt.toolbar.viewMode': 'Timeline granularity',
  'gantt.toolbar.enterFullscreen': 'Enter fullscreen',
  'gantt.toolbar.exitFullscreen': 'Exit fullscreen',
  'gantt.toolbar.criticalPath': 'Highlight critical path',
  'gantt.toolbar.autoSchedule': 'Auto-schedule dependencies',
  'gantt.toolbar.exportPng': 'Export as PNG',
  'gantt.toolbar.refresh': 'Refresh',
  'gantt.toolbar.undo': 'Undo',
  'gantt.toolbar.redo': 'Redo',
  'gantt.viewMode.day': 'Day',
  'gantt.viewMode.week': 'Week',
  'gantt.viewMode.month': 'Month',
  'gantt.viewMode.quarter': 'Quarter',
  'gantt.viewMode.year': 'Year',
  'gantt.row.expand': 'Expand',
  'gantt.row.collapse': 'Collapse',
  'gantt.row.open': 'Open details',
  'gantt.aria.taskList': 'Task list',
  'gantt.aria.refreshing': 'Refreshing…',
  'gantt.tooltip.days': 'd',
  'gantt.menu.view': 'View details',
  'gantt.menu.edit': 'Edit inline',
  'gantt.menu.delete': 'Delete',
  'gantt.menu.addPredecessor': 'Add predecessor…',
  'gantt.menu.addSuccessor': 'Add successor…',
  'gantt.menu.removeDependency': 'Remove dependency',
  'gantt.menu.noCandidates': 'No available tasks',
  'gantt.menu.searchTasks': 'Search tasks…',
  'gantt.delete.title': 'Delete this task?',
  'gantt.delete.body': '"{{title}}" will be permanently removed. This action cannot be undone.',
  'gantt.delete.cancel': 'Cancel',
  'gantt.delete.confirm': 'Delete',
  'gantt.delete.deleting': 'Deleting…',
  'gantt.drawer.fallbackTitle': 'Task Details',
  'gantt.linkType.fs': 'Finish → Start',
  'gantt.linkType.ss': 'Start → Start',
  'gantt.linkType.ff': 'Finish → Finish',
  'gantt.linkType.sf': 'Start → Finish',
  'gantt.linkEnd.start': 'start',
  'gantt.linkEnd.end': 'end',
  // Why the built-in drop-target policy refused a dependency link
  // (objectui#4158). One message per branch of `classifyLinkTarget`, and the
  // leaf name IS the branch name — a new branch that forgets its copy shows
  // up as a missing key here rather than as a plausible-but-wrong sentence.
  'gantt.link.rejected.self': 'A task cannot depend on itself.',
  'gantt.link.rejected.locked': 'This row is locked and cannot take a new dependency.',
  'gantt.link.rejected.group': 'A summary row cannot take a dependency — link one of its tasks instead.',
  'gantt.link.rejected.cycle': 'That link would create a circular dependency.',
  'gantt.conflict.title': 'Schedule conflict',
  'gantt.conflict.body': 'This move conflicts with dependency constraints. Auto-reschedule {{count}} affected task(s)?',
  // Count families (objectui#11445): `fallback` reads the `_one` / `_other` row
  // for a numeric `count`, the order i18next reads the `en` pack in.
  'gantt.conflict.body_one': 'This move conflicts with dependency constraints. Auto-reschedule {{count}} affected task?',
  'gantt.conflict.body_other': 'This move conflicts with dependency constraints. Auto-reschedule {{count}} affected tasks?',
  'gantt.conflict.confirm': 'Auto-reschedule',
  'gantt.conflict.cancel': 'Keep as is',
  'gantt.autoScheduleDlg.title': 'Auto-schedule',
  'gantt.autoScheduleDlg.body': 'Shift {{count}} task(s) later to satisfy dependency links?',
  'gantt.autoScheduleDlg.body_one': 'Shift {{count}} task later to satisfy dependency links?',
  'gantt.autoScheduleDlg.body_other': 'Shift {{count}} tasks later to satisfy dependency links?',
  'gantt.autoScheduleDlg.skipped': '{{count}} locked task(s) also violate links and were skipped.',
  'gantt.autoScheduleDlg.skipped_one': '{{count}} locked task also violates links and was skipped.',
  'gantt.autoScheduleDlg.skipped_other': '{{count}} locked tasks also violate links and were skipped.',
  'gantt.autoScheduleDlg.confirm': 'Apply',
  'gantt.autoScheduleDlg.cancel': 'Cancel',
  'gantt.autoScheduleDlg.none': 'All dependencies satisfied — nothing to reschedule.',
  'gantt.quickFilter.all': 'All',
  'gantt.quickFilter.clear': 'Clear filters',
  'gantt.quickFilter.empty': 'No options',
  // SINGLE braces on purpose — the ObjectGantt call site resolves these with a
  // literal `.replace('{shown}', …)`, not i18next interpolation. This is now
  // the ONLY key in this table on that idiom: the three `{count}` dialog keys
  // moved to i18next interpolation in objectui#4157, after `conflict.body`'s
  // packs were (correctly) written `{{count}}` while its call site still did
  // `.replace('{count}', …)` and rendered a literal `{2}` on screen. Any new
  // key here takes `{{name}}` + `t(key, { name })`; this one is pinned as the
  // deliberate exception by `gantt-quickfilter-locale-parity.test.ts`.
  'gantt.quickFilter.resultSummary': 'Showing {shown} / {total} tasks',
  'gantt.resource.header': 'Resource',
  'gantt.resource.peak': 'Peak',
  'gantt.resource.over': 'overloaded',
  'gantt.resource.empty': 'No tasks to allocate.',
  'gantt.readOnly': 'Read-only',
  'gantt.readOnlyHint': 'Editing is disabled for this view.',
  'gantt.lockedHint': 'No edit permission',
  'gantt.writeFailed': 'Save failed — the change was rolled back',
};

/** The defaults are English, so English plural rules pick a family's row. */
const EN_PLURAL_RULES = new Intl.PluralRules('en');

function fallback(key: string, options?: Record<string, unknown>): string {
  // A count family's `_one` / `_other` row first, then the base row — the
  // order i18next reads the `en` pack in, for a NUMERIC count only (i18next
  // plural-selects nothing else). The hand-rolled copy of `createSafeTranslation`'s
  // `defaultsRowFor` (objectui#11445), as `interpolate` below is of its interpolator.
  const count = options?.count;
  const slot =
    typeof count === 'number' && Number.isFinite(count)
      ? GANTT_DEFAULT_TRANSLATIONS[`${key}_${EN_PLURAL_RULES.select(count)}`]
      : undefined;
  let v = slot || GANTT_DEFAULT_TRANSLATIONS[key] || key;
  if (options) {
    for (const [k, val] of Object.entries(options)) {
      // `split(needle).join(value)` — deliberately not `replace`, and not
      // `replaceAll` either (objectui#4370, the hand-rolled copy of the shared
      // helper's objectui#3418 fix). This path must agree with i18next, which
      // serves the *provider* path; any divergence is a silent fork that only
      // shows up on provider-less hosts, where we are least likely to see it:
      //   1. `replace` with a string needle substitutes only the FIRST
      //      occurrence. i18next substitutes every one, so a sentence that
      //      repeats a placeholder leaked literal braces to users.
      //   2. `replace` AND `replaceAll` both interpret `$&`, `` $` ``, `$'`
      //      and `$$` in the *replacement* string. i18next does not. Values
      //      here are runtime data — `gantt.delete.body` is interpolated with
      //      the record's own title — so this one was reachable: a task titled
      //      `A$&B` rendered `"A{{title}}B" will be permanently removed.`,
      //      printing the placeholder back at the user inside their own data.
      // split/join is literal on both sides, which is exactly i18next's
      // behaviour, and needs no regex escaping of the placeholder name.
      v = v.split(`{{${k}}}`).join(String(val));
    }
  }
  return v;
}

export function useGanttTranslation() {
  // Deliberately NOT `createSafeTranslation`: that probes a single testKey and
  // then serves defaults for everything, which can't handle a host dictionary
  // that translates the common gantt keys but lags on newer ones (see the
  // per-key rationale below). No try/catch either — `useObjectTranslation` is
  // provider-safe and wrapping a hook in try/catch violates rules-of-hooks
  // (objectui#2879, same class as #2595/#2596).
  const result = useObjectTranslation();
  // `language` is the UI language, a BCP-47 tag (e.g. 'zh', 'en'). It is NOT a
  // date locale: every gantt date face formats with `useDisplayLocale()` from
  // `@object-ui/i18n`, which outranks the UI language with the tenant's
  // display locale (objectui#10442, objectui#10668).
  const language = result.language as string | undefined;
  // Per-key fallback. A consuming app's i18n dictionary commonly translates
  // the *common* gantt keys (column headers, toolbar) but lags behind on
  // newer ones (link types, dependency context-menu). i18next returns the
  // raw key string for a miss, which would surface untranslated keys like
  // `gantt.linkType.fs` in the UI. So for every key we let the host resolve
  // it first and fall back to our bundled English default ONLY when the host
  // returns the key unchanged (a miss). An all-or-nothing probe on a single
  // key can't catch a partially-translated host dictionary.
  const t = (key: string, options?: Record<string, unknown>): string => {
    const hostValue = result.t(key, options as never) as unknown;
    if (typeof hostValue === 'string' && hostValue !== key) return hostValue;
    return fallback(key, options);
  };
  return { t, language };
}

