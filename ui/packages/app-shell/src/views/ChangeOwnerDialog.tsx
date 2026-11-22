/**
 * ChangeOwnerDialog — the Change Owner action's one dialog (objectstack#35403),
 * opened by the record page's header action, by the default form's owner line
 * and, for two or more records, by a list's selection bar.
 *
 * ## What it asks
 *
 * The new owner, under the object's OWN label for its owner field ("Assigned
 * To", "Person", …): a person, or — where the object carries the ownership
 * queue column (ADR-0142 D3) — a queue. Optionally, that the new person is
 * notified. Cascade to related records is a later phase and is not offered.
 *
 * ## What it calls, and as whom
 *
 * The Change Owner endpoint, through `@objectstack/client`'s
 * `data.changeOwner` (one record) and `data.changeOwnerMany` (a list), as the
 * signed-in user. The server is the only judge: a record the caller may not
 * move comes back refused, and a bulk call reports every row it did not move
 * with the server's own code and sentence. The dialog computes no verdict of
 * its own.
 *
 * ## A person who already owns it (carried nit N1)
 *
 * The endpoint admits a change to the record's current owner as an echo and
 * counts it as updated. The dialog never says such a record "moved": on one
 * record, the current owner is left out of the picker and, if named anyway,
 * Change Owner stays off with the reason beside it; in a bulk report, a row
 * the list read with that owner already reads "already had this owner"
 * (`readChangeOwnerReport`).
 */

