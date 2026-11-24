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
 * notified. And, for a person target, which related records move along
 * (objectstack#35315 phase 2): one tick per declared cascade
 * (`transferBehavior: 'cascade'` on a child's reference field) whose child
 * offers Change Owner and on which the explain engine allows the caller the
 * `transfer` operation (`useChangeOwnerCascadeCandidates`). A ticked cascade
 * moves the child records owned by the previous owner; the server reports
 * every one it did not move, and the dialog draws that report.
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
 *
 * ## Picking a queue (objectstack#36395)
 *
 * The queue target is picked the way the person is: with the shared lookup
 * widget over `sys_queue`, so the server searches and pages the queues and
 * an organization with more than one page of them can still find and pick any
 * one. The widget commits the queue's `name` (`idField: 'name'`), the value
 * the endpoint's `queue` takes; it shows the queue's label.
 *
 * ## The queues an app declares (objectstack#36807)
 *
 * A queue lives in two places (ADR-0142 D1): an organization's `sys_queue`
 * rows, and the `queue` items an installed package declares
 * (`GET /api/v1/meta/queue`, read through the console's metadata store). The
 * lookup pages `sys_queue` alone, so the declared queues — few, and read
 * whole — are offered beside it as their own choices, built by
 * `mergeQueueCandidates`, the merge every other queue picker uses. The server
 * resolves a name registry-first, so a declared queue wins a name a
 * `sys_queue` row shares: the lookup is told to leave those names out
 * (`notIn` on `name`), and each queue is offered once. Either choice commits
 * the queue's `name`. A declared read that fails offers no declared queue;
 * the lookup is untouched by it.
 */

import { Suspense, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
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
} from '@object-ui/components';
import { Loader2 } from 'lucide-react';
import { useObjectTranslation, useObjectLabel } from '@object-ui/i18n';
import { MetadataCtx, notifyDataChanged, useAdapter } from '@object-ui/react';
import { getLazyFieldWidget, mergeQueueCandidates, queueCandidateLabel, type QueueCandidate } from '@object-ui/fields';
import type { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { toast } from 'sonner';
import {
  CHANGE_OWNER_FIELD,
  cascadeKey,
  declaredOwnerLabel,
  useChangeOwnerCascadeCandidates,
  type ChangeOwnerCascadeCandidate,
  offersQueueTarget,
  ownerIdOf,
  readChangeOwnerReport,
  recordIdOf,
  type ChangeOwnerObjectDef,
} from './changeOwner.js';

/** The `user` field widget the dialog picks its person with (lazy until drawn). */
const UserWidget = getLazyFieldWidget('user');
/** The `lookup` field widget the dialog picks its queue with (lazy until drawn). */
const LookupWidget = getLazyFieldWidget('lookup');

type ClientData = ReturnType<ObjectStackAdapter['getClient']>['data'];
/** `data.changeOwnerMany`'s answer (`ChangeOwnerReport` of `@objectstack/client`). */
export type ChangeOwnerBulkReport = Awaited<ReturnType<ClientData['changeOwnerMany']>>;
/** One cascaded relationship's outcome (`ChangeOwnerCascadeOutcome` of `@objectstack/client`). */
export type ChangeOwnerCascadeOutcomeView = NonNullable<ChangeOwnerBulkReport['cascade']>[number];

/** A refused call's words: the client throws an `Error` carrying the server's message. */
function failureText(err: unknown): string {
  const message = (err as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message ? message : String(err);
}

/**
 * The queues installed packages declare (the `queue` metadata type), read from
 * the console's metadata store once `enabled` turns on. The store answers a
 * failed read with no items, so a failure offers nothing; outside a
 * `<MetadataProvider>` nothing is read. The store's context value is rebuilt
 * whenever any type it caches settles, so it is read through a ref and the
 * effect keys on its presence alone.
 */
function useDeclaredQueues(enabled: boolean): QueueCandidate[] {
  const store = useContext(MetadataCtx);
  const storeRef = useRef(store);
  storeRef.current = store;
  const present = !!store;
  const [declared, setDeclared] = useState<QueueCandidate[]>([]);
  useEffect(() => {
    const current = storeRef.current;
    if (!enabled || !current) return;
    let cancelled = false;
    current.ensureType('queue').then(
      (items) => { if (!cancelled) setDeclared(mergeQueueCandidates(items, [])); },
      () => { if (!cancelled) setDeclared([]); },
    );
    return () => { cancelled = true; };
  }, [enabled, present]);
  return declared;
}

type RunState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'refused'; message: string }
  | { phase: 'done'; report?: ChangeOwnerBulkReport; moved: number; unchanged: number; cascade?: ChangeOwnerCascadeOutcomeView[] };

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
  const { fieldLabel, objectLabel } = useObjectLabel();
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
  const [ticks, setTicks] = useState<ReadonlySet<string>>(() => new Set());
  const formId = useId();
  const cascades = useChangeOwnerCascadeCandidates(
    objectName,
    open && kind === 'person',
    // A client without the read (an older server's SDK) offers no cascade.
    adapter && typeof adapter.getClient().data?.changeOwnerCascades === 'function'
      ? (object) => adapter.getClient().data.changeOwnerCascades(object)
      : undefined,
  );
  const cascadeCandidates = cascades.phase === 'ready' ? cascades.candidates : [];

  // Each opening starts from nothing picked and nothing reported.
  useEffect(() => {
    if (!open) return;
    setKind('person');
    setPerson(null);
    setQueue('');
    setNotify(false);
    setTicks(new Set());
    setRun({ phase: 'idle' });
  }, [open]);

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

  // The declared queues, read once the queue target is shown; a name one of
  // them takes is the declared queue's, so the lookup leaves it out.
  const declaredQueues = useDeclaredQueues(open && queueOffered && kind === 'queue');
  const declaredPicked = queue !== '' && declaredQueues.some((c) => c.name === queue);

  // The queue picker reads `sys_queue` only when it is opened, one page at a
  // time, with the typed term sent to the server as its search.
  const queueLabel = t('console.changeOwner.queue');
  const queuePlaceholder = t('console.changeOwner.queuePlaceholder');
  const queueField = useMemo(() => ({
    name: 'change_owner_queue',
    type: 'lookup',
    label: queueLabel,
    reference: 'sys_queue',
    idField: 'name',
    displayField: 'label',
    allowCreate: false,
    placeholder: queuePlaceholder,
    ...(declaredQueues.length > 0
      ? { lookupFilters: [{ field: 'name', operator: 'notIn', value: declaredQueues.map((c) => c.name) }] }
      : {}),
  }), [queueLabel, queuePlaceholder, declaredQueues]);

  const submit = async () => {
    if (!adapter || !target || ids.length === 0) return;
    const cascade = cascadeCandidates
      .filter((c) => ticks.has(cascadeKey(c)))
      .map((c) => ({ object: c.object, field: c.field }));
    const request = target.queue !== undefined
      ? { queue: target.queue }
      : { ownerId: target.ownerId!, ...(notify ? { notify: true } : {}), ...(cascade.length > 0 ? { cascade } : {}) };
    setRun({ phase: 'running' });
    try {
      const data = adapter.getClient().data;
      if (!bulk) {
        const result = await data.changeOwner(objectName, ids[0]!, request);
        notifyDataChanged({ objectName, recordId: ids[0]! });
        for (const c of result.cascade ?? []) notifyDataChanged({ objectName: c.object });
        // A cascade that left anything behind is drawn, never toasted away.
        if (result.cascade?.some((c) => c.failed > 0 || c.remaining > 0 || c.readFailure)) {
          setRun({ phase: 'done', moved: 1, unchanged: 0, cascade: result.cascade });
          return;
        }
        toast.success(t('console.changeOwner.changed'));
        onOpenChange(false);
        return;
      }
      const report = await data.changeOwnerMany(objectName, ids, request);
      notifyDataChanged({ objectName });
      for (const c of report.cascade ?? []) notifyDataChanged({ objectName: c.object });
      const read = readChangeOwnerReport(report, records, target);
      setRun({ phase: 'done', report, moved: read.moved, unchanged: read.unchanged, cascade: report.cascade });
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
              {cascades.phase === 'failed' && (
                <p role="alert" className="text-xs text-destructive" data-testid="change-owner-cascades-failed">
                  {t('console.changeOwner.cascadesFailed', { message: cascades.message })}
                </p>
              )}
              {cascadeCandidates.length > 0 && (
                <fieldset className="grid gap-1.5" data-testid="change-owner-cascades">
                  <legend className="text-sm font-medium">{t('console.changeOwner.cascadeHeading')}</legend>
                  <p className="text-xs text-muted-foreground">{t('console.changeOwner.cascadeHelp')}</p>
                  {cascadeCandidates.map((c) => {
                    const key = cascadeKey(c);
                    return (
                      <label key={key} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={ticks.has(key)}
                          onCheckedChange={(v) => {
                            setTicks((prev) => {
                              const next = new Set(prev);
                              if (v === true) next.add(key); else next.delete(key);
                              return next;
                            });
                          }}
                          disabled={done}
                          data-testid={`change-owner-cascade-${key}`}
                        />
                        {t('console.changeOwner.cascadeOption', {
                          object: objectLabel({ name: c.object, label: c.label }),
                          field: fieldLabel(c.object, c.field, c.fieldLabel),
                        })}
                      </label>
                    );
                  })}
                </fieldset>
              )}
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="change_owner_queue">{t('console.changeOwner.queue')}</Label>
              <Suspense fallback={<div className="h-10 animate-pulse rounded-md bg-muted" aria-hidden="true" />}>
                <LookupWidget
                  id="change_owner_queue"
                  value={queue && !declaredPicked ? queue : null}
                  onChange={(v: unknown) => { setQueue(typeof v === 'string' ? v : ''); setRun({ phase: 'idle' }); }}
                  field={queueField}
                  disabled={done}
                />
              </Suspense>
              {declaredQueues.length > 0 && (
                <fieldset className="grid gap-1.5" data-testid="change-owner-declared-queues">
                  <legend className="text-sm font-medium">{t('console.changeOwner.declaredQueues')}</legend>
                  <RadioGroup
                    value={declaredPicked ? queue : ''}
                    onValueChange={(value) => { setQueue(value); setRun({ phase: 'idle' }); }}
                    className="grid max-h-40 gap-1.5 overflow-y-auto"
                    disabled={done}
                  >
                    {declaredQueues.map((c) => (
                      <label key={c.name} className="flex items-center gap-2 text-sm">
                        <RadioGroupItem value={c.name} data-testid={`change-owner-declared-queue-${c.name}`} />
                        {queueCandidateLabel(c)}
                      </label>
                    ))}
                  </RadioGroup>
                </fieldset>
              )}
            </div>
          )}

          {run.phase === 'refused' && (
            <p role="alert" className="text-sm text-destructive" data-testid="change-owner-refused">
              {t('console.changeOwner.refused', { message: run.message })}
            </p>
          )}

          {run.phase === 'done' && run.report && (
            <ChangeOwnerReportView report={run.report} moved={run.moved} unchanged={run.unchanged} />
          )}
          {run.phase === 'done' && run.cascade && run.cascade.length > 0 && (
            <ChangeOwnerCascadeReportView outcomes={run.cascade} candidates={cascadeCandidates} />
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

/**
 * [objectstack#35315 phase 2] A cascade's answer, one paragraph per ticked
 * relationship: how many related records moved, every one the server did not
 * move with its own sentence, how many the row cap left with the previous
 * owner, and a relationship whose records could not be read at all.
 */
export function ChangeOwnerCascadeReportView({
  outcomes,
  candidates = [],
}: {
  outcomes: ReadonlyArray<ChangeOwnerCascadeOutcomeView>;
  /** The offered relationships, for the labels the child serves. */
  candidates?: ReadonlyArray<ChangeOwnerCascadeCandidate>;
}) {
  const { t } = useObjectTranslation();
  const { fieldLabel, objectLabel } = useObjectLabel();
  return (
    <div className="grid gap-2 text-sm" role="status" data-testid="change-owner-cascade-report">
      {outcomes.map((o) => {
        const offered = candidates.find((c) => c.object === o.object && c.field === o.field);
        const names = {
          object: objectLabel({ name: o.object, label: offered?.label ?? o.object }),
          field: fieldLabel(o.object, o.field, offered?.fieldLabel ?? o.field),
        };
        return (
          <div key={`${o.object}.${o.field}`} className="grid gap-0.5" data-testid={`change-owner-cascade-outcome-${o.object}.${o.field}`}>
            <p>{t('console.changeOwner.cascadeReport', { ...names, moved: o.updated, failed: o.failed })}</p>
            {o.readFailure && (
              <p className="text-xs text-destructive">
                {t('console.changeOwner.cascadeReadFailure', { ...names, message: o.readFailure.message })}
              </p>
            )}
            {o.remaining > 0 && (
              <p className="text-xs text-muted-foreground">{t('console.changeOwner.cascadeRemaining', { count: o.remaining })}</p>
            )}
            {o.failures.length > 0 && (
              <ul className="grid max-h-32 gap-0.5 overflow-y-auto text-xs text-destructive">
                {o.failures.map((f) => (
                  <li key={f.id} data-testid="change-owner-cascade-failure">
                    {t('console.changeOwner.failure', { id: f.id, message: f.message })}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
