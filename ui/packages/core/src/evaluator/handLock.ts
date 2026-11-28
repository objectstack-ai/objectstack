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
 * save, kanban drag between columns grouped by the field, calendar drag and
 * quick-create, the Gantt's drag, resize, progress handle, dependency link and in-place edit
 * (`@object-ui/plugin-gantt` `ganttHandLock.ts`), the timesheet cell, and the
 * command palette's create-as prefill. The in-app assistant acting for a
 * person is a hand surface too; its writes run in the AI service, which does
 * not read this module.
 * NOT hand surfaces, and so still on the raw `readonly` read: the import
 * wizard's target mapping (an import keeps the write) and the Studio/designer
 * authoring reads (they describe the declaration, not a person's edit).
 *
 * Two levels (the object level of the same ruling): an object's own
 * `uiReadonlyWhen` is the hand-lock DEFAULT for every field of its records, and
 * a field that declares its own `uiReadonly` or `uiReadonlyWhen` is judged by
 * that declaration instead ({@link effectiveUiReadonlyWhen}). So every verdict
 * here takes the object definition beside the field, as a REQUIRED context
 * key: a surface that forgot it would silently open a locked record, so the
 * compiler asks each caller for it (`null` where a surface has no object).
 * A surface that hands a field's lock on to another evaluator (a form field's
 * `uiReadonlyWhen`, a predicate whose operands it fetches) reads the folded
 * predicate from {@link effectiveUiReadonlyWhen} / {@link fieldLockPredicates},
 * never the object key itself.
 *
 * The predicate halves run through {@link resolveFieldRuleState}, the one
 * evaluator of field-level CEL, so a predicate here means what it means on
 * the form. A `readonlyWhen` that cannot be evaluated leaves the field
 * editable (the server drops the write); a `uiReadonlyWhen` that cannot be
 * evaluated LOCKS it, since no server judges the hand lock — including a row
 * that does not carry the predicate's operands, so a surface whose row is a
 * projection reads them first (the grid's row load, `@object-ui/plugin-grid`).
 */
import { resolveFieldRuleState, type FieldRulePredicate } from './fieldRules.js';

/** The field-lock keys of a field definition this verdict reads. */
export interface FieldHandLockDef {
  readonly?: unknown;
  readonlyWhen?: unknown;
  uiReadonly?: unknown;
  uiReadonlyWhen?: unknown;
}

/**
 * The object-level key this verdict reads (`@objectstack/spec`
 * `ObjectSchema.uiReadonlyWhen`): the whole-record hand lock, the default of
 * every field that declares no hand lock of its own.
 */
export interface ObjectHandLockDef {
  uiReadonlyWhen?: unknown;
}

/** Evaluation context for the predicate halves. */
export interface FieldHandLockContext {
  /**
   * The definition of the object the field belongs to, whose `uiReadonlyWhen`
   * is the field's default hand lock. REQUIRED on purpose: pass `null` only
   * where the surface truly has no object definition.
   */
  object: ObjectHandLockDef | null | undefined;
  /** The stored row an edit starts from, bound as `previous`. */
  previous?: Record<string, unknown>;
  /** The host shell's predicate scope (`current_user` and friends). */
  scope?: Record<string, unknown>;
  /** Locator for a fault warning, e.g. `"field 'status'"`. */
  fieldContext?: string;
}

/** True when the field declares a hand lock of its own (either key, either value). */
function declaresOwnHandLock(def: FieldHandLockDef | null | undefined): boolean {
  return def?.uiReadonly !== undefined || def?.uiReadonlyWhen !== undefined;
}

/**
 * The field's EFFECTIVE hand-lock predicate: its own `uiReadonlyWhen` when the
 * field declares a hand lock of its own (`uiReadonly` or `uiReadonlyWhen`, any
 * value — `uiReadonlyWhen: P\`false\`` keeps a field editable inside a locked
 * record), else the object's `uiReadonlyWhen`. `undefined` when neither
 * applies. The server lock (`readonly` / `readonlyWhen`) is not a hand-lock
 * declaration: it never cancels the object's default, it locks on its own.
 */
export function effectiveUiReadonlyWhen(
  def: FieldHandLockDef | null | undefined,
  object: ObjectHandLockDef | null | undefined,
): unknown {
  if (declaresOwnHandLock(def)) return def?.uiReadonlyWhen ?? undefined;
  return object?.uiReadonlyWhen ?? undefined;
}

/**
 * The conditional lock predicates that judge the field — `readonlyWhen` and the
 * effective `uiReadonlyWhen` — for a surface that must fetch their operands
 * before it judges a row. Absent ones are left out.
 */
export function fieldLockPredicates(
  def: FieldHandLockDef | null | undefined,
  object: ObjectHandLockDef | null | undefined,
): unknown[] {
  return [def?.readonlyWhen ?? undefined, effectiveUiReadonlyWhen(def, object)].filter((p) => p != null);
}

/**
 * The STATIC half: true when the field is read-only by hand on every record —
 * `readonly: true` or `uiReadonly: true`. For a surface that decides before it
 * has a record (which columns a create dialog lists, which fields a payload may
 * carry); a surface that has the record reads {@link fieldReadOnlyByHand}. The
 * object level adds nothing here: it is conditional only.
 */
export function fieldStaticallyReadOnlyByHand(def: FieldHandLockDef | null | undefined): boolean {
  return def?.readonly === true || def?.uiReadonly === true;
}

/** True when the field is judged by a conditional lock of either tier, its own or the object's. */
export function fieldHasConditionalHandLock(
  def: FieldHandLockDef | null | undefined,
  object: ObjectHandLockDef | null | undefined,
): boolean {
  return fieldLockPredicates(def, object).length > 0;
}

/**
 * The FULL verdict over one record: the static half, or `readonlyWhen` / the
 * effective `uiReadonlyWhen` TRUE over `record`. With no record the predicates
 * are judged over an empty one: `readonlyWhen` then answers open,
 * `uiReadonlyWhen` locked (it cannot be judged, and nothing behind it judges
 * the write).
 */
export function fieldReadOnlyByHand(
  def: FieldHandLockDef | null | undefined,
  record: Record<string, unknown> | null | undefined,
  context: FieldHandLockContext,
): boolean {
  if (fieldStaticallyReadOnlyByHand(def)) return true;
  if (!fieldHasConditionalHandLock(def, context.object)) return false;
  return resolveFieldRuleState(
    {
      readonlyWhen: (def?.readonlyWhen ?? undefined) as FieldRulePredicate | undefined,
      uiReadonlyWhen: effectiveUiReadonlyWhen(def, context.object) as FieldRulePredicate | undefined,
    },
    record ?? {},
    {},
    context.previous,
    context.scope,
    context.fieldContext,
  ).readonly;
}
