// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The draft review (ADR-0033 Phase B) as an item page opens it: the sheet that
 * shows a pending draft's change against the published item
 * ({@link DraftReviewPanel}), and the `?review=1` arrival that opens it.
 *
 * One presentation for every item page that honours a review link: the generic
 * item page (`ResourceEditPage`) and the permission set's matrix
 * (`PermissionMatrixEditPage`, Studio's page and the routed one,
 * objectstack#37269). Both producers of a review link write `?review=1` for any
 * draft item: the Packages page's per-draft link and the chat's 「Review N
 * change(s)」.
 */

import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@object-ui/components';
import { DraftReviewPanel } from './DraftReviewPanel.js';
import { t, type SupportedLocale } from './i18n.js';

/** The query a review link carries: `?review=1`. */
export const DRAFT_REVIEW_PARAM = 'review';
export const DRAFT_REVIEW_VALUE = '1';

export interface DraftReviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: string;
  name: string;
  /** The published (effective) item: the baseline. `null` for an item never published. */
  published: unknown;
  /** The pending draft's body. */
  draft: unknown;
  locale?: SupportedLocale | string;
}

/** The generic draft↔published review, in a right-hand sheet over the item page. */
export function DraftReviewSheet({
  open,
  onOpenChange,
  type,
  name,
  published,
  draft,
  locale,
}: DraftReviewSheetProps): React.ReactElement {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[92vw] sm:max-w-[720px] p-0 flex flex-col gap-0">
        <SheetHeader className="px-4 py-3 border-b">
          <SheetTitle className="text-base">{t('designer.draftReview.title', locale)}</SheetTitle>
          <SheetDescription className="text-xs">
            {type} / {name} · {t('designer.canvas.reviewVsPublished', locale)}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 min-h-0 overflow-auto p-4">
          <DraftReviewPanel published={published} draft={draft} locale={locale} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export interface DraftReviewArrivalInput {
  /** Off (a create draft) ⇒ the address's `?review=1` is left alone. */
  enabled: boolean;
  /** The read `reload` started is still in flight. */
  loading: boolean;
  /** The read found a pending draft. */
  hasDraft: boolean;
  /** Read the item afresh: the draft may have been written after the page mounted. */
  reload: () => void;
  /** Open the review. */
  open: () => void;
}

/**
 * ADR-0033 Phase B — a `?review=1` arrival. The draft may have been written
 * after the page mounted (the AI drafted it), so the page first reads the item
 * afresh; once that read settles it opens the review when a draft is pending,
 * and drops `?review=1` from the address (replacing the history entry), so a
 * refresh or Back does not open it again. The same-item-already-open case is
 * covered too: the fresh read is asked whatever the page already holds.
 */
export function useDraftReviewArrival({ enabled, loading, hasDraft, reload, open }: DraftReviewArrivalInput): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const reviewParam = searchParams.get(DRAFT_REVIEW_PARAM);
  const latest = React.useRef({ reload, open, searchParams, setSearchParams });
  latest.current = { reload, open, searchParams, setSearchParams };
  const reloadAskedRef = React.useRef(false);
  React.useEffect(() => {
    if (reviewParam !== DRAFT_REVIEW_VALUE || !enabled) return;
    if (!reloadAskedRef.current) {
      reloadAskedRef.current = true;
      latest.current.reload();
      return; // wait for the fresh read to settle before reading hasDraft
    }
    if (!loading) {
      if (hasDraft) latest.current.open();
      const next = new URLSearchParams(latest.current.searchParams);
      next.delete(DRAFT_REVIEW_PARAM);
      latest.current.setSearchParams(next, { replace: true });
      reloadAskedRef.current = false;
    }
  }, [reviewParam, enabled, loading, hasDraft]);
}
