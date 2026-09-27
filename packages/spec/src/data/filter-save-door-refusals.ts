// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20116] The SAVE door's verdict on ONE comparand slot: every refusal the
 * QUERY faces give for it, in the schema door's words. One function, called by
 * the two walks that reach a slot when a filter is saved:
 *
 * - `FilterConditionSchema`'s own walk (`checkFilterConditionComparands`,
 *   `./filter.zod.ts`), over the field entries of a condition and of every
 *   `$and` / `$or` / `$not` member — the shared comparand face's reach, which
 *   every schema carrying a `FilterCondition` gets;
 * - the analytics carriers' nested-relation walk
 *   (`refuseNestedRelationComparands`, `../ui/dataset.zod.ts`), over the
 *   entries INSIDE a nested-relation condition, which the analytics `where`
 *   door flattens to dotted members and judges like any other entry.
 *
 * So a slot is judged one way whichever reach finds it, and a rule added here
 * reaches both.
 *
 * ## The judge is the query face itself
 *
 * The comparand-shape face (`assertListComparandShapes`,
 * `./filter-comparand-shape.ts`) is called read-only on a one-slot node, so the
 * save door refuses exactly the cells the query door refuses: an array in the
 * equality or `$ne` slot, a `null` ordering comparand, a non-list `$in` /
 * `$nin`, a malformed `$between`, a `null` list member or endpoint, and a blank
 * or `{ $field }` endpoint — and passes what the face passes (the null
 * predicate, a `{ $field }` reference as a whole comparand, `$in: []`, a
 * whitespace endpoint). An arm the face gains later is refused on save the day
 * it lands. The two boolean flags, which that face does not judge, are judged
 * with the one predicate every flag face uses (`driver-sql`, `driver-memory`,
 * `driver-mongodb`, the read-scope compiler, the analytics `where` door): the
 * comparand is not a boolean (#5347 / #5369).
 *
 * ## The words
 *
 * - The equality and `$ne` slots: the face's own sentence, from the builders
 *   both doors import (`./filter-comparand-refusal-text.ts`).
 * - A `null` ordering comparand, a `null` list member or endpoint, a blank or
 *   `{ $field }` endpoint: the sentence the enforced operator slot
 *   (`FieldOperatorsSchema`) prints for the same comparand, read off that slot
 *   rather than restated, so one condition reads one way at the schema door.
 * - A non-list `$in` / `$nin` and a malformed `$between`: the face's sentence
 *   less its location, because the operator slot has only zod's generic
 *   wording for those shapes.
 * - A non-boolean flag: the query faces' sentence (see
 *   {@link nonBooleanFlagComparandMessage}).
 *
 * None carries the face's ` at <path>` clause: the issue's own `path` carries
 * the location, which a refinement cannot see from inside the document.
 *
 * ## Why a module of its own, and why the operator slots are handed in
 *
 * `./filter.zod.ts` is re-exported whole by the `data` barrel, so a function
 * exported from it would be published API. This module is not in the barrel,
 * like `./filter-comparand-refusal-text.ts`. It cannot import `./filter.zod.ts`
 * either, because that module imports THIS one — the cycle the face's
 * `LIST_COMPARAND_OPERATORS` docblock records. So the enforced operator slots,
 * whose sentences four arms print, are handed in by the caller as
 * `FieldOperatorsSchema` ({@link OperatorSlots}).
 */

import type { z } from 'zod';
import { assertListComparandShapes } from './filter-comparand-shape';
import {
  IN_OPERATOR_SPELLINGS,
  NIN_OPERATOR_SPELLINGS,
  arrayEqualityComparandMessage,
  arrayInequalityComparandMessage,
  shapePreview,
} from './filter-comparand-refusal-text';

/** One parse result, as far as this module reads it. */
type SlotParse = {
  readonly success: boolean;
  readonly error?: { readonly issues: ReadonlyArray<{ readonly path: readonly PropertyKey[]; readonly message: string }> };
};

/**
 * The slice of `FieldOperatorsSchema` this module reads: each operator's own
 * enforced slot, keyed by operator. Handed in by the caller — see the module
 * note for why this module does not import it.
 */
export interface OperatorSlots {
  readonly shape: Readonly<Record<string, { safeParse(input: unknown): SlotParse } | undefined>>;
}

/**
 * Ask the comparand-shape face about ONE slot — a one-entry node holding either
 * an implicit comparand (`{ stage: [...] }`) or a single operator
 * (`{ stage: { $in: 'won' } }`). Returns the face's refusal, or `undefined` when
 * the face accepts. It is handed one slot at a time because it throws on the
 * first refusal it meets, and the save door reports every refused slot of a
 * document, each at its own path.
 *
 * Only the face's own envelope (`INVALID_FILTER`) is read as a verdict.
 * Anything else it throws is a defect in the face, not a refused filter, and is
 * rethrown rather than reported as one.
 */
