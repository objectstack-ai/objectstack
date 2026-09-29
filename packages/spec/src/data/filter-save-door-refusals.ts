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
 *   (`refuseNestedRelationComparands`, `../ui/analytics-carrier-filter.ts`),
 *   over the entries INSIDE a nested-relation condition, which the analytics
 *   `where` door flattens to dotted members and judges like any other entry.
 *   Every stored filter charted through that door declares it: a dataset
 *   `filter`, a measure `filter`, a dashboard widget `filter`, and a report's
 *   and a joined report block's `runtimeFilter`.
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
 * The comparand-TYPE face (`normalizeFilterComparandTypes`,
 * `./filter-comparand-type.ts`, the #7872 ruling's accepted set `string |
 * number | bigint | boolean | null | Date`) is called read-only the same way,
 * on the field entry the query doors hand it: it refuses a plain object where
 * a scalar belongs (`{ $eq: { a: 1 } }`), a `Map`, a class instance, a
 * function, a Symbol, `undefined`, and a bigint beyond ±2^53, as a comparand
 * and as a list member — and passes what it passes: the six accepted types, a
 * `{ $field }` reference, and a bigint within ±2^53, which it would narrow to
 * its number on a query and which the save door keeps as written. Before it,
 * every save door accepted each of those and the analytics door refused each
 * on chart. The document is judged, never rewritten.
 *
 * One slot raises ONE refusal: the first the query doors give, in their order
 * — the shape face, then the type face, then the flag rule (`parseFilterAST`,
 * the engine seam and the analytics door all run them in that order). So
 * `$null: { a: 1 }` reads as the type face's refusal, as it does on chart, and
 * never as two issues at one path.
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
 * - A comparand the type face refuses: the type face's own sentence, less its
 *   ` at <path>` clause (see {@link comparandTypeRefusalAtSave}). Nothing of it
 *   is restated here.
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
import { normalizeFilterComparandTypes } from './filter-comparand-type';
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
 * The flags `FieldOperatorsSchema` declares `z.boolean()`. A non-boolean one
 * is refused on every query face under the #5347 / #5369 rulings, in every
 * position, because the backends read one in opposite directions.
 *
 * [#20311] `$empty` is a flag by the same declaration (ruling A on #20399,
 * record 5865693155: "`$empty: boolean`"). This door has held it to its
 * declared type since the day it was declared — before any query face had an
 * arm for it — and each face's arm inherited the rule, so a `"true"` string was
 * never saved into a stored filter no arm reads the way its author meant.
 * [#20446] Every face answers it now, and the view operators `is_empty` /
 * `is_not_empty` lower to it.
 */
const BOOLEAN_FLAG_OPERATORS: ReadonlySet<string> = new Set(['$null', '$exists', '$empty']);

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
 *
 * [#20311] `$empty` keeps the first sentence and the prescription's form; its
 * reason cannot be the opposite-directions history (no backend ever read it
 * the other way), so it names the rule it shares with the two null flags
 * instead.
 */
function nonBooleanFlagComparandMessage(op: string, field: string, value: unknown): string {
  if (op === '$empty') {
    return (
      `Operator "${op}" on field "${field}" requires a boolean comparand (true or false). `
      + `Received ${describeFlagComparand(value)}. @objectstack/spec FieldOperatorsSchema declares `
      + `${op} as a boolean, and a non-boolean is refused rather than coerced, the rule $null and `
      + `$exists follow on every query face. Write the boolean itself: "${op}": true matches rows `
      + `whose "${field}" is empty, "${op}": false rows whose "${field}" is not empty. The filter `
      + 'was NOT applied.'
    );
  }
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
 * Ask the comparand-TYPE face about one field entry (`{ stage: <spec> }`), the
 * hand-over the analytics door and the engine seam make. Returns the face's
 * refusal, or `undefined` when it accepts. Read-only: the face's narrowed copy
 * (a bigint within ±2^53, as its number) is discarded, because the save door
 * judges the document and never rewrites it.
 *
 * Only the face's own envelope (`INVALID_FILTER`) is read as a verdict, as in
 * {@link comparandShapeFaceRefusal}.
 */
function comparandTypeFaceRefusal(entry: Record<string, unknown>): Error | undefined {
  try {
    normalizeFilterComparandTypes(entry);
  } catch (error) {
    if ((error as { code?: unknown }).code === 'INVALID_FILTER') return error as Error;
    throw error;
  }
  return undefined;
}

/**
 * The type face's refusal of ONE slot, located and in its own words, or
 * `undefined` when the face passes the slot.
 *
 * - **The verdict** is the face's, twice over. On the whole field entry
 *   (`fieldSpec`) first, because the face classifies the entry before it
 *   judges an operator: a spec carrying a string `$field` is a field reference
 *   it steps around whole, whatever sits beside it. Then on the one-slot node,
 *   so each refused slot of an entry is reported at its own path.
 * - **The location.** The face judges a list operator's members one by one and
 *   stops at the first it refuses; that member is found by asking the face
 *   about each member alone, and the issue sits at it (`stage.$in.1`), as the
 *   shape arms' null member does. Anything else sits at the slot.
 * - **The words** are the face's message with its ` at where.<slot>` clause
 *   removed — the one clause this door cannot write truthfully, since a
 *   refinement cannot see where it sits in the document (the issue's `path`
 *   says). The clause removed is the one the face was handed (`where`, its
 *   default root, plus this slot), so nothing is parsed out of the text. Should
 *   the face ever spell its location differently, the clause is not found and
 *   the face's whole message is reported, location included, rather than a
 *   guess — `filter-save-door-face-parity.test.ts` fails on that text.
 */
function comparandTypeRefusalAtSave(
  field: string,
  op: string | undefined,
  comparand: unknown,
  fieldSpec: unknown,
): SaveDoorRefusal | undefined {
  if (comparandTypeFaceRefusal({ [field]: fieldSpec }) === undefined) return undefined;
  const slot = (value: unknown): Record<string, unknown> =>
    (op === undefined ? { [field]: value } : { [field]: { [op]: value } });
  const face = comparandTypeFaceRefusal(slot(comparand));
  if (face === undefined) return undefined;
  let at: number[] = [];
  let location = op === undefined ? `where.${field}` : `where.${field}.${op}`;
  if (op !== undefined && Array.isArray(comparand)) {
    const member = comparand.findIndex((value) => comparandTypeFaceRefusal(slot([value])) !== undefined);
    if (member !== -1) {
      at = [member];
      location = `${location}[${member}]`;
    }
  }
  const clause = ` at ${location} `;
  const message = face.message.includes(clause) ? face.message.replace(clause, ' ') : face.message;
  return { at, message };
}

/**
 * Raise, as ONE `custom` issue under `slotPath`, the first refusal the query
 * faces give for ONE comparand slot, in their order: the comparand-shape
 * face's verdict on the slot, then the comparand-type face's, then — for the
 * two boolean flags, which neither face judges as a flag — the flag rule. `op`
 * is `undefined` for an implicit-equality comparand, and `slotPath` is then
 * the field's own path. `slots` is `FieldOperatorsSchema`. `fieldSpec` is the
 * whole value of the field entry the slot sits in — the operator map, or the
 * implicit comparand itself (the default) — which the type face classifies
 * before it judges the slot.
 *
 * Returns whether the slot was refused, so a walk with arms of its own on the
 * same slot can stay silent rather than raise a second issue at one path.
 */
export function reportQueryFaceRefusals(
  ctx: z.RefinementCtx,
  slotPath: readonly (string | number)[],
  field: string,
  op: string | undefined,
  comparand: unknown,
  slots: OperatorSlots,
  fieldSpec: unknown = op === undefined ? comparand : { [op]: comparand },
): boolean {
  let refusal: SaveDoorRefusal | undefined;
  const shapeFace = comparandShapeFaceRefusal(op === undefined ? { [field]: comparand } : { [field]: { [op]: comparand } });
  if (shapeFace) refusal = comparandShapeRefusalAtSave(slots, field, op, comparand, shapeFace);
  refusal ??= comparandTypeRefusalAtSave(field, op, comparand, fieldSpec);
  if (refusal === undefined && op !== undefined && BOOLEAN_FLAG_OPERATORS.has(op) && typeof comparand !== 'boolean') {
    refusal = { at: [], message: nonBooleanFlagComparandMessage(op, field, comparand) };
  }
  if (refusal === undefined) return false;
  ctx.addIssue({ code: 'custom', path: [...slotPath, ...refusal.at], message: refusal.message });
  return true;
}
