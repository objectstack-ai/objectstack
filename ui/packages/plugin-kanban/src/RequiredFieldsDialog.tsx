/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The small collect-then-move dialog a kanban drop opens when the target
 * column makes fields required — objectui#4254.
 *
 * ## Not a mini-form
 *
 * Every control here is `@object-ui/fields`' {@link FieldEditWidget}, i.e. the
 * SAME widget the record form renders for that field type (its own header:
 * "the SAME dedicated widgets the form renders"), which is also what the data
 * grid's inline editor and the detail page's inline edit compose. So a select
 * edits as a select, a date as a date picker, a boolean as a checkbox —
 * without this package owning a single input implementation, and without a
 * second set of field-rendering decisions that could drift from the form's.
 *
 * The validation is the same one definition too: `isMissingForRequired` from
 * `@object-ui/core`, the presence contract the form and the server share, so
 * this dialog cannot decide a value is "empty" in a way the server would
 * disagree with (a `false` boolean and a `0` are values, not absences).
 *
 * ## Copy
 *
 * Through `useSafeTranslate` — the per-call `tt(key, fallback)` channel this
 * package already uses — so a host with no `I18nProvider` mounted (a
 * standalone board, this package's tests, the preview gallery) reads English
 * instead of a raw key. The two new keys live in the `kanban` namespace of all
 * ten locale packs; `common.cancel` and `kanban.moveCard` are reused rather
 * than minted again, since one control's label should not get several
 * translations that can drift apart.
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
import { useSafeTranslate } from '@object-ui/react';
import { isMissingForRequired } from '@object-ui/core';
import { FieldEditWidget } from '@object-ui/fields';
import type { RequiredWhenPromptField } from './requiredWhenPrompt';

/** A prompt field with its display label already resolved by the board. */
export interface RequiredFieldsDialogField extends RequiredWhenPromptField {
  label: string;
}

export interface RequiredFieldsDialogProps {
  open: boolean;
  /** The required-and-empty fields, in the object's declared order. */
  fields: RequiredFieldsDialogField[];
  /** Disables the controls while the combined PATCH is in flight. */
  submitting?: boolean;
  onCancel: () => void;
  onSubmit: (values: Record<string, unknown>) => void;
}

export function RequiredFieldsDialog({
  open,
  fields,
  submitting,
  onCancel,
  onSubmit,
}: RequiredFieldsDialogProps): React.ReactElement {
  const tt = useSafeTranslate();
  // Each drop is its own collection, and that is enforced by MOUNTING rather
  // than by a reset effect: the board renders this component only while a move
  // is pending, so cancelling or submitting unmounts it and the next drop
  // starts from empty state. A `useEffect` re-seed would be both redundant and
  // a cascading-render hazard the lint rule correctly flags.
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  // True only after a submit attempt, so the dialog opens clean rather than
  // shouting "Required" at fields the user has not reached yet.
  const [showErrors, setShowErrors] = React.useState(false);

  const missing = fields.filter((f) => isMissingForRequired(values[f.name]));

  const handleSubmit = () => {
    if (missing.length > 0) {
      setShowErrors(true);
      return;
    }
    onSubmit(values);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {tt('kanban.requiredFieldsTitle', 'Complete required fields')}
          </DialogTitle>
          <DialogDescription>
            {tt(
              'kanban.requiredFieldsDescription',
              'This move makes the fields below required. Fill them in to continue.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {fields.map((f) => {
            const isMissing = isMissingForRequired(values[f.name]);
            return (
              // A wrapping `label` gives the control its accessible name
              // implicitly. This used to be justified with "`FieldEditWidget`
              // renders the widget itself and takes no `id` to associate with,
              // and widening its contract belongs to `@object-ui/fields`" —
              // FALSE since objectui#7009 put `id` in `DOM_PASS_THROUGH_KEYS`:
              // the factory takes an `id` and lands it on the real control.
              // The reason is corrected rather than the markup changed
              // (`f08bcd9af`), because a dead constraint left in a comment is
              // how the next reader concludes it still binds.
              //
              // The wrapping form is still the right choice here, for a reason
              // that IS still true: this dialog renders whatever field types the
              // target column made required, and several of them resolve to
              // COMPOSITE controls with no single labelable element for a
              // `htmlFor` to point at — `RadioField` renders `<div
              // role="radiogroup">`, `CheckboxesField` `<div role="group">`,
              // `AddressField` a set of sibling inputs. One wrapping `label`
              // covers every type uniformly and mints no ids.
              <label key={f.name} className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">
                  {f.label}
                  <span className="text-destructive ml-0.5" aria-hidden="true">*</span>
                </span>
                <FieldEditWidget
                  field={f.def as never}
                  value={values[f.name]}
                  onChange={(v: unknown) =>
                    setValues((prev) => ({ ...prev, [f.name]: v }))
                  }
                  readonly={submitting}
                  // The a11y half of the red text below (`f08bcd9af`). The
                  // dialog has always COMPUTED this state and shown it to a
                  // sighted user; until `FieldEditWidget` forwarded the declared
                  // `error` key there was no way to hand it to the control, so
                  // `aria-invalid` was never set and a screen-reader user was
                  // told nothing. Same string as the visible hint, deliberately:
                  // a widget reads `error` ONLY to drive `aria-invalid` (the
                  // #3222 contract — the message TEXT stays with the host), so
                  // this cannot double-display, and one definition of the
                  // message cannot drift from the other.
                  error={showErrors && isMissing ? tt('common.required', 'Required') : undefined}
                />
                {showErrors && isMissing && (
                  <span className="text-xs text-destructive">
                    {tt('common.required', 'Required')}
                  </span>
                )}
              </label>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            {tt('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {tt('kanban.moveCard', 'Move card')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
