/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One detailed tool card in a `<ChatbotEnhanced>` turn: the collapsible
 * `<Tool>` with its header, payload, decision line and the purpose-built
 * cards (sample-data cleanup, package removal, record write, record
 * hand-off). A plain function, not a component: the card keeps its element
 * identity (`<Tool key={tool.toolCallId}>`) so a card the user opened or
 * closed keeps that state across re-renders.
 */
import * as React from 'react';
import { Hourglass, Table2, Trash2, Sparkles, XCircle, Loader2, CheckCircle2, Clock } from 'lucide-react';
import { humanizeToolName, unwrapToolResult, type ToolTitleTranslator } from '../tool-display';
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  type ToolStatusLabels,
} from '../elements/tool';
import type { detectPackageRemovedResult } from '../mapMessages';
import type { ChatbotEnhancedProps, ChatbotEnhancedToolInvocation } from './types';
import { SmartToolOutput, ToolRunningTimer } from './toolSummary';
import { formatRecordWriteValue, writtenRecordOf } from './toolRecordWrite';

/**
 * What a tool card reads from the `<ChatbotEnhanced>` that renders it: the
 * props as resolved there (defaults applied), the translator, the resolved
 * labels and the `ToolHeader` badge vocabulary.
 */
export type ToolDetailContext = Required<
  Pick<
    ChatbotEnhancedProps,
    | 'processVisibility'
    | 'toolApproveLabel'
    | 'toolDenyLabel'
    | 'toolDenyReason'
    | 'sampleDataCleanupTitleLabel'
    | 'sampleDataCleanupIrreversibleLabel'
    | 'sampleDataCleanupEditedLabel'
    | 'sampleDataCleanupAbsentLabel'
    | 'packageRemovalTitleLabel'
    | 'packageRemovalRowsLabel'
    | 'packageRemovalDraftLabel'
    | 'packageRemovalRowsUnknownLabel'
    | 'packageRemovalItemTypeLabel'
    | 'packageRemovalTotalLabel'
    | 'packageRemovalUncountedLabel'
    | 'packageRemovalPermanentLabel'
    | 'packageRemovalKeptLabel'
    | 'packageRemovalRemovedLabel'
    | 'packageRemovalPartialLabel'
    | 'recordWriteCreateTitle'
    | 'recordWriteUpdateTitle'
    | 'recordWriteDroppedLabel'
    | 'recordWriteSubmittingLabel'
    | 'recordWriteWrittenLabel'
    | 'recordWriteCancelledLabel'
    | 'recordWriteConfirmLabel'
    | 'recordWriteOpenFormLabel'
    | 'recordWriteOpenFormReason'
    | 'recordWriteCancelLabel'
    | 'recordWriteCancelReason'
    | 'recordHandoffTitleLabel'
    | 'recordHandoffOpenLabel'
  >
> &
  Pick<
    ChatbotEnhancedProps,
    | 'toolDecisions'
    | 'onToolApprove'
    | 'onOpenRecordForm'
    | 'onOpenRecord'
  > & {
    tt: ToolTitleTranslator;
    L: { connectionOfflineLabel: string };
    toolStatusLabels: ToolStatusLabels;
    heldForApprovalLabel: string;
    /**
     * A decision that met a lapsed pending action (decision state `expired`,
     * objectstack#34255): the status word and the sentence that says why.
     */
    expiredLabel: string;
    expiredDetailLabel: string;
    /** Handed in, not imported: this module takes only types from `../mapMessages`. */
    detectPackageRemovedResult: typeof detectPackageRemovedResult;
  };