function comparandShapeFaceRefusal(slot: Record<string, unknown>): Error | undefined {
  try {
    assertListComparandShapes(slot);
  } catch (error) {
    if ((error as { code?: unknown }).code === 'INVALID_FILTER') return error as Error;
    throw error;
  }
  return undefined;
}

/**
 * The face's `{ $field }` recogniser (`isFieldReferenceShape`): SHAPE only, a
 * non-array object carrying a `$field` key. Spelled here because this module
 * cannot import the schema door's copy (see the module note); it only locates
 * the endpoint the face already refused, and never decides a verdict.
 */
function isFieldReferenceShape(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && '$field' in value;
}

/** `string` / `number` / `null` / `array` … — the face's `describeOperand`, for the two sentences below. */
function describeComparandKind(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'Date';
  return typeof value;
}

/**
 * `$in` / `$nin` whose comparand is not a list — the face's sentence
 * (`nonListComparandError`), less the ` at <path>` location only the face can
 * write. The operator slot (`setMembershipSchema`) has only zod's generic
 * wording for this shape, so the face's is the one sentence the platform has.
 */
function nonListComparandMessage(op: '$in' | '$nin', field: string, value: unknown): string {
  const spellings = op === '$in' ? IN_OPERATOR_SPELLINGS : NIN_OPERATOR_SPELLINGS;
  const alternative = op === '$in' ? '"=" ($eq)' : '"!=" ($ne)';
  return (
    `Operator "${op}" on field "${field}" requires an ARRAY of values. `
    + `Received ${describeComparandKind(value)} (${shapePreview(value)}). `
    + `"${op}" tests membership of a list — write ${shapePreview([value])} for a single value, `
    + `or use ${alternative} to compare against it. Authoring spellings: ${spellings.join(', ')}. `
    + 'The filter was NOT applied, and an unapplied filter would have returned the UNFILTERED '
    + 'result set.'
  );
}

/**
 * `$between` whose comparand is not a two-element list — the face's sentence
 * (`malformedRangeComparandError`), less its ` at <path>` location, for the
 * reason {@link nonListComparandMessage} gives.
 */
function malformedRangeComparandMessage(field: string, value: unknown): string {
  return (
    `Operator "$between" on field "${field}" requires a [min, max] value array. `
    + `Received ${describeComparandKind(value)} (${shapePreview(value)}). `
    + 'A range needs exactly two bounds, in order; the authoring spelling that lowers to '
    + '"$between" is "between". The filter was NOT applied, and an unapplied filter would have '
    + 'returned the UNFILTERED result set.'
  );
}

/** The four ordering operators — the positions of the face's `null` ordering-comparand arm. */
const ORDERING_OPERATORS: ReadonlySet<string> = new Set(['$gt', '$gte', '$lt', '$lte']);

/** Where a refusal sits below its operator (`[]`, or a member / endpoint index), and its words. */
type SaveDoorRefusal = { readonly at: readonly number[]; readonly message: string };

/**
 * The sentence the enforced operator slot prints for `comparand` at `at` — the
 * schema door's established words for that condition — or `undefined` when the
 * slot raises nothing there.
 */
function operatorSlotSentence(
  slots: OperatorSlots,
  op: string,
  comparand: unknown,
  at: readonly number[],
): string | undefined {
  const parsed = slots.shape[op]?.safeParse(comparand);
  const where = at.join('.');
  return parsed?.error?.issues.find((issue) => issue.path.join('.') === where)?.message;
}

/**
 * Locate the defect the face stopped at, following the face's own order of
 * checks (`assertFieldListComparands`), and return where it sits and the words
 * for it. The VERDICT is already the face's; this only picks the sentence.
 *
 * A refusal none of these arms recognises — an arm the face gained after this
 * was written — is reported in the face's own words, location included, rather
 * than accepted. `filter-save-door-face-parity.test.ts` fails on that text, so
 * the new arm is worded here before it ships.
 */
