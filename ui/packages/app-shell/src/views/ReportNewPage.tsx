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
 * Opened from the reports index's 「New report」 (objectstack#36692): a report
 * is made from its own entry, never from the design mode, whose menu only
 * links reports that exist. The builder's Save and Close in its own header
 * are the screen's one Save/Cancel set: while the builder is open it holds
 * the design mode out (`useHoldDesignModeOut`), so entering the mode refuses.
 * The address can still be reached with the mode already on (the browser's
 * Back from a page of the app the mode was entered on), so while the mode is
 * on the page draws a prompt in place of the builder, and the builder opens
 * once the mode is saved or cancelled.
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
import { useDesignModeActive, useHoldDesignModeOut } from '../layout/designMode.js';
import {
  isRuntimeCreateNotSaved,
  pickRuntimeCreatePackage,
  saveAndPublishInPackage,
} from './runtime-metadata-persistence.js';
import { runtimeCreateRefusalText, usePackageCreateAsk } from './metadata-admin/PackageCreateAsk.js';
import { useMetadataLocale } from './metadata-admin/i18n.js';
import { draftBarPackageOf } from '../preview/DraftPreviewBar.js';
import { useMetadataClient } from './metadata-admin/useMetadata.js';
import { useMetadata } from '../providers/MetadataProvider.js';
import { loadHanRomanizer, romanizeHan } from './metadata-admin/romanizeHan.js';
import { toFieldNameOrEmpty } from './metadata-admin/previews/object-fields-io.js';
import { useStudioReturnLeaveMessage, useStudioReturnPath } from './StudioReturnButton.js';
import { withStudioReturn } from './studio-design/studioAddress.js';

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

/** How many names {@link freeReportName} asks about before it gives up. */
const NAME_TRIES = 50;

/**
 * The identifier a new report is created under, asked of the server by name.
 * A create never lands on a report that exists: the console's list can miss
 * one (read before another admin's create, or held by a package the list does
 * not show), and the draft pin of the save stops only a pending draft, so each
 * candidate is asked of every served layer (`exists`) first and a name it
 * holds moves on to the next suffix. `null` once {@link NAME_TRIES} are taken.
 */
export async function freeReportName(
  label: string,
  known: ReadonlySet<string>,
  exists: (name: string) => Promise<boolean>,
): Promise<string | null> {
  const taken = new Set(known);
  for (let tries = 0; tries < NAME_TRIES; tries += 1) {
    const name = newReportName(label, taken);
    if (!(await exists(name))) return name;
    taken.add(name);
  }
  return null;
}

export function ReportNewPage({ dataSource }: { dataSource?: DataSource }) {
  const { t, language } = useObjectTranslation();
  const { appName } = useParams<{ appName: string }>();
  const navigate = useNavigate();
  const metadataClient = useMetadataClient();
  const { reports, apps, loading, refresh } = useMetadata();
  const { isAdmin, isResolved } = useWorkspaceAdminStatus();
  const designing = useDesignModeActive();
  // The builder is open whenever this page draws it (objectstack#36692).
  useHoldDesignModeOut(isResolved && isAdmin && !designing);

  // objectstack#36906 — opened from Studio's report list (decision 13): the
  // builder's × goes back to that list, and the new report's page keeps the
  // way back (`?studio=`). Either way, × over unsaved edits asks first.
  const studioReturn = useStudioReturnPath();
  const studioLeaveMessage = useStudioReturnLeaveMessage();
  const backToReports = React.useCallback(
    ({ dirty }: { dirty: boolean }) => {
      if (dirty && !window.confirm(studioLeaveMessage)) return;
      if (studioReturn) navigate(studioReturn);
      else if (appName) navigate(`/apps/${appName}/reports`);
      else navigate(-1);
    },
    [navigate, appName, studioReturn, studioLeaveMessage],
  );
  // objectstack#36906, objectstack#37261 — a new report is saved in the app's
  // package, where Studio's report list finds it, as a new view made in an app
  // is (`resolveRuntimeCreatePackage`): the package when it is writable, else
  // its customization package through the ensure door. One rule for both ways
  // in: Studio's report list and the app's own reports index.
  // objectstack#38149 — when neither can be had, or outside any app, the
  // author picks a package or creates one before anything is written; in a
  // system app the report is refused, naming where to make it instead.
  const appPackageId = draftBarPackageOf(appName, apps as Parameters<typeof draftBarPackageOf>[1]);
  const { ask: askPackage, dialog: packageAskDialog } = usePackageCreateAsk();
  const metadataLocale = useMetadataLocale();

  const handleSave = React.useCallback(
    async (draft: ReportDraft): Promise<boolean> => {
      if (!metadataClient) return false;
      let packageId: string;
      try {
        packageId = await pickRuntimeCreatePackage({ packageId: appPackageId, askPackage }, 'report');
      } catch (err) {
        if (!isRuntimeCreateNotSaved(err)) throw err;
        const refusal = runtimeCreateRefusalText(err, 'report', metadataLocale);
        if (refusal) toast.error(t('form.saveError'), { description: refusal });
        return false;
      }
      await loadHanRomanizer().catch(() => {});
      const taken = new Set(((reports as Array<{ name?: unknown }>) ?? []).map((r) => String(r?.name ?? '')));
      // A report needs a name to be listed by: one left blank is saved under
      // the placeholder the box showed.
      const typed = pickLocalized(draft.label, language).trim();
      const label = typed ? draft.label : t('report.builder.namePlaceholder');
      let name: string | null;
      try {
        name = await freeReportName(
          typed || String(draft.dataset ?? ''),
          taken,
          async (candidate) => !!(await metadataClient.get('report', candidate)),
        );
        if (!name) {
          toast.error(t('form.saveError'), { description: t('report.builder.nameTaken') });
          return false;
        }
        const body = { ...draft, label, name };
        const ctx = { metadataClient, dataSource: dataSource as any };
        const outcome = await saveAndPublishInPackage('report', name, body, packageId, ctx);
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
      const reportPath = appName ? `/apps/${appName}/report/${encodeURIComponent(name)}` : `../report/${encodeURIComponent(name)}`;
      navigate(studioReturn ? withStudioReturn(reportPath, studioReturn) : reportPath, {
        replace: true,
      });
      return true;
    },
    [metadataClient, reports, language, dataSource, refresh, navigate, appName, t, studioReturn, appPackageId, askPackage, metadataLocale],
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

  // Never a second Save/Cancel set under the design mode's bar (objectstack#36692).
  if (designing) {
    return (
      <div className="flex h-full items-center justify-center p-8" data-testid="report-new-design-mode">
        <Empty>
          <EmptyTitle>{t('report.builder.designModeOnTitle')}</EmptyTitle>
          <EmptyDescription>{t('report.builder.designModeOn')}</EmptyDescription>
        </Empty>
      </div>
    );
  }

  return (
    <>
      <ReportBuilderHost
        initial={NEW_REPORT_SEED}
        onSave={handleSave}
        onClose={backToReports}
        dataSource={dataSource}
      />
      {packageAskDialog}
    </>
  );
}