import { Suspense, useEffect, useId, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import { Loader2 } from 'lucide-react';
import { useObjectTranslation, useObjectLabel } from '@object-ui/i18n';
import { notifyDataChanged, useAdapter } from '@object-ui/react';
import { getLazyFieldWidget } from '@object-ui/fields';
import type { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { toast } from 'sonner';
import {
  CHANGE_OWNER_FIELD,
  declaredOwnerLabel,
  offersQueueTarget,
  ownerIdOf,
  readChangeOwnerReport,
  recordIdOf,
  type ChangeOwnerObjectDef,
} from './changeOwner.js';

/** The `user` field widget the dialog picks its person with (lazy until drawn). */
const UserWidget = getLazyFieldWidget('user');

type ClientData = ReturnType<ObjectStackAdapter['getClient']>['data'];
/** `data.changeOwnerMany`'s answer (`ChangeOwnerReport` of `@objectstack/client`). */
export type ChangeOwnerBulkReport = Awaited<ReturnType<ClientData['changeOwnerMany']>>;

/** A refused call's words: the client throws an `Error` carrying the server's message. */
function failureText(err: unknown): string {
  const message = (err as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message ? message : String(err);
}

type RunState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'refused'; message: string }
  | { phase: 'done'; report: ChangeOwnerBulkReport; moved: number; unchanged: number };

type QueueState =
  | { phase: 'loading' }
  | { phase: 'failed'; message: string }
  | { phase: 'ready'; queues: Array<{ name: string; label: string }> };

export interface ChangeOwnerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The object the records belong to, as the Console serves it. */
  objectDef: ChangeOwnerObjectDef;
  /**
   * The records to hand over, as their surface read them (each with its id,
   * and its `owner_id` where the surface has it). One record calls
   * `data.changeOwner`; two or more call `data.changeOwnerMany`.
   */
  records: ReadonlyArray<Record<string, unknown>>;
  /** Selected records the switch's `visibleWhen` left out (bulk only); said, never dropped silently. */
  skipped?: number;
}

export function ChangeOwnerDialog({ open, onOpenChange, objectDef, records, skipped = 0 }: ChangeOwnerDialogProps) {
  const { t } = useObjectTranslation();
  const { fieldLabel } = useObjectLabel();
  const adapter = useAdapter() as ObjectStackAdapter | null;
  const objectName = String(objectDef?.name ?? '');
  const bulk = records.length !== 1;
  const ids = useMemo(() => records.map(recordIdOf).filter((id): id is string => id !== undefined), [records]);
  const currentOwner = bulk ? undefined : ownerIdOf(records[0]?.[CHANGE_OWNER_FIELD]);
  const queueOffered = offersQueueTarget(objectDef);
  const ownerLabel = fieldLabel(objectName, CHANGE_OWNER_FIELD, declaredOwnerLabel(objectDef) ?? t('console.changeOwner.ownerFallback'));

  const [kind, setKind] = useState<'person' | 'queue'>('person');
  const [person, setPerson] = useState<unknown>(null);
  const [queue, setQueue] = useState<string>('');
  const [notify, setNotify] = useState(false);
  const [run, setRun] = useState<RunState>({ phase: 'idle' });
  const [queues, setQueues] = useState<QueueState>({ phase: 'loading' });
  const formId = useId();

  // Each opening starts from nothing picked and nothing reported.
  useEffect(() => {
    if (!open) return;
    setKind('person');
    setPerson(null);
    setQueue('');
    setNotify(false);
    setRun({ phase: 'idle' });
  }, [open]);

  // The queues are read when the queue target is first chosen, never on open.
  useEffect(() => {
    if (!open || kind !== 'queue' || queues.phase === 'ready') return;
    let live = true;
    setQueues({ phase: 'loading' });
    void (async () => {
      try {
        if (!adapter) throw new Error(t('console.changeOwner.noClient'));
        const result = await adapter.find('sys_queue', { $top: 200 });
        const rows = Array.isArray(result?.data) ? result.data : [];
        const read = rows
          .map((r: any) => ({ name: typeof r?.name === 'string' ? r.name : '', label: typeof r?.label === 'string' && r.label ? r.label : String(r?.name ?? '') }))
          .filter((q) => q.name !== '');
        if (live) setQueues({ phase: 'ready', queues: read });
      } catch (err) {
        if (live) setQueues({ phase: 'failed', message: failureText(err) });
      }
    })();
    return () => { live = false; };
    // `queues.phase` is read to skip a second read, not to re-run on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, adapter]);

  const personId = ownerIdOf(person);
  const echo = !bulk && personId !== undefined && personId === currentOwner;
  const target = kind === 'queue'
    ? (queue ? { queue } : null)
    : (personId && !echo ? { ownerId: personId } : null);
  const done = run.phase === 'done';
  const canSubmit = !!adapter && !!target && ids.length > 0 && run.phase !== 'running' && !done;

  const pickerField = useMemo(() => ({
    name: 'change_owner_target',
    type: 'user',
    label: ownerLabel,
    // One record: its current owner is not a new owner, so it is not offered.
    ...(currentOwner ? { lookupFilters: [{ field: 'id', operator: 'ne', value: currentOwner }] } : {}),
  }), [ownerLabel, currentOwner]);

  const submit = async () => {
    if (!adapter || !target || ids.length === 0) return;
    const request = target.queue !== undefined
      ? { queue: target.queue }
      : { ownerId: target.ownerId!, ...(notify ? { notify: true } : {}) };
    setRun({ phase: 'running' });
    try {
      const data = adapter.getClient().data;
      if (!bulk) {
        await data.changeOwner(objectName, ids[0]!, request);
        notifyDataChanged({ objectName, recordId: ids[0]! });
        toast.success(t('console.changeOwner.changed'));
        onOpenChange(false);
        return;
      }
      const report = await data.changeOwnerMany(objectName, ids, request);
      notifyDataChanged({ objectName });
      const read = readChangeOwnerReport(report, records, target);
      setRun({ phase: 'done', report, moved: read.moved, unchanged: read.unchanged });
    } catch (err) {
      setRun({ phase: 'refused', message: failureText(err) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (run.phase !== 'running') onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md" data-testid="change-owner-dialog">
        <DialogHeader>
          <DialogTitle>{t('console.changeOwner.title')}</DialogTitle>
          <DialogDescription>
            {bulk
              ? t('console.changeOwner.descriptionBulk', { count: ids.length })
              : t('console.changeOwner.descriptionRecord')}
          </DialogDescription>
        </DialogHeader>

        <form
          id={formId}
          className="grid gap-4"
          onSubmit={(event) => { event.preventDefault(); void submit(); }}
        >
          {skipped > 0 && (
            <p className="text-sm text-muted-foreground" data-testid="change-owner-skipped">
              {t('console.changeOwner.skipped', { count: skipped })}
            </p>
          )}

          {queueOffered && (
            <RadioGroup
              value={kind}
              onValueChange={(value) => { setKind(value === 'queue' ? 'queue' : 'person'); setRun({ phase: 'idle' }); }}
              className="flex gap-4"
              disabled={done}
              data-testid="change-owner-kind"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="person" data-testid="change-owner-kind-person" />
                {t('console.changeOwner.targetPerson')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="queue" data-testid="change-owner-kind-queue" />
                {t('console.changeOwner.targetQueue')}
              </label>
            </RadioGroup>
          )}

          {kind === 'person' ? (
            <div className="grid gap-2">
              <Label htmlFor="change_owner_target">{ownerLabel}</Label>
              <Suspense fallback={<div className="h-10 animate-pulse rounded-md bg-muted" aria-hidden="true" />}>
                <UserWidget
                  id="change_owner_target"
                  value={person}
                  onChange={(v: unknown) => { setPerson(v); setRun({ phase: 'idle' }); }}
                  field={pickerField}
                  disabled={done}
                />
              </Suspense>
              {echo && (
                <p className="text-xs text-muted-foreground" data-testid="change-owner-already-owner">
                  {t('console.changeOwner.alreadyOwner')}
                </p>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={notify}
                  onCheckedChange={(v) => setNotify(v === true)}
                  disabled={done}
                  data-testid="change-owner-notify"
                />
                {t('console.changeOwner.notify')}
              </label>
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="change_owner_queue">{t('console.changeOwner.queue')}</Label>
              {queues.phase === 'loading' && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  {t('console.changeOwner.queuesLoading')}
                </p>
              )}
              {queues.phase === 'failed' && (
                <p role="alert" className="text-sm text-destructive" data-testid="change-owner-queues-failed">
                  {t('console.changeOwner.queuesFailed', { message: queues.message })}
                </p>
              )}
              {queues.phase === 'ready' && queues.queues.length === 0 && (
                <p className="text-sm text-muted-foreground" data-testid="change-owner-no-queues">
                  {t('console.changeOwner.noQueues')}
                </p>
              )}
              {queues.phase === 'ready' && queues.queues.length > 0 && (
                <Select value={queue} onValueChange={(v) => { setQueue(v); setRun({ phase: 'idle' }); }} disabled={done}>
                  <SelectTrigger id="change_owner_queue" data-testid="change-owner-queue">
                    <SelectValue placeholder={t('console.changeOwner.queuePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {queues.queues.map((q) => (
                      <SelectItem key={q.name} value={q.name}>{q.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {run.phase === 'refused' && (
            <p role="alert" className="text-sm text-destructive" data-testid="change-owner-refused">
              {t('console.changeOwner.refused', { message: run.message })}
            </p>
          )}

          {run.phase === 'done' && (
            <ChangeOwnerReportView report={run.report} moved={run.moved} unchanged={run.unchanged} />
          )}
        </form>

        <DialogFooter>
          {done ? (
            <Button type="button" onClick={() => onOpenChange(false)} data-testid="change-owner-close">
              {t('console.changeOwner.close')}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={run.phase === 'running'}>
                {t('console.changeOwner.cancel')}
              </Button>
              <Button
                type="submit"
                form={formId}
                disabled={!canSubmit}
                aria-busy={run.phase === 'running' || undefined}
                data-testid="change-owner-submit"
              >
                {run.phase === 'running' && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
                {run.phase === 'running' ? t('console.changeOwner.submitting') : t('console.changeOwner.submit')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A bulk answer: how many moved, how many already had the owner, how many did
 * not move — and each row that did not, with the server's own sentence. Every
 * failure the server listed is drawn; none is sampled.
 */
export function ChangeOwnerReportView({
  report,
  moved,
  unchanged,
}: {
  report: ChangeOwnerBulkReport;
  moved: number;
  unchanged: number;
}) {
  const { t } = useObjectTranslation();
  return (
    <div className="grid gap-1 text-sm" role="status" data-testid="change-owner-report">
      <p>{t('console.changeOwner.report', { moved, unchanged, failed: report.failed })}</p>
      {report.failures.length > 0 && (
        <ul className="grid max-h-48 gap-0.5 overflow-y-auto text-xs text-destructive">
          {report.failures.map((f) => (
            <li key={f.id} data-testid="change-owner-failure">
              {t('console.changeOwner.failure', { id: f.id, message: f.message })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
