// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The requests waiting on the signed-in user, as the full-page inbox lists
 * them (objectstack#36741): the read the shared approvals feed polls, with a
 * page the size of a list rather than of Home's five-row preview.
 *
 * It reads again when the shared feed's count moves (a poll, a decision taken
 * elsewhere) and when a write reaches `sys_approval_request` on the data bus,
 * which is how a decision taken in the right pane — the request's own
 * declared action — reports itself. Each re-read also refreshes the shared
 * feed, so the bell's badge drops with the decided row.
 *
 * @module
 */

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@object-ui/auth';
import { useDataInvalidation } from '@object-ui/react';
import {
  approverIdentities,
  fetchPendingApprovalPage,
  refreshSharedPendingApprovals,
  type PendingApprovalRequest,
} from '../../hooks/sharedUserFeeds.js';

/** How many waiting requests the page lists. */
export const INBOX_PAGE_APPROVAL_ROWS = 100;

/** The object a decision writes, whose bus change re-reads the list. */
const APPROVAL_REQUEST_OBJECT = 'sys_approval_request';

export interface InboxPageApprovals {
  requests: PendingApprovalRequest[];
  /** The route's exact count over the same filter (may exceed the page). */
  total: number;
  /** `ready` once a read answered; `error` keeps the last rows. */
  status: 'loading' | 'ready' | 'error';
}

export function useInboxPageApprovals(sharedTotal: number): InboxPageApprovals {
  const { user } = useAuth();
  const identities = approverIdentities(user);
  const key = user?.id && identities.length > 0 ? identities.join(',') : null;
  const nonce = useDataInvalidation(APPROVAL_REQUEST_OBJECT);
  const [state, setState] = useState<InboxPageApprovals>({ requests: [], total: 0, status: 'loading' });
  const firstNonce = useRef(nonce);

  useEffect(() => {
    if (!key) {
      setState({ requests: [], total: 0, status: 'ready' });
      return;
    }
    let live = true;
    // A decision moved the request: the badge's own feed reads again too.
    if (nonce !== firstNonce.current) refreshSharedPendingApprovals();
    void fetchPendingApprovalPage(key.split(','), INBOX_PAGE_APPROVAL_ROWS).then((answer) => {
      if (!live) return;
      if (answer.status === 'ok') setState({ ...answer.page, status: 'ready' });
      else if (answer.status === 'unavailable') setState({ requests: [], total: 0, status: 'ready' });
      else setState((prev) => ({ ...prev, status: 'error' }));
    });
    return () => {
      live = false;
    };
  }, [key, nonce, sharedTotal]);

  return state;
}
