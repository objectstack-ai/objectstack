/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Progress,
  ScrollArea,
} from '@object-ui/components';
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/react';
import { getLazyFieldWidget } from '@object-ui/fields';
// The two shared allow-tables of widgets that are fed the dialog's own
// in-progress values as their record — one definition each for this dialog, the
// single-record action dialog and the object form (objectui#4770 / objectui#4815).
// Their TSDoc carries the rationale that used to be repeated in each copy.
// See `paramNeedsDependentValues` below for why this surface ORs them;
// ⛔ never copied into a local literal, and ⛔ never merged into one set.
import { CASCADE_OPTION_WIDGET_TYPES, EXPANDABLE_FIELD_TYPES, declaredNameField, getRecordDisplayName, recordDisplayValueAt } from '@object-ui/core';
import type { BulkActionDef, BulkActionParam } from '@object-ui/types';
import { useBulkExecutor, type BulkExecutorOptions, type BulkResult } from '../hooks/useBulkExecutor';
import { hasMultiValueShape, type MultiValueFieldDef } from '../hooks/multiValueFields';
import {
  bulkParamToField,
  fieldNeedsDataSource,
  isLookupishParam,
  lookupTargetObject,
} from './bulkParamToField';
import { unresolvedFieldOf } from '../resolveBulkActions';
import { bulkConfirmTextSource } from './bulkConfirmText';

/**
 * The name the confirm step lists an affected record by (objectui#13107).
 *
 * The resolver's own ladder (`getRecordDisplayName`, ADR-0079) for an object
 * that declares no `nameField`. For one that does, the declared field or the
 * resolver's `Record #<id>` floor, never a derived one: when the row lacks
 * the declared value (a projection that did not ask for it, a value the
 * principal may not read), the derive steps would name the record by another
 * text field, and a contact's job title is not the record a write targets.
 * The floor is the resolver's own, reached with nothing left to derive from.
 */
function affectedRecordName(objectDef: unknown, row: Record<string, unknown>, fallback: string): string {
  const nameField = declaredNameField(objectDef);
  if (typeof nameField !== 'string' || nameField === '' || recordDisplayValueAt(row, nameField)) {
    return getRecordDisplayName(objectDef, row, { fallback });
  }
  return getRecordDisplayName(undefined, { id: row.id ?? row._id }, { fallback, deriveFromRecordKeys: false });
}

