/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn } from '@object-ui/components';
import { Check, CornerDownRight, Minus, Undo2, X } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/react';
import type { ApprovalRequestLite } from '../../hooks/useRecordApprovals.js';

/**
 * ApprovalStepLine — the vertical step line of an approval request's flow:
 * one row per step it is handed, done / current / upcoming (objectui#12491).
 *
 * It draws the route the approvals get serves for one request, `flow_route`
 * (objectstack#26668): the steps the request's run passed, read off the run's
 * own request rows, its own step, and, while it is pending, the steps ahead
 * the flow's graph alone decides. Both callers hand it that one list: the
 * business record's approvals panel (`RecordApprovalsPanel`) for the pending
 * request, and the approval request page's decision panel for its bound row.
 * The approvals get's `flow_steps` is NOT a route: it is the flow graph's
 * trunk, so a request a decision sent down another branch was drawn on rungs
 * it never visits (objectstack#26563); no caller hands it in. The gate on HOW
 * MANY steps lives here, once: fewer than two steps draws nothing, unless the
 * route is a decided request's (objectstack#35730).
 *
 * ## A decided request's own step
 *
 * A decided request's route (`ahead: 'decided'`) ends at its own step, and
 * the served step state says only `done` (approved) or `current` (any other
 * decision). So the caller hands in the request's status as `decided`, and the
 * last step is drawn with that decision, its marker and its word, never as the
 * step in progress. One step is then enough to draw: the first step of a flow,
 * or a one-step flow, decided, is still the answer to "where did it stop".
 *
 * ## Where the approval stands after it (objectstack#35863)
 *
 * The decided route stops at the request's own step, so the server adds
 * `flow_route.outcome`: the run's latest request past this one and whether the
 * run has ended. The caller hands it in as `outcome`, and one line under the
 * decided step says it: went on to a later step and waits there, went on and
 * stands at that step's decision, went on and ended with it, or ended here.
 * Nothing is drawn when the server serves no outcome: the line never guesses.
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
 * The list's accessible name is the Approval Center's
 * `approvalsInbox.stepProgress` row, asked for by literal key so the call-site
 * i18n gate checks it. Module-internal: no export from the package entry and
 * no SDUI component type.
 */

/** One approval step of a request's route: its node id, its label and where it stands. */
export type ApprovalFlowStep = NonNullable<ApprovalRequestLite['flow_route']>['steps'][number];

/** Where the record's approval stands after a decided request (`flow_route.outcome`). */
export type ApprovalRouteOutcome = NonNullable<NonNullable<ApprovalRequestLite['flow_route']>['outcome']>;

export interface ApprovalStepLineProps {
  /** The served route's steps (`flow_route.steps`), in route order. Fewer than two draws nothing, unless `decided`. */
  steps: ReadonlyArray<ApprovalFlowStep> | null | undefined;
  /** The request's status when its route is decided (`flow_route.ahead === 'decided'`); else absent. */
  decided?: string;
  /** The served outcome past a decided request (`flow_route.outcome`); drawn only with `decided`. */
  outcome?: ApprovalRouteOutcome;
}

/** Whether {@link ApprovalStepLine} draws anything for these props: the one gate on step count. */
export function stepLineDraws({ steps, decided }: ApprovalStepLineProps): boolean {
  return !!steps && steps.length >= (decided ? 1 : 2);
}

/** A decision's marker: its icon and the marker's tint. */
const DECISION_MARKER: Readonly<Record<string, { icon: typeof Check; tint: string }>> = {
  approved: { icon: Check, tint: 'bg-emerald-500 text-white' },
  rejected: { icon: X, tint: 'bg-red-500 text-white' },
  returned: { icon: Undo2, tint: 'bg-muted text-muted-foreground border' },
  recalled: { icon: Minus, tint: 'bg-muted text-muted-foreground border' },
  cancelled: { icon: Minus, tint: 'bg-muted text-muted-foreground border' },
};

