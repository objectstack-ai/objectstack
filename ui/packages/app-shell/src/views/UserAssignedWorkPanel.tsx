/**
 * UserAssignedWorkPanel — a user's open work, shown in the ban dialog, with one
 * optional bulk hand-over (objectstack#30205).
 *
 * Banning a user signs them out, but the records they own and the records
 * assigned to them stay where they were. This panel tells the administrator
 * how many there are and lets them hand those records to someone else, in the
 * same dialog, before they confirm the ban.
 *
 * ## What it reads, and as whom
 *
 * `security.assignedWork.count` and `.transfer` of `@objectstack/client`, as
 * the signed-in administrator. The counts are the records the administrator
 * can read; an object they cannot read is named, never counted as zero; a
 * count the server cut short says so. Each moved record is an ordinary update
 * under the administrator's permissions, so a record they may not change is
 * reported as a failure with the server's reason. The panel shows the server's
 * answer as it came: it computes no count of its own.
 *
 * "Owned" is the records whose `owner_id` names the user; every other user
 * field is "assigned". A multi-valued user field is counted but cannot be
 * handed over here (the server answers `transferable: false`).
 *
 * ## Never in the ban's way
 *
 * The panel is optional and runs nothing on its own: the dialog's Confirm is
 * the ban and stays enabled whatever the panel is doing, and a failed count or
 * hand-over is shown here without blocking it. One hand-over moves at most the
 * server's batch (500 records) and reports what moved, what failed and how
 * many still hold the user; a further batch is the administrator's click, and
 * the counts are read again after each one.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Label } from '@object-ui/components';
import { Loader2 } from 'lucide-react';
import { useObjectTranslation, useObjectLabel } from '@object-ui/i18n';
import { useAdapter, useMetadata } from '@object-ui/react';
import { getLazyFieldWidget } from '@object-ui/fields';
import type { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { servedObjectLabel } from '@object-ui/core';
import { splitAssignedWork, type AssignedWorkSummary, type AssignedWorkTransferReport } from './userAssignedWork.js';

/** The `user` field widget the hand-over picks its person with (lazy until drawn). */
const UserWidget = getLazyFieldWidget('user');

/** The id of the picked person, whatever shape the user picker hands back. */
function pickedUserId(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined;
  if (typeof value === 'number') return String(value);
  const id = (value as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'string' && id ? id : typeof id === 'number' ? String(id) : undefined;
}

/** A refused call's words: the client throws an `Error` carrying the server's message. */
function failureText(err: unknown): string {
  const message = (err as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message ? message : String(err);
}

/** The slice of an object definition the panel labels rows with. */
type ObjectDefLike = { name?: unknown; label?: unknown; fields?: Record<string, { label?: string } | undefined> };

type CountState =
  | { phase: 'loading' }
  | { phase: 'failed'; message: string | null }
  | { phase: 'ready'; summary: AssignedWorkSummary };

type TransferState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'refused'; message: string; banned: boolean }
  | { phase: 'done'; report: AssignedWorkTransferReport };

export interface UserAssignedWorkPanelProps {
  /** The user whose work is counted and handed over. */
  userId: string;
}

export function UserAssignedWorkPanel({ userId }: UserAssignedWorkPanelProps) {
  const { t, language } = useObjectTranslation();
  const { objectLabel, fieldLabel } = useObjectLabel();
  const adapter = useAdapter() as ObjectStackAdapter | null;
  const { objects } = useMetadata();
  const [count, setCount] = useState<CountState>({ phase: 'loading' });
  const [transfer, setTransfer] = useState<TransferState>({ phase: 'idle' });
  const [target, setTarget] = useState<unknown>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        if (!adapter) {
          if (live) setCount({ phase: 'failed', message: null });
          return;
        }
        const summary = await adapter.getClient().security.assignedWork.count(userId);
        if (live) setCount({ phase: 'ready', summary });
      } catch (err) {
        if (live) setCount({ phase: 'failed', message: failureText(err) });
      }
    })();
    return () => { live = false; };
  }, [adapter, userId, generation]);

  const objectDefOf = useCallback(
    (name: string) => ((objects ?? []) as ReadonlyArray<ObjectDefLike | null | undefined>)
      .find((o) => o?.name === name) ?? undefined,
    [objects],
  );
  // An object's name follows the served-object-label rule (objectstack#30486):
  // the label the server served is drawn as given, and the client bundle is
  // asked only when none is served, so a renamed object shows its new name.
  const objectText = useCallback((name: string) => {
    const def = objectDefOf(name);
    return servedObjectLabel({ name, label: def?.label }, language, objectLabel, name);
  }, [objectDefOf, language, objectLabel]);
  const fieldText = useCallback((object: string, field: string) => {
    const declared = objectDefOf(object)?.fields?.[field]?.label;
    return fieldLabel(object, field, declared || field);
  }, [objectDefOf, fieldLabel]);

  // The candidate list leaves out the person being banned; the user picker
  // itself leaves out every banned user.
  const pickerField = useMemo(() => ({
    name: 'assigned_work_target',
    type: 'user',
    label: t('console.assignedWork.handoverTo'),
    lookupFilters: [{ field: 'id', operator: 'ne', value: userId }],
  }), [t, userId]);

  const targetId = pickedUserId(target);

  const runTransfer = async () => {
    if (!adapter || !targetId) return;
    setTransfer({ phase: 'running' });
    try {
      const report = await adapter.getClient().security.assignedWork.transfer(userId, { toUserId: targetId });
      setTransfer({ phase: 'done', report });
      // Read the counts again: what moved no longer holds the user. The
      // previous answer stays drawn until the new one arrives.
      setGeneration((g) => g + 1);
    } catch (err) {
      const fields = (err as { fields?: Array<{ code?: unknown }> } | null)?.fields;
      const banned = Array.isArray(fields) && fields.some((f) => f?.code === 'reference_user_banned');
      setTransfer({ phase: 'refused', message: failureText(err), banned });
    }
  };

  return (
    <section
      aria-labelledby="assigned-work-title"
      className="grid gap-3 rounded-md border bg-muted/30 p-3 text-sm sm:col-span-2"
      data-testid="user-assigned-work"
    >
      <h3 id="assigned-work-title" className="font-medium">{t('console.assignedWork.title')}</h3>

      {count.phase === 'loading' && (
        <p className="flex items-center gap-2 text-muted-foreground" data-testid="user-assigned-work-loading">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {t('console.assignedWork.loading')}
        </p>
      )}

      {count.phase === 'failed' && (
        <p role="alert" className="text-destructive" data-testid="user-assigned-work-count-failed">
          {count.message === null
            ? t('console.assignedWork.noClient')
            : t('console.assignedWork.countFailed', { message: count.message })}
        </p>
      )}

      {count.phase === 'ready' && (
        <AssignedWorkSummaryView
          summary={count.summary}
          objectText={objectText}
          fieldText={fieldText}
        />
      )}

      {count.phase === 'ready' && count.summary.objects.some((o) => o.transferable) && (
        <div className="grid gap-2 border-t pt-3" data-testid="user-assigned-work-handover">
          <Label htmlFor="assigned_work_target">{t('console.assignedWork.handoverTo')}</Label>
          <Suspense fallback={<div className="h-10 animate-pulse rounded-md bg-muted" aria-hidden="true" />}>
            <UserWidget
              id="assigned_work_target"
              value={target}
              onChange={(v: unknown) => { setTarget(v); setTransfer({ phase: 'idle' }); }}
              field={pickerField}
            />
          </Suspense>
          <p className="text-xs text-muted-foreground">{t('console.assignedWork.handoverHint')}</p>
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => { void runTransfer(); }}
              disabled={!targetId || transfer.phase === 'running'}
              aria-busy={transfer.phase === 'running' || undefined}
              data-testid="user-assigned-work-transfer"
            >
              {transfer.phase === 'running' && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
              {transfer.phase === 'running'
                ? t('console.assignedWork.handingOver')
                : transfer.phase === 'done' && transfer.report.remaining > 0
                  ? t('console.assignedWork.handoverNext')
                  : t('console.assignedWork.handover')}
            </Button>
          </div>
        </div>
      )}

      {transfer.phase === 'refused' && (
        <p role="alert" className="text-destructive" data-testid="user-assigned-work-transfer-refused">
          {transfer.banned
            ? t('console.assignedWork.targetBanned')
            : t('console.assignedWork.transferRefused', { message: transfer.message })}
        </p>
      )}

      {transfer.phase === 'done' && (
        <TransferReportView report={transfer.report} objectText={objectText} />
      )}
    </section>
  );
}

