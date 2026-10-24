/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn } from '@object-ui/components';
import { Check } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/react';
import type { ApprovalRequestLite } from '../../hooks/useRecordApprovals.js';

/**
 * ApprovalStepLine — the vertical step line of an approval request's flow:
 * one row per approval step of the owning flow, done / current / upcoming,
 * drawn from the request's server-served `flow_steps` (objectui#12491).
 *
 * Two surfaces draw it, through this one markup: the business record's
 * approvals panel (`RecordApprovalsPanel`), which draws it for the record's
 * pending request, and the approval request page's decision panel
 * (`record:approval_decision`), which draws it for the request the page is
 * bound to, at any status. Each caller owns its own gate on WHICH request; the
 * gate on HOW MANY steps lives here, once: a flow with one approval step has no
 * line to draw, so fewer than two steps draws nothing.
 *
 * ## Vertical, at every step count (objectui#5554)
 *
 * The strip used to be a horizontal row. A row's intrinsic width grows without
 * bound with step count and label length (a real 6-step flow with ordinary CJK
 * labels measured 1070px inside a 527px container), so its tail steps sat
 * behind a scroll gesture with no affordance, and readers took the clipped
 * strip for "no more data". A column caps width at the container at any step
 * count and any label length, so there is no flow length or viewport at which
 * it regresses, which is what a count- or measurement-triggered switch back to
 * a row would reintroduce. Nothing here may pin intrinsic width: no `shrink-0`
 * on the rows, no `whitespace-nowrap` on the labels, no horizontal scroller.
 *
 * The approvals inbox's request sheet draws the same stepper from its own
 * copy (its list adds a `px-1` inset), frozen there by ADR-0060 rule 3. Each
 * side pins the contract for itself, by hand rather than by import.
 *
 * The list's accessible name is the Approval Center's
 * `approvalsInbox.stepProgress` row, asked for by literal key so the call-site
 * i18n gate checks it. Module-internal: no export from the package entry and
 * no SDUI component type.
 */

/** One approval step of the owning flow, as the approvals get serves it. */
export type ApprovalFlowStep = NonNullable<ApprovalRequestLite['flow_steps']>[number];

export interface ApprovalStepLineProps {
  /** The request's `flow_steps`, as served. Fewer than two steps draws nothing. */
  steps: ReadonlyArray<ApprovalFlowStep> | null | undefined;
}

export const ApprovalStepLine: React.FC<ApprovalStepLineProps> = ({ steps }) => {
  const { t } = useObjectTranslation();
  if (!steps || steps.length < 2) return null;
  return (
    <ol
      className="flex flex-col"
      aria-label={String(t('approvalsInbox.stepProgress', { defaultValue: 'Approval steps' }))}
    >
      {steps.map((s, i) => {
        const next = steps[i + 1];
        return (
          <li key={s.id} className="flex items-start gap-2">
            <div className="flex flex-col items-center self-stretch">
              <span className={cn(
                'flex items-center justify-center h-5 w-5 shrink-0 rounded-full text-[10px] font-semibold',
                s.state === 'done' && 'bg-emerald-500 text-white',
                s.state === 'current' && 'bg-amber-500 text-white ring-2 ring-amber-200 dark:ring-amber-500/30',
                s.state === 'upcoming' && 'bg-muted text-muted-foreground border',
              )}>
                {s.state === 'done' ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {next && (
                // Tinted by the step it leads INTO — the same rule the
                // horizontal connector used, now running down the rail.
                <div className={cn('w-px flex-1 min-h-3 my-1', next.state === 'done' || next.state === 'current' ? 'bg-emerald-300 dark:bg-emerald-700' : 'bg-border')} />
              )}
            </div>
            <span className={cn(
              'min-w-0 flex-1 pt-0.5 text-xs break-words',
              s.state === 'current' ? 'font-medium' : 'text-muted-foreground',
            )}>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
};