export const renderToolDetail = (tool: ChatbotEnhancedToolInvocation, ctx: ToolDetailContext) => {
  const {
    toolDecisions,
    onToolApprove,
    processVisibility,
    tt,
    L,
    toolStatusLabels,
    heldForApprovalLabel,
    expiredLabel,
    expiredDetailLabel,
    toolApproveLabel,
    toolDenyLabel,
    toolDenyReason,
    sampleDataCleanupTitleLabel,
    sampleDataCleanupIrreversibleLabel,
    sampleDataCleanupEditedLabel,
    sampleDataCleanupAbsentLabel,
    packageRemovalTitleLabel,
    packageRemovalRowsLabel,
    packageRemovalDraftLabel,
    packageRemovalRowsUnknownLabel,
    packageRemovalItemTypeLabel,
    packageRemovalTotalLabel,
    packageRemovalUncountedLabel,
    packageRemovalPermanentLabel,
    packageRemovalKeptLabel,
    packageRemovalRemovedLabel,
    packageRemovalPartialLabel,
    detectPackageRemovedResult,
    recordWriteCreateTitle,
    recordWriteUpdateTitle,
    recordWriteDroppedLabel,
    recordWriteSubmittingLabel,
    recordWriteWrittenLabel,
    recordWriteCancelledLabel,
    recordWriteConfirmLabel,
    recordWriteOpenFormLabel,
    recordWriteOpenFormReason,
    recordWriteCancelLabel,
    recordWriteCancelReason,
    onOpenRecordForm,
    onOpenRecord,
    recordHandoffTitleLabel,
    recordHandoffOpenLabel,
  } = ctx;
  const state =
    tool.state ??
    (tool.errorText
      ? 'output-error'
      : tool.result !== undefined
        ? 'output-available'
        : 'input-available');
  const partType = `tool-${tool.toolName}` as `tool-${string}`;
  const decision = toolDecisions?.[tool.toolCallId];
  const isAwaitingApproval =
    state === 'approval-requested' && Boolean(onToolApprove) && !decision;
  // cloud#3565 — a record-write card draws the record itself and its own
  // three buttons; the generic Approve / Deny strip, its decision line and
  // the raw payload stay out of the way.
  const isRecordWriteCard = Boolean(tool.recordWrite);
  const hidePendingPayload =
    state === 'approval-requested' && Boolean(tool.pendingActionId);
  // objectui#7254 / cloud#1658 — `humanizeToolName`'s translator seam has
  // existed since the tool titles were found untranslatable, but no call
  // site ever passed one, so every card header read English
  // ("Propose blueprint", "Apply edit", "Verify build") inside an otherwise
  // Chinese conversation. Unknown/custom tools still fall back to the same
  // English title-caser.
  const friendlyTitle = humanizeToolName(tool.toolName, tt);
  const renderableResult = unwrapToolResult(tool.result);
  const showRawName =
    processVisibility === 'debug' &&
    friendlyTitle &&
    friendlyTitle.toLowerCase() !== tool.toolName.toLowerCase();
  // Raw PARAMETERS/RESULT JSON is developer detail — only in `debug` mode,
  // or when a HITL approval needs the operator to see the exact payload.
  const showPayload =
    processVisibility === 'debug' ||
    (isAwaitingApproval && !isRecordWriteCard && !tool.sampleDataCleanup && !tool.packageRemoval);
  // A tool with no output yet is RUNNING — show a live elapsed timer next to
  // its title so a long tool call has a visible countdown, not a
  // static "Running" (issue #432).
  const isRunning = state === 'input-streaming' || state === 'input-available';
  const titleNode = (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span>{friendlyTitle || tool.toolName}</span>
      {showRawName ? (
        <code className="rounded bg-muted px-1 py-px text-[10px] font-mono text-muted-foreground">
          {tool.toolName}
        </code>
      ) : null}
      {isRunning ? <ToolRunningTimer offlineLabel={L.connectionOfflineLabel} /> : null}
    </span>
  );

  return (
    <Tool
      key={tool.toolCallId}
      defaultOpen={
        state === 'output-error' ||
        state === 'approval-requested' ||
        Boolean(tool.recordHandoff) ||
        Boolean(tool.recordWrite) ||
        Boolean(tool.packageRemoval)
      }
    >
      <ToolHeader
        type={partType}
        state={state}
        title={titleNode}
        statusLabels={toolStatusLabels}
      />
      <ToolContent>
        {showPayload && tool.args !== undefined ? (
          <ToolInput input={tool.args} />
        ) : null}
        {hidePendingPayload ? null : showPayload || state === 'output-error' ? (
          <SmartToolOutput
            output={renderableResult}
            errorText={tool.errorText}
          />
        ) : null}
        {decision && !isRecordWriteCard ? (
          <div
            className={
              'flex items-center gap-2 p-3 border-t text-xs ' +
              (decision.state === 'error'
                ? 'bg-destructive/10 text-destructive'
                : decision.state === 'success'
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : decision.state === 'held'
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                    : 'bg-muted/30 text-muted-foreground')
            }
            data-testid="tool-decision"
            data-state={decision.state}
          >
            {decision.state === 'held' ? (
              <Hourglass className="size-3.5" aria-hidden="true" />
            ) : decision.state === 'expired' ? (
              <Clock className="size-3.5" aria-hidden="true" />
            ) : (
              <span aria-hidden="true">
                {decision.state === 'pending'
                  ? '...'
                  : decision.state === 'success'
                    ? 'OK'
                    : 'X'}
              </span>
            )}
            <span>
              {decision.state === 'held'
                ? heldForApprovalLabel
                : decision.state === 'expired'
                  ? `${expiredLabel} · ${expiredDetailLabel}`
                  : decision.message ??
                    (decision.state === 'pending'
                      ? 'Submitting decision...'
                      : decision.state === 'success'
                        ? 'Action approved and executed.'
                        : 'Decision failed.')}
            </span>
          </div>
        ) : null}
        {isAwaitingApproval && !isRecordWriteCard ? (
          <div className="flex gap-2 p-3 border-t bg-muted/30">
            <button
              type="button"
              onClick={() => onToolApprove?.(tool.toolCallId, true)}
              className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              {toolApproveLabel}
            </button>
            <button
              type="button"
              onClick={() =>
                onToolApprove?.(
                  tool.toolCallId,
                  false,
                  toolDenyReason,
                )
              }
              className="inline-flex h-7 items-center rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent"
            >
              {toolDenyLabel}
            </button>
          </div>
        ) : null}
        {/* cloud#3565 — 「清理示例数据」: what the seed ledger recorded, per
            table, so the user confirms a list rather than a payload, and
            that the removal cannot be undone (the maintainer's note on
            cloud#3565: no recycle bin until objectstack#3146). The rows
            the list leaves out — hidden from the user or already gone —
            and the rows kept because someone edited them are each said
            when there are any. The generic Approve / Deny strip below
            stays the decision. */}
        {tool.sampleDataCleanup ? (
          <div
            className="flex flex-col gap-2 border-t bg-muted/20 px-3 py-2.5"
            data-testid="sample-data-cleanup"
          >
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80">
              <Table2 className="size-3.5" />
              {sampleDataCleanupTitleLabel}
            </span>
            <ul className="flex flex-col gap-0.5 text-xs" data-testid="sample-data-cleanup-tables">
              {tool.sampleDataCleanup.tables.map((t) => (
                <li key={t.objectName} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">{t.label}</span>
                  <span className="tabular-nums text-muted-foreground">{t.count}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs font-medium text-destructive" data-testid="sample-data-cleanup-irreversible">
              {sampleDataCleanupIrreversibleLabel}
            </p>
            {tool.sampleDataCleanup.edited > 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="sample-data-cleanup-edited">
                {sampleDataCleanupEditedLabel(tool.sampleDataCleanup.edited)}
              </p>
            ) : null}
            {tool.sampleDataCleanup.absent > 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="sample-data-cleanup-absent">
                {sampleDataCleanupAbsentLabel(tool.sampleDataCleanup.absent)}
              </p>
            ) : null}
          </div>
        ) : null}
        {/* objectstack#31025 — 「删除软件包」: what goes, per object with its
            row count, the other items by type, and the total, so the user
            confirms a list rather than a payload. A draft object has no
            table and an uncounted one says so; neither reads as 0. When the
            tables are dropped the card says they are gone for good and skip
            the recycle bin (the shape's `recycleBin: false`); when they are
            kept it says so. The generic Approve / Deny strip below stays the
            decision; once approved, the outcome says removed or partial. */}
        {tool.packageRemoval ? (
          <div
            className="flex flex-col gap-2 border-t bg-muted/20 px-3 py-2.5"
            data-testid="package-removal"
            data-data={tool.packageRemoval.data}
          >
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80">
              <Trash2 className="size-3.5" />
              {packageRemovalTitleLabel(tool.packageRemoval.label)}
            </span>
            {tool.packageRemoval.objects.length > 0 ? (
              <ul className="flex flex-col gap-0.5 text-xs" data-testid="package-removal-objects">
                {tool.packageRemoval.objects.map((o) => (
                  <li
                    key={o.name}
                    className="flex items-baseline justify-between gap-3"
                    data-testid={`package-removal-object-${o.name}`}
                  >
                    <span className="min-w-0 truncate">{o.label}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {o.rows !== undefined
                        ? packageRemovalRowsLabel(o.rows)
                        : o.draft
                          ? packageRemovalDraftLabel
                          : packageRemovalRowsUnknownLabel}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {Object.keys(tool.packageRemoval.items).length > 0 ? (
              <ul className="flex flex-col gap-0.5 text-xs" data-testid="package-removal-items">
                {Object.entries(tool.packageRemoval.items).map(([type, n]) => (
                  <li
                    key={type}
                    className="flex items-baseline justify-between gap-3"
                    data-testid={`package-removal-item-${type}`}
                  >
                    <span className="min-w-0 truncate">{packageRemovalItemTypeLabel(type)}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{n}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-muted-foreground" data-testid="package-removal-total">
              {packageRemovalTotalLabel(tool.packageRemoval.totalRows)}
            </p>
            {tool.packageRemoval.uncountedObjects > 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="package-removal-uncounted">
                {packageRemovalUncountedLabel(tool.packageRemoval.uncountedObjects)}
              </p>
            ) : null}
            {tool.packageRemoval.data === 'dropped' ? (
              <p className="text-xs font-medium text-destructive" data-testid="package-removal-permanent">
                {packageRemovalPermanentLabel}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground" data-testid="package-removal-kept">
                {packageRemovalKeptLabel}
              </p>
            )}
            {(() => {
              const outcome =
                decision?.state === 'success' && decision.decision === 'approved'
                  ? detectPackageRemovedResult(decision.result)
                  : undefined;
              if (!outcome) return null;
              return (
                <p
                  className={
                    'text-xs font-medium ' +
                    (outcome.status === 'removed'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-amber-700 dark:text-amber-400')
                  }
                  data-testid="package-removal-outcome"
                  data-state={outcome.status}
                >
                  {outcome.status === 'removed'
                    ? packageRemovalRemovedLabel
                    : packageRemovalPartialLabel(outcome.failed)}
                </p>
              );
            })()}
          </div>
        ) : null}
        {/* cloud#3565 — the ONE-record write the user confirms. The card is
            the whole affordance: the record as it will be written (old → new
            on an update), what the server left out and why, and the three
            buttons the ruling names. 确认 approves the pending action, which
            writes AS THE USER; 取消 rejects it; 打开完整表单 rejects it too
            and hands the host the values, so a record saved in the form is
            never written a second time from here. */}
        {tool.recordWrite ? (
          <div
            className="flex flex-col gap-2 border-t bg-muted/20 px-3 py-2.5"
            data-testid="record-write"
            data-operation={tool.recordWrite.operation}
          >
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80">
              <Sparkles className="size-3.5" />
              {tool.recordWrite.operation === 'create'
                ? recordWriteCreateTitle(tool.recordWrite.objectLabel)
                : recordWriteUpdateTitle(tool.recordWrite.objectLabel)}
              {tool.recordWrite.label ? (
                <span className="font-normal text-muted-foreground">· {tool.recordWrite.label}</span>
              ) : null}
            </span>
            {tool.recordWrite.reason ? (
              <p className="text-xs text-muted-foreground">{tool.recordWrite.reason}</p>
            ) : null}
            <dl
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs"
              data-testid="record-write-fields"
            >
              {tool.recordWrite.fields.map((f) => (
                <React.Fragment key={f.name}>
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="min-w-0 break-words" data-testid={`record-write-field-${f.name}`}>
                    {'current' in f ? (
                      <>
                        <span className="text-muted-foreground line-through">
                          {formatRecordWriteValue(f.current)}
                        </span>
                        <span aria-hidden="true"> → </span>
                      </>
                    ) : null}
                    <span className="font-medium">{formatRecordWriteValue(f.value)}</span>
                  </dd>
                </React.Fragment>
              ))}
            </dl>
            {tool.recordWrite.dropped.length > 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="record-write-dropped">
                {recordWriteDroppedLabel}:{' '}
                {tool.recordWrite.dropped
                  .map((d) => `${d.field} (${d.detail ?? d.reason.replace(/_/g, ' ')})`)
                  .join(', ')}
              </p>
            ) : null}
            {decision ? (
              <p
                data-testid="record-write-decision"
                data-state={decision.state}
                className={
                  'inline-flex flex-wrap items-center gap-1.5 text-xs ' +
                  (decision.state === 'error'
                    ? 'text-destructive'
                    : decision.state === 'success'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : decision.state === 'held'
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-muted-foreground')
                }
              >
                {decision.state === 'error' ? (
                  <>
                    <XCircle className="size-3.5" />
                    {decision.message}
                  </>
                ) : decision.state === 'held' ? (
                  <>
                    <Hourglass className="size-3.5" />
                    {heldForApprovalLabel}
                  </>
                ) : decision.state === 'expired' ? (
                  <>
                    <Clock className="size-3.5" />
                    {`${expiredLabel} · ${expiredDetailLabel}`}
                  </>
                ) : decision.state === 'pending' ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    {recordWriteSubmittingLabel}
                  </>
                ) : decision.decision === 'rejected' ? (
                  recordWriteCancelledLabel
                ) : (
                  <>
                    <CheckCircle2 className="size-3.5" />
                    {recordWriteWrittenLabel}
                    {(() => {
                      const written = writtenRecordOf(decision.result);
                      return written && onOpenRecord ? (
                        <button
                          type="button"
                          onClick={() => onOpenRecord(written)}
                          data-testid="record-write-open-written"
                          className="underline underline-offset-2 hover:text-foreground"
                        >
                          {written.label ?? written.recordId}
                        </button>
                      ) : null;
                    })()}
                  </>
                )}
              </p>
            ) : null}
            {isAwaitingApproval ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onToolApprove?.(tool.toolCallId, true)}
                  data-testid="record-write-confirm"
                  className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  {recordWriteConfirmLabel}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onToolApprove?.(tool.toolCallId, false, recordWriteOpenFormReason);
                    onOpenRecordForm?.(tool.recordWrite!);
                  }}
                  disabled={!onOpenRecordForm}
                  data-testid="record-write-open-form"
                  className="inline-flex h-7 items-center rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {recordWriteOpenFormLabel}
                </button>
                <button
                  type="button"
                  onClick={() => onToolApprove?.(tool.toolCallId, false, recordWriteCancelReason)}
                  data-testid="record-write-cancel"
                  className="inline-flex h-7 items-center rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent"
                >
                  {recordWriteCancelLabel}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {/* cloud#1658 — the record hand-off: the agent resolved the record a
            write request names but has no action to perform the change, so
            the card lands the user exactly there. No superseded logic on
            purpose: unlike a build prompt, an older record link stays
            correct — the record does not go stale because a newer hand-off
            exists. */}
        {tool.recordHandoff ? (
          <div
            className="flex flex-col gap-2 border-t bg-muted/20 px-3 py-2.5"
            data-testid="record-handoff"
          >
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80">
              <Sparkles className="size-3.5" />
              {recordHandoffTitleLabel}
            </span>
            <p className="text-xs text-muted-foreground">
              {tool.recordHandoff.label ?? tool.recordHandoff.objectName}
              {tool.recordHandoff.reason ? ` — ${tool.recordHandoff.reason}` : ''}
            </p>
            <button
              type="button"
              onClick={() => onOpenRecord?.(tool.recordHandoff!)}
              disabled={!onOpenRecord}
              data-testid="record-handoff-open"
              className="inline-flex w-fit items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {recordHandoffOpenLabel}
            </button>
          </div>
        ) : null}
      </ToolContent>
    </Tool>
  );
};
