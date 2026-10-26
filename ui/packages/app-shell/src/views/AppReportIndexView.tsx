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
 * app's navigation does not name still has a UI path.
 */

import { Link, useParams } from 'react-router-dom';
import { BarChart3, ChevronRight, Loader2 } from 'lucide-react';
import { Empty, EmptyTitle, EmptyDescription } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { useExpressionContext } from '../providers/ExpressionProvider.js';
import { useAppReportEntries } from './appReportIndex.js';

export function AppReportIndexView() {
  const { t } = useObjectTranslation();
  const { appName } = useParams<{ appName: string }>();
  const { app } = useExpressionContext();
  const { entries, loading } = useAppReportEntries(app, true);
  const title = t('console.reportIndex.title', { defaultValue: 'Reports' });

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center p-8" data-testid="report-index-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
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
        <ul className="divide-y" aria-label={title}>
          {entries.map((entry) => (
            <li key={entry.name}>
              <Link
                to={`/apps/${appName}/report/${encodeURIComponent(entry.name)}`}
                className="flex items-center gap-3 px-4 sm:px-6 py-3 hover:bg-accent focus-visible:outline-none focus-visible:bg-accent"
                data-testid={`report-index-entry-${entry.name}`}
              >
                <BarChart3 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{entry.label}</span>
                  {entry.description && (
                    <span className="block truncate text-xs text-muted-foreground">{entry.description}</span>
                  )}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
