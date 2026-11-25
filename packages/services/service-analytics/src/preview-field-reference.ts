// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36677] A `{ $field }` comparand on the draft-data preview
 * (`preview-evaluator.ts`), answered as the live faces of the dataset door
 * answer it.
 *
 * ## The defect
 *
 * The preview's operator table compared the row value with the reference
 * OBJECT, through `String()` (`'[object Object]'`), so every field-to-field
 * filter answered a wrong count with a `200`: `label $eq { $field: 'alias' }`
 * matched no row, `$ne` every row, and a reference to a multi-value column
 * (`{ $field: 'tags' }`) was counted where both live faces refuse it
 * `INVALID_FILTER` / 400. The live faces are one path: `NativeSQLStrategy`
 * declines a cross-field comparison (`findCrossFieldComparand`, ruling Q1 = B)
 * so it routes to the ObjectQL strategy, whose engine hands it to the driver
 * that compiles it (`driver-sql`'s `applyCrossFieldComparison`).
 *
 * ## The rules, and where each one comes from
 *
 * - **The truth table** of the six scalar operators is the shared cross-field
 *   corpus's (`driver-sql`'s `cross-field-conformance-cases.ts`, which pins
 *   `@objectstack/formula`'s `matchesFilterCondition` and the SQL compile to the
 *   same rows): `$eq` matches a row whose two columns are both empty, `$ne` is
 *   its exact complement, and an ordering needs a value on both sides. So every
 *   arm is TOTAL, and the shared lowering puts no NULL guard around it
 *   (`operatorIsNullTotal` in `@objectstack/spec/data`).
 * - **The comparison class** is `@objectstack/spec`'s
 *   `crossFieldComparisonVerdict`, the one classification driver-sql, the
 *   in-process write check and the authoring door read: two columns compare
 *   only within one class, and a list, an object, a file or a formula column
 *   has none.
 * - **The positions and the referent** follow driver-sql's own refusal arm,
 *   case for case: a reference must name a declared column of the same object
 *   (no dotted path), and a reference anywhere but the six scalar operators is
 *   refused with the sentence this package's `where` door says for it
 *   (`comparand-shape.ts`).
 *
 * ## What the preview refuses that a live face serves
 *
 * One shape: a `{ $field, addDays }` offset reference. The live faces shift a
 * `date` / `datetime` referent by whole days in SQL; this face would need a
 * second copy of that arithmetic to evaluate it, and an offset it evaluated
 * differently would be the wrong number this card removes. It is REFUSED,
 * named, in the preview's not-evaluated words (#19810), never answered.
 *
 * ## What the preview does not judge
 *
 * The tenant-isolation column. driver-sql refuses it on either side of a
 * comparison, reading which column it is off the object's schema
 * (`resolveTenantFieldName` in `@objectstack/core`); the preview is handed a
 * field's declared shape only (`sourceFieldMeta`), so it compares such a
 * reference like any other text column. Recorded on #36677 rather than
 * guessed by name here.
 *
 * Every refusal is the `where` door's envelope (`INVALID_FILTER` / 400), and
 * judged once, before any row is read, so an empty seed draft refuses too.
 */

import { crossFieldComparisonVerdict, type ValueShapeFieldDef } from '@objectstack/spec/data';
import {
  CROSS_FIELD_COMPARISON_OPERATORS,
  TEXT_PATTERN_OPERATORS,
  isFieldReference,
  unbindableListMemberMessage,
  unrenderableTextComparandMessage,
} from './comparand-shape.js';
import { invalidFilterError } from './strategies/filter-normalizer.js';

type Row = Record<string, unknown>;

/**
 * One scalar operator's test of a row's value against the row's REFERENT —
 * the value of the column the `{ $field }` names. `order` is the preview's
 * shared operand ordering (`compare` in `preview-evaluator.ts`), handed in so
 * the two tables order a pair one way.
 */
export type FieldReferencePredicate = (value: unknown, referent: unknown, order: (a: unknown, b: unknown) => number) => boolean;

/** Both sides equal, or both empty — the corpus's `$eq` (row 6, both NULL, matches). */
function referenceEquals(value: unknown, referent: unknown, order: (a: unknown, b: unknown) => number): boolean {
  if (referent == null || value == null) return referent == null && value == null;
  return value === referent || order(value, referent) === 0;
}

/**
 * The six operators a `{ $field }` comparand is evaluated under — the set
 * `comparand-shape.ts` names `CROSS_FIELD_COMPARISON_OPERATORS` (pinned equal
 * in this card's test).
 */
export const PREVIEW_FIELD_REFERENCE_OPERATORS: ReadonlyMap<string, FieldReferencePredicate> = new Map<string, FieldReferencePredicate>([
  ['$eq', (value, referent, order) => referenceEquals(value, referent, order)],
  ['$ne', (value, referent, order) => !referenceEquals(value, referent, order)],
  ['$gt', (value, referent, order) => value != null && referent != null && order(value, referent) > 0],
  ['$gte', (value, referent, order) => value != null && referent != null && order(value, referent) >= 0],
  ['$lt', (value, referent, order) => value != null && referent != null && order(value, referent) < 0],
  ['$lte', (value, referent, order) => value != null && referent != null && order(value, referent) <= 0],
]);

/**
 * The predicate for `op` when `comparand` is a reference this face evaluates,
 * else `undefined`. An offset reference is refused here too, so a direct
 * caller of the matcher cannot have it compared without its offset.
 */
