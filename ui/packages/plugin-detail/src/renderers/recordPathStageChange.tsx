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
 * ## The fields a stage needs (`collectFields`, objectstack#35891, #35956)
 *
 * The header's stage menu (`RecordStageMenu`) asks for more than a yes: a
 * stage that makes other fields required — a field whose `requiredWhen` holds
 * once the record stands on it and is empty now, such as a loss reason on
 * 「失败」 — asks for just those fields, and the move and their values go in
 * ONE write. Both halves are the shared in-place fill-in of `@object-ui/fields`
 * (objectstack#35956): `collectRequiredWhenPromptFields` picks the fields and
 * `RequiredFieldsDialog` collects them, the same pair the list cell, the
 * record page's inline Save and the board use, so this surface keeps no copy
 * of its own. Which fields to ask for is presentation; the server still judges
 * the write (objectui#6868: it is the only validation authority on this
 * surface). A refusal stays in the dialog and the stage does not move: a
 * reason that names a field shown is drawn under it, one that names a field
 * the reader may fill adds that field, any other reads at the dialog's foot.
 * A stage that needs nothing opens the same dialog as the move's confirmation.
 * `record:path` leaves the option off and keeps its plain confirmation.
 *
 * The fields asked are judged against the record AS IT STANDS, on every
 * render, not frozen at the pick (objectstack#36036). A 409 re-reads the
 * record, and the re-read row reaches this hook later through the record
 * context (the page's refresh is a bus notice, not a fetch it can await), so
 * the list follows that row when it lands: a field another writer filled in
 * the meantime leaves the dialog, the move no longer sends it, and a value the
 * reader typed for it stops counting toward the fields it would chain in. When
 * nothing is left, the dialog is the move's confirmation again.
 *
 * ## The flows a move starts (objectstack#35928)
 *
 * Both confirmations name the flows the move would start, under their
 * sentence, through `../stageChangeStarts` — the reader the list cell's
 * confirm shares, so the two surfaces cannot disagree. The server judges which
 * flows start; a read that fails or answers none leaves the sentence alone.
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
} from '@object-ui/components';
import {
  getRecordDisplayName,
  resolveFieldAffordance,
  stateMachineNextValues,
} from '@object-ui/core';
import {
  collectRequiredWhenPromptFields,
  hasFieldEditWidget,
  RequiredFieldsDialog,
  type RequiredFieldsDialogField,
  type RequiredWhenPromptField,
} from '@object-ui/fields';
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
import { isConcurrentUpdateError } from '../ConcurrentUpdateDialog';
import { useDetailTranslation } from '../useDetailTranslation';
import { StageChangeStarts, useRecordUpdateStarts } from '../stageChangeStarts';

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

/**
 * A pending move: the stage, and the fields its dialog asked for at the pick.
 * The dialog asks what the CURRENT record needs (`fieldsNeededAt` at render);
 * the pick-time list only names the fields a re-read has since filled.
 */
type StageTarget = { value: unknown; label: string; fields: RequiredWhenPromptField[] };

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
  const { fieldLabel, translateOptions } = useSafeFieldLabel();
  const { language } = useObjectTranslation();
  const [target, setTarget] = React.useState<StageTarget | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [refusal, setRefusal] = React.useState<string[] | null>(null);

  const objectName = ctx?.objectName;
  const recordId = ctx?.recordId;
  const dataSource = ctx?.dataSource;
  const objectSchema = ctx?.objectSchema;
  const objectFields = (objectSchema as { fields?: Record<string, unknown> } | null | undefined)?.fields;
  const fieldDef = statusField ? fieldDefOf(objectSchema, statusField) : undefined;
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

  const record = (ctx?.data ?? {}) as Record<string, unknown>;
  const stored = statusField ? record[statusField] : undefined;
  const reachable = statusField ? stateMachineNextValues(objectSchema, statusField, stored) : null;
  const admits = (value: unknown): boolean => reachable === null || reachable.has(String(value));

  // A field this reader may fill in the stage dialog: the question the record
  // page's other in-place editors ask of a field (`InlineEditSaveBar`'s
  // fill-in asks the same one).
  const fillable = (name: string, def: Record<string, unknown>): boolean =>
    name !== statusField
    && def.readonly !== true
    && !isComputedDetailField(undefined, def as FieldDef)
    && !NON_EDITABLE_SYSTEM_FIELDS.has(name)
    && !!objectName
    && resolveFieldAffordance('recordEdit', perms, objectName, name);

  // The empty fields the move makes required, judged by the shared prompt
  // (`@object-ui/fields`, objectstack#35956): the evaluator the form and the
  // server share, as the engine's transition gate judges the write.
  const fieldsNeededAt = (value: unknown): RequiredWhenPromptField[] =>
    collectFields && statusField
      ? collectRequiredWhenPromptFields(objectFields, record, { [statusField]: value }, { fillable })
      : [];

  const request = (stage: { value: unknown; label: string }) => {
    setRefusal(null);
    setTarget({ value: stage.value, label: stage.label, fields: fieldsNeededAt(stage.value) });
  };

  // objectstack#35928 — the flows the pending move would start, named under
  // the confirm's sentence by the shared reader the list cell's confirm uses.
  const starts = useRecordUpdateStarts(
    target && pressable && statusField && objectName
      ? { object: objectName, recordId: String(recordId), changes: { [statusField]: target.value } }
      : null,
  );

  const labelOf = (field: string): string => {
    const declared = fieldDefOf(objectSchema, field)?.label;
    const fallback = declared == null ? field : String(pickLocalized(declared as Parameters<typeof pickLocalized>[0], language) ?? field);
    return objectName ? fieldLabel(objectName, field, fallback) : fallback;
  };

  const ifMatchOf = (): { ifMatch: string } | undefined => {
    const updatedAt = record.updated_at;
    return typeof updatedAt === 'string' ? { ifMatch: updatedAt } : undefined;
  };

  // `record:path`: a yes, then the move alone; a refusal reads under the rail.
  const confirm = async () => {
    const stage = target;
    setTarget(null);
    if (!stage || !pressable || !admits(stage.value)) return;
    setBusy(true);
    try {
      await updateVia(dataSource, objectName!, recordId!, { [statusField!]: stage.value }, ifMatchOf());
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

  // `collectFields`: the move and the typed values in ONE write, from the
  // shared dialog. A rejection keeps the dialog open: a refusal that names
  // fields goes to the dialog as it came (each reason under its field, a
  // fillable field it names joins the dialog); every other refusal reads as
  // this surface's own line at the dialog's foot. The stage does not move.
  const submitWithFields = async (stage: StageTarget, values: Record<string, unknown>) => {
    if (!pressable || !admits(stage.value)) {
      setTarget(null);
      return;
    }
    setBusy(true);
    try {
      await updateVia(dataSource, objectName!, recordId!, { ...values, [statusField!]: stage.value }, ifMatchOf());
    } catch (err) {
      const concurrent = isConcurrentUpdateError(err);
      if (concurrent) await ctx?.refresh?.();
      const named = concurrent ? [] : (extractFieldErrors(err) ?? []).filter((e) => !!e.message);
      if (named.length > 0 && !declaredUserMessage(err)) throw err;
      const line = stageRefusalLines(err, statusField!, labelOf, t).join(' ');
      throw Object.assign(new Error(line), { userMessage: line });
    } finally {
      setBusy(false);
    }
    setTarget(null);
    await ctx?.refresh?.();
  };

  const dialog = collectFields
    ? renderFieldsDialog()
    : (
      <AlertDialog open={target !== null} onOpenChange={(open) => { if (!open) setTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('detail.pathStageChangeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('detail.pathStageChangeDescription', { stage: target?.label ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <StageChangeStarts flows={starts} />
          <AlertDialogFooter>
            <AlertDialogCancel>{t('detail.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void confirm(); }}>
              {t('detail.pathStageChangeConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );

  /**
   * The header menu's dialog: the shared `RequiredFieldsDialog` the list cell,
   * the record page's inline Save and the board open (objectstack#35956). It
   * names the record and the move, then the fields the move needs — none for
   * most stages, when it is the move's confirmation and opens on its button,
   * so Enter confirms (objectstack#35891).
   */
  function renderFieldsDialog(): React.ReactNode {
    if (!target || !statusField) return null;
    const stage = target;
    const objectKey = objectName ?? '';
    const label = (f: RequiredWhenPromptField): RequiredFieldsDialogField => {
      const opts = f.def.options;
      const localized = objectKey && Array.isArray(opts) ? translateOptions(objectKey, f.name, opts) : opts;
      return { ...f, def: { ...f.def, ...(localized ? { options: localized } : {}) }, label: labelOf(f.name) };
    };
    const exclude = [statusField];
    // What the record as it stands needs. After a 409 re-read this is the
    // re-read row's answer: a field another writer filled is gone, so the
    // dialog neither shows nor sends it (it sends only the fields it shows).
    const asked = fieldsNeededAt(stage.value);
    // A value the reader typed for a field asked at the pick and no longer
    // asked is not sent, so it must not ask for the fields it would chain in
    // either: the write leaves the stored value standing, and the chain is
    // judged against what the write leaves.
    const noLongerAsked = new Set(
      stage.fields.filter((f) => !asked.some((a) => a.name === f.name)).map((f) => f.name),
    );
    const sendable = (values: Record<string, unknown>) =>
      noLongerAsked.size === 0 ? values : Object.fromEntries(Object.entries(values).filter(([k]) => !noLongerAsked.has(k)));
    return (
      <RequiredFieldsDialog
        // A new pick is a new collection: the dialog's typed values reset.
        key={String(stage.value)}
        open
        fields={asked.map(label)}
        submitting={busy}
        recordName={getRecordDisplayName(objectSchema, record)}
        changes={[{ name: statusField, label: labelOf(statusField), value: stage.label }]}
        moreFields={(values) => collectRequiredWhenPromptFields(
          objectFields,
          record,
          { ...sendable(values), [statusField]: stage.value },
          { exclude, fillable },
        ).map(label)}
        refusalField={(name) => {
          const def = objectFields?.[name] as Record<string, unknown> | undefined;
          if (!def || typeof def !== 'object' || name === statusField) return null;
          if (!hasFieldEditWidget(def.type as string | undefined) || !fillable(name, def)) return null;
          return label({ name, def: { name, ...def } });
        }}
        // The stage field and an object-level (`_record`) reason read alone,
        // as `stageRefusalLines` reads them; another field by its label.
        labelOf={(name) => (name !== statusField && objectFields?.[name] ? labelOf(name) : undefined)}
        title={t('detail.pathStageChangeTitle')}
        description={asked.length > 0
          ? t('detail.stageMenuFieldsDescription', { stage: stage.label })
          : t('detail.pathStageChangeDescription', { stage: stage.label })}
        notice={<StageChangeStarts flows={starts} />}
        submitLabel={t('detail.pathStageChangeConfirm')}
        onCancel={() => setTarget(null)}
        onSubmit={(values) => submitWithFields(stage, values)}
      />
    );
  }

  return { pressable, admits, busy, refusal, request, dialog };
}
