// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ReportNewPage — the report builder for a NEW report (objectstack#36374),
 * at the app's `reports/new` address.
 *
 * The same builder the report page's 「Edit」 opens (`ReportBuilderHost`),
 * started on an empty report: the preview says 「Choose a data source」 and
 * that picker opens by itself. Save writes the report and publishes it in the
 * same press (the maintainer's ruling on epic #36510 — see `ReportView`), then
 * lands on the report's page. Admin only, as the Edit is: a report is shared
 * by every member of the workspace.
 *
 * The report's identifier is derived from the name the author typed (Chinese
 * romanised, as the Studio inspector derives it) and made unique against the
 * reports the console already knows, so a new report never writes over one.
 *
 * @module
 */

import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Empty, EmptyDescription, EmptyTitle } from '@object-ui/components';
import { useObjectTranslation, pickLocalized } from '@object-ui/i18n';
import { useWorkspaceAdminStatus } from '@object-ui/auth';
import { formatMetadataError } from '@object-ui/data-objectstack';
import type { DataSource } from '@object-ui/types';
import type { ReportDraft } from '@object-ui/plugin-report';
import { ReportBuilderHost } from './ReportBuilderHost.js';
import { saveAndPublishRuntimeMetadata } from './runtime-metadata-persistence.js';
import { useMetadataClient } from './metadata-admin/useMetadata.js';
import { useMetadata } from '../providers/MetadataProvider.js';
import { loadHanRomanizer, romanizeHan } from './metadata-admin/romanizeHan.js';
import { toFieldNameOrEmpty } from './metadata-admin/previews/object-fields-io.js';

/** The report a new builder starts on: nothing bound, the one report type. */
export const NEW_REPORT_SEED: ReportDraft = { name: '', label: '', type: 'summary' };

/**
 * The identifier a new report is saved under: its name as an identifier,
 * `report` when the name gives none, suffixed until no known report holds it.
 */
export function newReportName(label: string, taken: ReadonlySet<string>): string {
  const base = toFieldNameOrEmpty(romanizeHan(label)) || 'report';
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function ReportNewPage({ dataSource }: { dataSource?: DataSource }) {
  const { t, language } = useObjectTranslation();
  const { appName } = useParams<{ appName: string }>();
  const navigate = useNavigate();
  const metadataClient = useMetadataClient();
  const { reports, loading, refresh } = useMetadata();
  const { isAdmin, isResolved } = useWorkspaceAdminStatus();

  const backToReports = React.useCallback(() => {
    if (appName) navigate(`/apps/${appName}/reports`);
    else navigate(-1);
  }, [navigate, appName]);

  const handleSave = React.useCallback(
    async (draft: ReportDraft): Promise<boolean> => {
      if (!metadataClient) return false;
      await loadHanRomanizer().catch(() => {});
      const taken = new Set(((reports as Array<{ name?: unknown }>) ?? []).map((r) => String(r?.name ?? '')));
      // A report needs a name to be listed by: one left blank is saved under
      // the placeholder the box showed.
      const typed = pickLocalized(draft.label, language).trim();
      const label = typed ? draft.label : t('report.builder.namePlaceholder');
      const name = newReportName(typed || String(draft.dataset ?? ''), taken);
      const body = { ...draft, label, name };
      try {
        const outcome = await saveAndPublishRuntimeMetadata('report', name, body, {
          metadataClient,
          dataSource: dataSource as any,
        });
        if (outcome === 'pending-draft') {
          toast.error(t('form.saveError'), { description: t('report.builder.pendingDraft') });
          return false;
        }
      } catch (err) {
        toast.error(t('form.saveError'), {
          description: formatMetadataError(err),
          classNames: { description: 'whitespace-pre-line' },
        });
        return false;
      }
      await refresh().catch(() => {});
      navigate(appName ? `/apps/${appName}/report/${encodeURIComponent(name)}` : `../report/${encodeURIComponent(name)}`, {
        replace: true,
      });
      return true;
    },
    [metadataClient, reports, language, dataSource, refresh, navigate, appName, t],
  );

  if (loading || !isResolved) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex h-full items-center justify-center p-8" data-testid="report-new-admin-only">
        <Empty>
          <EmptyTitle>{t('report.builder.adminOnlyTitle')}</EmptyTitle>
          <EmptyDescription>{t('report.builder.adminOnly')}</EmptyDescription>
        </Empty>
      </div>
    );
  }

  return (
    <ReportBuilderHost
      initial={NEW_REPORT_SEED}
      onSave={handleSave}
      onClose={backToReports}
      dataSource={dataSource}
    />
  );
}
