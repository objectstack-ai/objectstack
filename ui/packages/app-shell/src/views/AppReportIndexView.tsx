/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The app's report index, `/apps/APP/reports` (objectui#13020): every report
 * the app ships that the member may open, by its localized label, each linking
 * to its own route, `report/NAME`. Which reports, and under which read rule,
 * is `useAppReportEntries`'s answer (`appReportIndex.ts`); the ⌘K palette
 * reads the same one. The sidebar links here from every app, so a report the
 * app's navigation does not name still has a UI path. A report it names is
 * listed only when the sidebar's gates show the member an entry naming it
 * (objectstack#26892).
 *
 * ## Views, sections and search (objectstack#27526)
 *
 * Two views across the top, the reader's choice kept per user
 * (`REPORT_INDEX_VIEW_PREFERENCE`): 全部 lists every report in one section
 * per primary object, in the app's navigation order, with the 「其它」 section
 * last (`groupReportsByObject`); each section header shows its count and
 * collapses its section. 最近 lists the reports the reader opened last, most
 * recent first, from the recent-items store, in one list: its order is the
 * point of the view, so it is not split by object. A row shows the report's
 * label, its object and when the reader last opened it; the search box
 * filters the current view. There is no 「我创建的」 view: the served report
 * list carries no creator.
 *
 * Which sections are collapsed is this visit's state only.
 */

import { useId, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BarChart3, ChevronDown, ChevronRight, Loader2, Search } from 'lucide-react';
import { Empty, EmptyTitle, EmptyDescription, Input, cn } from '@object-ui/components';
import { useDisplayLocale, useObjectTranslation } from '@object-ui/i18n';
import { useExpressionContext } from '../providers/ExpressionProvider.js';
import { useNavMemberGates } from '../hooks/useNavMemberGates.js';
import { useRecentItems } from '../context/RecentItemsProvider.js';
import { useWorkspacePreference } from '../utils/workspacePreference.js';
import { timeAgo } from '../utils/relativeTime.js';
import {
  DEFAULT_REPORT_INDEX_VIEW,
  REPORT_INDEX_VIEW_PREFERENCE,
  groupReportsByObject,
  lastOpenedReports,
  navigationObjectOrder,
  reportMatchesQuery,
  useAppReportEntries,
  useReportObjectLabels,
  type AppReportEntry,
  type ReportIndexView,
  type ReportObjectLabels,
  type ReportSection,
} from './appReportIndex.js';

const VIEWS: readonly ReportIndexView[] = ['all', 'recent'];

type Translate = ReturnType<typeof useObjectTranslation>['t'];

function viewLabel(t: Translate, view: ReportIndexView): string {
  return view === 'recent'
    ? t('console.reportIndex.viewRecent', { defaultValue: 'Recent' })
    : t('console.reportIndex.viewAll', { defaultValue: 'All reports' });
}

export function AppReportIndexView() {
  const { t, language } = useObjectTranslation();
  const displayLocale = useDisplayLocale();
  const { appName } = useParams<{ appName: string }>();
  const { app } = useExpressionContext();
  const gates = useNavMemberGates();
  const { entries, loading } = useAppReportEntries(app, true, gates);
  const { recentItems } = useRecentItems();
  const [view, setView] = useWorkspacePreference(REPORT_INDEX_VIEW_PREFERENCE, 'user', DEFAULT_REPORT_INDEX_VIEW);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const objects = [...new Set(entries.flatMap((entry) => (entry.object ? [entry.object] : [])))];
  const labels = useReportObjectLabels(app, objects);
  const title = t('console.reportIndex.title', { defaultValue: 'Reports' });

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center p-8" data-testid="report-index-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const lastOpened = lastOpenedReports(recentItems);
  const matches = (entry: AppReportEntry) =>
    reportMatchesQuery(entry, entry.object ? labels.singular(entry.object) : undefined, query);
  const row = (entry: AppReportEntry) => (
    <ReportRow
      key={entry.name}
      entry={entry}
      href={`/apps/${appName}/report/${encodeURIComponent(entry.name)}`}
      objectLabel={entry.object ? labels.singular(entry.object) : undefined}
      opened={timeAgo(lastOpened.get(entry.name), displayLocale)}
      t={t}
    />
  );

  let body: ReactNode;
  if (view === 'recent') {
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    const recent = [...lastOpened.keys()].flatMap((name) => byName.get(name) ?? []);
    const shown = recent.filter(matches);
    body =
      shown.length > 0 ? (
        <ul className="divide-y" aria-label={viewLabel(t, 'recent')} data-testid="report-index-recent">
          {shown.map(row)}
        </ul>
      ) : (
        <NoneShown
          title={
            recent.length === 0
              ? t('console.reportIndex.recentEmpty', { defaultValue: 'No recently opened reports' })
              : t('console.reportIndex.noMatch', { defaultValue: 'No reports match your search.' })
          }
        />
      );
  } else {
    const sections = groupReportsByObject(entries.filter(matches), navigationObjectOrder(app), labels.plural, language);
    body =
      sections.length > 0 ? (
        <div className="divide-y" data-testid="report-index-sections">
          {sections.map((section) => {
            const key = section.object ?? '';
            return (
              <ReportSectionView
                key={key}
                section={section}
                labels={labels}
                collapsed={collapsed.has(key)}
                onToggle={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (!next.delete(key)) next.add(key);
                    return next;
                  })
                }
                t={t}
              >
                {section.entries.map(row)}
              </ReportSectionView>
            );
          })}
        </div>
      ) : (
        <NoneShown title={t('console.reportIndex.noMatch', { defaultValue: 'No reports match your search.' })} />
      );
  }

  return (
    <div className="flex flex-col h-full overflow-auto bg-background" data-testid="report-index">
      <div className="p-4 sm:p-6 border-b shrink-0">
        <h1 className="text-lg sm:text-xl md:text-2xl font-bold tracking-tight">{title}</h1>
      </div>
      {entries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <Empty>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <BarChart3 className="h-6 w-6 text-muted-foreground" />
            </div>
            <EmptyTitle>{t('console.reportIndex.emptyTitle', { defaultValue: 'No reports' })}</EmptyTitle>
            <EmptyDescription>
              {t('console.reportIndex.emptyDescription', {
                defaultValue: 'This app has no reports you can open.',
              })}
            </EmptyDescription>
          </Empty>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 px-4 sm:px-6 py-3 border-b sm:flex-row sm:items-center sm:justify-between">
            <div
              role="group"
              aria-label={t('console.reportIndex.viewsLabel', { defaultValue: 'Report views' })}
              className="inline-flex shrink-0 rounded-md border p-0.5"
            >
              {VIEWS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={view === option}
                  onClick={() => setView(option)}
                  className={cn(
                    'rounded px-3 py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    view === option ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                  data-testid={`report-index-view-${option}`}
                >
                  {viewLabel(t, option)}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:max-w-xs">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('console.reportIndex.searchPlaceholder', { defaultValue: 'Search reports…' })}
                aria-label={t('console.reportIndex.searchLabel', { defaultValue: 'Search reports' })}
                className="pl-8"
                data-testid="report-index-search"
              />
            </div>
          </div>
          {body}
        </>
      )}
    </div>
  );
}

/** One collapsible section of the 全部 view: its object's label and count, then its reports. */
function ReportSectionView({
  section,
  labels,
  collapsed,
  onToggle,
  t,
  children,
}: {
  section: ReportSection;
  labels: ReportObjectLabels;
  collapsed: boolean;
  onToggle: () => void;
  t: Translate;
  children: ReactNode;
}) {
  const headerId = useId();
  const listId = useId();
  const label =
    section.object === null
      ? t('console.reportIndex.otherSection', { defaultValue: 'Other' })
      : labels.plural(section.object);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <section aria-labelledby={headerId} data-testid="report-index-section" data-object={section.object ?? ''}>
      <h2 className="m-0">
        <button
          id={headerId}
          type="button"
          aria-expanded={!collapsed}
          aria-controls={listId}
          onClick={onToggle}
          className="flex w-full items-center gap-2 bg-muted/40 px-4 sm:px-6 py-2 text-left text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:bg-muted"
        >
          <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 truncate">{label}</span>
          <span
            className="rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground"
            data-testid="report-index-section-count"
          >
            {section.entries.length}
          </span>
        </button>
      </h2>
      {!collapsed && (
        <ul id={listId} className="divide-y" aria-label={label}>
          {children}
        </ul>
      )}
    </section>
  );
}

