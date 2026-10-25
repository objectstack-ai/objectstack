/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn, Badge } from '@object-ui/components';
import { Check, Circle } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/react';
import type { ApprovalDecisionProgress } from '../../hooks/useRecordApprovals.js';

/**
 * DecisionProgressIndicator — the segmented progress/quorum indicator bound to
 * a pending approval request's `decision_progress` (objectui#12033, the A3
 * primitive of objectui#2763).
 *
 * It draws the three aggregation behaviors the approval-service contract
 * declares for `decision_progress`, from the server's tally and nothing else:
 *
 *   - `unanimous` — `got` approvals of `need`, where `need` is every approver;
 *   - `quorum` (M-of-N) — `got` approvals of the `need` threshold. The N it is
 *     drawn from is not part of the tally, so the caller may pass the eligible
 *     approver count to show beside it;
 *   - `per_group` (countersign) — `got` satisfied groups of `need`, plus one
 *     tick per entry of `groups`.
 *
 * `first_response` nodes carry no `decision_progress` (one decision finalizes
 * them), so there is no fourth shape: a caller renders this only when the
 * tally is present. The counts are never re-derived client-side — the engine's
 * finalization tally stays authoritative and this is display only.
 *
 * Extracted from `RecordApprovalsPanel` so the approval detail page
 * (objectui#2763 B1) can draw the same indicator; the panel renders it with no
 * change to its DOM. Module-internal: no export from the package entry and no
 * SDUI component type — registering it is B1's step.
 *
 * The copy is the Approval Center's `approvalsInbox.*` rows, the same ones the
 * panel always read, asked for by literal key so the call-site i18n gate checks
 * each one rather than seeing a forwarded `key: string`.
 */

/**
 * Above this many required decisions the ticks would shrink to hairlines, so
 * the bar becomes one continuous fill and the count in the label carries it.
 */
const MAX_SEGMENTS = 12;

export interface DecisionProgressIndicatorProps {
  /** The pending request's server-computed tally, as the contract declares it. */
  progress: ApprovalDecisionProgress;
  /**
   * How many approvers may still decide the pending node, shown beside an
   * approvals tally (`unanimous` / `quorum`) and never beside a group tally.
   * Absent or zero shows nothing.
   */
  eligibleApprovers?: number;
}

export const DecisionProgressIndicator: React.FC<DecisionProgressIndicatorProps> = ({
  progress: dp,
  eligibleApprovers = 0,
}) => {
  const { t } = useObjectTranslation();
  const perGroup = dp.behavior === 'per_group';

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-[11px] text-muted-foreground">
          {perGroup
            ? String(t('approvalsInbox.progressGroups', {
                defaultValue: 'Sign-off progress — {{got}} of {{need}} groups',
                got: dp.got,
                need: dp.need,
              }))
            : String(t('approvalsInbox.progressApprovals', {
                defaultValue: 'Approvals — {{got}} of {{need}}',
                got: dp.got,
                need: dp.need,
              }))}
        </span>
        {!perGroup && eligibleApprovers > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {String(t('approvalsInbox.progressEligible', {
              defaultValue: '{{count}} eligible approver(s)',
              count: eligibleApprovers,
            }))}
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={dp.need}
        aria-valuenow={Math.min(dp.got, dp.need)}
        aria-label={String(t('approvalsInbox.progressBar', { defaultValue: 'Decision progress' }))}
        className="flex gap-1"
      >
        {dp.need > 0 && dp.need <= MAX_SEGMENTS ? (
          Array.from({ length: dp.need }).map((_, i) => (
            <div
              key={i}
              className={cn('h-1.5 flex-1 rounded-full', i < dp.got ? 'bg-emerald-500' : 'bg-muted')}
            />
          ))
        ) : (
          <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${dp.need > 0 ? Math.min(100, (dp.got / dp.need) * 100) : 0}%` }}
            />
          </div>
        )}
      </div>
      {dp.groups && (
        <div className="flex flex-wrap gap-1 mt-2">
          {dp.groups.map((g) => (
            <Badge
              key={g.group}
              variant="outline"
              className={cn(
                'text-[11px] gap-1',
                g.satisfied
                  ? 'border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400'
                  : 'text-muted-foreground',
              )}
              title={`${g.got}/${g.need}`}
            >
              {g.satisfied ? <Check className="h-3 w-3" /> : <Circle className="h-2.5 w-2.5" />}
              {g.group} {g.got}/{g.need}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
};
