// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5869] The comparand-shape gate for the LIST-SHAPED filter operators, at the
 * engine's single filter collection point.
 *
 * `FieldOperatorsSchema` (`spec/data/filter.zod.ts`) declares three operators
 * whose comparand is a LIST rather than a scalar:
 *
 * ```
 * $in:      z.array(z.any())
 * $nin:     z.array(z.any())
 * $between: z.tuple([min, max])
 * ```
 *
 * Nothing enforced that declaration on the way in. `isFilterAST` checks the
 * OPERATOR and the tuple's arity, never the comparand's shape, and
 * `parseFilterAST` lowers `['status', 'not_in', 'done']` to
 * `{ status: { $nin: 'done' } }` without complaint — so a scalar reached the
 * driver, where each backend answered differently:
 *
 * | comparand              | driver-sql            | driver-memory        | driver-mongodb    |
 * |:-----------------------|:----------------------|:---------------------|:------------------|
 * | `$in` / `$nin` scalar  | `whereIn(f, scalar)` → **500 DATABASE_ERROR** | evaluated as-is | emitted as-is |
 * | `$between` non-2-tuple | refused, 400          | refused, 400 (#5328) | arm falls through, no range predicate |
 *
 * The 500 is the reported defect (#5869): a server-fault code for a filter the
 * CALLER can fix, with no word about which operator, which field, or what shape
 * was expected. It is also reachable from spec-VALID authoring —
 * `ViewFilterRuleSchema.value` is `string | number | boolean | null | (string |
 * number)[]` and does not constrain the value by operator, so
 * `{ field: 'status', operator: 'not_in', value: 'done' }` publishes cleanly and
 * 500s on first render.
 *
 * ## Why here and not in each driver
 *
 * The table above IS the argument: three backends, three answers, one declared
 * contract. `driver-memory` already carries a shape gate
 * (`filter-refusal.ts`), but it is that package's own and no other driver reads
 * it — and both driver families are under a maintainer investment freeze
 * (#5499). The engine's lowering seam is the ONE place every query passes
 * through regardless of which door it came in by or which driver it lands on,
 * so the gate belongs here and every backend inherits one answer.
 *
 * ## Both doors, because only one of them carries an array
 *
 * The refusal that already lives at this seam only inspects `where` when it
 * arrives as a `FilterArray`. That is Door 2 (a direct in-process engine call).
 * Door 1 — the protocol/HTTP face, and the door #5869 was actually measured
 * through — runs its own `isFilterAST` → `parseFilterAST` in
 * `metadata-protocol/protocol.ts` and hands the engine an already-lowered
 * `FilterCondition` OBJECT. A guard on the array branch alone would therefore
 * have left the reported defect exactly where it was. This gate runs on the
 * lowered condition, so both doors are covered by one check.
 *
 * ## Deliberately NOT refused
 *
 * - **`$in: []` / `$nin: []`.** An empty list is a legitimate, declared
 *   predicate — "matches nothing" and "matches everything" respectively — and
 *   both drivers say so in as many words. Arity is not this gate's business;
 *   only "is it a list at all".
 * - **The MEMBER types of any list.** `$between`'s members are checked by
 *   nobody (`driver-sql` checks arity and nothing else, and #5041 measured the
 *   member case and deliberately left it — ISO date strings are a legitimate
 *   range on every backend); `$in`/`$nin` members are #5234's subject, on the
 *   `driver-sql` object-syntax face, and are not re-judged here.
 * - **A field spec with no `$` keys** (`{ author: { name: 'x' } }`) — a
 *   deep-equality comparand to `driver-memory` and `driver-mongodb` alike. This
 *   gate does not descend into one, for the same reason `filter-refusal.ts`
 *   does not: a comparand is data, and a stricter reading here would invent a
 *   contract no backend agrees with.
 */

import { StandardErrorCode } from '@objectstack/spec/api';

/**
 * The operators whose comparand `FieldOperatorsSchema` declares as a list, with
 * the authoring spellings that lower to each.
 *
 * The spellings matter to the message and not to the check: an author writes
 * `not_in` on a `ViewFilterRule` and never types `$nin`, so a refusal naming
 * only the lowered form sends them looking for a key that is not in their
 * metadata. Values are the `AST_OPERATOR_MAP` keys (`spec/data/filter.zod.ts`)
 * that map to each `$` operator.
 */
const LIST_COMPARAND_OPERATORS: ReadonlyMap<string, readonly string[]> = new Map([
  ['$in', ['in']],
  ['$nin', ['nin', 'not_in', 'notin']],
  ['$between', ['between']],
]);

/** What a caller most likely meant when they wrote a scalar. */
const SCALAR_ALTERNATIVE: ReadonlyMap<string, string> = new Map([
  ['$in', '"=" ($eq)'],
  ['$nin', '"!=" ($ne)'],
]);

/**
 * A plain object — filter STRUCTURE rather than a comparand.
 *
 * `Date` and other class instances are comparands even though `typeof` calls
 * them objects, and an array is a comparand at this position too (it is what a
 * list operator is FOR). Same classification `driver-memory`'s gate makes.
 */
function isFilterNode(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && !(value instanceof Date)
  );
}

/** `string` / `number` / `null` / `object` … — the word the message uses. */
function describeOperand(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'Date';
  return typeof value;
}

/**
 * A short, bounded rendering of the offending value.
 *
 * Bounded because the value came off the wire and a filter comparand can be
 * arbitrarily large; the message is for a human reading a 400, not a dump.
 *
 * The whole message has a second, harder bound: `rest-server.ts` TRUNCATES a
 * declared-4xx message at `CLIENT_MESSAGE_MAX` (500) before it reaches the
 * client (#5423). Everything a caller needs in order to act — operator, field,
 * received value, position, corrected shape — is therefore front-loaded, and
 * the test file pins the assembled length under that bound so a later edit
 * cannot silently push the tail off the wire.
 */
function shapePreview(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

/**
 * The wire envelope every filter refusal in the platform already uses.
 *
 * [#7047] EXPORTED, because this package has a second filter-refusal site and a
 * private second copy of these four lines is how the platform's refusal faces
 * drifted in the first place. `having-filter.ts` threw a bare `new Error` for a
 * retired or unknown operator — `code` and `status` both `undefined` — so a
 * 400-class author error reached the client 500-shaped, on the ONE refusal face
 * of five that no conformance table drove. It calls this now, so the two
 * objectql refusal sites cannot answer one mistake with two envelopes.
 *
 * The twin outside this package is `driver-memory`'s `unsupportedFilterError`
 * (`filter-refusal.ts`), which carries the cross-driver rationale.
 */
export function invalidFilterError(message: string): Error {
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_FILTER;
  err.status = 400;
  return err;
}

/**
 * `$in` / `$nin` whose comparand is not a list at all.
 *
 * Names the operator (in both the lowered and the authoring spelling), the
 * field, the received shape, the position, and the expected shape — the #5346 /
 * #5348 wording contract. The closing sentence is the one a caller cannot infer
 * from a status code: the query did not run.
 */
function nonListComparandError(
  object: string,
  operation: string,
  op: string,
  field: string,
  value: unknown,
  path: string,
): Error {
  const spellings = LIST_COMPARAND_OPERATORS.get(op) ?? [];
  const alternative = SCALAR_ALTERNATIVE.get(op);
  return invalidFilterError(
    `${operation}('${object}'): Operator "${op}" on field "${field}" requires an ARRAY of ` +
    `values. Received ${describeOperand(value)} (${shapePreview(value)}) at ${path}. ` +
    `"${op}" tests membership of a list — write ${shapePreview([value])} for a single value` +
    (alternative ? `, or use ${alternative} to compare against it` : '') +
    `. Authoring spellings: ${spellings.join(', ')}. The filter was NOT applied, and an ` +
    `unapplied filter would have returned the UNFILTERED result set (#5869).`,
  );
}

/**
 * `$between` whose comparand is not a two-element `[min, max]` array.
 *
 * Arity only — the exact condition `driver-sql`'s `$between` arm and
 * `driver-memory`'s `isBetweenComparand` already apply, hoisted so that the
 * backends which check NEITHER stop answering silently. The leading sentence is
 * kept verbatim from those two so one condition keeps one wording across the
 * platform (#5240's rule, applied across packages rather than within one).
 */
function malformedRangeComparandError(
  object: string,
  operation: string,
  field: string,
  value: unknown,
  path: string,
): Error {
  return invalidFilterError(
    `${operation}('${object}'): Operator "$between" on field "${field}" requires a [min, max] ` +
    `value array. Received ${describeOperand(value)} (${shapePreview(value)}) at ${path}. ` +
    `A range needs exactly two bounds, in order; the authoring spelling that lowers to ` +
    `"$between" is "between". The filter was NOT applied, and an unapplied filter would have ` +
    `returned the UNFILTERED result set (#5869).`,
  );
}

/**
 * Walk one `FilterCondition` and refuse every list-shaped operator whose
 * comparand cannot be one.
 *
 * Read-only and allocation-free on the overwhelmingly common path (a filter
 * with no list operator walks its own keys and returns). Runs on every engine
 * read and write, so it stays a walk rather than a schema parse — that cost is
 * now the whole reason, and this gate deliberately enforces only the three
 * list declarations the drivers genuinely cannot agree on.
 *
 * [#5685] This paragraph used to carry a second reason: that
 * `FieldOperatorsSchema` was "stricter than the runtime in ways the runtime
 * deliberately allows", because `$gt` was declared `number | Date |
 * FieldReference` while `['created_at', '>', '2026-01-01']` lowers to a STRING
 * bound that every backend accepts and the showcase apps rely on. That was a
 * real mismatch and it is **fixed at the source** rather than tolerated here:
 * the four ordering slots now declare `string` too, so the observation that
 * motivated this note no longer describes the schema. It is recorded rather
 * than deleted because this file's workaround is part of the evidence that
 * closed #5685 — the schema, not the runtime, was the wrong side.
 */
export function assertListComparandShapes(
  object: string,
  operation: string,
  node: unknown,
  path = 'where',
): void {
  if (!isFilterNode(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const here = `${path}.${key}`;
    if (key === '$and' || key === '$or') {
      // A non-array operand is a different defect, owned by the drivers'
      // combinator checks; this gate only walks what it can.
      if (Array.isArray(value)) {
        value.forEach((child, index) =>
          assertListComparandShapes(object, operation, child, `${here}[${index}]`));
      }
      continue;
    }
    if (key === '$not') {
      assertListComparandShapes(object, operation, value, here);
      continue;
    }
    // Any other `$` key at node level is a logical operator this gate does not
    // judge — an unknown one is already refused downstream, by name.
    if (key.startsWith('$')) continue;
    assertFieldListComparands(object, operation, key, value, here);
  }
}

/** One field constraint: `{ field: <spec> }`. */
function assertFieldListComparands(
  object: string,
  operation: string,
  field: string,
  spec: unknown,
  path: string,
): void {
  // A spec that is not a plain object is a comparand (implicit equality) and
  // carries no operator to check.
  if (!isFilterNode(spec)) return;
  const keys = Object.keys(spec);
  // No `$` key at all → a deep-equality comparand or a nested-relation
  // condition. Not descended into; see the module note.
  if (!keys.some((key) => key.startsWith('$'))) return;
  for (const op of keys) {
    if (!LIST_COMPARAND_OPERATORS.has(op)) continue;
    const comparand = spec[op];
    if (op === '$between') {
      if (!Array.isArray(comparand) || comparand.length !== 2) {
        throw malformedRangeComparandError(object, operation, field, comparand, `${path}.${op}`);
      }
      continue;
    }
    if (!Array.isArray(comparand)) {
      throw nonListComparandError(object, operation, op, field, comparand, `${path}.${op}`);
    }
  }
}
