/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { useDisplayLocale } from '@object-ui/i18n';
import { cn, Badge, Button } from '@object-ui/components';
import { Stamp, Paperclip, Loader2, Send, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { createAuthenticatedFetch } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/react';
import {
  isSubmitterOf,
  listApprovalActions,
  remindApprovalRequest,
  type ApprovalActionLite,
  type ApprovalActionAttachmentLite,
  type ApprovalRequestLite,
} from '../hooks/useRecordApprovals.js';
import { isViaOverrideRow } from '../utils/approvalOverride.js';
import {
  approverCopyFrom,
  approverDisplay,
  formatIdentity,
  prettifyMachineName,
  unresolvedApproverRefs,
  DEFAULT_APPROVER_COPY,
  type ApproverDisplayCopy,
} from '../utils/approverIdentity.js';
import {
  useApproverDirectory,
  type ApproverDirectory,
} from '../hooks/useApproverDirectory.js';
import { ApprovalStepLine } from './approval-progress/ApprovalStepLine.js';
import { DecisionProgressIndicator } from './approval-progress/DecisionProgressIndicator.js';
import { eligibleApproverCount } from './approval-progress/eligibleApprovers.js';

/**
 * RecordApprovalsPanel — the record page's read-only approval surface
 * (objectui#3461).
 *
 * Visibility is READ-gated, not approver-gated: anyone who can open the
 * record sees which step its approval sits at, who it is waiting on, and
 * what has been decided so far. Before this panel, the record page consumed
 * the approvals API solely to decide whether the CURRENT user gets
 * Approve/Reject buttons — the pending-approver list and the action thread
 * existed only in the Approval Center, which business-app roles cannot even
 * navigate to (its nav lives under the `setup` app), and granting them
 * `sys_approval_request` list access would expose every tenant record's
 * requests. "Who is my record waiting on" belongs on the record.
 *
 * Data comes from the SAME reads the header actions already use
 * (`useRecordApprovals` — the hook's `requests` array), plus the per-request
 * action thread (`GET /approvals/requests/:id/actions`, i.e.
 * `sys_approval_action`) that the record's own audit history never sees:
 * the engine writes business-field mirrors as `runAs:'system'`, so record
 * history shows "System updated stage" and nothing else. Copy reuses the
 * Approval Center's `approvalsInbox.*` i18n keys verbatim so the two
 * surfaces cannot drift.
 *
 * A multi-level flow opens ONE request per approval node (and per ADR-0044
 * revision round), so the timeline here merges the action threads of every
 * request on the record into a single chronological story — the "who
 * approved level 1 and when" a per-request drawer can't show at a glance.
 *
 * Renders nothing when the approvals plugin is absent or the record has no
 * requests — a record that never entered an approval gets no empty chrome.
 */

export interface RecordApprovalsPanelProps {
  /**
   * The record's approval state, threaded from the host's ONE
   * `useRecordApprovals()` call — the panel deliberately takes the hook's
   * result instead of calling the hook itself so the record page keeps a
   * single approvals read (the header decision buttons consume the same).
   */
  approvals: {
    available: boolean;
    requests: ApprovalRequestLite[];
    pendingRequest: ApprovalRequestLite | null;
  };
  /** Signed-in user id — remind fallback gate for pre-`viewer` backends. */
  currentUserId?: string | null;
  className?: string;
}

/**
 * Semantic status colors — mirrors the Approval Center's STATUS_CLASSES
 * (green = approved, amber = waiting, red = rejected, slate = recalled,
 * violet = returned for revision).
 */
const STATUS_CLASSES: Record<string, string> = {
  pending:  'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400',
  rejected: 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400',
  recalled: 'border-border bg-muted text-muted-foreground',
  returned: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-400',
};

/** Timeline dot color per action kind — same palette as the Approval Center. */
const ACTION_DOT: Record<string, string> = {
  approve: 'bg-emerald-500',
  reject: 'bg-destructive',
  submit: 'bg-blue-500',
  reassign: 'bg-indigo-500',
  remind: 'bg-amber-500',
  request_info: 'bg-amber-500',
  comment: 'bg-slate-400',
  escalate: 'bg-red-500',
  revise: 'bg-violet-500',
  resubmit: 'bg-blue-500',
};

/**
 * Identity formatting moved to `utils/approverIdentity` in `77f846a8b` — the
 * panel, the merged timeline and the admin-override dialog must not each own a
 * copy. Re-exported here because this module is where it was published.
 */
export { formatIdentity };

/**
 * Collapse the pending-approver chips, keyed by (name, group) so 会签
 * comprehension survives: the same person filling two different groups stays
 * two labeled chips, a person filling one group twice collapses to one chip
 * with a count. Mirrors the Approval Center's `approverChips` (#2762 P1-2 /
 * objectui#2807); the tooltip keeps the underlying ids inspectable.
 */
export interface ApproverChip {
  label: string;
  group?: string;
  count: number;
  title: string;
  /**
   * The people filling the seat, already joined for display. Absent (rather
   * than empty) when there is nothing to add, so a caller comparing chips with
   * `toEqual` sees the same shape it always did.
   */
  detail?: string;
  /** Probed AND empty — set only when the seat is genuinely unstaffed. */
  unstaffed?: boolean;
}

export function approverChips(
  r: ApprovalRequestLite,
  opts?: { directory?: ApproverDirectory; copy?: ApproverDisplayCopy },
): ApproverChip[] {
  const copy = opts?.copy ?? DEFAULT_APPROVER_COPY;
  const directory = opts?.directory ?? {};
  const order: string[] = [];
  const byKey = new Map<string, ApproverChip>();
  for (const a of r.pending_approvers || []) {
    const shown = approverDisplay(a, {
      serverName: r.pending_approver_names?.[a],
      resolved: directory[a],
      copy,
    });
    const label = shown.label;
    const gs = r.pending_approver_groups?.[a];
    const group = gs && gs.length ? gs.join(' / ') : undefined;
    // The seat's people are part of its identity: two positions can share a
    // label, and collapsing them would merge two different slates into one chip.
    const key = [label, shown.detail, group].filter(Boolean).join(' ');
    const seen = byKey.get(key);
    if (seen) {
      seen.count += 1;
      if (a && !seen.title.split(', ').includes(a)) seen.title += `, ${a}`;
    } else {
      byKey.set(key, {
        label,
        group,
        count: 1,
        title: a || label,
        ...(shown.detail ? { detail: shown.detail } : {}),
        ...(shown.unstaffed ? { unstaffed: true } : {}),
      });
      order.push(key);
    }
  }
  return order.map((k) => byKey.get(k)!);
}

/**
 * `locale` is REQUIRED: the timeline's action times used to be formatted with
 * no tag, i.e. in the MACHINE's locale (objectui#9909). The panel passes
 * `useDisplayLocale()`.
 */
function formatDate(s: string | null | undefined, locale: string): string {
  if (!s) return '—';
  try { return new Date(s).toLocaleString(locale); } catch { return s; }
}

/**
 * The step a request or a timeline row names, as a reader should see it: the
 * authored step label when there is one, else the node's machine name
 * prettified, else nothing. The headline and every timeline row draw their
 * step through this one rule, so the two cannot drift (objectui#13248).
 */
function stepDisplayText(
  label: string | null | undefined,
  machineName: string | null | undefined,
): string | null {
  return label || (machineName ? prettifyMachineName(machineName) : null);
}

/**
 * Merge the per-request action threads into one chronological (oldest-first)
 * timeline. Explicit sort — the panel must not depend on per-request server
 * order once several requests' rows are concatenated.
 */
export function mergeActionTimelines(threads: ApprovalActionLite[][]): ApprovalActionLite[] {
  return threads
    .flat()
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

export const RecordApprovalsPanel: React.FC<RecordApprovalsPanelProps> = ({
  approvals,
  currentUserId,
  className,
}) => {
  const { t } = useObjectTranslation();
  const displayLocale = useDisplayLocale();
  const tr = React.useCallback(
    (key: string, defaultValue: string, opts?: Record<string, unknown>) =>
      String(t(`approvalsInbox.${key}`, { defaultValue, ...opts })),
    [t],
  );

  const { available, requests, pendingRequest } = approvals;
  // Newest-first from the hook; the pending row (at most one) leads the header.
  const headline = pendingRequest ?? requests[0] ?? null;

  const [actions, setActions] = React.useState<ApprovalActionLite[]>([]);
  const [actionsLoading, setActionsLoading] = React.useState(false);
  const [reminding, setReminding] = React.useState(false);

  /**
   * Resolve the pending approvers the SERVER could not name (`77f846a8b`).
   *
   * `positi…ager` was `formatIdentity('position:sales_manager')` — the raw
   * engine reference, middle-truncated to fit its chip. The gate below keeps
   * this free on a backend that resolves its own slate: a request whose
   * `pending_approver_names` covers every id yields an empty list, and the
   * hook never touches the adapter.
   */
  const approverRefs = React.useMemo(
    () => unresolvedApproverRefs(pendingRequest),
    [pendingRequest],
  );
  const approverDirectory = useApproverDirectory(approverRefs);
  const approverCopy = React.useMemo<ApproverDisplayCopy>(
    () => approverCopyFrom(t as unknown as Parameters<typeof approverCopyFrom>[0]),
    [t],
  );

  // Reload key: the id set plus each request's decision state, as a stable
  // string — so the timeline refetches when a decision lands (the host's
  // hook refresh flips `status` or bumps the enriched `decision_progress`
  // tally), but NOT on every refresh returning identical data in new arrays.
  const requestIdsKey = requests
    .map((r) => `${r.id} ${r.status} ${r.decision_progress?.got ?? ''}`)
    .join(',');

  const reloadActions = React.useCallback(async () => {
    const ids = requestIdsKey
      ? requestIdsKey.split(',').map((k) => k.split(' ')[0])
      : [];
    if (ids.length === 0) {
      setActions([]);
      return;
    }
    setActionsLoading(true);
    try {
      const threads = await Promise.all(
        ids.map((id) => listApprovalActions(id).catch(() => [] as ApprovalActionLite[])),
      );
      setActions(mergeActionTimelines(threads));
    } finally {
      setActionsLoading(false);
    }
  }, [requestIdsKey]);

  React.useEffect(() => {
    void reloadActions();
  }, [reloadActions]);

  /**
   * Remind is the submitter's lever (server-authorized): prefer the
   * server-resolved `viewer.is_submitter` from the enriched pending row and
   * fall back to a plain id match for backends predating framework#3310.
   *
   * The derivation moved to `isSubmitterOf` unchanged (`830ed5803`) so the
   * record band's Recall gate reads the SAME answer — two copies of it would be
   * two definitions of who submitted. `?? false` restates this call site's own
   * reading of "no pending request": there is nothing to remind about, so the
   * button is gone either way.
   */
  const isSubmitter = isSubmitterOf(pendingRequest, currentUserId) ?? false;

  const handleRemind = React.useCallback(async () => {
    if (!pendingRequest) return;
    setReminding(true);
    try {
      const out = await remindApprovalRequest(pendingRequest.id);
      toast.success(tr('remindSuccess', 'Reminder sent to {{count}} approver(s)', {
        count: out?.notified ?? 0,
      }));
      await reloadActions();
    } catch (err: any) {
      toast.error(
        err?.code === 'THROTTLED' || err?.status === 429
          ? tr('remindThrottled', 'A reminder was sent recently — try again later.')
          : err?.message || tr('loadFailed', 'Failed to load request'),
      );
    } finally {
      setReminding(false);
    }
  }, [pendingRequest, reloadActions, tr]);

  /**
   * Open a timeline attachment via its short-lived signed URL — same
   * user-gesture-preserving dance as the Approval Center (framework#3266
   * follow-up): open the tab synchronously, then point it at the URL.
   */
  const authFetch = React.useMemo(() => createAuthenticatedFetch(), []);
  const openAttachment = React.useCallback(async (att: ApprovalActionAttachmentLite) => {
    const win = window.open('', '_blank', 'noopener');
    try {
      const base = String((import.meta as any).env?.VITE_SERVER_URL || '').replace(/\/$/, '');
      const res = await authFetch(`${base}/api/v1/storage/files/${encodeURIComponent(att.id)}/url`);
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const body = await res.json().catch(() => null);
      const raw = body?.data?.url ?? body?.url;
      if (!raw) throw new Error('NO_URL');
      const url = /^https?:\/\//i.test(raw) ? raw : `${base}${raw}`;
      if (win) win.location.href = url;
      else window.open(url, '_blank', 'noopener');
    } catch {
      win?.close();
      toast.error(tr('attachmentOpenFailed', 'Could not open the attachment — please try again'));
    }
  }, [authFetch, tr]);

  // After all hooks: an unavailable plugin or a record with no requests
  // renders no chrome at all.
  if (!available || requests.length === 0 || !headline) return null;

  const statusLabel = (status: string): string => {
    switch (status) {
      case 'pending': return tr('statusPending', 'Pending');
      case 'approved': return tr('statusApproved', 'Approved');
      case 'rejected': return tr('statusRejected', 'Rejected');
      case 'recalled': return tr('statusRecalled', 'Recalled');
      case 'returned': return tr('statusReturned', 'Returned for revision');
      default: return status;
    }
  };

  const actionText = (a: ApprovalActionLite): string =>
    a.action === 'submit' ? tr('actSubmit', 'Submitted')
      : a.action === 'approve' ? tr('actApprove', 'Approved')
      : a.action === 'reject' ? tr('actReject', 'Rejected')
      : a.action === 'recall' ? tr('actRecall', 'Recalled')
      : a.action === 'reassign' ? tr('actReassign', 'Reassigned')
      : a.action === 'remind' ? tr('actRemind', 'Reminder sent')
      : a.action === 'request_info' ? tr('actRequestInfo', 'Requested more info')
      : a.action === 'comment' ? tr('actComment', 'Commented')
      : a.action === 'escalate' ? tr('actEscalate', 'SLA escalated')
      : a.action === 'revise' ? tr('actRevise', 'Sent back for revision')
      : a.action === 'resubmit' ? tr('actResubmit', 'Resubmitted')
      : a.action;

  const actorName = (a: ApprovalActionLite): string =>
    a.actor_id === 'system:sla'
      ? tr('systemSlaActor', 'System (SLA)')
      : a.actor_name ?? formatIdentity(a.actor_id);

  /**
   * A timeline row's step label is its request's (objectui#13248). The server
   * writes `sys_approval_action.step_label` as a copy of the owning request's
   * step label, but `GET /approvals/requests/:id/actions` does not serve that
   * column: `rowFromAction`, like the spec's `ApprovalActionRow`, names only
   * `step_name`. The request rows this panel already holds serve `step_label`
   * from the same chain, and every row in the timeline belongs to one of them
   * (the threads are read per request id), so the row reads it there. Without
   * this the row drew the prettified node id ("Manager Review") where the flow
   * author wrote "Sales Manager Review".
   */
  const stepLabelByRequest = new Map(requests.map((r) => [r.id, r.step_label]));
  const actionStepText = (a: ApprovalActionLite): string | null =>
    stepDisplayText(stepLabelByRequest.get(a.request_id), a.step_name);

  const dp = pendingRequest?.decision_progress;
  const eligible = eligibleApproverCount(pendingRequest);
  const stepText = headline.status === 'pending'
    ? stepDisplayText(headline.step_label, headline.current_step)
    : null;

  return (
    <div className={cn('rounded-lg border bg-card', className)} data-testid="record-approvals-panel">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
        <div className="flex items-center gap-2 min-w-0 text-sm font-medium">
          <Stamp className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{t('detail.approvalsPanelTitle', { defaultValue: 'Approvals' })}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {headline.process_label || prettifyMachineName(headline.process_name)}
            {stepText ? ` · ${stepText}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {(headline.round ?? 1) > 1 && (
            <Badge variant="outline" className="text-[11px] text-muted-foreground">
              {tr('roundChip', 'Round {{n}}', { n: headline.round })}
            </Badge>
          )}
          <Badge variant="outline" className={cn('font-medium', STATUS_CLASSES[headline.status] ?? '')}>
            {statusLabel(headline.status)}
          </Badge>
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Flow-level step strip — where in the multi-level flow this record
            sits; present on the enriched pending row only (single reads).
            Vertical at every step count (objectui#5554); the markup is the
            one `ApprovalStepLine` the approval request page's decision panel
            draws too (objectui#12491), and it draws nothing under two steps. */}
        <ApprovalStepLine steps={pendingRequest?.flow_steps} />

        {/* Aggregation progress — the pending node's server-computed tally
            (unanimous / quorum approvals, per-group countersign), drawn by
            the shared indicator and never re-derived client-side. */}
        {dp && <DecisionProgressIndicator progress={dp} eligibleApprovers={eligible} />}

        {/* Who the pending step waits on — THE read this panel exists for:
            server-resolved names (group approvers labeled with their group),
            visible to every record reader, not just approvers. */}
        {pendingRequest && (pendingRequest.pending_approvers || []).length > 0 && (
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">
              {tr('waitingOn', 'Waiting on')}
            </div>
            <div className="flex flex-wrap gap-1">
              {approverChips(pendingRequest, { directory: approverDirectory, copy: approverCopy }).map((chip, i) => (
                <Badge
                  key={`${chip.label}-${chip.group ?? ''}-${i}`}
                  variant="outline"
                  className="text-[11px]"
                  /* The raw `position:…` reference belongs on hover, not as the
                     primary identification — `77f846a8b`. */
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
              {isSubmitter && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 px-2 text-[11px]"
                  disabled={reminding}
                  onClick={() => void handleRemind()}
                >
                  {reminding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  {tr('remindBtn', 'Send reminder')}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Merged action timeline — the approval story the record's own audit
            history cannot tell (the engine mirrors fields as `runAs:'system'`,
            and decisions live in sys_approval_action, not record history). */}
        <div>
          <div className="text-[11px] text-muted-foreground mb-2">
            {tr('history', 'Activity')}
          </div>
          {actionsLoading && actions.length === 0 ? (
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {tr('loadingMore', 'Loading…')}
            </div>
          ) : actions.length === 0 ? (
            <div className="text-xs text-muted-foreground">{tr('noActions', 'No actions yet.')}</div>
          ) : (
            <ol className="relative space-y-3 pl-5 before:absolute before:left-[7px] before:top-1 before:bottom-1 before:w-px before:bg-border">
              {actions.map((a) => (
                <li key={a.id} className="relative text-xs">
                  {/* objectui#5178 — an admin override does not wear the ordinary
                      decision's dot. `approve` is emerald here, which is exactly
                      the "byte-for-byte like an ordinary approval" the card
                      reports; an override gets the amber attention dot instead,
                      so the distinction survives a glance down the timeline. */}
                  <span
                    className={`absolute -left-[18px] top-1 h-3 w-3 rounded-full ring-2 ring-background ${
                      isViaOverrideRow(a) ? 'bg-amber-500' : ACTION_DOT[a.action] ?? 'bg-muted-foreground'
                    }`}
                    aria-hidden
                  />
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="font-medium">{actionText(a)}</span>
                    <span className="text-muted-foreground">·</span>
                    <span title={a.actor_id || ''}>{actorName(a)}</span>
                    {/* The marker framework#4466 wrote and nothing read. Only an
                        explicit `via_override: true` earns it — see
                        `isViaOverrideRow` for why "not recorded" must not
                        render as either answer. */}
                    {isViaOverrideRow(a) && (
                      <Badge
                        variant="outline"
                        className="gap-1 border-amber-500/60 px-1.5 py-0 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                        title={tr('viaOverrideHint', 'The actor held no approver slot on this step — admitted by the admin-override path.')}
                        data-testid="via-override-chip"
                      >
                        <ShieldAlert className="h-3 w-3" aria-hidden />
                        {tr('viaOverrideChip', 'Admin override')}
                      </Badge>
                    )}
                    {actionStepText(a) && (
                      <span className="text-muted-foreground" data-testid="approval-action-step">
                        · {actionStepText(a)}
                      </span>
                    )}
                    <span className="ml-auto text-muted-foreground text-[10px]">
                      {formatDate(a.created_at, displayLocale)}
                    </span>
                  </div>
                  {a.action === 'reassign' && (a.reassign_from || a.reassign_to) && (
                    <div className="text-muted-foreground mt-0.5">
                      {tr('reassignFromTo', 'from {{from}} to {{to}}', {
                        from: a.reassign_from_name ?? formatIdentity(a.reassign_from),
                        to: a.reassign_to_name ?? formatIdentity(a.reassign_to),
                      })}
                    </div>
                  )}
                  {a.comment && (
                    <div className="text-muted-foreground italic mt-0.5">"{a.comment}"</div>
                  )}
                  {Array.isArray(a.attachments) && a.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {a.attachments.map((att, i) => (
                        <button
                          key={att.id || i}
                          type="button"
                          onClick={() => void openAttachment(att)}
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                          title={att.name || att.id}
                        >
                          <Paperclip className="h-3 w-3" />
                          {att.name
                            || `${tr('attachmentChip', 'Attachment')}${a.attachments!.length > 1 ? ` ${i + 1}` : ''}`}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
};

export default RecordApprovalsPanel;
