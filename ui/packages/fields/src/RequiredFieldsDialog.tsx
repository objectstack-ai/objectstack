/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The small collect-then-save dialog an in-place change opens when it makes
 * other fields required — objectui#4254 (the kanban drop), made shared by
 * objectstack#35956 so a list cell and the record page's inline edit open the
 * same one. The host decides WHEN to open it (`collectRequiredWhenPromptFields`
 * returned fields) and owns the write; this dialog collects the values.
 *
 * ## What it shows
 *
 * The record's name, then the change that set this off as read-only rows
 * (`changes`, e.g. 「销售阶段：赢单」), then one row per field to fill. Save
 * hands the host the typed values, and the host writes them together with the
 * change in ONE write; Cancel writes nothing.
 *
 * ## Chained requirements
 *
 * A value typed here can make one more field required (`moreFields`): it joins
 * the dialog at once, nothing is saved half-way, and Save waits for it too.
 *
 * ## A refusal stays in the dialog
 *
 * When the host's `onSubmit` rejects (someone else changed the record, a rule
 * the prompt could not foresee), the dialog stays open and says why: a reason
 * naming a field shown here is drawn under that field; one naming another
 * field the reader can fill adds that field (`refusalField`); every other
 * reason is listed at the foot. A host whose `onSubmit` settles its own
 * failures (the kanban board's toast and rollback) simply never rejects.
 *
 * ## Not a mini-form
 *
 * Every control here is {@link FieldEditWidget}, i.e. the SAME widget the
 * record form renders for that field type (its own header: "the SAME dedicated
 * widgets the form renders"), which is also what the data grid's inline editor
 * and the detail page's inline edit compose. So a select edits as a select, a
 * date as a date picker, a boolean as a checkbox — without a second set of
 * field-rendering decisions that could drift from the form's.
 *
 * The validation is the same one definition too: `isMissingForRequired` from
 * `@object-ui/core`, the presence contract the form and the server share, so
 * this dialog cannot decide a value is "empty" in a way the server would
 * disagree with (a `false` boolean and a `0` are values, not absences).
 *
 * ## Copy
 *
 * Through `useSafeTranslate` — the per-call `tt(key, fallback)` channel — so a
 * host with no `I18nProvider` mounted (a standalone board, a package's tests,
 * the preview gallery) reads English instead of a raw key. The host may pass
 * its own `title`, `description` and `submitLabel` (the board keeps its
 * 「移动卡片」).
 *
 * ## Nothing to fill
 *
 * A host may open it with no fields (the record header's stage menu, whose
 * every move goes through this dialog): it is then the change's confirmation,
 * the record and the change above Cancel and Save, and Save takes the focus.
 * A refusal naming a field the reader can fill still adds that field.
 */

import React from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@object-ui/components';
import {
  useSafeTranslate,
  declaredUserMessage,
  extractFieldErrors,
  extractWriteErrorMessage,
} from '@object-ui/react';
import { isMissingForRequired } from '@object-ui/core';
import { FieldEditWidget } from './FieldEditWidget.js';
import type { RequiredWhenPromptField } from './requiredWhenPrompt.js';

/** A prompt field with its display label already resolved by the host. */
export interface RequiredFieldsDialogField extends RequiredWhenPromptField {
  label: string;
}

/** One read-only row naming a value of the change that opened the dialog. */
export interface RequiredFieldsDialogChange {
  name: string;
  label: string;
  /** The value as the reader reads it (an option's label, not its code). */
  value: string;
}

export interface RequiredFieldsDialogProps {
  open: boolean;
  /** The required-and-empty fields, in the object's declared order. */
  fields: RequiredFieldsDialogField[];
  /** Disables the controls while the host's write is in flight. */
  submitting?: boolean;
  onCancel: () => void;
  /**
   * Called with the typed values once every field shown has one. The host
   * writes them with its change; a rejection keeps the dialog open and shows
   * the reason (see the file header).
   */
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
  /** The record's display name, drawn first. */
  recordName?: string;
  /** The change that set this off, drawn read-only above the fields. */
  changes?: RequiredFieldsDialogChange[];
  /**
   * The fields the typed values make required in turn (chained requirements),
   * asked on every change of the values; shown after `fields`, de-duplicated.
   */
  moreFields?: (values: Record<string, unknown>) => RequiredFieldsDialogField[];
  /**
   * A field a refusal names that is not shown yet: the row to add for it, or
   * `null` when the reader cannot fill it here (its reason is then listed at
   * the foot).
   */
  refusalField?: (name: string) => RequiredFieldsDialogField | null;
  /** The label of a field a foot line names; `undefined` reads the reason alone. */
  labelOf?: (name: string) => string | undefined;
  title?: string;
  description?: string;
  /**
   * What the host adds about the change under the change block, read-only —
   * the record header's stage menu names the flows the move would start there
   * (objectstack#35928). Nothing is drawn for none.
   */
  notice?: React.ReactNode;
  submitLabel?: string;
}

/** The reasons a rejected submit carries: per field, and the rest. */
function refusalOf(err: unknown): { entries: Array<{ field: string; message: string }>; fallback: string | null } {
  const entries = (extractFieldErrors(err) ?? [])
    .filter((e) => typeof e.message === 'string' && e.message.length > 0)
    .map((e) => ({ field: e.field, message: e.message as string }));
  return { entries, fallback: entries.length > 0 ? null : declaredUserMessage(err) ?? extractWriteErrorMessage(err) ?? null };
}

export function RequiredFieldsDialog({
  open,
  fields,
  submitting,
  onCancel,
  onSubmit,
  recordName,
  changes,
  moreFields,
  refusalField,
  labelOf,
  title,
  description,
  notice,
  submitLabel,
}: RequiredFieldsDialogProps): React.ReactElement {
  const tt = useSafeTranslate();
  // Each change is its own collection, and that is enforced by MOUNTING rather
  // than by a reset effect: hosts render this component only while a change is
  // pending, so cancelling or saving unmounts it and the next change starts
  // from empty state. A `useEffect` re-seed would be both redundant and a
  // cascading-render hazard the lint rule correctly flags.
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  // True only after a submit attempt, so the dialog opens clean rather than
  // shouting "Required" at fields the user has not reached yet.
  const [showErrors, setShowErrors] = React.useState(false);
  // The last refusal: per-field reasons, the fields it added, the foot lines.
  const [serverErrors, setServerErrors] = React.useState<Record<string, string>>({});
  const [addedFields, setAddedFields] = React.useState<RequiredFieldsDialogField[]>([]);
  const [footLines, setFootLines] = React.useState<string[]>([]);
  const [sending, setSending] = React.useState(false);
  const busy = !!submitting || sending;
  const submitRef = React.useRef<HTMLButtonElement>(null);

  const shown: RequiredFieldsDialogField[] = [];
  const seen = new Set<string>();
  for (const f of [...fields, ...(moreFields?.(values) ?? []), ...addedFields]) {
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    shown.push(f);
  }
  const missing = shown.filter((f) => isMissingForRequired(values[f.name]));

  const presentRefusal = (err: unknown) => {
    const { entries, fallback } = refusalOf(err);
    const byField: Record<string, string> = {};
    const added: RequiredFieldsDialogField[] = [];
    const lines: string[] = [];
    for (const { field, message } of entries) {
      if (seen.has(field) || added.some((f) => f.name === field)) {
        if (!(field in byField)) byField[field] = message;
        continue;
      }
      const row = refusalField?.(field) ?? null;
      if (row) {
        added.push(row);
        byField[field] = message;
        continue;
      }
      const label = labelOf?.(field);
      const line = label ? `${label}: ${message}` : message;
      if (!lines.includes(line)) lines.push(line);
    }
    if (fallback) lines.push(fallback);
    if (entries.length === 0 && !fallback) lines.push(tt('table.saveFailed', 'Save failed'));
    setServerErrors(byField);
    setAddedFields((prev) => [...prev, ...added.filter((f) => !prev.some((p) => p.name === f.name))]);
    setFootLines(lines);
  };

  const handleSubmit = async () => {
    if (busy) return;
    if (missing.length > 0) {
      setShowErrors(true);
      return;
    }
    // Only the fields shown are sent: a value typed for a chained field that
    // a later edit made unnecessary again stays out of the write.
    const sent = Object.fromEntries(shown.map((f) => [f.name, values[f.name]]));
    setFootLines([]);
    setSending(true);
    try {
      await onSubmit(sent);
    } catch (err) {
      presentRefusal(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <DialogContent
        className="sm:max-w-md max-h-[90dvh] overflow-y-auto"
        data-testid="required-fields-dialog"
        onOpenAutoFocus={(event) => {
          // With fields to fill the first one takes focus (the default). With
          // none — a host using the dialog as the change's confirmation, the
          // record header's stage menu — Save does, so Enter confirms the
          // change the reader just picked rather than Cancel (objectstack#35891).
          if (shown.length > 0 || !submitRef.current) return;
          event.preventDefault();
          submitRef.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {title ?? tt('fields.requiredPromptTitle', 'Complete required fields')}
          </DialogTitle>
          <DialogDescription>
            {description ?? tt(
              'fields.requiredPromptDescription',
              'This change makes the fields below required. Fill them in to save it.',
            )}
          </DialogDescription>
        </DialogHeader>

        {(recordName || (changes && changes.length > 0)) && (
          <div className="flex flex-col gap-2 rounded-md border bg-muted/40 px-3 py-2" data-required-fields-change="">
            {recordName && (
              <p className="min-w-0 break-words text-sm font-medium">{recordName}</p>
            )}
            {changes && changes.length > 0 && (
              <dl className="flex flex-col gap-1 text-sm">
                {changes.map((c) => (
                  <div key={c.name} className="flex min-w-0 flex-wrap gap-x-1.5" data-required-fields-change-row={c.name}>
                    <dt className="text-muted-foreground">{c.label}:</dt>
                    <dd className="min-w-0 break-words font-medium">{c.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}

        {notice}

        <div className="flex flex-col gap-4 py-2">
          {shown.map((f) => {
            const isMissing = isMissingForRequired(values[f.name]);
            const message = serverErrors[f.name]
              ?? (showErrors && isMissing ? tt('common.required', 'Required') : undefined);
            return (
              // A wrapping `label` gives the control its accessible name
              // implicitly. `FieldEditWidget` does take an `id` (objectui#7009
              // put it in `DOM_PASS_THROUGH_KEYS`), but this dialog renders
              // whatever field types the change made required, and several of
              // them resolve to COMPOSITE controls with no single labelable
              // element for a `htmlFor` to point at — `RadioField` renders
              // `<div role="radiogroup">`, `CheckboxesField` `<div
              // role="group">`, `AddressField` a set of sibling inputs. One
              // wrapping `label` covers every type uniformly and mints no ids.
              <label key={f.name} className="flex flex-col gap-1.5" data-required-fields-field={f.name}>
                <span className="text-sm font-medium">
                  {f.label}
                  <span className="text-destructive ml-0.5" aria-hidden="true">*</span>
                </span>
                <FieldEditWidget
                  field={f.def as never}
                  value={values[f.name]}
                  onChange={(v: unknown) => {
                    setValues((prev) => ({ ...prev, [f.name]: v }));
                    // A server reason is about the value it was given; a new
                    // value retires it.
                    setServerErrors((prev) => {
                      if (!(f.name in prev)) return prev;
                      const next = { ...prev };
                      delete next[f.name];
                      return next;
                    });
                  }}
                  readonly={busy}
                  // A widget reads `error` ONLY to drive `aria-invalid` (the
                  // #3222 contract — the message TEXT stays with the host), so
                  // the same string as the visible hint below cannot
                  // double-display (objectui#7008).
                  error={message}
                />
                {message && (
                  <span className="text-xs text-destructive" data-required-fields-error={f.name}>
                    {message}
                  </span>
                )}
              </label>
            );
          })}
        </div>

        {footLines.length > 0 && (
          <div role="alert" className="flex flex-col gap-1 text-sm text-destructive" data-required-fields-refusal="">
            {footLines.map((line) => <p key={line} className="break-words">{line}</p>)}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {tt('common.cancel', 'Cancel')}
          </Button>
          <Button ref={submitRef} onClick={() => { void handleSubmit(); }} disabled={busy}>
            {submitLabel ?? tt('common.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