export function fieldReferencePredicate(field: string, op: string, comparand: unknown): FieldReferencePredicate | undefined {
  if (!isFieldReference(comparand)) return undefined;
  const predicate = PREVIEW_FIELD_REFERENCE_OPERATORS.get(op);
  if (predicate && hasOffset(comparand)) throw offsetRefusal(field, op, comparand.$field);
  return predicate;
}

function hasOffset(ref: { $field: string }): boolean {
  return 'addDays' in ref && (ref as Row).addDays !== undefined;
}

function offsetRefusal(field: string, op: string, ref: string): Error {
  return fieldReferenceRefusal(field, op, ref,
    `the draft-data preview does not evaluate an addDays offset on a field reference. It is ` +
      `refused rather than answered: the preview has no copy of the whole-day shift the published ` +
      `dataset applies, and a count it shifted differently would change at publish. Publish the ` +
      `draft to chart it, or compare against the field without an offset.`);
}

/** The refusal driver-sql's arm gives a reference, in its words, seated in this face's envelope. */
function fieldReferenceRefusal(field: string, op: string, ref: string, reason: string): Error {
  return invalidFilterError(
    `[analytics] Operator "${op}" on field "${field}" compares against another field ` +
      `({ "$field": "${ref}" }), which the draft-data preview refuses, as the published dataset ` +
      `does: ${reason}`,
  );
}

/** Each field constraint of a lowered `where`, at any depth, with the key it constrains. */
function forEachFieldConstraint(where: unknown, visit: (field: string, ops: Row) => void): void {
  if (where === null || typeof where !== 'object' || Array.isArray(where)) return;
  for (const [key, cond] of Object.entries(where as Row)) {
    if (key === '$and' || key === '$or') {
      if (Array.isArray(cond)) cond.forEach((arm) => forEachFieldConstraint(arm, visit));
    } else if (key === '$not') {
      forEachFieldConstraint(cond, visit);
    } else if (cond !== null && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
      visit(key, cond as Row);
    }
  }
}

/**
 * The row-INDEPENDENT half: every `{ $field }` comparand sits where this face
 * evaluates one, names a same-object column, and carries no offset. Needs no
 * declaration, so it runs on every preview.
 */
export function assertPreviewFieldReferencesEvaluable(where: Row | undefined): void {
  forEachFieldConstraint(where, (field, ops) => {
    for (const [op, comparand] of Object.entries(ops)) {
      if (Array.isArray(comparand)) {
        if (op === '$in' || op === '$nin') {
          comparand.forEach((member, index) => {
            if (isFieldReference(member)) throw invalidFilterError(`[analytics] ${unbindableListMemberMessage(op, field, member, index)}`);
          });
        }
        continue;
      }
      if (!isFieldReference(comparand)) continue;
      if (TEXT_PATTERN_OPERATORS.has(op)) {
        throw invalidFilterError(`[analytics] ${unrenderableTextComparandMessage(op, field, comparand)}`);
      }
      const ref = comparand.$field;
      if (!CROSS_FIELD_COMPARISON_OPERATORS.has(op)) {
        throw fieldReferenceRefusal(field, op, ref,
          `a field reference is a comparand of the six scalar operators only ($eq, $ne, $gt, $gte, $lt, $lte).`);
      }
      if (ref.includes('.')) {
        throw fieldReferenceRefusal(field, op, ref,
          `"${ref}" is a dotted path, and a field reference names a column of the same object only ` +
            `(no relation traversal).`);
      }
      if (hasOffset(comparand)) throw offsetRefusal(field, op, ref);
    }
  });
}

/**
 * The DECLARATION half: both columns of each comparison are declared and share
 * one comparison class (`crossFieldComparisonVerdict`). `targetShapeOf` reads a
 * filter key's declared value shape through the column it binds to;
 * `columnShapeOf` reads a column's. A type outside `FieldType` is not judged,
 * as the shared verdict judges none.
 */
export function refusePreviewFieldReferenceClasses(
  where: Row | undefined,
  targetShapeOf: (member: string) => ValueShapeFieldDef | undefined,
  columnShapeOf: (column: string) => ValueShapeFieldDef | undefined,
): void {
  forEachFieldConstraint(where, (field, ops) => {
    for (const [op, comparand] of Object.entries(ops)) {
      if (!CROSS_FIELD_COMPARISON_OPERATORS.has(op) || !isFieldReference(comparand)) continue;
      const ref = comparand.$field;
      const referent = columnShapeOf(ref);
      if (!referent) {
        throw fieldReferenceRefusal(field, op, ref, `"${ref}" is not a declared field of this object — only declared fields can be referenced.`);
      }
      const target = targetShapeOf(field);
      if (!target) {
        throw fieldReferenceRefusal(field, op, ref,
          `the target field "${field}" is not a declared field of this object, so the two columns' types ` +
            `cannot be checked as comparable.`);
      }
      const verdict = crossFieldComparisonVerdict(target, referent);
      if (verdict.verdict === 'no-class') {
        const [side, shape] = verdict.right.kind === 'no-class' ? [`"${ref}"`, referent] : [`the target field "${field}"`, target];
        throw fieldReferenceRefusal(field, op, ref,
          `${side} (type "${shape.type}"${shape.multiple ? ', multiple' : ''}) has no scalar stored column ` +
            `a comparison can read.`);
      }
      if (verdict.verdict === 'cross-class') {
        throw fieldReferenceRefusal(field, op, ref,
          `"${field}" is stored as ${verdict.left} but "${ref}" as ${verdict.right}, and a cross-class ` +
            `comparison answers differently by backend — compare same-class columns.`);
      }
    }
  });
}
