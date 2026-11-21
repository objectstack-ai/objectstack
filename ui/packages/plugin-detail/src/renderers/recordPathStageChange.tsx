/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:path`'s stage press, behind the block's `allowStageChange` opt-in
 * (`RecordPathProps.allowStageChange`, objectstack#28061).
 *
 * The path stays a readout unless three things hold: the author set
 * `allowStageChange: true`, the record is stored and its data source can update
 * it, and the reader may edit `statusField` on THIS record. The last is the
 * question the record page's other in-place editors ask of a field
 * (`HeaderHighlight`, `DetailSection`): the page's edit session may edit the
 * record (`useInlineEdit().canEdit`, the page host's record-level verdict), the
 * field is not read-only or computed, and the caller's `recordEdit` field grant
 * holds — row-scoped when the block sits inside `RecordFieldAccessForRecord`,
 * which `RecordPathRenderer` mounts for exactly this. While the edit session
 * holds a draft the path is a readout again: that draft's Save is the record's
 * one pending write.
 *
 * A press asks for confirmation, then writes `{ [statusField]: value }` through
 * `updateVia`, the update path `InlineEditSaveBar` uses, with the record's
 * `updated_at` as the `ifMatch` concurrency token, and re-reads the record.
 *
 * Which moves are legal is the SERVER's call: the object's `state_machine`
 * rule (ADR-0020), required fields and edit rights are judged on the write. A
 * refusal is shown in place, under the rail — the server's own sentences
 * first, a fixed line only when it sent none.
 *
 * What the path OFFERS follows the same machine the record form, the grid's
 * inline editor and the board read (`stateMachineNextValues`): a stage the
 * field's blocking `state_machine` rule cannot reach from the STORED value is
 * drawn as a readout, not a button, so the press never promises a move the
 * server is bound to refuse. The default record page turns this block's press
 * on (objectstack#30075), which is why an always-refused button would reach
 * every app with a machine on its stage field. A field without such a rule
 * offers every stage, and the server still judges each write.
 *
 * ## The fields a stage needs (`collectFields`, objectstack#35891)
 *
 * The header's stage menu (`RecordStageMenu`) asks for more than a yes: a
 * stage that makes other fields required — a field whose `requiredWhen` holds
 * once the record stands on it and is empty now, such as a loss reason on
 * 「失败」 — opens the confirmation with just those fields, and the move and
 * their values go in ONE write. Which fields to ask for is presentation; the
 * server still judges the write (objectui#6868: it is the only validation
 * authority on this surface). A refusal that names fields the reader may fill
 * keeps the form open with those fields added and each one's reason beside
 * it, and the stage does not move. `record:path` leaves the option off and
 * keeps its plain confirmation.
 */

import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from '@object-ui/components';
import {
  isMissingForRequired,
  resolveFieldAffordance,
  resolveFieldRuleState,
  stateMachineNextValues,
} from '@object-ui/core';
import { usePermissions } from '@object-ui/permissions';
import {
  declaredUserMessage,
  delegationScopeMessage,
  extractFieldErrors,
  extractWriteErrorMessage,
  isExternalWriteRefusal,
  isPermissionError,
  useInlineEdit,
  useRecordContext,
  useSafeFieldLabel,
} from '@object-ui/react';
import { pickLocalized, useObjectTranslation } from '@object-ui/i18n';
import { isComputedDetailField } from '../fieldEnrichment';
import { NON_EDITABLE_SYSTEM_FIELDS } from '../systemFields';
import { updateVia } from '../InlineEditSaveBar';
import { InlineFieldInput } from '../InlineFieldInput';
import { enrichDetailField } from '../fieldEnrichment';
import { isConcurrentUpdateError } from '../ConcurrentUpdateDialog';
import { useDetailTranslation } from '../useDetailTranslation';

/** The field a server refusal names when its rule declares no field. */
const RECORD_LEVEL_FIELD = '_record';

type Translate = (key: string, opts?: Record<string, unknown>) => string;

/**
 * The lines a refused stage write shows, in the order a reader needs them.
 *
 *   1. A 409 `CONCURRENT_UPDATE`: the record moved under the reader. The record
 *      is re-read, so the line says so rather than repeating a server string.
 *   2. Text the producer marked for the end user (`userMessage`), verbatim.
 *   3. A field-scoped refusal (`VALIDATION_FAILED` with `fields[]`, which is
 *      how an illegal `state_machine` transition and a missing required field
 *      arrive): one line per entry. An entry about `statusField` itself, or an
 *      object-level `_record` entry, reads alone; any other field is prefixed
 *      with its label, since the reader cannot see that field on the path.
 *   4. A write the object's external datasource does not admit
 *      (`EXTERNAL_WRITE_FORBIDDEN`, ADR-0015): the read-only line. No
 *      permission lifts it, so it is asked before the permission check.
 *   5. A permission refusal: the delegated-admin scope reason when there is
 *      one, else a fixed line — a raw 403 string is never shown.
 *   6. Anything else: the server's message, else a fixed line.
 */
export function stageRefusalLines(
  err: unknown,
  statusField: string,
  labelOf: (field: string) => string,
  t: Translate,
): string[] {
  if (isConcurrentUpdateError(err)) return [t('detail.pathStageChangeConflict')];
  const declared = declaredUserMessage(err);
  if (declared) return [declared];
  const fieldLines = (extractFieldErrors(err) ?? [])
    .filter((e) => !!e.message)
    .map((e) =>
      e.field === statusField || e.field === RECORD_LEVEL_FIELD ? e.message : `${labelOf(e.field)}: ${e.message}`,
    );
  if (fieldLines.length > 0) return fieldLines;
  if (isExternalWriteRefusal(err)) return [t('form.readOnlyExternalSource')];
  if (isPermissionError(err)) return [delegationScopeMessage(err) ?? t('detail.pathStageChangeDenied')];
  return [extractWriteErrorMessage(err) ?? t('detail.pathStageChangeFailed')];
}

/** The members of an object definition's field entry this module reads. */
type FieldDef = {
  type?: unknown;
  readonly?: unknown;
  required?: unknown;
  label?: unknown;
  visibleWhen?: any;
  readonlyWhen?: any;
  requiredWhen?: any;
};

const fieldDefOf = (objectSchema: unknown, field: string): FieldDef | undefined =>
  (objectSchema as { fields?: Record<string, FieldDef | undefined> } | null | undefined)?.fields?.[field];

const canUpdate = (ds: unknown): boolean => {
  const d = ds as Record<string, unknown> | null | undefined;
  return typeof d?.update === 'function' || typeof d?.updateOne === 'function' || typeof d?.patch === 'function';
};

export interface StageChange {
  /** Whether this reader may press a stage of this record's path. */
  pressable: boolean;
  /**
   * Whether the field's blocking `state_machine` admits a move from the
   * stored value to `value` — `true` for every value when no such rule
   * governs the field. Only meaningful while `pressable`.
   */
  admits: (value: unknown) => boolean;
  /** A write is in flight. */
  busy: boolean;
  /** The last refusal's lines, until the next press. */
  refusal: string[] | null;
  /** Ask to move the record to `stage` (opens the confirmation). */
  request: (stage: { value: unknown; label: string }) => void;
  /** The confirmation dialog; render it once, beside the rails. */
  dialog: React.ReactNode;
}

export interface StageChangeOptions {
  /**
   * Ask, in the confirmation, for the fields the target stage needs filled
   * (see "The fields a stage needs" above). Off for `record:path`.
   */
  collectFields?: boolean;
}

/** A pending move: the stage, and the fields its confirmation asks for. */
type StageTarget = { value: unknown; label: string; fields: string[] };

export function useStageChange(
  allowStageChange: boolean,
  statusField: string | undefined,
  options: StageChangeOptions = {},
): StageChange {
  const collectFields = options.collectFields === true;
  const ctx = useRecordContext();
  const inline = useInlineEdit();
  const perms = usePermissions();
  const { t } = useDetailTranslation();
  const { fieldLabel } = useSafeFieldLabel();
  const { language } = useObjectTranslation();
  const [target, setTarget] = React.useState<StageTarget | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [refusal, setRefusal] = React.useState<string[] | null>(null);
  // The confirmation's own fields (`collectFields`): their values, and the
  // server's reason for each one it refused on the last try.
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [formLines, setFormLines] = React.useState<string[] | null>(null);

  const objectName = ctx?.objectName;
  const recordId = ctx?.recordId;
  const dataSource = ctx?.dataSource;
  const fieldDef = statusField ? fieldDefOf(ctx?.objectSchema, statusField) : undefined;
  const pressable =
    allowStageChange
    && !!statusField
    && !!objectName
    && recordId != null && recordId !== ''
    && !!ctx?.data
    && canUpdate(dataSource)
    && !!inline?.canEdit
    && !inline.editing
    && fieldDef?.readonly !== true
    && !isComputedDetailField(undefined, fieldDef)
    && !NON_EDITABLE_SYSTEM_FIELDS.has(statusField)
    && resolveFieldAffordance('recordEdit', perms, objectName, statusField);

  const stored = statusField ? (ctx?.data as Record<string, unknown> | undefined)?.[statusField] : undefined;
  const reachable = statusField ? stateMachineNextValues(ctx?.objectSchema, statusField, stored) : null;
  const admits = (value: unknown): boolean => reachable === null || reachable.has(String(value));

  // A field this reader may fill in the confirmation: the same question the
  // record page's other in-place editors ask of a field.
  const fillable = (field: string): boolean => {
    const def = fieldDefOf(ctx?.objectSchema, field);
    return !!def
      && field !== statusField
      && def.readonly !== true
      && !isComputedDetailField(undefined, def)
      && !NON_EDITABLE_SYSTEM_FIELDS.has(field)
      && !!objectName
      && resolveFieldAffordance('recordEdit', perms, objectName, field);
  };

  // The empty fields whose `requiredWhen` holds once the record stands on
  // `value`, judged as the engine's transition gate judges them (the stored
  // row is `previous`), and that are shown and writable there.
  const fieldsNeededAt = (value: unknown): string[] => {
    if (!collectFields || !statusField) return [];
    const fields = (ctx?.objectSchema as { fields?: Record<string, FieldDef | undefined> } | undefined)?.fields ?? {};
    const record = (ctx?.data ?? {}) as Record<string, unknown>;
    const moved = { ...record, [statusField]: value };
    const out: string[] = [];
    for (const [name, def] of Object.entries(fields)) {
      if (!def || def.requiredWhen == null || !fillable(name)) continue;
      if (!isMissingForRequired(record[name])) continue;
      const state = resolveFieldRuleState(
        { visibleWhen: def.visibleWhen, readonlyWhen: def.readonlyWhen, requiredWhen: def.requiredWhen },
        moved,
        { required: def.required === true, readonly: def.readonly === true, name },
        record,
        undefined,
        `field '${name}'`,
      );
      if (state.visible && !state.readonly && state.required) out.push(name);
    }
    return out;
  };

  const request = (stage: { value: unknown; label: string }) => {
    setRefusal(null);
    setValues({});
    setFieldErrors({});
    setFormLines(null);
    setTarget({ value: stage.value, label: stage.label, fields: fieldsNeededAt(stage.value) });
  };

  const labelOf = (field: string): string => {
    const declared = fieldDefOf(ctx?.objectSchema, field)?.label;
    const fallback = declared == null ? field : String(pickLocalized(declared as Parameters<typeof pickLocalized>[0], language) ?? field);
    return objectName ? fieldLabel(objectName, field, fallback) : fallback;
  };

  const confirm = async () => {
    const stage = target;
    if (collectFields) return confirmWithFields(stage);
    setTarget(null);
    if (!stage || !pressable || !admits(stage.value)) return;
    setBusy(true);
    const updatedAt = (ctx?.data as Record<string, unknown> | undefined)?.updated_at;
    const ifMatch = typeof updatedAt === 'string' ? updatedAt : undefined;
    try {
      await updateVia(dataSource, objectName!, recordId!, { [statusField!]: stage.value }, ifMatch ? { ifMatch } : undefined);
      await ctx?.refresh?.();
    } catch (err) {
      setRefusal(stageRefusalLines(err, statusField!, labelOf, t));
      // A stale token means the reader is looking at an old record: show the
      // current one, so a second press is judged against what is stored.
      if (isConcurrentUpdateError(err)) await ctx?.refresh?.();
    } finally {
      setBusy(false);
    }
  };

  // `collectFields`: the move and the asked-for fields in one write. The
  // confirmation stays open until the write lands; a refusal is shown in it,
  // never only after it closed, and the stage does not move.
  const confirmWithFields = async (stage: StageTarget | null) => {
    if (!stage || !pressable || !admits(stage.value) || busy) return;
    setBusy(true);
    setFieldErrors({});
    setFormLines(null);
    const updatedAt = (ctx?.data as Record<string, unknown> | undefined)?.updated_at;
    const ifMatch = typeof updatedAt === 'string' ? updatedAt : undefined;
    const payload: Record<string, unknown> = { [statusField!]: stage.value };
    for (const field of stage.fields) {
      if (Object.prototype.hasOwnProperty.call(values, field)) payload[field] = values[field];
    }
    try {
      await updateVia(dataSource, objectName!, recordId!, payload, ifMatch ? { ifMatch } : undefined);
      setTarget(null);
      await ctx?.refresh?.();
    } catch (err) {
      // The fields the refusal names that this reader may fill join the
      // form, each with its reason; every other line reads under the form.
      const named = isConcurrentUpdateError(err) ? [] : (extractFieldErrors(err) ?? []);
      const byField: Record<string, string> = {};
      for (const e of named) {
        if (e.message && fillable(e.field)) byField[e.field] = e.message;
      }
      const asked = Object.keys(byField);
      if (asked.length > 0) {
        setTarget({ ...stage, fields: [...stage.fields, ...asked.filter((f) => !stage.fields.includes(f))] });
        setFieldErrors(byField);
      }
      const rest = asked.length > 0
        ? named.filter((e) => e.message && !(e.field in byField)).map((e) =>
          e.field === statusField || e.field === RECORD_LEVEL_FIELD ? e.message : `${labelOf(e.field)}: ${e.message}`)
        : stageRefusalLines(err, statusField!, labelOf, t);
      setFormLines(rest.length > 0 ? rest : null);
      if (isConcurrentUpdateError(err)) await ctx?.refresh?.();
    } finally {
      setBusy(false);
    }
  };

  const record = (ctx?.data ?? {}) as Record<string, unknown>;
  const staged = { ...record, ...values, ...(target && statusField ? { [statusField]: target.value } : {}) };
  const fieldsBody = collectFields && target && target.fields.length > 0 ? (
    <div className="flex flex-col gap-3" data-stage-change-fields="">
      {target.fields.map((field) => {
        const def = fieldDefOf(ctx?.objectSchema, field) as Record<string, any> | undefined;
        const enriched = enrichDetailField({ name: field, label: labelOf(field), type: def?.type ?? 'text' }, def);
        const error = fieldErrors[field];
        const id = `stage-change-field-${field}`;
        return (
          <div key={field} className="flex flex-col gap-1.5" data-stage-change-field={field}>
            <label htmlFor={id} className="text-sm font-medium">
              {labelOf(field)}
              <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
            </label>
            <div id={id}>
              <InlineFieldInput
                field={enriched}
                value={Object.prototype.hasOwnProperty.call(values, field) ? values[field] : record[field]}
                onChange={(v) => setValues((prev) => ({ ...prev, [field]: v }))}
                dataSource={dataSource}
                autoFocus={field === target.fields[0]}
                error={error}
                dependentValues={staged}
              />
            </div>
            {error && (
              <p role="alert" className="text-xs text-destructive" data-stage-change-field-error={field}>
                {error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  ) : null;

  const dialog = (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => { if (!open && !(collectFields && busy)) setTarget(null); }}
    >
      <AlertDialogContent
        onOpenAutoFocus={collectFields ? (event) => {
          // An alert dialog focuses Cancel on open. The stage menu's dialog is
          // one the reader opened by picking a stage, so Enter confirms the
          // move (objectstack#35891): focus the first field it asks for, or
          // the confirm button when it asks for none.
          const content = event.currentTarget as HTMLElement | null;
          const first = content?.querySelector<HTMLElement>(
            '[data-stage-change-fields] input, [data-stage-change-fields] textarea, [data-stage-change-fields] button, [data-stage-change-fields] [role="combobox"]',
          ) ?? content?.querySelector<HTMLElement>('[data-stage-change-confirm]');
          if (first) {
            event.preventDefault();
            first.focus();
          }
        } : undefined}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t('detail.pathStageChangeTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {fieldsBody
              ? t('detail.stageMenuFieldsDescription', { stage: target?.label ?? '' })
              : t('detail.pathStageChangeDescription', { stage: target?.label ?? '' })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {fieldsBody}
        {collectFields && formLines && (
          <div role="alert" className="flex flex-col gap-1 text-sm text-destructive" data-stage-change-refusal="">
            {formLines.map((line, i) => <p key={i}>{line}</p>)}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={collectFields && busy}>{t('detail.cancel')}</AlertDialogCancel>
          {collectFields ? (
            <Button
              type="button"
              disabled={busy}
              onClick={() => { void confirm(); }}
              data-stage-change-confirm=""
            >
              {t('detail.pathStageChangeConfirm')}
            </Button>
          ) : (
            <AlertDialogAction onClick={() => { void confirm(); }}>
              {t('detail.pathStageChangeConfirm')}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { pressable, admits, busy, refusal, request, dialog };
}