export const ApprovalStepLine: React.FC<ApprovalStepLineProps> = ({ steps, decided, outcome }) => {
  const { t } = useObjectTranslation();
  if (!steps || !stepLineDraws({ steps, decided })) return null;
  // Literal keys, so the call-site i18n gate checks every one.
  const decisionWord = (status: string): string | null => {
    switch (status) {
      case 'approved': return String(t('approvalsInbox.statusApproved', { defaultValue: 'Approved' }));
      case 'rejected': return String(t('approvalsInbox.statusRejected', { defaultValue: 'Rejected' }));
      case 'returned': return String(t('approvalsInbox.statusReturned', { defaultValue: 'Returned for revision' }));
      case 'recalled': return String(t('approvalsInbox.statusRecalled', { defaultValue: 'Recalled' }));
      case 'cancelled': return String(t('approvalsInbox.statusCancelled', { defaultValue: 'Cancelled' }));
      default: return null;
    }
  };
  // The line under the decided step, or null when there is nothing to say.
  const outcomeText = (o: ApprovalRouteOutcome | undefined): string | null => {
    if (!decided || !o) return null;
    const decision = decisionWord(o.status);
    if (!o.step) {
      return o.ended ? String(t('approvalsInbox.outcomeEndedHere', { defaultValue: 'The approval ended here' })) : null;
    }
    const step = o.step.label;
    if (o.status === 'pending') {
      return String(t('approvalsInbox.outcomeWaiting', { step, defaultValue: 'Went on to {{step}}, waiting for a decision' }));
    }
    if (!decision) return null;
    return o.ended
      ? String(t('approvalsInbox.outcomeEndedAt', { step, decision, defaultValue: 'Went on to {{step}}, then ended: {{decision}}' }))
      : String(t('approvalsInbox.outcomeNow', { step, decision, defaultValue: 'Went on to {{step}}: {{decision}}' }));
  };
  const after = outcomeText(outcome);
  const list = (
    <ol
      className="flex flex-col"
      aria-label={String(t('approvalsInbox.stepProgress', { defaultValue: 'Approval steps' }))}
    >
      {steps.map((s, i) => {
        const next = steps[i + 1];
        const decision = decided && !next ? decided : undefined;
        const marker = decision ? DECISION_MARKER[decision] : undefined;
        const word = decision ? decisionWord(decision) : null;
        const state = decision ? 'decided' : s.state;
        const Icon = marker?.icon ?? Check;
        return (
          <li key={s.id} className="flex items-start gap-2" data-decision={decision}>
            <div className="flex flex-col items-center self-stretch">
              <span className={cn(
                'flex items-center justify-center h-5 w-5 shrink-0 rounded-full text-xs font-medium',
                marker?.tint ?? (decision && 'bg-muted text-muted-foreground border'),
                state === 'done' && 'bg-emerald-500 text-white',
                state === 'current' && 'bg-amber-500 text-white ring-2 ring-amber-200 dark:ring-amber-500/30',
                state === 'upcoming' && 'bg-muted text-muted-foreground border',
              )}>
                {state === 'done' || marker ? <Icon className="h-3 w-3" aria-hidden /> : i + 1}
              </span>
              {next && (
                // Tinted by the step it leads INTO — the same rule the
                // horizontal connector used, now running down the rail.
                <div className={cn('w-px flex-1 min-h-3 my-1', next.state === 'done' || next.state === 'current' ? 'bg-emerald-300 dark:bg-emerald-700' : 'bg-border')} />
              )}
            </div>
            <span className={cn(
              'min-w-0 flex-1 pt-0.5 text-xs break-words',
              state === 'current' ? 'font-medium' : 'text-muted-foreground',
            )}>{s.label}</span>
            {word && <span className="min-w-0 pt-0.5 text-xs font-medium break-words">{word}</span>}
          </li>
        );
      })}
    </ol>
  );
  if (!after) return list;
  // Outside the list, so assistive tech never counts it as a step.
  return (
    <div className="flex flex-col gap-1">
      {list}
      <p className="flex items-start gap-2" data-testid="approval-step-outcome" data-outcome={outcome?.status}>
        <span className="flex w-5 justify-center pt-0.5">
          <CornerDownRight className="h-3 w-3 text-muted-foreground" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 pt-0.5 text-xs text-muted-foreground break-words">{after}</span>
      </p>
    </div>
  );
};
