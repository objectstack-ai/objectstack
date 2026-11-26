// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `?review=1` arrival of an item page (ADR-0033 Phase B): the link the
 * chat's 「Review N change(s)」 and the Packages page's per-draft link write
 * for any draft item. It opens the page's draft review (`DraftReviewSheet`).
 * Shared by the generic item page (`ResourceEditPage`) and the permission
 * set's matrix (`PermissionMatrixEditPage`, objectstack#37269), so a review
 * link reads the same on both.
 */

import * as React from 'react';
import { useSearchParams } from 'react-router-dom';

/** The query a review link carries: `?review=1`. */
export const DRAFT_REVIEW_PARAM = 'review';
export const DRAFT_REVIEW_VALUE = '1';

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
  // The latest callbacks and query, for the arrival effect below; refreshed
  // in an effect of their own, which runs before it.
  const latest = React.useRef({ reload, open, searchParams, setSearchParams });
  React.useEffect(() => {
    latest.current = { reload, open, searchParams, setSearchParams };
  });
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