export interface BulkActionDialogProps {
  /** The action being executed. */
  def: BulkActionDef | null;
  /** Selected records to operate on. */
  rows: Array<Record<string, unknown>>;
  /** Object resource name (passed to the executor + lookup loader). */
  resource: string;
  /**
   * Data source used by the executor and threaded into the lookup/user param
   * widgets (candidate search) + the confirm step's id→label resolution.
   */
  dataSource: BulkExecutorOptions['dataSource'] & {
    find?: (
      resource: string,
      query?: Record<string, unknown>,
    ) => Promise<{ data?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>;
    // ⚠️ The id is a `string`, not `string | number` (objectui#9511). This is a
    // hand-restated face, so it does not follow `DataSource` on its own — and
    // because it declares `findOne` as a PROPERTY rather than a method, it is
    // checked contravariantly, which is why narrowing the protocol reddened
    // here while the bivariant method declarations upstream stayed quiet.
    findOne?: (
      resource: string,
      id: string,
      params?: Record<string, unknown>,
    ) => Promise<Record<string, unknown> | null>;
  };
  /** Open state. */
  open: boolean;
  /** Close handler — invoked on Cancel, on overlay click, or after Done. */
  onClose: (result?: BulkResult | null) => void;
  /**
   * Object definition for `resource` — what the confirm step names each
   * affected record by (objectui#12332). Read only through the ONE ADR-0079
   * resolver, `getRecordDisplayName` (`nameField`, then the legacy ladder),
   * the resolver the delete confirm and the record header use. A row with no
   * resolvable title reads `Record #<id>`, marked as an id.
   *
   * Replaces a `labelKey` prop that defaulted to `'name'` and that no caller
   * ever set, so an object titled by any other field listed raw ids.
   */
  objectDef?: unknown;
  /**
   * Object-schema `fields` map for `resource`. Used to derive single- vs
   * multi-value semantics for `update` params whose author did not declare
   * `multiple` explicitly (#2204): a param aimed at a multiselect / tags /
   * checkboxes field — or a select / lookup / user / file / image field
   * flagged `multiple: true` — renders the multi-select control and patches
   * an array, instead of silently degrading to single-select + scalar.
   */
  objectFields?: Record<string, MultiValueFieldDef>;
  /**
   * Per-record dispatcher for a def PROMOTED from an object action
   * (objectui#3002) — see {@link BulkExecutorOptions.runAction}. The dialog's
   * params → confirm steps are what let one action run over N records without
   * the runner re-prompting per record.
   */
  runAction?: BulkExecutorOptions['runAction'];
  /**
   * Whole-selection dispatcher for a def with `execution: 'aggregate'`
   * (objectui#3139) — see {@link BulkExecutorOptions.runAggregate}. Same
   * params/confirm collection as `runAction`, but the executor calls this
   * exactly once with every eligible row instead of once per record.
   */
  runAggregate?: BulkExecutorOptions['runAggregate'];
  /**
   * Selected records the def's `visible` predicate excluded (objectui#3067).
   * `rows` already has them removed; this is what lets the confirm step say
   * the run covers fewer records than the user picked, instead of quietly
   * shrinking the selection.
   */
  skippedCount?: number;
}

type Step = 'params' | 'confirm' | 'running' | 'result';

interface LookupOption {
  value: string;
  label: string;
}

/**
 * 4-step bulk action dialog. Resolves param values, lets the user confirm the
 * impact, executes via useBulkExecutor, then displays a success/failure
 * summary with a downloadable error list when applicable.
 */
export const BulkActionDialog: React.FC<BulkActionDialogProps> = ({
  def,
  rows,
  resource,
  dataSource,
  open,
  onClose,
  objectDef,
  objectFields,
  runAction,
  runAggregate,
  skippedCount = 0,
}) => {
  const { t } = useObjectTranslation();
  const params = def?.params ?? [];

  // Effective multi-value semantics for an `update` param: an explicit
  // `param.multiple` wins; when the author omitted it, fall back to the
  // target field's own schema so a multi-value column never silently gets
  // a single-select control + scalar patch (#2204). Non-update operations
  // pass params to a handler (not a field patch), so schema fallback does
  // not apply there.
  const isParamMultiple = useCallback((p: BulkActionParam): boolean => {
    if (typeof p.multiple === 'boolean') return p.multiple;
    if (def?.operation !== 'update') return false;
    return hasMultiValueShape(objectFields?.[p.name]);
  }, [def?.operation, objectFields]);
  const initialParamValues = useMemo<Record<string, unknown>>(() => {
    const v: Record<string, unknown> = {};
    for (const p of params) {
      if (p.default !== undefined) v[p.name] = p.default;
    }
    return v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def?.name]);

  const [step, setStep] = useState<Step>('params');
  const [values, setValues] = useState<Record<string, unknown>>(initialParamValues);
  // Confirm-step display labels for picker params: param name → id → label.
  // Resolved lazily (findOne per selected id) when the user reaches the
  // confirm step — the params step needs no preloaded option list because the
  // picker widgets fetch their own candidates (#3064).
  const [lookupLabels, setLookupLabels] = useState<Record<string, Record<string, string>>>({});
  const { run, undo, retry, progress, result, reset } = useBulkExecutor({ resource, dataSource, objectFields, runAction, runAggregate });
  const [retrying, setRetrying] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoneAt, setUndoneAt] = useState<number | null>(null);

