/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Which fields a change is about to make REQUIRED while they are still empty —
 * the pre-evaluation half of the in-place fill-in (objectui#4254 for the kanban
 * drop, objectstack#35956 for every other in-place write: a list cell, the
 * record page's inline edit, the header's stage change).
 *
 * A change writes a few values, and that write can flip another field's
 * `requiredWhen` predicate to TRUE. Sent alone, the engine refuses the whole
 * update (`Win Reason 不能为空`), and the surface the change was made on often
 * has no place to type the missing value (a column the view does not draw, a
 * collapsed section). This module answers the question that makes the change
 * completable instead: *given the record and the values about to be written,
 * which fields become required while still being empty?*
 *
 * ## One evaluator, not two
 *
 * The verdict comes from `@object-ui/core`'s {@link resolveFieldRuleState} —
 * the SAME function the record form (`components/renderers/form/form.tsx`),
 * the wizard (`plugin-form/WizardForm.tsx`) and the line-item grid
 * (`fields/widgets/GridField.tsx`) resolve `visibleWhen`/`readonlyWhen`/
 * `requiredWhen` with, which in turn delegates to `@objectstack/formula`'s
 * `ExpressionEngine`. That is deliberate and load-bearing: the prompt and the
 * server's enforcement must reach the identical verdict, and a second
 * hand-rolled predicate evaluator is exactly how the two ends drift. The
 * card's own predicate shape — `has(record.stage) && record.stage ==
 * "closed_won"` — was measured against that engine before this was written.
 *
 * ## Why "required" alone is not the filter
 *
 * A field is only offered when the dialog can honestly render a control for
 * it, so further conditions narrow the set. Each exclusion is a case where
 * prompting would be worse than not prompting:
 *
 *  - **already has a value** — the change is not what is missing. `required` is
 *    a PRESENCE contract, so the emptiness test is core's `isMissingForRequired`
 *    (the one the form and the server agree on: `false` and `0` are values,
 *    an empty array is not) rather than a truthiness check that would re-ask
 *    for every unchecked box. It is read off the record as STORED, so a value
 *    typed into the dialog keeps its row.
 *  - **not visible** (`visibleWhen` FALSE) — the record form would not show it,
 *    so neither does this.
 *  - **readonly** — there is nothing the user could author.
 *  - **no edit widget** (`file`, `richtext`, `formula`, … — the types
 *    `@object-ui/fields` deliberately excludes from in-place editing) — a
 *    dialog row with no control is a worse dead end than the one being fixed.
 *  - **not fillable by this reader** — the host's own field-write question
 *    (`options.fillable`), so the dialog never offers a field the reader's
 *    grant would refuse.
 *
 * These fall through to the unchanged write, where the server's refusal is
 * legible (objectstack#7525 is closed) — a legible refusal beats a dialog that
 * cannot collect anything.
 *
 * The fields the change itself writes are skipped (`options.exclude`, by
 * default every key of `changes`): the change IS their value.
 */
import { resolveFieldRuleState, isMissingForRequired } from '@object-ui/core';
import { hasFieldEditWidget } from './FieldEditWidget.js';

/** A field the change makes required, paired with the definition to render it. */
export interface RequiredWhenPromptField {
  /** Field name — the key the combined write will carry. */
  name: string;
  /** The field definition, with `name` guaranteed present for the widget. */
  def: Record<string, unknown> & { type?: string };
}

/** How {@link collectRequiredWhenPromptFields} narrows its set. */
export interface RequiredWhenPromptOptions {
  /**
   * Fields never offered. Defaults to every key of `changes` — the values the
   * change writes. A dialog re-asking with the values typed into it passes the
   * keys of the ORIGINAL change only, so a field it collected keeps its row.
   */
  exclude?: Iterable<string>;
  /**
   * The host's own question of whether this reader may write `name` here (its
   * field grant, a system column). Absent: every field is fillable.
   */
  fillable?: (name: string, def: Record<string, unknown>) => boolean;
}

/**
 * The fields writing `changes` over `record` would make required and that are
 * still empty, in the object's declared field order.
 *
 * Returns `[]` whenever the change needs no prompt — the caller's signal to
 * keep its write exactly as it was.
 *
 * @param objectFields  `objectDef.fields`, as the surface fetched them.
 * @param record        The record as it stands BEFORE the change.
 * @param changes       The values the change is about to write.
 * @param options       See {@link RequiredWhenPromptOptions}.
 */
export function collectRequiredWhenPromptFields(
  objectFields: Record<string, unknown> | null | undefined,
  record: Record<string, unknown> | null | undefined,
  changes: Record<string, unknown>,
  options: RequiredWhenPromptOptions = {},
): RequiredWhenPromptField[] {
  if (!objectFields || !record) return [];

  // The record as the server would see it after the write — this is what the
  // predicates are judged against, and the whole reason the prompt can happen
  // BEFORE the write rather than in reaction to a refusal.
  const next = { ...record, ...changes };
  const exclude = new Set(options.exclude ?? Object.keys(changes));

  const prompts: RequiredWhenPromptField[] = [];
  for (const [name, raw] of Object.entries(objectFields)) {
    if (exclude.has(name)) continue;
    if (!raw || typeof raw !== 'object') continue;
    const def = raw as Record<string, unknown>;

    // Scoped to conditional requirements on purpose. A statically-required
    // empty field means the record was already invalid before anyone touched
    // it; turning an in-place edit into a general-purpose validation form is a
    // different feature from the one that was approved.
    if (def.requiredWhen == null) continue;
    if (!isMissingForRequired(record[name])) continue;

    const state = resolveFieldRuleState(
      {
        visibleWhen: def.visibleWhen as never,
        readonlyWhen: def.readonlyWhen as never,
        requiredWhen: def.requiredWhen as never,
      },
      next,
      // `name` says which column of the stored record is this field's value,
      // so the change is judged as the engine judges the write: a transition
      // gate (objectstack#30220). A record already inside the gate without
      // the value rests there, the engine lets the write through, and nothing
      // is asked.
      { required: def.required === true, readonly: def.readonly === true, name },
      // The stored record, so a predicate reading `previous.*` sees what the
      // form would show it.
      record,
      undefined,
      `field '${name}'`,
    );

    if (!state.required || !state.visible || state.readonly) continue;
    if (!hasFieldEditWidget(def.type as string | undefined)) continue;
    if (options.fillable && !options.fillable(name, def)) continue;

    prompts.push({ name, def: { name, ...def } });
  }
  return prompts;
}
