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
 * One node, the whole request page below its header (objectstack#34588):
 * the decision row on top, then the business record on the left and a right
 * rail of approval progress, attachments and activity, in that order
 * (maintainer 2026-11-17: 「审批页应该直接显示完整的记录；「动态」在最后」). The
 * rail is a column beside the record from the `@4xl` container width up;
 * narrower, the parts stack in the same order, so the activity is last there
 * too.
 *
 * The parts, each drawn by a piece already shipped:
 *
 *  0. **Where the request came from** (objectui#12491) — a request no person
 *     submitted (opened by a flow run with no user context, such as a
 *     scheduled run) is marked with the Approval Center's "Flow-initiated"
 *     copy, as the approvals inbox's request sheet marks it. See "The flow
 *     origin" below.
 *  0b. **Why it was decided** (objectstack#32667) — on a request that was
 *     rejected, sent back for revision or approved, the comment the deciding
 *     action was recorded with, and who recorded it. See "The request's
 *     thread" below.
 *  1. **What was submitted** (objectstack#34588, replacing objectui#12483's
 *     six-field summary) — the business record whole, as SUBMITTED: every
 *     field the reader may read, in the sections of the object's default
 *     record page, a field changed after submission marked with its current
 *     value, the record's child tables as current rows, and its attachment
 *     fields in the rail. `./SubmittedRecord.tsx` draws it from the bound
 *     row's `payload` and `payload_display` (objectstack#10749) and one read
 *     of the record; see its header for what it reads.
 *  2. **Where the flow stands** (objectui#12491, objectstack#26668) — the
 *     vertical step line of this request's own route, the bound row's
 *     `flow_route` as the approvals get serves it: the steps its run passed,
 *     its own step, and, while it is pending, the steps ahead the flow's graph
 *     decides. At ANY status: a decided request and a `first_response` node
 *     draw it too. The markup is `ApprovalStepLine`, the one the business
 *     record's approvals panel draws. Never the row's `flow_steps`, the flow
 *     graph's trunk, which showed a request a decision sent down another
 *     branch on rungs it never visits (objectstack#26563).
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
 * ## The request's thread (objectstack#32667, objectstack#34588)
 *
 * The rail ends with the request's activity: its thread
 * (`sys_approval_action`), newest first, drawn by `ApprovalActionTimeline`,
 * the markup the business record's approvals panel draws its timeline with.
 * It took the place of the page's Timeline tab. The request row carries no
 * thread, so the panel reads it the way that tab read it: a `find` of
 * `sys_approval_action` scoped to the request (`{ request_id }`), through the
 * page's data source, which the console routes to
 * `GET /approvals/requests/:id/actions`. One read, again when a decision
 * invalidates the timeline; with no data source it reads nothing. Like that
 * tab's related list, it reads only on a read verdict for the object: a
 * reader refused `sys_approval_action` sends no read and gets no activity
 * card (objectui#13324).
 *
 * The reader a decision reaches lands on this page; the applicant of a
 * rejected request comes here to learn what to fix. So on a request whose
 * status a decision set, the deciding action's comment is also drawn on top,
 * from the same read: the latest action of the kind the status names
 * (`reject` for `rejected`, `revise` for `returned`, `approve` for
 * `approved`). A decision recorded without a comment, and a read that fails,
 * draw nothing there.
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
import {
  notifyDataChanged,
  useAdapter,
  useDataInvalidation,
  useObjectTranslation,
  useRecordContext,
} from '@object-ui/react';
import { cn, Badge } from '@object-ui/components';
import { usePermissions } from '@object-ui/permissions';
import { History, Stamp, Workflow } from 'lucide-react';
import { ApprovalActionTimeline } from '../approval-progress/ApprovalActionTimeline.js';
import { ApprovalStepLine } from '../approval-progress/ApprovalStepLine.js';
import { DecisionProgressIndicator } from '../approval-progress/DecisionProgressIndicator.js';
import { eligibleApproverCount } from '../approval-progress/eligibleApprovers.js';
import { DeclaredActionsBar } from '../DeclaredActionsBar.js';
import { approverChips } from '../RecordApprovalsPanel.js';
import {
  SubmittedAttachmentsCard,
  SubmittedChildTables,
  SubmittedRecordCard,
  useSubmittedRecord,
} from './SubmittedRecord.js';
import { RECORD_APPROVAL_ACTION_LOCATION, SYS_APPROVAL_REQUEST_OBJECT } from '../recordApprovalActions.js';
import type { ApprovalActionLite, ApprovalRequestLite } from '../../hooks/useRecordApprovals.js';
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
            {chip.count > 1 && (
              <span className="ml-1 text-muted-foreground">
                · {String(t('approvalsInbox.approverSlots', {
                  defaultValue: 'holds {{count}} approver slot(s)',
                  count: chip.count,
                }))}
              </span>
            )}
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

/**
 * The action kind that settles a request in each decided status: the action
 * whose comment explains the decision (see "The decision comment" above).
 */
const DECIDING_ACTION: Readonly<Record<string, string>> = {
  rejected: 'reject',
  returned: 'revise',
  approved: 'approve',
};

/** The read of one request's thread, newest first: the order the activity card draws it in. */
function timelineQuery(requestId: string) {
  return { $filter: { request_id: requestId }, $orderby: [{ field: 'created_at', order: 'desc' as const }] };
}

/**
 * The request's thread, newest first: ONE read that the activity card and the
 * decision comment share (see "The request's thread" above). `loaded` turns
 * true once the read answered, a failure included.
 *
 * Read through the adapter the PAGE is bound to (the record context's), which
 * the console routes to the request's actions route, and only on a read
 * verdict, as the Timeline related list it replaces was: a reader whose
 * verdict refuses `sys_approval_action` sends no read and sees no rows. Under
 * the console's `ApprovalRecordReads` the verdict for both approval objects
 * is the server's, so a party to the request reads its thread.
 */
function useRequestThread(requestId: string): { rows: ApprovalActionLite[]; loaded: boolean; readable: boolean } {
  const adapter = useAdapter();
  const dataSource = useRecordContext()?.dataSource ?? adapter;
  const perms = usePermissions();
  const timelineChanged = useDataInvalidation(APPROVAL_ACTION_OBJECT);
  const [answer, setAnswer] = React.useState<{ key: string; rows: ApprovalActionLite[] } | null>(null);
  const permitted = perms?.isLoaded ? perms.can(APPROVAL_ACTION_OBJECT, 'read') : true;
  const canRead = permitted && typeof dataSource?.find === 'function';

  React.useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    // The executor runs synchronously, so a source that THROWS lands with a rejection.
    new Promise<unknown>((resolve) => resolve(dataSource!.find(APPROVAL_ACTION_OBJECT, timelineQuery(requestId)))).then(
      (out) => {
        const rows = (out as { data?: unknown } | null)?.data;
        if (!cancelled) setAnswer({ key: requestId, rows: Array.isArray(rows) ? (rows as ApprovalActionLite[]) : [] });
      },
      () => {
        if (!cancelled) setAnswer({ key: requestId, rows: [] });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [requestId, canRead, dataSource, timelineChanged]);

  if (!canRead) return { rows: [], loaded: true, readable: permitted };
  return answer && answer.key === requestId
    ? { rows: answer.rows, loaded: true, readable: true }
    : { rows: [], loaded: false, readable: true };
}

/**
 * Why a decided request was decided: the deciding action's comment and who
 * recorded it, on the request's own page; nothing on a pending request, or
 * for a decision recorded without a comment.
 */
function DecisionComment({ request, thread }: { request: ApprovalRequestLite; thread: readonly ApprovalActionLite[] }) {
  const { t } = useObjectTranslation();
  const kind = DECIDING_ACTION[request.status];
  // The thread is newest first, so the first row of the kind is the deciding one.
  const action = kind ? thread.find((row) => row?.action === kind) ?? null : null;
  const comment = typeof action?.comment === 'string' ? action.comment.trim() : '';
  if (!action || !comment) return null;
  const tr = (k: string, defaultValue: string) => String(t(`approvalsInbox.${k}`, { defaultValue }));
  const verb =
    action.action === 'reject' ? tr('actReject', 'Rejected')
      : action.action === 'revise' ? tr('actRevise', 'Sent back for revision')
      : tr('actApprove', 'Approved');
  return (
    <div
      className="rounded-md border px-3 py-2 text-sm"
      data-testid="approval-decision-comment"
      data-action={action.action}
    >
      <div className="text-[11px] text-muted-foreground mb-0.5">
        {verb}
        {action.actor_name ? ` · ${action.actor_name}` : ''}
      </div>
      <p className="whitespace-pre-wrap break-words">{comment}</p>
    </div>
  );
}

/** A titled card of the page's right rail. */
function RailCard({ icon: Icon, title, testId, children }: {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  title: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card" data-testid={testId}>
      <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>{title}</span>
      </div>
      <div className="space-y-3 px-4 py-3">{children}</div>
    </section>
  );
}

/** The parts over one request row. Module-internal: no package export. */
export function ApprovalDecisionPanel({ request, className }: ApprovalDecisionPanelProps) {
  const { t } = useObjectTranslation();
  const progress = request.decision_progress;
  const eligible = eligibleApproverCount(request);
  const requestId = String(request.id);
  const thread = useRequestThread(requestId);
  const submitted = useSubmittedRecord(request);
  const stepLabel = (request as { current_step_label?: unknown }).current_step_label;
  // A row names its own step when the read serves `step_label`; else every
  // row of this request is on the request's step (one request, one node).
  const stepText = React.useCallback(
    (action: ApprovalActionLite) => {
      const own = (action as { step_label?: unknown }).step_label;
      if (typeof own === 'string' && own !== '') return own;
      return typeof stepLabel === 'string' && stepLabel !== '' ? stepLabel : null;
    },
    [stepLabel],
  );

  const handleDecided = React.useCallback(() => {
    notifyDataChanged({ objectName: SYS_APPROVAL_REQUEST_OBJECT, recordId: requestId });
    notifyDataChanged({ objectName: APPROVAL_ACTION_OBJECT });
  }, [requestId]);

  const tr = (key: string, defaultValue: string) => String(t(`approvalsInbox.${key}`, { defaultValue }));

  return (
    <div className={cn('@container space-y-4', className)} data-testid="approval-decision-panel">
      <div className="space-y-3" data-testid="approval-decision-head">
        <FlowOrigin request={request} />
        <DecisionComment request={request} thread={thread.rows} />
        {/* The approver's band, the same one the business record page draws
            (objectstack#34361). */}
        <DeclaredActionsBar
          objectName={SYS_APPROVAL_REQUEST_OBJECT}
          record={request}
          location={RECORD_APPROVAL_ACTION_LOCATION}
          onDone={handleDecided}
          foldDecisions
        />
      </div>
      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4" data-testid="approval-decision-record">
          {submitted && <SubmittedRecordCard model={submitted} />}
          {submitted && <SubmittedChildTables model={submitted} />}
        </div>
        <aside className="min-w-0 space-y-4" data-testid="approval-decision-rail">
          <RailCard icon={Stamp} title={tr('progressTitle', 'Approval progress')} testId="approval-decision-progress">
            <ApprovalStepLine steps={request.flow_route?.steps} />
            {progress && <DecisionProgressIndicator progress={progress} eligibleApprovers={eligible} />}
            <PendingApprovers request={request} />
          </RailCard>
          {submitted && <SubmittedAttachmentsCard model={submitted} />}
          {thread.readable && (
            <RailCard icon={History} title={tr('history', 'Activity')} testId="approval-decision-activity">
              <ApprovalActionTimeline actions={thread.rows} loading={!thread.loaded} stepText={stepText} />
            </RailCard>
          )}
        </aside>
      </div>
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