/**
 * One report: its link carries the label and description only, so the link's
 * name is the report's; the object and last-opened cells sit beside it, and
 * the link's overlay makes the whole row the click target.
 */
function ReportRow({
  entry,
  href,
  objectLabel,
  opened,
  t,
}: {
  entry: AppReportEntry;
  href: string;
  objectLabel: string | undefined;
  opened: string;
  t: Translate;
}) {
  const openedText = opened ? t('console.reportIndex.lastOpened', { defaultValue: 'Opened {{time}}', time: opened }) : '';
  return (
    <li className="relative flex items-center gap-3 px-4 sm:px-6 py-3 hover:bg-accent focus-within:bg-accent">
      <BarChart3 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <Link
        to={href}
        className="min-w-0 flex-1 after:absolute after:inset-0 focus-visible:outline-none"
        data-testid={`report-index-entry-${entry.name}`}
      >
        <span className="block truncate text-sm font-medium">{entry.label}</span>
        {entry.description && <span className="block truncate text-xs text-muted-foreground">{entry.description}</span>}
      </Link>
      {objectLabel && (
        <span
          className="hidden sm:block w-40 shrink-0 truncate text-xs text-muted-foreground"
          data-testid={`report-index-object-${entry.name}`}
        >
          {objectLabel}
        </span>
      )}
      <span
        className="hidden sm:block w-48 shrink-0 truncate text-right text-xs text-muted-foreground"
        data-testid={`report-index-opened-${entry.name}`}
        title={openedText || undefined}
      >
        {openedText}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </li>
  );
}

/** What a view shows when it lists no report. */
function NoneShown({ title }: { title: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8" data-testid="report-index-none">
      <p className="text-sm text-muted-foreground">{title}</p>
    </div>
  );
}
