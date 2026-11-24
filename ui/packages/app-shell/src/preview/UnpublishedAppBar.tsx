/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0045 — the "unpublished app" banner. Renders while the CURRENT app is
 * materialized-but-unpublished (`app._unpublished === true`): the app is fully
 * real — tables, data, interactions — but end users can't see it (the REST gate
 * strips it for non-builders). The banner narrates that state and offers the
 * one action that matters: Publish, which simply clears the publish gate
 * (`_unpublished: false`) — instant and reversible, per ADR-0045.
 *
 * ## Why `_unpublished` and not `hidden` (objectstack#4829 A1, framework PR
 * objectstack#6942)
 *
 * These were one flag and are now two, with disjoint meanings:
 *
 *   `_unpublished` — MACHINE-MANAGED publish gate. Set by materialization,
 *                    cleared by publish. The server withholds these apps from
 *                    non-builders, so this bar is the builder's own watermark.
 *   `hidden`       — AUTHOR-DECLARED navigation presentation, and nothing else.
 *                    "Hidden apps stay fully routable and permission-checked";
 *                    they are published, real, reachable by URL, and merely
 *                    kept out of the launcher (the built-in `account` app is
 *                    the specimen).
 *
 * Reading `hidden` here was therefore wrong in BOTH directions once the
 * framework split them: it painted the "unpublished" watermark over published
 * nav-hidden apps (Account), and it dropped the watermark from the builder's
 * own genuinely-unpublished preview. Launcher surfaces keep filtering on
 * `hidden` — that key now means exactly what it says — and must NOT start
 * filtering on `_unpublished`, which the server already withholds
 * (`layout/AppSwitcher.tsx`, `console/AppContent.tsx`, `console/home/HomePage.tsx`).
 *
 * Sibling of DraftPreviewBar (the ADR-0037 draft-overlay watermark): that bar
 * owns mutation preview (`?preview=draft`); this one owns the materialize
 * regime. In preview mode this bar yields — the draft bar already narrates.
 *
 * objectstack#34610 — a new app the AI builds is materialized (ADR-0045), so
 * while the drawer builds it the main area shows the real app and this bar is
 * the screen's one Publish (the chat draws none). Its sentence says the app is
 * not published yet, the card's 「这个应用还没发布过」, as the draft bar's
 * says how many unpublished changes a published app has; a publish here tells
 * the chat, which shows a receipt.
 */

import { useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { EyeOff, History, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { useMetadata } from '../providers/MetadataProvider.js';
import { useAdapter } from '../providers/AdapterProvider.js';
import { emitPublishReceipt } from '../assistant/assistantBus.js';
import { matchAppBySegment } from '../utils/appRoute.js';
import { CommitTimeline } from './CommitTimeline.js';
import { usePreviewDrafts } from './PreviewModeContext.js';

export function UnpublishedAppBar() {
  const preview = usePreviewDrafts();
  const { appName } = useParams();
  const location = useLocation();
  const { apps, refresh } = useMetadata();
  const adapter = useAdapter();
  const { t } = useObjectTranslation();
  const [publishing, setPublishing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // The draft-preview watermark owns the preview tree; never stack both bars.
  if (preview) return null;
  const routeApp = appName ?? location.pathname.match(/\/apps\/([^/?#]+)/)?.[1];
  if (!routeApp) return null;
  const app = matchAppBySegment(apps ?? [], routeApp);
  if (!app || (app as any)._unpublished !== true) return null;
  // ADR-0067 — the package this app belongs to keys its commit timeline.
  const packageId =
    (app as { packageId?: string })?.packageId ?? (app as { _packageId?: string })?._packageId ?? null;

  const publish = async () => {
    setPublishing(true);
    try {
      // Publish = the ADR-0045 visibility flip: one metadata write, no
      // lifecycle machinery. Body is the full current app with
      // `_unpublished: false` (the meta save endpoint replaces the overlay row).
      //
      // `false`, not a delete: ADR-0045 §3 makes publish/unpublish symmetric
      // ("unpublish = re-hide"), so the gate stays a two-state flag rather than
      // a key whose absence has to be re-derived — the same shape the server's
      // own `POST /packages/:id/publish-drafts` flip writes.
      //
      // Whatever `hidden` the app carries rides through the spread UNTOUCHED:
      // publishing an app must not silently rewrite the author's navigation
      // choice, which is the exact regression objectstack#4829 was filed for.
      //
      // objectstack#34610 — saved under the app's own NAME. The route segment
      // is the app's package id (ADR-0048) for every app the AI builds, and
      // the meta door refuses an app saved under a key its `name` disagrees
      // with, so a write keyed by the segment never published the app.
      const appKey = typeof (app as { name?: unknown }).name === 'string' && (app as { name: string }).name
        ? (app as { name: string }).name
        : routeApp;
      // objectstack#35054 (route D) — the body is the app as its author
      // STORED it (`getAuthoredItem`, the untranslated layers, read at the
      // address this write names), not the served row above: that row is
      // translated for the console's locale, and the door stores a body
      // verbatim, so publishing in zh-CN stored the app's label and every
      // navigation label in Chinese. An app with nothing stored to read is not
      // published from the served copy.
      const stored = adapter?.getAuthoredItem ? await adapter.getAuthoredItem('app', appKey) : null;
      if (!stored) throw new Error(`app/${appKey}`);
      const res = await fetch(`/api/v1/meta/app/${encodeURIComponent(appKey)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ...stored, _unpublished: false }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error((payload as any)?.error?.message ?? (payload as any)?.error ?? `HTTP ${res.status}`);
      }
      toast.success(
        t('preview.unpublishedBar.published', {
          defaultValue: 'Published! The app is now visible to your users.',
        }),
      );
      refresh?.();
      emitPublishReceipt({ packageId });
    } catch (e) {
      toast.error(
        `${t('preview.unpublishedBar.publishFailed', { defaultValue: 'Publish failed' })}: ${(e as Error).message}`,
      );
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <div
        className="sticky top-0 z-40 flex items-center gap-3 border-b border-amber-300/70 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
        data-testid="unpublished-app-bar"
      >
        <EyeOff className="h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1 truncate">
          {t('preview.unpublishedBar.notPublishedYet', {
            defaultValue:
              'This app is not published yet. It works, but only builders can see it. Publish to make it visible to your users.',
          })}
        </p>
        {packageId ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setHistoryOpen(true)}
            data-testid="unpublished-app-history"
          >
            <History className="mr-1 h-3.5 w-3.5" />
            {t('preview.history.button', { defaultValue: 'History' })}
          </Button>
        ) : null}
        <Button size="sm" onClick={publish} disabled={publishing} data-testid="unpublished-app-publish">
          <Rocket className="mr-1 h-3.5 w-3.5" />
          {publishing
            ? t('preview.unpublishedBar.publishing', { defaultValue: 'Publishing…' })
            : t('preview.unpublishedBar.publish', { defaultValue: 'Publish' })}
        </Button>
      </div>
      {packageId ? (
        <CommitTimeline
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          packageId={packageId}
          onReverted={refresh}
        />
      ) : null}
    </>
  );
}