function comparandShapeRefusalAtSave(
  slots: OperatorSlots,
  field: string,
  op: string | undefined,
  comparand: unknown,
  face: Error,
): SaveDoorRefusal {
  const fromSlot = (at: readonly number[]): SaveDoorRefusal | undefined => {
    const message = op === undefined ? undefined : operatorSlotSentence(slots, op, comparand, at);
    return message === undefined ? undefined : { at, message };
  };
  let refusal: SaveDoorRefusal | undefined;
  if (op === undefined) {
    refusal = { at: [], message: arrayEqualityComparandMessage(comparand, { field }) };
  } else if (op === '$eq') {
    refusal = { at: [], message: arrayEqualityComparandMessage(comparand, { op, field }) };
  } else if (op === '$ne') {
    refusal = { at: [], message: arrayInequalityComparandMessage(comparand, { field }) };
  } else if (comparand === null && ORDERING_OPERATORS.has(op)) {
    refusal = fromSlot([]);
  } else if (op === '$in' || op === '$nin') {
    refusal = Array.isArray(comparand)
      ? fromSlot([comparand.indexOf(null)])
      : { at: [], message: nonListComparandMessage(op, field, comparand) };
  } else if (op === '$between') {
    if (!Array.isArray(comparand) || comparand.length !== 2) {
      refusal = { at: [], message: malformedRangeComparandMessage(field, comparand) };
    } else {
      const nullBound = comparand.indexOf(null);
      const blankBound = comparand.findIndex((bound) => bound === '' || bound === undefined);
      const referenceBound = comparand.findIndex(isFieldReferenceShape);
      const bound = nullBound !== -1 ? nullBound : blankBound !== -1 ? blankBound : referenceBound;
      if (bound !== -1) refusal = fromSlot([bound]);
    }
  }
  return refusal ?? { at: [], message: face.message };
}

/**
 * The two flags `FieldOperatorsSchema` declares `z.boolean()`. A non-boolean one
 * is refused on every query face under the #5347 / #5369 rulings, in every
 * position, because the backends read one in opposite directions.
 */
const BOOLEAN_FLAG_OPERATORS: ReadonlySet<string> = new Set(['$null', '$exists']);

/** What arrived where a flag's boolean belongs — the analytics door's `describeFlagComparand`. */
function describeFlagComparand(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'bigint') return `a bigint (${value}n)`;
  if (Array.isArray(value)) return `an array (${shapePreview(value)})`;
  if (value instanceof Date) return `a Date (${shapePreview(value)})`;
  if (isFieldReferenceShape(value)) return `a field reference (${shapePreview(value)})`;
  return `a ${typeof value} (${shapePreview(value)})`;
}

/**
 * The refusal of a non-boolean `$null` / `$exists` flag, as the query faces
 * give it. The first sentence is `driver-sql`'s word for word through "(true or
 * false)", which the analytics `where` door also keeps; the reason and the
 * prescription are the analytics door's, less the location and the history of
 * what that door used to do. The field is named because this door can see it;
 * the issue's own `path` carries the location.
 */
function nonBooleanFlagComparandMessage(op: string, field: string, value: unknown): string {
  const [whenTrue, whenFalse] = op === '$null' ? ['has no value', 'has a value'] : ['has a value', 'has no value'];
  return (
    `Operator "${op}" on field "${field}" requires a boolean comparand (true or false). `
    + `Received ${describeFlagComparand(value)}. @objectstack/spec FieldOperatorsSchema declares `
    + `${op} as a boolean, and a non-boolean is refused rather than coerced because the backends `
    + 'read one in OPPOSITE directions — one as IS NULL, another as IS NOT NULL. Write the '
    + `boolean itself: "${op}": true matches rows whose "${field}" ${whenTrue}, "${op}": false `
    + `rows whose "${field}" ${whenFalse}. The filter was NOT applied.`
  );
}

/**
 * Raise, as `custom` issues under `slotPath`, every refusal the query faces
 * give for ONE comparand slot: the comparand-shape face's verdict on the slot,
 * and — for the two boolean flags, which that face does not judge — the flag
 * rule. `op` is `undefined` for an implicit-equality comparand, and `slotPath`
 * is then the field's own path. `slots` is `FieldOperatorsSchema`.
 */
export function reportQueryFaceRefusals(
  ctx: z.RefinementCtx,
  slotPath: readonly (string | number)[],
  field: string,
  op: string | undefined,
  comparand: unknown,
  slots: OperatorSlots,
): void {
  const refusals: SaveDoorRefusal[] = [];
  const face = comparandShapeFaceRefusal(op === undefined ? { [field]: comparand } : { [field]: { [op]: comparand } });
  if (face) refusals.push(comparandShapeRefusalAtSave(slots, field, op, comparand, face));
  if (op !== undefined && BOOLEAN_FLAG_OPERATORS.has(op) && typeof comparand !== 'boolean') {
    refusals.push({ at: [], message: nonBooleanFlagComparandMessage(op, field, comparand) });
  }
  for (const refusal of refusals) {
    ctx.addIssue({ code: 'custom', path: [...slotPath, ...refusal.at], message: refusal.message });
  }
}
