/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The reports an app ships, as one member may open them (objectui#13020).
 *
 * A report used to have one door: its own route, `report/:reportName`, reached
 * from a navigation entry that names it. A report the app's navigation does
 * not name had no UI path, and ⌘K found only the reports the navigation
 * names. Two consumers read this module: the app's report index
 * (`/apps/APP/reports`, `AppReportIndexView`) and the ⌘K palette, so both list
 * the same reports under the same rule.
 *
 * ## Which reports an app ships
 *
 * What the app's navigation ships (objectui#13273): the union of
 *
 * - the reports whose `_packageId` is the app's own: the owner link
 *   `preferLocal` (ADR-0048) resolves a report route by, and the one
 *   `AppHeader` names the report crumb by. An app with no `_packageId`
 *   (created in the console) owns no package; it owns the reports no package
 *   owns, the ones `preferLocal` likewise resolves with no owner preference;
 * - every report a `type: 'report'` entry of the app's served navigation
 *   names, at any depth. The served navigation carries what a module
 *   contributes through `navigationContributions`, merged into the app's
 *   groups with no package stamp, so a module's reports are the app's too.
 *
 * One per report name: the owned document first, else the first served. A
 * navigation entry naming a report the report list does not hold is left out:
 * it could not be opened. The walk is {@link flattenNavigation}, the one the
 * ⌘K palette reads its navigation entries through.
 *
 * ## Which a member may open
 *
 * A report reads its data through the ADR-0021 dataset it binds (`dataset`,
 * or each `blocks[].dataset` of a `joined` report), and the dataset reads its
 * base `object`. A member who may not read that object gets the report page's
 * dataset query refused. The report page itself asks nothing before it
 * opens, so the verdict asked here is the console's one object-read verdict,
 * `mayReadObject` (`navObjectReadGate`, objectui#12109), on every object the
 * report's datasets read: a report is listed only when every one is readable.
 *
 * An unknown answer is not a refusal, as in `navObjectReadGate`: a dataset the
 * dataset list does not hold, or one that names no object, refuses nothing.
 * No permission provider mounted, `can` answers `true`.
 *
 * ## Which the navigation shows the member (objectstack#26892)
 *
 * A report that one or more entries of the app's navigation name is listed
 * only when the member is shown at least one of those entries, under the
 * sidebar's own gates (`navEntriesShownToMember` over `useNavMemberGates`):
 * an entry its `visible`, `requiredPermissions` or runtime-capability gates
 * hide, one the object-read prune drops, one inside a group those gates hide,
 * and one whose API read has not answered yet do not count. Before this, a
 * report the app's package owns was listed through the owner rule even when
 * the navigation hid its entry from the member, and it opened empty for them.
 * At least one, not every: a member shown any entry that names the report can
 * open it from the sidebar already.
 *
 * A report no entry names keeps the read rule alone: the index is its only
 * door (objectui#13020), and no navigation gate speaks about it.
 *
 * ## What it reads
 *
 * The report list and the dataset list (`MetadataProvider`'s cache, one
 * `/meta/:type` read each), and the permissions the shell already holds. ⛔
 * Never the object registry. Neither list while `enabled` is false: the lists
 * are lazy getters, and a closed palette reads neither. The navigation gates
 * are the caller's `useNavMemberGates()`, the sidebar's: the reads they make
 * (the app's object scope, each entry's API binding) are the sidebar's reads,
 * through the same readers, and this module makes none of its own.
 *
 * Internal module: not re-exported by the package entry.
 */

import { usePermissions } from '@object-ui/permissions';
import { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import { useMetadata } from '../providers/MetadataProvider.js';
import { metadataText } from '../hooks/useNavTargetLabel.js';
import { mayReadObject, type ObjectReadCheck } from '../utils/navObjectReadGate.js';
import { navEntriesShownToMember, type NavMemberGates } from '../hooks/useNavMemberGates.js';
import type { NavigationItem } from '@object-ui/types';

/** The members this module reads off a served report document. */
export interface ServedReport {
  name?: unknown;
  label?: unknown;
  description?: unknown;
  dataset?: unknown;
  blocks?: unknown;
  _packageId?: unknown;
}

/** One report of the index, as the member is shown it. */
export interface AppReportEntry {
  /** The report's machine name: its route is `report/NAME`. */
  name: string;
  /** Its localized label, else its name. */
  label: string;
  /** Its localized description, when it has one. */
  description?: string;
}

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** The package an app document names, or `undefined` for a package-less app. */
function packageOf(app: unknown): string | undefined {
  const id = app && typeof app === 'object' ? (app as { _packageId?: unknown })._packageId : undefined;
  return nonEmptyString(id) ? id : undefined;
}

/**
 * Every entry of a navigation tree, its groups opened at any depth: a group
 * with children stands for them. The ⌘K palette's walk, shared so the palette
 * and the report index read the same navigation.
 */
export function flattenNavigation(items: readonly any[]): any[] {
  const result: any[] = [];
  for (const item of items) {
    if (item.type === 'group' && item.children) {
      result.push(...flattenNavigation(item.children));
    } else {
      result.push(item);
    }
  }
  return result;
}

/** The app's served navigation tree, or `undefined` when it serves none. */
function navigationOf(app: unknown): unknown[] | undefined {
  const navigation = app && typeof app === 'object' ? (app as { navigation?: unknown }).navigation : undefined;
  return Array.isArray(navigation) ? navigation : undefined;
}

/** The report names the `type: 'report'` entries of `items` name, at any depth. */
function reportNamesIn(items: readonly unknown[]): Set<string> {
  const out = new Set<string>();
  for (const item of flattenNavigation(items)) {
    if (item && typeof item === 'object' && item.type === 'report' && nonEmptyString(item.reportName)) {
      out.add(item.reportName);
    }
  }
  return out;
}

/** The report names `type: 'report'` entries of the app's served navigation name. */
function navigationReportNames(app: unknown): Set<string> {
  const navigation = navigationOf(app);
  return navigation ? reportNamesIn(navigation) : new Set<string>();
}

/**
 * Whether the app's navigation lets the member see the report named `name`:
 * a report no entry names, yes; one that entries name, only when `gates` show
 * the member at least one of them (`navEntriesShownToMember`, the sidebar's
 * walk).
 */
export function navigationShowsReport(app: unknown, gates: NavMemberGates): (name: string) => boolean {
  const navigation = navigationOf(app);
  const named = navigation ? reportNamesIn(navigation) : new Set<string>();
  if (!navigation || named.size === 0) return () => true;
  const shown = reportNamesIn(navEntriesShownToMember(navigation as NavigationItem[], gates));
  return (name) => !named.has(name) || shown.has(name);
}

/**
 * The reports `app` ships: those its package owns (for an app with no
 * package, those no package owns), and those its served navigation names. One
 * per name: the owned document first, else the first served.
 */
export function appShippedReports(reports: readonly unknown[] | undefined, app: unknown): ServedReport[] {
  const owner = packageOf(app);
  const named = navigationReportNames(app);
  const served: ServedReport[] = [];
  for (const item of reports ?? []) {
    if (!item || typeof item !== 'object') continue;
    const report = item as ServedReport;
    if (nonEmptyString(report.name)) served.push(report);
  }
  const seen = new Set<string>();
  const out: ServedReport[] = [];
  const take = (keep: (report: ServedReport) => boolean) => {
    for (const report of served) {
      const name = report.name as string;
      if (seen.has(name) || !keep(report)) continue;
      seen.add(name);
      out.push(report);
    }
  };
  take((report) => (nonEmptyString(report._packageId) ? report._packageId : undefined) === owner);
  take((report) => named.has(report.name as string));
  return out;
}

/** The dataset names a report binds: its own `dataset`, and each block's. */
export function reportDatasets(report: ServedReport): string[] {
  const out: string[] = [];
  if (nonEmptyString(report.dataset)) out.push(report.dataset);
  if (Array.isArray(report.blocks)) {
    for (const block of report.blocks) {
      const name = block && typeof block === 'object' ? (block as { dataset?: unknown }).dataset : undefined;
      if (nonEmptyString(name) && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

/** `dataset name -> the object it reads`, for the datasets that name one. */
export function datasetObjectIndex(datasets: readonly unknown[] | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of datasets ?? []) {
    if (!item || typeof item !== 'object') continue;
    const { name, object } = item as { name?: unknown; object?: unknown };
    if (nonEmptyString(name) && nonEmptyString(object) && !out.has(name)) out.set(name, object);
  }
  return out;
}

/**
 * Whether the member may open `report`: every object its datasets read passes
 * `mayReadObject`. A dataset whose object is unknown refuses nothing.
 */
export function mayOpenReport(
  report: ServedReport,
  datasetObjects: ReadonlyMap<string, string>,
  can: ObjectReadCheck,
): boolean {
  return reportDatasets(report).every((dataset) => {
    const object = datasetObjects.get(dataset);
    return object === undefined || mayReadObject(can, object);
  });
}

/** What {@link useAppReportEntries} answers. */
export interface AppReportEntries {
  /** The reports the member may open, sorted by label. Empty while loading. */
  entries: AppReportEntry[];
  /** A list the verdict needs has not answered yet. */
  loading: boolean;
}

const NOT_READ: AppReportEntries = { entries: [], loading: false };

/**
 * The reports `app` ships that this member may open and the app's navigation
 * shows them, labelled and sorted. `gates` are the member's navigation gates,
 * the caller's `useNavMemberGates()`. With `enabled` false it reads neither
 * list and answers no entry.
 */
export function useAppReportEntries(app: unknown, enabled: boolean, gates: NavMemberGates): AppReportEntries {
  const metadata = useMetadata();
  const { can } = usePermissions();
  const { reportLabel } = useObjectLabel();
  const { language } = useObjectTranslation();
  if (!enabled) return NOT_READ;

  // Read through the lazy getters: each starts its list's one read.
  const reports = metadata.reports;
  const datasets = metadata.getItemsByType('dataset');
  const pending = (type: string) => {
    const status = metadata.getTypeStatus?.(type);
    return status === 'idle' || status === 'loading';
  };
  if (pending('report') || pending('dataset')) return { entries: [], loading: true };

  const datasetObjects = datasetObjectIndex(datasets);
  const shownByNavigation = navigationShowsReport(app, gates);
  const entries = appShippedReports(reports, app)
    .filter((report) => shownByNavigation(report.name as string) && mayOpenReport(report, datasetObjects, can))
    .map((report): AppReportEntry => {
      const name = report.name as string;
      const text = metadataText(report.label, language);
      const label = reportLabel({ name, label: text ?? '' });
      const description = metadataText(report.description, language);
      return {
        name,
        label: nonEmptyString(label) && label.trim() !== '' ? label : name,
        ...(description ? { description } : {}),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, language));
  return { entries, loading: false };
}
