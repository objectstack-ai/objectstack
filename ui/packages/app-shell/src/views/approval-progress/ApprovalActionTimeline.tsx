/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The approval action timeline: one entry per `sys_approval_action` row, its
 * kind, who acted, the step, when, a reassignment's from and to, the comment
 * and the attachments (each opened through its short-lived signed URL).
 *
 * One markup for both places that tell an approval's story, so the two cannot
 * drift: the business record's approvals panel (`RecordApprovalsPanel`, the
 * merged threads of every request on the record) and the approval request's
 * own page, whose right rail ends with it (objectstack#34588). Each caller
 * reads its rows and passes them in the order it draws them; the step each
 * row names is the caller's to resolve (`stepText`), because the actions
 * route does not serve a row's step label (objectui#13248).
 *
 * Copy is the Approval Center's `approvalsInbox.*` keys, verbatim.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { Badge } from '@object-ui/components';
import { formatDateTime } from '@object-ui/core';
import { createAuthenticatedFetch } from '@object-ui/auth';
import { useDisplayLocale } from '@object-ui/i18n';
import { useObjectTranslation } from '@object-ui/react';
import { Loader2, Paperclip, ShieldAlert } from 'lucide-react';
import type { ApprovalActionAttachmentLite, ApprovalActionLite } from '../../hooks/useRecordApprovals.js';
import { isViaOverrideRow } from '../../utils/approvalOverride.js';
import { isSystemNote } from '../../utils/approvalSystemNote.js';
import { formatIdentity } from '../../utils/approverIdentity.js';

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
 * An action's time in the record page's one datetime face: core's compact
 * face, the one the page's highlight chips and every `datetime` cell draw
 * (objectstack#35415), in the host's display zone. `locale` is REQUIRED: the
 * timeline's action times used to be formatted with no tag, i.e. in the
 * MACHINE's locale (objectui#9909). The timeline passes `useDisplayLocale()`.
 */
function formatDate(s: string | null | undefined, locale: string): string {
  if (!s) return '—';
  const text = formatDateTime(s, { locale, style: 'compact' });
  return text === '—' ? s : text;
}

export interface ApprovalActionTimelineProps {
  /** The rows, in the order they are drawn. */
  actions: readonly ApprovalActionLite[];
  /** True while the first read has not answered: a spinner instead of "No actions yet." */
  loading?: boolean;
  /** The step a row names, as a reader should see it; null names none. */
  stepText?: (action: ApprovalActionLite) => string | null;
}

export function ApprovalActionTimeline({ actions, loading = false, stepText }: ApprovalActionTimelineProps) {
  const { t } = useObjectTranslation();
  const displayLocale = useDisplayLocale();
  const tr = React.useCallback(
    (key: string, defaultValue: string, opts?: Record<string, unknown>) =>
      String(t(`approvalsInbox.${key}`, { defaultValue, ...opts })),
    [t],
  );

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

  const actionText = (a: ApprovalActionLite): string =>
    isSystemNote(a) ? tr('actSystemNote', 'System note')
      : a.action === 'submit' ? tr('actSubmit', 'Submitted')
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
      : !a.actor_id
        ? tr('systemActor', 'System')
        : a.actor_name ?? formatIdentity(a.actor_id);

  const actionStepText = (a: ApprovalActionLite): string | null => stepText?.(a) ?? null;

  return loading && actions.length === 0 ? (
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
  );
}
