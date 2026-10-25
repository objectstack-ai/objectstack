/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Which fields a kanban drop is about to make REQUIRED and empty — the
 * pre-evaluation half of objectui#4254.
 *
 * Dropping a card into a column writes one value (`groupBy` := the column id),
 * and that write can flip a field's `requiredWhen` predicate to TRUE. The board
 * used to PATCH the column value alone, the engine refused the whole update
 * (`Win Reason 不能为空`), and there was no way to finish the move from the
 * board at all. This module answers the question that makes the move
 * completable instead: *given the record and the value the drop is about to
 * write, which fields become required while still being empty?*
 *
 * ## One evaluator, not two
 *
 * The verdict comes from `@object-ui/core`'s {@link resolveFieldRuleState} —
 * the SAME function the record form (`components/renderers/form/form.tsx`),
 * the wizard (`plugin-form/WizardForm.tsx`) and the line-item grid
 * (`fields/widgets/GridField.tsx`) resolve `visibleWhen`/`readonlyWhen`/
 * `requiredWhen` with, which in turn delegates to `@objectstack/formula`'s
 * `ExpressionEngine`. That is deliberate and load-bearing: the board's prompt
 * and the server's enforcement must reach the identical verdict, and a second
 * hand-rolled predicate evaluator is exactly how the two ends drift. The
 * card's own predicate shape — `has(record.stage) && record.stage ==
 * "closed_won"` — was measured against that engine before this was written.
 *
 * ## Why "required" alone is not the filter
 *
 * A field is only offered when the dialog can honestly render a control for
 * it, so four further conditions narrow the set. Each exclusion is a case
 * where prompting would be worse than not prompting:
 *
 *  - **already has a value** — the move is not what is missing. `required` is a
 *    PRESENCE contract, so the emptiness test is core's `isMissingForRequired`
 *    (the one the form and the server agree on: `false` and `0` are values,
 *    an empty array is not) rather than a truthiness check that would re-ask
 *    for every unchecked box.
 *  - **not visible** (`visibleWhen` FALSE) — the record form would not show it,
 *    so neither does this.
 *  - **readonly** — there is nothing the user could author.
 *  - **no edit widget** (`file`, `richtext`, `formula`, … — the types
 *    `@object-ui/fields` deliberately excludes from in-place editing) — a
 *    dialog row with no control is a worse dead end than the one being fixed.
 *
 * The last three fall through to the unchanged PATCH, where the server's
 * refusal is now legible (objectstack#7525 is closed) — a legible refusal
 * beats a dialog that cannot collect anything.
 *
 * The `groupBy` field itself is skipped: the drop IS its value.
 */
import { resolveFieldRuleState, isMissingForRequired } from '@object-ui/core';
import { hasFieldEditWidget } from '@object-ui/fields';

/** A field the drop makes required, paired with the definition to render it. */
export interface RequiredWhenPromptField {
  /** Field name — the key the combined PATCH will carry. */
  name: string;
  /** The field definition, with `name` guaranteed present for the widget. */
  def: Record<string, unknown> & { type?: string };
}

/**
 * The fields a move to `toColumnId` would make required and that are still
 * empty, in the object's declared field order.
 *
 * Returns `[]` whenever the drop needs no prompt — the caller's signal to keep
 * today's single-key PATCH exactly as it was.
 *
 * @param objectFields  `objectDef.fields`, as fetched by the board.
 * @param record        The record as it stands BEFORE the drop.
 * @param groupBy       The field the board groups by (the one the drop writes).
 * @param toColumnId    The value the drop is about to write.
 */
export function collectRequiredWhenPromptFields(
  objectFields: Record<string, unknown> | null | undefined,
  record: Record<string, unknown> | null | undefined,
  groupBy: string,
  toColumnId: unknown,
): RequiredWhenPromptField[] {
  if (!objectFields || !record) return [];

  // The record as the server would see it after the drop — this is what the
  // predicates are judged against, and the whole reason the prompt can happen
  // BEFORE the write rather than in reaction to a refusal.
  const next = { ...record, [groupBy]: toColumnId };

  const prompts: RequiredWhenPromptField[] = [];
  for (const [name, raw] of Object.entries(objectFields)) {
    if (name === groupBy) continue;
    if (!raw || typeof raw !== 'object') continue;
    const def = raw as Record<string, unknown>;

    // Scoped to conditional requirements on purpose. A statically-required
    // empty field means the record was already invalid before anyone touched
    // the board; turning a drag into a general-purpose validation form is a
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
      { required: def.required === true, readonly: def.readonly === true },
      // The pre-drop record, so a predicate reading `previous.*` sees what the
      // form would show it.
      record,
      undefined,
      `field '${name}'`,
    );

    if (!state.required || !state.visible || state.readonly) continue;
    if (!hasFieldEditWidget(def.type as string | undefined)) continue;

    prompts.push({ name, def: { name, ...def } });
  }
  return prompts;
}
