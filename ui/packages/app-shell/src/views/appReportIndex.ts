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
 * ## How the index groups them (objectstack#27526)
 *
 * By the report's primary object, derived and never declared: the report
 * schema carries no grouping key. The primary object is the object of the
 * first dataset the report binds (its own `dataset`, then each block's, the
 * order {@link reportDatasets} answers) that the dataset list maps to one; a
 * report with none is in the 「其它」 section. The sections follow the order
 * the app's navigation first names each object in (`type: 'object'` entries,
 * {@link flattenNavigation}'s walk), then the objects it names nowhere by
 * label, then 「其它」 ({@link groupReportsByObject}).
 *
 * Which reports the index shows is the reader's choice of view, kept in the
 * console's preference store ({@link REPORT_INDEX_VIEW_PREFERENCE}, scope
 * `user`): every report, or the ones the reader opened last, read from the
 * recent-items store ({@link lastOpenedReports}). The served report list
 * carries no creator, so there is no 「我创建的」 view.
 *
 * ## What it reads
 *
 * The report list and the dataset list (`MetadataProvider`'s cache, one
 * `/meta/:type` read each), and the permissions the shell already holds. ⛔
 * Never the object registry. Neither list while `enabled` is false: the lists
 * are lazy getters, and a closed palette reads neither. The navigation gates
 * are the caller's `useNavMemberGates()`, the sidebar's: the reads they make
 * (the app's object scope, each entry's API binding) are the sidebar's reads,
 * through the same readers, and this module makes none of its own. The
 * index's object labels ({@link useReportObjectLabels}) read that same object
 * scope: the app's package scope the gates already hold, and by name the
 * grouped objects it does not hold (for an app with no package, by name
 * alone), never the whole registry while nothing else has loaded it.
 *
 * Internal module: not re-exported by the package entry.
 */

