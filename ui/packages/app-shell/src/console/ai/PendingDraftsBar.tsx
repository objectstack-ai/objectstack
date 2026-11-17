/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Standing "unpublished changes" line for the AI build surface
 * (objectui#5694), above the composer while the conversation's bound package
 * has pending drafts, so it survives scrolling.
 *
 * objectstack#34610 — the line no longer publishes. The screen has one
 * Publish, the shell's bar for the regime the main area is in (the draft bar
 * for changes to a published app, the unpublished-app bar for an app not
 * published yet), and the chat points to it:
 *
 *  - while the main area shows this package's draft (`draftBarShown`), the
 *    line says where the Publish is;
 *  - otherwise it offers to show the draft (`onShowDraft`), which puts the
 *    main area on the app in draft mode, the draft bar on top.
 *
 * The count is the package's pending drafts (`_drafts?package=`), the scope
 * the draft bar, its changes panel and the draft cards read, so the chat and
 * the bar show one number. A publish from the shell's bar lands here as a
 * receipt (`subscribePublishReceipt`), shown until the package has pending
 * drafts again or the user dismisses it.
 *
 * Count freshness: re-read when the package binding changes and whenever the
 * turn goes idle (`idle` flips true) — tool results that stage drafts land
 * inside a turn, so idle edges are exactly when the count can have changed.
 * The shared source (objectui#5801) also re-reads on the metadata-refresh
 * pulse every publish sends.
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, Eye, X } from 'lucide-react';
import { Button } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { appPackageOf, usePendingDrafts } from '../../preview/usePendingDrafts.js';
import { subscribePublishReceipt } from '../../assistant/assistantBus.js';

export interface PendingDraftsBarProps {
  /** The conversation's bound package (ADR-0057 A1.a); undefined = not bound yet. */
  packageId: string | undefined;
  /** True while no turn is streaming — the count refetch trigger. */
  idle: boolean;
  /** The main area shows this package's draft, with the draft bar on top. */
  draftBarShown?: boolean;
  /** Put the main area on this package's draft; absent where there is no main area to move. */
  onShowDraft?: () => void;
}

export function PendingDraftsBar({ packageId, idle, draftBarShown = false, onShowDraft }: PendingDraftsBarProps) {
  const { t } = useObjectTranslation();
  // The app's drafts, as the shell's draft bar counts them: its package and
  // its customization pair (`appDraftPackages`), so the two numbers agree.
  const { count, refresh: refreshCount } = usePendingDrafts({
    appPackageId: packageId,
    enabled: Boolean(packageId),
  });
  // The package a landed publish covered, as its receipt; shown while it is
  // this conversation's package and nothing is pending again.
  const [receiptFor, setReceiptFor] = useState<string | null>(null);

  useEffect(() => {
    if (!packageId || !idle) return;
    void refreshCount();
  }, [idle, packageId, refreshCount]);

  // A publish from the shell's bar that covered this package (or the whole
  // environment) is this conversation's receipt.
  useEffect(() => {
    if (!packageId) return;
    return subscribePublishReceipt((r) => {
      if (r.packageId === null || appPackageOf(r.packageId) === appPackageOf(packageId)) setReceiptFor(packageId);
    });
  }, [packageId]);
  // New drafts after the publish supersede its receipt (adjusted while
  // rendering, the React pattern for state derived from a changed value).
  const pending = (count ?? 0) > 0;
  const [wasPending, setWasPending] = useState(pending);
  if (pending !== wasPending) {
    setWasPending(pending);
    if (pending) setReceiptFor(null);
  }
  const receipt = receiptFor !== null && receiptFor === packageId;

  if (!packageId) return null;

  if (!pending) {
    if (!receipt) return null;
    return (
      <div
        data-testid="publish-receipt"
        role="status"
        className="pointer-events-auto flex w-full max-w-3xl items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 shadow-sm backdrop-blur dark:text-emerald-200"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          {t('console.ai.pendingDrafts.receipt', { defaultValue: 'Published. Your changes are live.' })}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          onClick={() => setReceiptFor(null)}
          aria-label={t('console.ai.pendingDrafts.dismissReceipt', { defaultValue: 'Dismiss' })}
          data-testid="publish-receipt-dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div
      data-testid="pending-drafts-bar"
      className="pointer-events-auto flex w-full max-w-3xl items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm shadow-sm backdrop-blur"
    >
      {/* objectui#13088 — the sentence wraps: it takes the row's free width
          and breaks onto more lines, never cut to one with an ellipsis. On a
          phone the row is narrower than the sentence, and the cut half is
          the part that says where to publish. */}
      <span data-testid="pending-drafts-bar-sentence" className="min-w-0 flex-1">
        {draftBarShown || !onShowDraft
          ? t('console.ai.pendingDrafts.publishFromBar', {
              defaultValue: '{{count}} unpublished changes. Publish them from the draft bar at the top.',
              count,
            })
          : t('console.ai.pendingDrafts.showDraftToPublish', {
              defaultValue: '{{count}} unpublished changes. Show the draft to review and publish them.',
              count,
            })}
      </span>
      {!draftBarShown && onShowDraft ? (
        <Button
          size="sm"
          variant="outline"
          onClick={onShowDraft}
          className="shrink-0"
          data-testid="pending-drafts-show-draft"
        >
          <Eye className="mr-1 h-3.5 w-3.5" />
          {t('console.ai.pendingDrafts.showDraft', { defaultValue: 'Show draft' })}
        </Button>
      ) : null}
    </div>
  );
}
