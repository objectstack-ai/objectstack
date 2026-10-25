/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0037 — the persistent "Draft preview" watermark. Renders only while the
 * tree is in preview mode (`?preview=draft`); makes the mode unmistakable and
 * offers the only two actions that matter: leave the preview, or make it real
 * (the same governed one-click publish the Home banner uses). The bar is what
 * keeps a read-only preview from ever being confused with the live app.
 */

import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Eye, X, Rocket, GitCompareArrows, Sparkles } from 'lucide-react';
import { Button, cn } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { usePreviewDrafts, markPreviewExit, PREVIEW_QUERY_FLAG } from './PreviewModeContext.js';
import { usePendingDrafts } from './usePendingDrafts.js';
import { usePublishAllDrafts } from './usePublishAllDrafts.js';
import { DraftChangesPanel } from './DraftChangesPanel.js';
import { draftSurfaceOf, draftsOnSurface } from './draftSurface.js';

export function DraftPreviewBar() {
  const preview = usePreviewDrafts();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useObjectTranslation();
  const { publishAll, publishing } = usePublishAllDrafts(t);
  const [changesOpen, setChangesOpen] = useState(false);
  // Pending-draft count for the Changes button label — what Publish will
  // actually promote. The shared source (objectui#5801) refreshes on the
  // metadata-refresh pulse; the pathname effect keeps the old "drafts staged
  // while the preview is open" trigger too.
  const { count: pendingCount, entries: pendingEntries, refresh: refreshPending } = usePendingDrafts({
    enabled: Boolean(preview),
  });
  useEffect(() => {
    if (!preview) return;
    void refreshPending();
  }, [preview, location.pathname, refreshPending]);
  // objectui#12968 — what is pending on the surface this preview shows: the
  // route below `/apps/:appName` names it (an object, a page, a dashboard or a
  // report), and the entries the count above already read are filtered to it.
  // No surface (the app's landing, admin pages) or an unknown count → no line.
  const appSubPath = useParams()['*'];
  const surface = useMemo(
    () => (appSubPath === undefined ? null : draftSurfaceOf(appSubPath)),
    [appSubPath],
  );
  const pendingHere =
    surface && typeof pendingCount === 'number' ? draftsOnSurface(pendingEntries, surface).length : 0;

  if (!preview) return null;

  const exit = () => {
    // Tell the sticky preview keeper this is an INTENTIONAL exit, or it
    // would immediately re-apply the flag we are about to remove.
    markPreviewExit();
    const params = new URLSearchParams(location.search);
    params.delete(PREVIEW_QUERY_FLAG);
    const qs = params.toString();
    navigate(`${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`, { replace: true });
  };

  const publish = async () => {
    const result = await publishAll();
    if (!result.ok) return;
    // The draft world just became the real world — exit preview and reload so
    // every renderer re-reads the published registry.
    exit();
    setTimeout(() => { try { window.location.reload(); } catch { /* ignore */ } }, 300);
  };

  // Under the auto-publish posture (and any time a draft preview is opened with
  // nothing staged) there are zero pending drafts. Claiming "nothing is live
  // until you publish" and offering a Publish button then is both false and a
  // no-op, so the bar drops the publish affordance and softens to a neutral
  // preview indicator. An UNKNOWN count (null — still loading or the fetch
  // failed) keeps the publish path: we only relax when we KNOW the count is zero.
  const noChanges = pendingCount === 0;
  // objectui#13140 — "Sample data appears once you publish" is a claim about
  // what Publish will do, and publishing loads rows only for a `seed` draft it
  // promotes (the publish response's `seedApplied` receipt rides on a seed's
  // promotion and nothing else). So the sentence shows only while a pending
  // `seed` draft is in the list this bar read — the same env-wide `_drafts`
  // list `usePublishAllDrafts` publishes. A package with no sample data, whose
  // records already show, gets the Publish button alone; so does an unknown
  // count, which read no entries and so cannot back the promise.
  const seedPending = pendingEntries.some((entry) => entry.type === 'seed');

  return (
    <div
      className={cn(
        'sticky top-0 z-40 border-b',
        noChanges
          ? 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-300'
          : 'border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200',
      )}
      data-testid="draft-preview-bar"
    >
      {/* Control strip — the persistent preview indicator and secondary
          controls (Changes / Exit). The dominant Publish action lives in the
          hint band below so it reads as the one obvious next step. */}
      <div className="flex items-center gap-3 px-4 py-2 text-sm">
        <Eye className="h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1 truncate">
          {noChanges
            ? t('preview.draftBar.messageClean', {
                defaultValue: 'Draft preview — no unpublished changes; everything here is already live.',
              })
            : pendingHere > 0
              ? t('preview.draftBar.pendingHere', {
                  count: pendingHere,
                  defaultValue: 'Draft preview · {{count}} unpublished changes on this page',
                })
              : t('preview.draftBar.message', {
                  defaultValue:
                    'Draft preview — you are seeing unpublished changes. Nothing here is live until you publish.',
                })}
        </p>
        {!noChanges && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setChangesOpen(true)}
            data-testid="draft-preview-changes"
          >
            <GitCompareArrows className="mr-1 h-3.5 w-3.5" />
            {t('preview.draftBar.changes', { defaultValue: 'Changes' })}
            {typeof pendingCount === 'number' ? ` (${pendingCount})` : ''}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={exit} data-testid="draft-preview-exit">
          <X className="mr-1 h-3.5 w-3.5" />
          {t('preview.draftBar.exit', { defaultValue: 'Exit preview' })}
        </Button>
      </div>

      {/* Publish band — shown only while changes are pending, with Publish as
          the dominant CTA. Its magic-moment hint shows only while a `seed`
          draft is pending (`seedPending` above): a freshly-built draft renders
          empty (dashboards at 0, lists "Nothing here yet") because its seed
          rows load only on publish, and naming that keeps an empty preview
          from reading as a broken or hollow build. Without a pending seed,
          publishing loads no rows, and the hint would contradict the records
          already on screen. */}
      {!noChanges && (
        <>
          <div className="flex items-center gap-3 border-t border-amber-300/50 px-4 py-2.5 dark:border-amber-700/40">
            {seedPending && (
              <div className="flex min-w-0 flex-1 items-center gap-3" data-testid="draft-preview-sample-hint">
                <Sparkles className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-tight">
                    {t('preview.draftBar.sampleDataTitle', {
                      defaultValue: 'Sample data appears once you publish',
                    })}
                  </p>
                  <p className="text-xs leading-snug text-amber-800/80 dark:text-amber-200/70">
                    {t('preview.draftBar.sampleDataBody', {
                      defaultValue:
                        'You’re previewing your app’s structure. Publish to load example records and make it live.',
                    })}
                  </p>
                </div>
              </div>
            )}
            <Button
              onClick={publish}
              disabled={publishing}
              data-testid="draft-preview-publish"
              className="ml-auto shrink-0 shadow-sm"
            >
              <Rocket className="mr-1.5 h-4 w-4" />
              {publishing
                ? t('preview.draftBar.publishing', { defaultValue: 'Publishing…' })
                : t('preview.draftBar.publishCta', { defaultValue: 'Publish to see it live' })}
            </Button>
          </div>
          <DraftChangesPanel open={changesOpen} onOpenChange={setChangesOpen} />
        </>
      )}
    </div>
  );
}
