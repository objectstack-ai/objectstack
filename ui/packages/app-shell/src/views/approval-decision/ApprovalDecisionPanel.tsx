/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The decision panel of an approval request's record page (objectui#12045, B1
 * of objectui#2763; ruling 6079807016, letter 乙), the page component type
 * `record:approval_decision`.
 *
 * One node, six parts, each drawn by a piece already shipped:
 *
 *  0. **Where the request came from** (objectui#12491) — a request no person
 *     submitted (opened by a flow run with no user context, such as a
 *     scheduled run) is marked with the Approval Center's "Flow-initiated"
 *     copy, as the approvals inbox's request sheet marks it. See "The flow
 *     origin" below.
 *  1. **What was submitted** (objectui#12483) — the declared amount and a
 *     summary of the request's record snapshot, under the target object's
 *     declared labels and through the record page's own cells, with the
 *     object's `hidden: true` fields and the reader's unreadable fields left
 *     out. `RecordSnapshotSummary` draws it from the bound row's `payload`
 *     and `payload_display`; see its header for what it reads.
 *  2. **Where the flow stands** (objectui#12491) — the vertical step line of
 *     the owning flow, from the bound row's `flow_steps`, when the flow has
 *     more than one approval step, at ANY status: a decided request and a
 *     `first_response` node draw it too, as the sheet draws it. The markup is
 *     `ApprovalStepLine`, the one the business record's approvals panel draws.
 *  3. **Progress** — `DecisionProgressIndicator` (A3), drawn from the request's
 *     server-computed `decision_progress` tally. It is present only on a
 *     pending node that aggregates more than one decision, and the panel draws
 *     it only then; nothing is re-derived here.
 *  4. **Who the pending step waits on** (objectui#12482) — each pending
 *     approver named, with a position's label and the countersign group the
 *     slot fills, as the approvals inbox's request sheet names them. See
 *     "Naming the pending approvers" below.
 *  5. **Decisions** — `DeclaredActionsBar` over `sys_approval_request`'s OWN
 *     declared actions at `record_section`, the location and the bar the
 *     business record page already runs them through (objectui#3055). Every
 *     decision is an ordinary declared `type:'api'` action, its form is
 *     `ActionParamDialog` (a comment and several attachments, ruling Q3-A), and
 *     whether a viewer sees one is the action's own `visible` predicate over
 *     the request's server-computed `viewer` block. The panel adds no
 *     per-action code, so a new decision action is metadata alone.
 *
 * ## Naming the pending approvers (objectui#12482)
 *
 * The request row the page binds already carries everything a name needs:
 * `pending_approvers` (the slots), `pending_approver_names` (the server's own
 * id -> name answer for user ids, from the same approvals get) and, on a
 * `per_group` node, `pending_approver_groups` (slot -> the group or groups it
 * fills). So the names are drawn here, from that row, with no prop, no page
 * edit and no spec row.
 *
 * The drawing is app-shell's one approver-naming path, the one the business
 * record's approvals panel already draws its "Waiting on" chips with:
 * `approverChips` (collapsed by name and group, so one person holding three
 * quorum slots is one chip with a count, and two people sharing a name in two
 * groups stay two chips) over `approverDisplay`. A reference the server left
 * unnamed (`position:<name>`, `team:<id>`, …) is looked up once per slate by
 * `useApproverDirectory`, whose module cache the decision buttons on the same
 * request share; a slate the server named whole asks nothing. An id nothing
 * can name keeps the identity formatter's face, the one the inbox's sheet
 * draws for it, and every raw slot stays in the chip's `title`.
 *
 * Why not inside `DecisionProgressIndicator`: the indicator draws a tally, and
 * a `first_response` node carries none, so the indicator is not drawn there at
 * all while its approvers still wait. The inbox's sheet and the business
 * record's panel both draw the tally and the names as two parts under two
 * gates (a tally present; a pending request with a slot), and so does this
 * panel.
 *
 * ## The flow origin (objectui#12491)
 *
 * The contract represents "no human submitter" one way: the request's
 * `submitter_id` is null (ADR-0118 D1), and the approvals get serves a null
 * column as an absent key. So the panel marks the origin when the bound row's
 * `submitter_id` is absent or null, and only then. ⛔ It reads no `flow:` or
 * `system:` prefix off a submitter id: no writer stores such a sentinel, and a
 * prefix branch here would be a second, tolerated spelling of the same fact
 * (AGENTS.md #0.1). The flow's display name is the served page's highlights
 * strip's to show, not this panel's.
 *
 * Why not inside `DecisionProgressIndicator` either: the step line and the
 * origin, like the names, are drawn where no tally exists, so each is its own
 * part under its own gate.
 *
 * ## No authorable props
 *
 * The panel reads the record context and nothing else: the request row the
 * page bound (with its `viewer` and `decision_progress`, which the approvals
 * get route serves and the data API does not) and the object's declared
 * actions. `@objectstack/spec` 18 declares exactly this contract
 * (objectstack-ai/objectstack#22472), a `ComponentPropsMap` row that is an
 * empty strict object, so a misspelled key on an authored node is a
 * validation finding instead of a silently ignored prop.
 *
 * Outside a `sys_approval_request` record page there is no request to decide
 * on, so the node draws a short notice saying it works only on approval request
 * pages (objectui#12072). A block placed on another object's record page, or on
 * a page with no record at all, is thereby visible to its author instead of
 * silently empty. On a request page whose row has not loaded yet, the node
 * still draws nothing.
 *
 * ## After a decision
 *
 * The action has already POSTed and the runtime has already toasted. What the
 * page owes is a re-read, as data and not as a remount (AGENTS.md #8): the
 * request record (its status, `viewer` and tally change) and the timeline (a
 * decision appends a `sys_approval_action` row), both through the
 * invalidation bus their readers already subscribe to.
 *
 * ## Registered as `record:approval_decision`
 *
 * `@objectstack/spec` 18 declares the type and its `ComponentPropsMap` row
 * (an empty strict object). The registration lives in the leaf
 * `../record-approval-decision-renderer.tsx` (objectui#12342), imported for
 * its side effect from `src/index.ts`, and it landed together with the type's
 * arm in `@object-ui/types/zod` and its `known-schema-types.ts` line, so
 * `registered-types-validate-ratchet-10859` in `@object-ui/cli` does not rise.
 * Nothing re-exports the renderer from the package entry: a page reaches it
 * through the registry, by type.
 *
 * It lives in app-shell rather than plugin-detail for the reason
 * `record:approvals` does: the bar's runtime depends on `@object-ui/auth`,
 * which plugin-detail deliberately does not pull in.
 */

import * as React from 'react';
import { notifyDataChanged, useObjectTranslation, useRecordContext } from '@object-ui/react';
import { cn, Badge } from '@object-ui/components';
import { Workflow } from 'lucide-react';
import { ApprovalStepLine } from '../approval-progress/ApprovalStepLine.js';
import { DecisionProgressIndicator } from '../approval-progress/DecisionProgressIndicator.js';
import { eligibleApproverCount } from '../approval-progress/eligibleApprovers.js';
import { DeclaredActionsBar } from '../DeclaredActionsBar.js';
import { approverChips } from '../RecordApprovalsPanel.js';
import { RecordSnapshotSummary } from './RecordSnapshotSummary.js';
import { RECORD_APPROVAL_ACTION_LOCATION, SYS_APPROVAL_REQUEST_OBJECT } from '../recordApprovalActions.js';
import type { ApprovalRequestLite } from '../../hooks/useRecordApprovals.js';
import type { ApprovalRequestRow } from '@objectstack/spec/contracts';
import { useApproverDirectory } from '../../hooks/useApproverDirectory.js';
import {
  approverCopyFrom,
  unresolvedApproverRefs,
  type ApproverDisplayCopy,
} from '../../utils/approverIdentity.js';

/** The timeline object a decision appends a row to. */
const APPROVAL_ACTION_OBJECT = 'sys_approval_action';

export interface ApprovalDecisionPanelProps {
  /**
   * The request row as the approvals get route serves it: the dispatch record
   * the declared actions run against (`{id}` resolves to it) and the `viewer`
   * block their `visible` predicates read.
   */
  request: ApprovalRequestLite & { viewer?: unknown } & Pick<ApprovalRequestRow, 'payload' | 'payload_display'>;
  className?: string;
}

/**
 * Who the pending step waits on: one chip per approver, named, with a
 * position's label and the countersign group the slot fills (objectui#12482).
 * Drawn on a pending request with at least one slot, as the inbox's sheet
 * draws its "Waiting on" row; nothing otherwise.
 */
function PendingApprovers({ request }: { request: ApprovalRequestLite }) {
  const { t } = useObjectTranslation();
  const pending = request.status === 'pending';
  // Only the references the server left unnamed, and none on a decided
  // request, so a slate the approvals get named whole costs no request.
  const refs = React.useMemo(
    () => (pending ? unresolvedApproverRefs(request) : []),
    [pending, request],
  );
  const directory = useApproverDirectory(refs);
  const copy = React.useMemo<ApproverDisplayCopy>(
    () => approverCopyFrom(t as unknown as Parameters<typeof approverCopyFrom>[0]),
    [t],
  );
  if (!pending) return null;
  const chips = approverChips(request, { directory, copy });
  if (chips.length === 0) return null;
  return (
    <div data-testid="approval-decision-pending-approvers">
      <div className="text-[11px] text-muted-foreground mb-1">
        {String(t('approvalsInbox.waitingOn', { defaultValue: 'Waiting on' }))}
      </div>
      <div className="flex flex-wrap gap-1">
        {chips.map((chip, i) => (
          <Badge
            key={`${chip.label}-${chip.group ?? ''}-${i}`}
            variant="outline"
            className="text-[11px]"
            // The raw slot belongs on hover, never as the identification.
            title={chip.title}
            data-testid="approver-chip"
            data-unstaffed={chip.unstaffed ? 'true' : undefined}
          >
            {chip.label}
            {chip.detail && <span className="ml-1 text-muted-foreground">· {chip.detail}</span>}
            {chip.group && <span className="ml-1 text-muted-foreground">· {chip.group}</span>}
            {chip.count > 1 && <span className="ml-1 text-muted-foreground">×{chip.count}</span>}
          </Badge>
        ))}
      </div>
    </div>
  );
}

/**
 * Where the request came from: the "Flow-initiated" marker on a request no
 * person submitted, its `submitter_id` absent or null (objectui#12491); nothing
 * for a request a person submitted. See "The flow origin" above.
 */
function FlowOrigin({ request }: { request: ApprovalRequestLite }) {
  const { t } = useObjectTranslation();
  if (request.submitter_id != null) return null;
  return (
    <div
      className="flex items-center gap-1 text-xs text-muted-foreground"
      data-testid="approval-decision-flow-origin"
    >
      <Workflow className="h-3 w-3 shrink-0" aria-hidden />
      <span className="italic">
        {String(t('approvalsInbox.flowOrigin', { defaultValue: 'Flow-initiated' }))}
      </span>
    </div>
  );
}

/** The parts over one request row. Module-internal: no package export. */
export function ApprovalDecisionPanel({ request, className }: ApprovalDecisionPanelProps) {
  const progress = request.decision_progress;
  const eligible = eligibleApproverCount(request);
  const requestId = String(request.id);

  const handleDecided = React.useCallback(() => {
    notifyDataChanged({ objectName: SYS_APPROVAL_REQUEST_OBJECT, recordId: requestId });
    notifyDataChanged({ objectName: APPROVAL_ACTION_OBJECT });
  }, [requestId]);

  return (
    <div className={cn('space-y-3', className)} data-testid="approval-decision-panel">
      <FlowOrigin request={request} />
      <RecordSnapshotSummary
        objectName={request.object_name}
        snapshot={request.payload}
        display={request.payload_display}
      />
      <ApprovalStepLine steps={request.flow_steps} />
      {progress && <DecisionProgressIndicator progress={progress} eligibleApprovers={eligible} />}
      <PendingApprovers request={request} />
      <DeclaredActionsBar
        objectName={SYS_APPROVAL_REQUEST_OBJECT}
        record={request}
        location={RECORD_APPROVAL_ACTION_LOCATION}
        onDone={handleDecided}
      />
    </div>
  );
}

const splitDesigner = (props: Record<string, unknown>) => {
  const { 'data-obj-id': id, 'data-obj-type': type, style } = props || {};
  return { 'data-obj-id': id, 'data-obj-type': type, style } as React.HTMLAttributes<HTMLDivElement>;
};

export interface ApprovalDecisionRendererProps {
  schema?: Record<string, unknown>;
  className?: string;
  [k: string]: unknown;
}

/**
 * The node renderer: the panel over the bound request; off a request page, a
 * notice that the block works only there; on a request page whose row has not
 * loaded, nothing.
 *
 * The notice is the muted dashed placeholder `record:path` draws when it cannot
 * do its job where it was placed, with its copy from the language packs.
 */
export const ApprovalDecisionRenderer: React.FC<ApprovalDecisionRendererProps> = ({
  schema: _schema,
  className,
  ...props
}) => {
  const ctx = useRecordContext();
  const { t } = useObjectTranslation();
  const designer = splitDesigner(props);
  if (ctx?.objectName !== SYS_APPROVAL_REQUEST_OBJECT) {
    return (
      <div className={className} {...designer}>
        <div
          className="text-xs text-muted-foreground italic px-3 py-2 border border-dashed rounded"
          data-testid="approval-decision-off-request-page"
        >
          {String(t('approvalsInbox.decisionPanelOffRequestPage', {
            defaultValue: 'The approval decision panel only works on approval request pages.',
          }))}
        </div>
      </div>
    );
  }
  const row = ctx.data;
  if (row == null || typeof row !== 'object' || (row as { id?: unknown }).id == null) return null;
  return (
    <div className={className} {...designer}>
      <ApprovalDecisionPanel request={row as ApprovalDecisionPanelProps['request']} />
    </div>
  );
};
