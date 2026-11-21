/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One pending approval request in the inbox panel, decidable in place
 * (objectstack#34589).
 *
 * The decision levers are NOT drawn here: they are the request's own declared
 * actions at `list_item` (`approval_approve`, `approval_reject` on
 * `sys_approval_request`), run through `DeclaredActionsBar` — the governed
 * path the record page and the decision panel already run them through. So
 * whether a viewer sees a lever is the action's own `visible` predicate over
 * the row's server-computed `viewer` block, a request that asks for decision
 * outputs collects them in the action's param dialog, and the request a click
 * sends is the declared one. No third approvals client is written here.
 *
 * "View details" opens the request in the Approvals inbox, the target Home's
 * "My work" approvals row opens.
 *
 * @module
 */

import { useObjectTranslation, useDisplayLocale } from '@object-ui/i18n';
import type { PendingApprovalRequest } from '../hooks/sharedUserFeeds.js';
import { DeclaredActionsBar } from '../views/DeclaredActionsBar.js';
import { timeAgo } from '../utils/relativeTime.js';

/** The object whose declared actions decide a request. */
const APPROVAL_REQUEST_OBJECT = 'sys_approval_request';

/** The declared location of the inline levers (approve / reject). */
const INLINE_DECISION_LOCATION = 'list_item';

/** The phone tap floor, as the rest of the panel spells it. */
const PHONE_TAP = 'max-md:min-h-11';

/** The flow's label and the record's title, as Home's approvals row names it. */
export function approvalRequestTitle(r: PendingApprovalRequest): string {
  return [r.processLabel || r.processName, r.recordTitle].filter(Boolean).join(' · ') || r.id;
}

export interface InboxApprovalItemProps {
  request: PendingApprovalRequest;
  /** Open the request in the Approvals inbox. */
  onOpen: (request: PendingApprovalRequest) => void;
  /** A declared action on this request succeeded. */
  onDecided: (request: PendingApprovalRequest) => void;
}

export function InboxApprovalItem({ request, onOpen, onDecided }: InboxApprovalItemProps) {
  const { t } = useObjectTranslation();
  const displayLocale = useDisplayLocale();
  return (
    <div data-testid="inbox-approval-item" className="px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-tight truncate">{approvalRequestTitle(request)}</div>
          {request.createdAt && (
            <div className="text-xs text-muted-foreground mt-1">
              {timeAgo(request.createdAt, displayLocale)}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {request.row && (
              <DeclaredActionsBar
                objectName={APPROVAL_REQUEST_OBJECT}
                record={request.row}
                location={INLINE_DECISION_LOCATION}
                onDone={() => onDecided(request)}
              />
            )}
            <button
              type="button"
              onClick={() => onOpen(request)}
              className={`text-xs text-primary hover:underline ${PHONE_TAP} max-md:px-2`}
            >
              {t('notifications.viewApprovalDetails', { defaultValue: 'View details' })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