  // #2185 — keep the dialog open when the user dismisses a nested Radix popper
  // (the Status <Select> dropdown or a ComboBox <Popover>) by clicking away from
  // it. Radix leaves the dialog overlay at pointer-events:auto while marking the
  // dialog body pointer-events:none, so that click lands on the backdrop and
  // Radix's DismissableLayer would tear the whole dialog down. We can't detect
  // the open popper inside the dialog's onInteractOutside handler — by the time
  // it runs, Radix has already unmounted the popper (verified: popper is present
  // at capture-phase pointerdown but gone by bubble). So we snapshot "was a
  // popper open?" on the capture-phase pointerdown and let the guards below read
  // that snapshot instead of the (already stale) live DOM.
  const popperOpenAtPointerDown = useRef(false);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = () => {
      popperOpenAtPointerDown.current = !!document.querySelector(
        '[data-radix-popper-content-wrapper] [data-state="open"]',
      );
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  // Reset internal state whenever the dialog re-opens for a different action.
  useEffect(() => {
    if (!open) return;
    reset();
    setValues(initialParamValues);
    setLookupLabels({});
    setUndoneAt(null);
    setUndoing(false);
    setRetrying(null);
    // Skip params step when nothing to collect.
    setStep(params.length === 0 ? 'confirm' : 'params');
  }, [open, def?.name, initialParamValues, params.length, reset]);

  // Resolve picker-param ids into display labels for the confirm step. The
  // widgets show labels while picking, but the committed value is just id(s);
  // a failed or impossible resolution silently falls back to showing the raw
  // id — purely cosmetic, so no error surface needed here.
  useEffect(() => {
    if (step !== 'confirm') return;
    if (typeof dataSource.findOne !== 'function') return;
    let cancelled = false;
    (async () => {
      const updates: Record<string, Record<string, string>> = {};
      for (const p of params) {
        const target = lookupTargetObject(p);
        if (!isLookupishParam(p) || !target) continue;
        const v = values[p.name];
        const ids = (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(String);
        for (const id of ids) {
          if (lookupLabels[p.name]?.[id]) continue;
          try {
            const rec = await dataSource.findOne!(target, id);
            if (!rec) continue;
            const labelField = typeof p.labelField === 'string' ? p.labelField : undefined;
            const label =
              (labelField ? rec[labelField] : undefined)
              ?? rec.name ?? rec.full_name ?? rec.email;
            if (label != null) (updates[p.name] ??= {})[id] = String(label);
          } catch {
            // Leave the id unresolved; describeValue falls back to the raw id.
          }
        }
      }
      if (!cancelled && Object.keys(updates).length > 0) {
        setLookupLabels(prev => {
          const next = { ...prev };
          for (const [name, labels] of Object.entries(updates)) {
            next[name] = { ...next[name], ...labels };
          }
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const paramsValid = useMemo(() => {
    for (const p of params) {
      // [objectui#12105] A promoted param whose backing field the shared
      // resolver could not find is refused below, so it can never be filled:
      // the run is blocked, as the single-record dialog blocks its submit,
      // rather than dispatched without a value nobody could supply.
      if (unresolvedFieldOf(p)) return false;
      if (p.required) {
        const v = values[p.name];
        if (v === undefined || v === null || v === '') return false;
        if (Array.isArray(v) && v.length === 0) return false;
      }
    }
    return true;
  }, [params, values]);

  // Resolve a param value into a human-readable string for the confirm step:
  // maps select/lookup ids back to their labels, joins multi-value arrays, and
  // renders booleans/empties sensibly (a raw `String(v)` would show ids and
  // `[object Object]`).
  const describeValue = useCallback((param: BulkActionParam | undefined, v: unknown): string => {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return '—';
    if (typeof v === 'boolean') return v ? t('grid.yes', { defaultValue: 'Yes' }) : t('grid.no', { defaultValue: 'No' });
    const optSource: LookupOption[] = param && isLookupishParam(param)
      ? Object.entries(lookupLabels[param.name] ?? {}).map(([value, label]) => ({ value, label }))
      : (param?.options ?? []).map(o => ({ value: String(o.value), label: String(o.label) }));
    const labelOf = (x: unknown) => optSource.find(o => o.value === String(x))?.label ?? String(x);
    return Array.isArray(v) ? v.map(labelOf).join(', ') : labelOf(v);
  }, [t, lookupLabels]);

  const maxRecords = def?.maxRecords ?? Infinity;
  const overLimit = rows.length > maxRecords;
  /**
   * [objectui#4420] Nothing survived the eligibility fold.
   *
   * The dialog still OPENS on an all-excluded selection — that is the ruled
   * shape for the built-in Delete (maintainer, 2026-08-17): "a legible
   * refusal, not a hidden button whose absence is unexplained". What it must
   * not do is offer to run: `Affected records (0)` beside an enabled Run
   * button reads as a live operation, and pressing it reports
   * `Succeeded 0 / 0` — a success panel for a run that never had a subject.
   * The skipped notice above already carries the WHY, so the refusal needs no
   * new copy, only a control that declines.
   *
   * Deliberately `rows.length`, not "skipped > 0": a run over zero records is
   * meaningless for every def, however the selection got here.
   */
  const noEligibleRows = rows.length === 0;

  const handleRun = useCallback(async () => {
    if (!def) return;
    setStep('running');
    await run(def, rows, values);
    setStep('result');
  }, [def, rows, values, run]);

  const downloadErrors = useCallback(() => {
    if (!result?.errors?.length) return;
    const header = 'record_id,error_message';
    const csv = [header, ...result.errors.map(e =>
      `${e.id},"${e.error.replace(/"/g, '""')}"`,
    )].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bulk_errors_${def?.name ?? 'action'}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, def?.name]);

  // Undo is only meaningful for `update` runs where at least one row landed.
  // For delete / custom we never captured a snapshot, so the executor will
  // refuse the undo — but we hide the button up-front to avoid dead UI.
  const canUndo =
    !!def
    && def.operation === 'update'
    && !!result
    && result.succeeded > 0
    && undoneAt === null;

  const handleUndo = useCallback(async () => {
    setUndoing(true);
    try {
      const undoResult = await undo();
      if (undoResult) {
        setUndoneAt(Date.now());
      }
    } finally {
      setUndoing(false);
    }
  }, [undo]);

  const handleRetry = useCallback(
    async (rowId: string) => {
      setRetrying(rowId);
      try {
        await retry(rowId);
      } finally {
        setRetrying(null);
      }
    },
    [retry],
  );

  if (!def) return null;

  const title = def.label ?? def.name;
  const previewRows = rows.slice(0, 5);
  const restCount = Math.max(0, rows.length - previewRows.length);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(result); }}>
      <DialogContent
        className="max-w-md"
        // If the outside interaction that reached the dialog was really the user
        // dismissing an open nested popper (see popperOpenAtPointerDown above),
        // swallow it: the popper's own DismissableLayer already closed the
        // dropdown, so the first click away just dismisses it and the dialog
        // stays put. A genuine backdrop click (no popper open) still closes the
        // dialog normally. (#2185)
        onPointerDownOutside={(e) => {
          if (popperOpenAtPointerDown.current) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (popperOpenAtPointerDown.current) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === 'running' && <Loader2 className="h-4 w-4 animate-spin" />}
            {title}
          </DialogTitle>
          {step === 'confirm' && (
            <DialogDescription>
              {bulkConfirmTextSource(def.confirmText) ?? t('grid.bulk.confirmDefault', { count: rows.length, defaultValue: `This will apply to ${rows.length} record(s).` })}
            </DialogDescription>
          )}
        </DialogHeader>

        {step === 'params' && (
          <div className="space-y-3">
            {params.map(p => {
              // [objectui#12105] The refusal comes FIRST, ahead of
              // `bulkParamToField`, which would otherwise build a widget from
              // the placeholder type the resolver fell back to — the same order,
              // and the same copy, as app-shell's `ActionParamDialog`.
              const unresolved = unresolvedFieldOf(p);
              if (unresolved) {
                return (
                  <div key={p.name} className="space-y-1.5">
                    <Label className="text-xs">{p.label ?? p.name}</Label>
                    <div
                      role="alert"
                      data-testid={`bulk-param-unresolved-${p.name}`}
                      className="grid gap-1 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive"
                    >
                      <p>
                        {t('actionDialog.unresolvedParam', {
                          defaultValue:
                            'This parameter cannot be shown: the field it is backed by is missing from the object metadata, so the control it needs cannot be built. Ask an administrator to fix the action definition.',
                        })}
                      </p>
                      {/* An identifier, rendered verbatim in every locale. */}
                      <p className="font-mono">{unresolved}</p>
                    </div>
                  </div>
                );
              }
              return (
                <ParamField
                  key={p.name}
                  param={p}
                  multiple={isParamMultiple(p)}
                  value={values[p.name]}
                  // The WHOLE in-progress record, not only this row's value: an
                  // option widget's per-option `visibleWhen` is resolved against
                  // it, so a sibling param's value can narrow this param's
                  // offered list (objectui#4757).
                  values={values}
                  dataSource={dataSource}
                  onChange={(v) => setValues(prev => ({ ...prev, [p.name]: v }))}
                />
              );
            })}
          </div>
        )}

        {step === 'confirm' && (
          <div className="space-y-3 text-sm">
            {overLimit && (
              <div className="rounded-md bg-destructive/10 text-destructive px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  {t('grid.bulk.overLimit', {
                    count: rows.length,
                    limit: maxRecords,
                    defaultValue: `Selection (${rows.length}) exceeds the action limit (${maxRecords}). Reduce the selection to proceed.`,
                  })}
                </div>
              </div>
            )}
            <div className="text-muted-foreground">
              {t('grid.bulk.affectedRecords', { count: rows.length, defaultValue: `Affected records (${rows.length}):` })}
            </div>
            {/* [#3067] The selection shrank because this action's `visible`
                excluded some records. Say it here rather than let the count
                silently disagree with what the user ticked. */}
            {skippedCount > 0 && (
              <div className="text-muted-foreground text-xs" data-testid="bulk-skipped-notice">
                {t('grid.bulk.skippedIneligible', {
                  count: skippedCount,
                  defaultValue: `${skippedCount} selected record(s) are not eligible for this action and will be skipped.`,
                })}
              </div>
            )}
            <ScrollArea className="max-h-32 rounded border bg-muted/30 p-2">
              <ul className="text-xs space-y-1">
                {previewRows.map((r, i) => (
                  <li key={String(r.id ?? i)} className="break-words">
                    • {affectedRecordName(objectDef, r, t('grid.bulk.rowFallback', { index: i + 1, defaultValue: `Row ${i + 1}` }))}
                  </li>
                ))}
                {restCount > 0 && (
                  <li className="text-muted-foreground">
                    {t('grid.bulk.andMore', { count: restCount, defaultValue: `… and ${restCount} more` })}
                  </li>
                )}
              </ul>
            </ScrollArea>
            {Object.keys(values).length > 0 && (
              <div className="rounded border bg-muted/30 p-2 text-xs space-y-0.5">
                {Object.entries(values).map(([k, v]) => {
                  const p = params.find(x => x.name === k);
                  return (
                    <div key={k}>
                      <span className="text-muted-foreground">{p?.label ?? k}:</span> {describeValue(p, v)}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {step === 'running' && (
          <div className="space-y-2">
            <Progress value={progress.total ? (progress.done + progress.failed) / progress.total * 100 : 0} />
            <div className="text-xs text-muted-foreground text-center">
              {t('grid.bulk.processed', {
                count: progress.done + progress.failed,
                total: progress.total,
                defaultValue: `${progress.done + progress.failed} / ${progress.total} processed`,
              })}
              {progress.failed > 0 && t('grid.bulk.processedFailed', { count: progress.failed, defaultValue: ` · ${progress.failed} failed` })}
            </div>
          </div>
        )}

        {step === 'result' && result && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              {result.failed === 0 ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              )}
              <span>
                {undoneAt !== null ? t('grid.bulk.undonePrefix', { defaultValue: 'Undone — ' }) : ''}
                {t('grid.bulk.succeeded', {
                  count: result.succeeded,
                  total: result.total,
                  defaultValue: `Succeeded ${result.succeeded} / ${result.total}`,
                })}
                {result.failed > 0 && t('grid.bulk.resultFailed', { count: result.failed, defaultValue: ` · Failed ${result.failed}` })}
              </span>
            </div>
            {result.errors.length > 0 && (
              <>
                <ScrollArea className="max-h-48 rounded border bg-destructive/5 p-2" data-testid="bulk-error-inspector">
                  <ul className="text-xs space-y-1.5">
                    {result.errors.map(e => (
                      <li
                        key={e.id}
                        className="flex items-start gap-2"
                        data-testid={`bulk-error-row-${e.id}`}
                      >
                        <XCircle className="h-3 w-3 mt-0.5 shrink-0 text-destructive" />
                        <div className="min-w-0 flex-1">
                          <div className="break-words">
                            <span className="text-muted-foreground">{e.id}:</span> {e.error}
                          </div>
                        </div>
                        {/* A plain `custom` callout has nothing to re-run, but
                            a PROMOTED def (#3002) re-dispatches its object
                            action for that one record — same as update/delete.
                            An aggregate def (#3139) has no per-row slice to
                            re-attempt: the whole-run re-run is the retry (a
                            total failure keeps the selection for exactly that),
                            so the button is hidden — the executor's retry()
                            refuses it anyway. */}
                        {(def.operation !== 'custom' || !!def.actionDef)
                          && def.execution !== 'aggregate' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1.5 text-[10px] shrink-0"
                            onClick={() => handleRetry(e.id)}
                            disabled={retrying === e.id}
                            data-testid={`bulk-error-retry-${e.id}`}
                          >
                            {retrying === e.id ? '…' : t('grid.bulk.retry', { defaultValue: 'Retry' })}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
                <Button variant="outline" size="sm" onClick={downloadErrors}>
                  {t('grid.bulk.downloadErrorCsv', { defaultValue: 'Download error CSV' })}
                </Button>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'params' && (
            <>
              <Button variant="ghost" onClick={() => onClose()}>{t('grid.bulk.cancel', { defaultValue: 'Cancel' })}</Button>
              <Button onClick={() => setStep('confirm')} disabled={!paramsValid}>{t('grid.bulk.next', { defaultValue: 'Next' })}</Button>
            </>
          )}
          {step === 'confirm' && (
            <>
              <Button variant="ghost" onClick={() => params.length ? setStep('params') : onClose()}>
                {params.length ? t('grid.bulk.back', { defaultValue: 'Back' }) : t('grid.bulk.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button
                variant={def.variant === 'danger' ? 'destructive' : 'default'}
                onClick={handleRun}
                disabled={overLimit || noEligibleRows}
              >
                {def.confirmLabel ?? t('grid.bulk.run', { defaultValue: 'Run' })}
              </Button>
            </>
          )}
          {step === 'running' && (
            <Button variant="ghost" disabled>
              {t('grid.bulk.running', { defaultValue: 'Running…' })}
            </Button>
          )}
          {step === 'result' && (
            <>
              {canUndo && (
                <Button
                  variant="outline"
                  onClick={handleUndo}
                  disabled={undoing}
                  data-testid="bulk-undo-button"
                >
                  {undoing ? t('grid.bulk.undoing', { defaultValue: 'Undoing…' }) : t('grid.bulk.undo', { defaultValue: 'Undo' })}
                </Button>
              )}
              <Button onClick={() => onClose(result)}>{t('grid.bulk.done', { defaultValue: 'Done' })}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface ParamFieldProps {
  param: BulkActionParam;
  /** Effective multi-value semantics — explicit `param.multiple` or the target field's schema (#2204). */
  multiple: boolean;
  value: unknown;
  onChange: (v: unknown) => void;
  /** Threaded into picker widgets (lookup/user) for candidate search. */
  dataSource: BulkActionDialogProps['dataSource'];
  /**
   * ALL of the dialog's in-progress param values — not just this row's. They
   * are the record an option widget resolves its per-option `visibleWhen`
   * against (objectui#4757, the bulk landing site of objectui#3765's Option B
   * ruling); see {@link CASCADE_OPTION_WIDGET_TYPES}.
   */
  values: Record<string, unknown>;
}

/**
 * One param row: label → shared form field widget → help text. The widget is
 * the SAME component the object form (and ActionParamDialog, ADR-0059) renders
 * for that field type, resolved via `bulkParamToField` + `getLazyFieldWidget`
 * — so a `lookup` param gets the searchable record picker with its own
 * loading/error/empty states (#3064) and a `sys_user` target gets the form's
 * PeoplePicker. Widgets stay lazy behind `<Suspense>` so opening a dialog only
 * loads the widgets its params actually use.
 */
/**
 * Which widgets in this dialog are handed the dialog's live record as
 * `dependentValues` — and the reason is not one rule but TWO, over overlapping
 * families, exactly as the object form already splits them (`form.tsx`'s
 * `needsDataSourceWiring` line beside its `CASCADE_OPTION_WIDGET_TYPES` line)
 * and as the single-record dialog does since objectui#8672 ruling A.
 *
 * 1. **Option widgets** — {@link CASCADE_OPTION_WIDGET_TYPES}. Their OFFERED
 *    SET is re-resolved against the record (`visibleWhen`, `dependsOn` gating)
 *    by the shared evaluator. This half has been supplied here since
 *    objectui#4757.
 * 2. **Reference-bearing pickers** — {@link EXPANDABLE_FIELD_TYPES}. They have
 *    no options list to narrow; they narrow a QUERY. `LookupField` turns the
 *    field's declared `dependsOn` into a hard `$filter` (`dependentFilter` →
 *    `popoverFilter` / `baseFilter`, feeding the quick-select popover, the
 *    Level-2 table picker and PeoplePicker alike) and gates the trigger while a
 *    named parent is still empty. objectui#8755 wires this half up here, the
 *    third and last surface that reads the option set.
 *
 * ⭐ **Why this is a consistency fix and not a new authoring route.** `dependsOn`
 * was ALREADY a live, honoured key on a `BulkActionParam`: `bulkParamToField`
 * does not destructure it out, so it rides `...extra` onto the field bag, and
 * the option widgets above have read it through `useCascadingOptions` all
 * along. Family 2 read the same key off the same bag and was never handed the
 * record, so a bulk lookup param declaring `dependsOn` rendered a trigger
 * disabled FOREVER — prompting for the very param the user had just filled.
 * Retiring the key (ADR-0049 enforce-or-remove, the other disposition
 * objectui#8755 weighed) would have deleted a shipping capability, because one
 * of the two families that read it works.
 *
 * ⚠️ **The bulk param schema does NOT license the key, and must not be cited as
 * if it did.** `@objectstack/spec`'s `BulkActionParamSchema` "accepts"
 * `dependsOn` — and accepts a nonsense key in the same breath, because it is not
 * strict; its strict sibling `ActionParamSchema` refuses both. That accept is a
 * NULL reading, measured with both controls in
 * `__tests__/bulkLookupDependsOnReach-8755.test.tsx` leg B. Whether the key
 * should become authorable BY CONTRACT on this surface by closing that schema
 * is upstream of this repo and is left open there. The other route this
 * sentence used to name — the field-backed one `resolveActionParams` gives the
 * single-record dialog — now exists for a PROMOTED action's params
 * (objectui#12105, `resolvePromotedBulkParams`): a field that declares
 * `dependsOn` hands it to the bulk param exactly as it does on the record page.
 * An AUTHORED `bulkActionDefs[].params` entry still has no such route.
 *
 * ⭐ **Why this is not `CASCADE_OPTION_WIDGET_TYPES.add('lookup')`.** That set is
 * shared verbatim with the object form's cascade-CLEAR loop and with
 * `ActionParamDialog`, and its members mean one specific thing: "this widget's
 * offered OPTION set is re-resolved by `resolveCascadingOptions`". A lookup's is
 * not — it has no option set. So the families stay separate and this surface ORs
 * them. ⛔ Never `new Set([...A, ...B])` — a copy re-forks a shared table.
 *
 * ⚠️ `EXPANDABLE_FIELD_TYPES` is read over WIDGET keys here (the output of
 * `bulkParamToField`, i.e. `resolveBulkParamWidgetType`), the same coincidence
 * the form and the single-record dialog document: each reference type maps onto
 * a same-named widget id. `tree` resolves to `lookup` before it reaches this
 * test, so that member is inert here. A picker that degraded to `text` for want
 * of a declared `object` target is a `text` widget by then, and correctly gets
 * nothing.
 */
function paramNeedsDependentValues(widgetType: string): boolean {
  return (
    CASCADE_OPTION_WIDGET_TYPES.has(widgetType) || EXPANDABLE_FIELD_TYPES.has(widgetType)
  );
}

const ParamField: React.FC<ParamFieldProps> = ({ param, multiple, value, onChange, dataSource, values }) => {
  const id = `bulk-param-${param.name}`;
  const field = useMemo(() => bulkParamToField(param, multiple), [param, multiple]);
  // getLazyFieldWidget caches per type, and the useMemo keeps the reference
  // hook-stable for a given param (react-hooks/static-components).
  const Widget = useMemo(() => getLazyFieldWidget(field.type), [field.type]);
  // Only picker widgets receive the dataSource — the simple widgets spread
  // unknown props toward the DOM.
  const dataSourceProps = fieldNeedsDataSource(field) ? { dataSource } : {};
  // The dialog's own in-progress values ARE the record its option predicates
  // are resolved against (objectui#4757 — the bulk landing site of the ruling
  // taken on objectui#3765, "the dialog is a small form", implemented for the
  // single-record dialog in PR objectui#4756). Until this prop existed the bulk
  // dialog passed nothing, so `useCascadingOptions` resolved the EMPTY record
  // — and a `visibleWhen` written against a sibling PARAM could never see the
  // value the user had just picked in this same dialog. The shared evaluator is
  // untouched: this is the supply half that was missing.
  //
  // ⚠️ That fall-through used to be written here as reaching "whatever record
  // the HOST GRID PAGE happened to publish". No page published one, and none
  // could: the chain ended `?? ctx.formValues ?? ctx.data` while
  // `SchemaRendererContextType` declares exactly `dataSource` / `debug` /
  // `debugFlags` / `apiFetch`, so those two links were unsettable rather than
  // merely unset. They were retired under ADR-0049 enforce-or-remove
  // (objectui#7206): `useCascadingOptions` now reads `dependentValues ?? {}`,
  // and this prop is the only channel that can carry a record.
  //
  // Bulk is where the ruling costs least, which is why it needed no separate
  // decision. An action dialog over N selected rows has NO single row record to
  // compete with — `rows` is a selection, and no per-row scope was ever offered
  // to these predicates — so "the dialog's values are the record" is not a
  // choice between two records here; it is the only record there has ever been.
  // A predicate naming a column the dialog has no param for (`record.owner_id`)
  // stays unresolvable, which `resolveVisibleOptions` fails OPEN: the option is
  // offered, never wrongly hidden.
  //
  // ⭐ objectui#8755 — the record now reaches the reference-bearing PICKERS too,
  // not only the option widgets. WHICH record is the same one and for the same
  // reason: this dialog holds no row at all, so its `values` are its whole
  // equivalent of the grid's `ctx.pendingRow ?? ctx.row` (objectui#7165/#7188),
  // with no second candidate to rank against it. ⛔ Nothing about the cascade
  // itself is implemented here — `LookupField`'s `dependentFilter` chain was
  // always live and host-independent; this line supplies the one INPUT no host
  // could otherwise deliver. WHICH widgets, and why two rules rather than one,
  // is `paramNeedsDependentValues` above.
  const cascadeProps = paramNeedsDependentValues(field.type)
    ? { dependentValues: values }
    : {};

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-xs">
          {param.label ?? param.name}
          {/* Visual-only (objectui#3299, aligned with app-shell's
              `ActionParamDialog` in objectui#3967): the required STATE is
              announced through `aria-required` on the control below. This
              `*` sits inside a `<Label htmlFor>`, so without `aria-hidden`
              accname folds it into the referenced control's name and every
              required bulk param announces as "Label asterisk". */}
          {param.required && <span className="text-destructive ml-0.5" aria-hidden="true">*</span>}
        </Label>
      </div>
      <Suspense fallback={<div className="h-9 w-full animate-pulse rounded-md bg-muted" aria-hidden="true" />}>
        {/* eslint-disable-next-line react-hooks/static-components -- getLazyFieldWidget returns a per-type cached lazy component (stable identity), not a component created during render */}
        <Widget
          id={id}
          value={value ?? null}
          onChange={onChange}
          field={field}
          // Required is a STATE, so it rides the state channel to the control
          // (objectui#3299) — deliberately NOT the native `required` attribute
          // (#3290: that arms the browser's constraint bubble alongside this
          // dialog's own `missing`/Next gating — two validators, one field).
          // `param.required` is otherwise live only in the dialog's own
          // pre-submit gate, so before this the control announced no required
          // state at all. Widgets forward `aria-*` by prefix through their
          // `toDomProps` whitelist, so it reaches the rendered control; none of
          // them derives it from `field.required`. `|| undefined` keeps an
          // optional param free of the attribute entirely (not `"false"`),
          // matching `ActionParamDialog`.
          aria-required={param.required || undefined}
          {...dataSourceProps}
          {...cascadeProps}
        />
      </Suspense>
      {param.help && <p className="text-[11px] text-muted-foreground">{param.help}</p>}
    </div>
  );
};
