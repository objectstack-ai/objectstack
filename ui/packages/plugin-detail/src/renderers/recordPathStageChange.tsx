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
 * rule (ADR-0020), required fields and edit rights are judged on the write, and
 * nothing here evaluates them. A refusal is shown in place, under the rail —
 * the server's own sentences first, a fixed line only when it sent none.
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
import { resolveFieldAffordance } from '@object-ui/core';
import { usePermissions } from '@object-ui/permissions';
import {
  declaredUserMessage,
  delegationScopeMessage,
  extractFieldErrors,
  extractWriteErrorMessage,
  isPermissionError,
  useInlineEdit,
  useRecordContext,
  useSafeFieldLabel,
} from '@object-ui/react';
import { pickLocalized, useObjectTranslation } from '@object-ui/i18n';
import { isComputedFieldType } from '../fieldEnrichment';
import { NON_EDITABLE_SYSTEM_FIELDS } from '../systemFields';
import { updateVia } from '../InlineEditSaveBar';
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
 *   4. A permission refusal: the delegated-admin scope reason when there is
 *      one, else a fixed line — a raw 403 string is never shown.
 *   5. Anything else: the server's message, else a fixed line.
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
  if (isPermissionError(err)) return [delegationScopeMessage(err) ?? t('detail.pathStageChangeDenied')];
  return [extractWriteErrorMessage(err) ?? t('detail.pathStageChangeFailed')];
}

const canUpdate = (ds: unknown): boolean => {
  const d = ds as Record<string, unknown> | null | undefined;
  return typeof d?.update === 'function' || typeof d?.updateOne === 'function' || typeof d?.patch === 'function';
};

export interface StageChange {
  /** Whether this reader may press a stage of this record's path. */
  pressable: boolean;
  /** A write is in flight. */
  busy: boolean;
  /** The last refusal's lines, until the next press. */
  refusal: string[] | null;
  /** Ask to move the record to `stage` (opens the confirmation). */
  request: (stage: { value: unknown; label: string }) => void;
  /** The confirmation dialog; render it once, beside the rails. */
  dialog: React.ReactNode;
}

export function useStageChange(allowStageChange: boolean, statusField: string | undefined): StageChange {
  const ctx = useRecordContext();
  const inline = useInlineEdit();
  const perms = usePermissions();
  const { t } = useDetailTranslation();
  const { fieldLabel } = useSafeFieldLabel();
  const { language } = useObjectTranslation();
  const [target, setTarget] = React.useState<{ value: unknown; label: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [refusal, setRefusal] = React.useState<string[] | null>(null);

  const objectName = ctx?.objectName;
  const recordId = ctx?.recordId;
  const dataSource = ctx?.dataSource;
  const fieldDef = statusField ? (ctx?.objectSchema as any)?.fields?.[statusField] : undefined;
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
    && !isComputedFieldType(undefined, fieldDef?.type)
    && !NON_EDITABLE_SYSTEM_FIELDS.has(statusField)
    && resolveFieldAffordance('recordEdit', perms, objectName, statusField);

  const request = React.useCallback((stage: { value: unknown; label: string }) => {
    setRefusal(null);
    setTarget(stage);
  }, []);

  const labelOf = (field: string): string => {
    const declared = (ctx?.objectSchema as any)?.fields?.[field]?.label;
    const fallback = declared == null ? field : String(pickLocalized(declared, language) ?? field);
    return objectName ? fieldLabel(objectName, field, fallback) : fallback;
  };

  const confirm = async () => {
    const stage = target;
    setTarget(null);
    if (!stage || !pressable) return;
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

  const dialog = (
    <AlertDialog open={target !== null} onOpenChange={(open) => { if (!open) setTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('detail.pathStageChangeTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('detail.pathStageChangeDescription', { stage: target?.label ?? '' })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('detail.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => { void confirm(); }}>
            {t('detail.pathStageChangeConfirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { pressable, busy, refusal, request, dialog };
}