function AssignedWorkSummaryView({
  summary,
  objectText,
  fieldText,
}: {
  summary: AssignedWorkSummary;
  objectText: (name: string) => string;
  fieldText: (object: string, field: string) => string;
}) {
  const { t } = useObjectTranslation();
  const { owned, assigned } = splitAssignedWork(summary);
  return (
    <div className="grid gap-2" data-testid="user-assigned-work-summary">
      <p>
        {summary.total > 0
          ? t('console.assignedWork.summary', { total: summary.total, owned, assigned })
          : t('console.assignedWork.none')}
      </p>
      {summary.objects.length > 0 && (
        <ul className="grid gap-1">
          {summary.objects.map((row) => (
            <li
              key={`${row.object}.${row.field}`}
              className="flex items-baseline justify-between gap-3"
              data-testid={`user-assigned-work-row-${row.object}-${row.field}`}
            >
              <span className="min-w-0">
                {t('console.assignedWork.row', { object: objectText(row.object), field: fieldText(row.object, row.field) })}
                {!row.transferable && (
                  <span className="block text-xs text-muted-foreground">{t('console.assignedWork.notTransferable')}</span>
                )}
              </span>
              <span className="shrink-0 tabular-nums font-medium">{row.count}</span>
            </li>
          ))}
        </ul>
      )}
      {summary.truncated && (
        <p className="text-xs text-muted-foreground" data-testid="user-assigned-work-truncated">
          {t('console.assignedWork.truncated')}
        </p>
      )}
      {summary.unreadable.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="user-assigned-work-unreadable">
          {t('console.assignedWork.unreadable', { objects: summary.unreadable.map(objectText).join(', ') })}
        </p>
      )}
    </div>
  );
}

function TransferReportView({
  report,
  objectText,
}: {
  report: AssignedWorkTransferReport;
  objectText: (name: string) => string;
}) {
  const { t } = useObjectTranslation();
  const failures = report.objects.flatMap((o) => o.failures.map((f) => ({ ...f, object: o.object })));
  return (
    <div className="grid gap-1" role="status" data-testid="user-assigned-work-report">
      <p>{t('console.assignedWork.report', { updated: report.updated, failed: report.failed, remaining: report.remaining })}</p>
      {failures.length > 0 && (
        <ul className="grid gap-0.5 text-xs text-destructive">
          {failures.map((f) => (
            <li key={`${f.object}.${f.id}`} data-testid="user-assigned-work-failure">
              {t('console.assignedWork.failure', { object: objectText(f.object), id: f.id, message: f.message })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
