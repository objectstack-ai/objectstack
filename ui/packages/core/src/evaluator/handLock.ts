/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * "May a person edit this field by hand, now?" — the ONE answer every console
 * surface a person edits through reads (ruling record 7180466652, the
 * two-tier field-lock model of `@objectstack/spec` `Field`).
 *
 * Two locks, two tiers each:
 *
 * |             | server lock — no client writes | hand lock — no person edits at the console |
 * |:------------|:-------------------------------|:-------------------------------------------|
 * | always      | `readonly`                     | `uiReadonly`                               |
 * | conditional | `readonlyWhen`                 | `uiReadonlyWhen`                           |
 *
 * Both tiers lock a hand surface, so this verdict folds all four. Only the
 * server lock is read on the write path (objectql); the hand lock is read here
 * and nowhere on the server, so API, import, action and flow writes keep a
 * hand-locked field and the object's validations judge them.
 *
 * The hand surfaces (each reads this module, never `def.readonly` alone): the
 * create and edit dialogs and the payload they submit, the record page's
 * inline edit, the highlight-strip chip, grid inline edit and its multi-row
 * save, kanban drag between columns grouped by the field, and calendar drag.
 * NOT hand surfaces, and so still on the raw `readonly` read: the import
 * wizard's target mapping (an import keeps the write) and the Studio/designer
 * authoring reads (they describe the declaration, not a person's edit).
 *
 * The predicate halves run through {@link resolveFieldRuleState}, the one
 * evaluator of field-level CEL, so a predicate here means what it means on
 * the form; a predicate that cannot be evaluated leaves the field editable,
 * as `readonlyWhen` does everywhere on the client (the server decides).
 */
import { resolveFieldRuleState, type FieldRulePredicate } from './fieldRules.js';

/** The field-lock keys of a field definition this verdict reads. */
export interface FieldHandLockDef {
  readonly?: unknown;
  readonlyWhen?: unknown;
  uiReadonly?: unknown;
  uiReadonlyWhen?: unknown;
}

/** Optional evaluation context for the predicate halves. */
export interface FieldHandLockContext {
  /** The stored row an edit starts from, bound as `previous`. */
  previous?: Record<string, unknown>;
  /** The host shell's predicate scope (`current_user` and friends). */
  scope?: Record<string, unknown>;
  /** Locator for a fault warning, e.g. `"field 'status'"`. */
  fieldContext?: string;
}

/**
 * The STATIC half: true when the field is read-only by hand on every record —
 * `readonly: true` or `uiReadonly: true`. For a surface that decides before it
 * has a record (which columns a create dialog lists, which fields a payload may
 * carry); a surface that has the record reads {@link fieldReadOnlyByHand}.
 */
export function fieldStaticallyReadOnlyByHand(def: FieldHandLockDef | null | undefined): boolean {
  return def?.readonly === true || def?.uiReadonly === true;
}

/** True when the field declares a conditional lock of either tier. */
export function fieldHasConditionalHandLock(def: FieldHandLockDef | null | undefined): boolean {
  return def?.readonlyWhen != null || def?.uiReadonlyWhen != null;
}

/**
 * The FULL verdict over one record: the static half, or `readonlyWhen` /
 * `uiReadonlyWhen` TRUE over `record`. With no record the predicates are
 * judged over an empty one (a column-level question, answered fail-open).
 */
export function fieldReadOnlyByHand(
  def: FieldHandLockDef | null | undefined,
  record?: Record<string, unknown> | null,
  context: FieldHandLockContext = {},
): boolean {
  if (fieldStaticallyReadOnlyByHand(def)) return true;
  if (!fieldHasConditionalHandLock(def)) return false;
  return resolveFieldRuleState(
    {
      readonlyWhen: (def?.readonlyWhen ?? undefined) as FieldRulePredicate | undefined,
      uiReadonlyWhen: (def?.uiReadonlyWhen ?? undefined) as FieldRulePredicate | undefined,
    },
    record ?? {},
    {},
    context.previous,
    context.scope,
    context.fieldContext,
  ).readonly;
}