import { usePermissions } from '@object-ui/permissions';
import { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import { useMetadata } from '../providers/MetadataProvider.js';
import { metadataText } from '../hooks/useNavTargetLabel.js';
import { mayReadObject, type ObjectReadCheck } from '../utils/navObjectReadGate.js';
import { navEntriesShownToMember, type NavMemberGates } from '../hooks/useNavMemberGates.js';
import { defineWorkspacePreference, versionedPreferenceCodec } from '../utils/workspacePreference.js';
import type { RecentItem } from '../context/RecentItemsProvider.js';
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
  /** Its primary object ({@link reportPrimaryObject}), when it has one. */
  object?: string;
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

/**
 * The report's primary object, the one the index groups it under
 * (objectstack#27526): the object of the first dataset it binds, in
 * {@link reportDatasets}'s order, that `datasetObjects` maps to one. A report
 * whose datasets name none, or are unknown, has no primary object.
 */
export function reportPrimaryObject(
  report: ServedReport,
  datasetObjects: ReadonlyMap<string, string>,
): string | undefined {
  for (const dataset of reportDatasets(report)) {
    const object = datasetObjects.get(dataset);
    if (object !== undefined) return object;
  }
  return undefined;
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
 * the caller's `useNavMemberGates()`, or `null` on a frame with no app. With
 * `enabled` false, or no gates, it reads neither list and answers no entry.
 */
export function useAppReportEntries(
  app: unknown,
  enabled: boolean,
  gates: NavMemberGates | null,
): AppReportEntries {
  const metadata = useMetadata();
  const { can } = usePermissions();
  const { reportLabel } = useObjectLabel();
  const { language } = useObjectTranslation();
  if (!enabled || !gates) return NOT_READ;

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
      const object = reportPrimaryObject(report, datasetObjects);
      return {
        name,
        label: nonEmptyString(label) && label.trim() !== '' ? label : name,
        ...(description ? { description } : {}),
        ...(object ? { object } : {}),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, language));
  return { entries, loading: false };
}

/**
 * The object names the `type: 'object'` entries of the app's served
 * navigation name, in the order each is first named, at any depth: the order
 * of the index's sections (objectstack#27526).
 */
export function navigationObjectOrder(app: unknown): string[] {
  const out: string[] = [];
  for (const item of flattenNavigation(navigationOf(app) ?? [])) {
    if (!item || typeof item !== 'object' || item.type !== 'object') continue;
    if (nonEmptyString(item.objectName) && !out.includes(item.objectName)) out.push(item.objectName);
  }
  return out;
}

/** One section of the index: the reports of one primary object, or of none. */
export interface ReportSection {
  /** The reports' primary object, or `null` for the 「其它」 section. */
  object: string | null;
  /** Its reports, in the order they were handed in. */
  entries: AppReportEntry[];
}

/**
 * `entries` in sections by primary object (objectstack#27526), each section
 * keeping the entries' order: first the objects `order` names, in its order
 * (the app's navigation, {@link navigationObjectOrder}), then the other
 * objects by `labelOf`, then the 「其它」 section of the reports with no
 * primary object. An object with no entry has no section.
 */
export function groupReportsByObject(
  entries: readonly AppReportEntry[],
  order: readonly string[],
  labelOf: (object: string) => string,
  language?: string,
): ReportSection[] {
  const byObject = new Map<string, AppReportEntry[]>();
  const other: AppReportEntry[] = [];
  for (const entry of entries) {
    if (entry.object === undefined) {
      other.push(entry);
      continue;
    }
    const section = byObject.get(entry.object);
    if (section) section.push(entry);
    else byObject.set(entry.object, [entry]);
  }
  const rank = (object: string) => {
    const at = order.indexOf(object);
    return at === -1 ? order.length : at;
  };
  const objects = [...byObject.keys()].sort(
    (a, b) => rank(a) - rank(b) || labelOf(a).localeCompare(labelOf(b), language) || a.localeCompare(b),
  );
  const sections: ReportSection[] = objects.map((object) => ({ object, entries: byObject.get(object)! }));
  if (other.length > 0) sections.push({ object: null, entries: other });
  return sections;
}

/**
 * The index's views (objectstack#27526): every report the member may open,
 * or the ones they opened last. A reader's choice, never metadata.
 */
export type ReportIndexView = 'all' | 'recent';

/** What a reader who never chose sees: every report. */
export const DEFAULT_REPORT_INDEX_VIEW: ReportIndexView = 'all';

/**
 * The reader's index view, in the console's preference store
 * (`workspacePreference.ts`), scope `user`: one choice across apps, stored as
 * `{"value":"all"|"recent","v":1}`. Any other stored value is no choice.
 */
export const REPORT_INDEX_VIEW_PREFERENCE = defineWorkspacePreference<ReportIndexView>({
  name: 'reports.index.view',
  codec: versionedPreferenceCodec<ReportIndexView>({
    version: 1,
    toRecord: (value) => ({ value }),
    fromRecord: (record) => (record.value === 'all' || record.value === 'recent' ? record.value : undefined),
  }),
});

/**
 * When the reader last opened each report, by name, most recent first: the
 * `report` entries of the recent-items store and their `visitedAt`. The store
 * keeps the last few targets of every kind, so a report opened long ago, or
 * only in another browser before the store synced, is not in it.
 */
export function lastOpenedReports(items: readonly RecentItem[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of items) {
    if (item.type === 'report' && !out.has(item.name)) out.set(item.name, item.visitedAt);
  }
  return out;
}

/**
 * Whether `entry` holds the search `query`, ignoring case: in its label, its
 * description or its object's label. An empty query matches every entry.
 */
export function reportMatchesQuery(entry: AppReportEntry, objectLabel: string | undefined, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') return true;
  return [entry.label, entry.description, objectLabel].some(
    (text) => typeof text === 'string' && text.toLocaleLowerCase().includes(needle),
  );
}

/** How the index names an object (objectstack#27526). */
export interface ReportObjectLabels {
  /** A section header: the object's plural label, else its label, else its name. */
  plural(object: string): string;
  /** A row's object cell: the object's label, else its name. */
  singular(object: string): string;
}

const NO_OBJECTS: readonly unknown[] = [];

const nonBlank = (text: string | undefined): string | undefined =>
  typeof text === 'string' && text.trim() !== '' ? text : undefined;

/**
 * The labels of `objects`, the primary objects the index groups by, from the
 * object definitions the shell reads for the app: while nothing has loaded
 * the whole registry, the app's object scope (its package scope, the one the
 * navigation gates read, plus by name the objects it does not hold; for an
 * app with no package, the objects by name), else the registry as loaded.
 * A label passes through the bundle lookup the console applies to object
 * names (`useObjectLabel`).
 */
export function useReportObjectLabels(app: unknown, objects: readonly string[]): ReportObjectLabels {
  const metadata = useMetadata();
  const { objectLabel, objectPluralLabel } = useObjectLabel();
  const { language } = useObjectTranslation();
  const packageId = packageOf(app);
  const scoped = !!metadata.readObjectScope && metadata.getTypeStatus?.('object') === 'idle';
  let served: unknown;
  if (!scoped) served = metadata.getItemsByType('object');
  else if (objects.length === 0) served = NO_OBJECTS;
  else served = metadata.readObjectScope!(packageId ? { packageId, names: objects } : { names: objects }).served;

  const byName = new Map<string, { label?: unknown; pluralLabel?: unknown }>();
  for (const item of Array.isArray(served) ? served : []) {
    if (!item || typeof item !== 'object') continue;
    const name = (item as { name?: unknown }).name;
    if (nonEmptyString(name) && !byName.has(name)) byName.set(name, item as { label?: unknown; pluralLabel?: unknown });
  }
  const labelText = (object: string) => metadataText(byName.get(object)?.label, language) ?? '';
  return {
    plural: (object) => {
      const pluralLabel = byName.get(object)?.pluralLabel;
      return (
        nonBlank(
          objectPluralLabel({
            name: object,
            label: labelText(object),
            ...(typeof pluralLabel === 'string' ? { pluralLabel } : {}),
          }),
        ) ?? object
      );
    },
    singular: (object) => nonBlank(objectLabel({ name: object, label: labelText(object) })) ?? object,
  };
}
