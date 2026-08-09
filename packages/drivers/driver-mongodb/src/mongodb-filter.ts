// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MongoDB Filter Translator
 *
 * Converts ObjectStack FilterCondition / AST-style `where` clauses into
 * native MongoDB filter documents.
 *
 * Supports:
 * - Implicit equality: `{ field: value }`
 * - Explicit operators: `{ field: { $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin } }`
 * - String operators: `{ field: { $contains, $startsWith, $endsWith, $notContains } }`
 * - Special: `{ field: { $null, $exists } }`
 * - Logical: `{ $and, $or, $not }`
 * - Range: `{ field: { $between: [min, max] } }`
 *
 * NOT supported, deliberately: the legacy ARRAY spelling (`[field, op, value]`,
 * `[[…], 'or', […]]`). `where` is a `FilterCondition` object by declaration, and
 * `FilterArray` is INPUT-ONLY authoring sugar lowered through `parseFilterAST`
 * at the engine and protocol doors before any driver is reached (#5158, ruling
 * C). A second compiler for it here is the divergence ADR-0053 D-A1 forbids —
 * it is refused loudly instead, matching driver-sql, driver-memory and cloud's
 * `RemoteTransport.buildWhereSQL`.
 */

import type { Filter } from 'mongodb';
import { nextUtcCalendarDay } from '@objectstack/core';
import { StandardErrorCode } from '@objectstack/spec/api';
// [#5659] The Filter Protocol's boolean identity reduction, shared with
// driver-sql, driver-memory and the flow linter and proven against the same
// `FILTER_LOGIC_CASES` table this driver's conformance suite runs. This file
// supplies only its own refusals — see `reduceFilterNode` below.
import {
  reduceFilterVerdict,
  reduceFilterKeyVerdict,
  type FilterVerdict as SharedFilterVerdict,
  type FilterVerdictHooks,
} from '@objectstack/spec/data';
// [#5702] The retired filter operators and the prescription each refusal
// prints, read from the spec so this driver's sentence about `$regex` cannot
// drift from the four other refusal sites' (#5701).
import { RETIRED_FILTER_OPERATORS } from '@objectstack/spec/data';
// [#6520] `$icontains`' ASCII-only fold, defined once in the spec. This driver
// hands a PATTERN to MongoDB rather than comparing strings, so the fold has to
// live in the pattern source — see its docblock for why `$options: 'i'` is the
// wrong tool.
import { asciiCaseInsensitiveRegexSource } from '@objectstack/spec/data';
import {
  coerceTemporalValue,
  type TemporalFieldKind,
  type TemporalFieldKindResolver,
} from './mongodb-temporal.js';

// ── [#5239] Boolean identities for the empty combinators ─────────────────────

/**
 * Keys that reach this translator inside a `where` object but describe the
 * QUERY rather than a predicate. The emitter has always skipped them; the
 * reduction below has to agree, or "what this node is worth as a boolean" and
 * "what this node emits" could disagree — which is the class of defect the
 * reduction exists to remove.
 */
const QUERY_LEVEL_KEYS = new Set(['limit', 'offset', 'fields', 'orderBy']);

/**
 * A MongoDB query document that matches NO document, for the `false` verdict.
 *
 * `$in: []` is empty-set membership — no value satisfies it, on every server
 * version, with no dependence on a collection's fields. `_id` is the one field
 * MongoDB guarantees exists. This is the shape #5239 names, and it is emitted
 * as a REAL condition: `$or: []` must reach `find` / `updateMany` /
 * `deleteMany` as "zero rows", never as the absent filter `{}`, which those
 * three read as "every document".
 */
function matchNothing(): Filter<any> {
  return { _id: { $in: [] } };
}

/**
 * [#5239, mirroring #5134] What a filter node is worth as a boolean, decided
 * BEFORE any query document is built.
 *
 * - `'true'`  — matches every document; the translator emits no condition.
 * - `'false'` — matches no document; the translator emits {@link matchNothing}.
 * - `'clause'` — carries at least one real predicate; translate it normally.
 *
 * [#5659] The vocabulary is `@objectstack/spec`'s now, because the REDUCTION
 * that produces it is — see {@link reduceFilterNode}. Kept as a local alias so
 * every use site below still reads `FilterVerdict`.
 */
type FilterVerdict = SharedFilterVerdict;

/**
 * [#5239] Is `value` a Filter Protocol NODE — the shape `FilterConditionSchema`
 * declares for every element of `$and`/`$or` and for the operand of `$not`?
 *
 * The PROTOTYPE check is the load-bearing half. The identity reduction turns
 * "this node has no predicates" into "matches every document", so any object
 * whose own enumerable keys are empty reads as TRUE. A `Date`, a `RegExp`, a
 * `Map` or a class instance all satisfy `typeof x === 'object' &&
 * !Array.isArray(x)` while enumerating to nothing — accepting them would
 * PROMOTE garbage from "silently mistranslated" to "matches all documents",
 * which on `deleteMany` is not a wrong row count but data loss. Measured on
 * `main` before this change: `{ $or: [new Date()] }` translated to
 * `{ $or: [{}] }`, i.e. every document, and `{ $or: 'x' }` / `{ $not: null }`
 * translated to `{}`, likewise every document.
 */
function isFilterNode(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * [#5239] The gate that gives "this group translated to empty" exactly ONE
 * cause.
 *
 * Identity reduction is sound only once an empty group can mean "the author
 * wrote an empty group" and nothing else. Refusing non-nodes here — before any
 * identity is applied — is what makes the reduction safe rather than a
 * promotion of garbage to match-all. Same discipline as #5134 in `driver-sql`
 * and cloud#1073 in Turso's `RemoteTransport.buildWhereSQL`.
 */
function assertFilterNode(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (isFilterNode(value)) return;
  throw unsupportedFilterError(
    `Filter node at ${path} is a ${describeFilterOperand(value)} (${safeShapePreview(value)}), not a filter ` +
      `condition object. Every element of "$and"/"$or" and the operand of "$not" must be a plain object of ` +
      `field constraints (e.g. { "status": "active" }) or nested combinators — @objectstack/spec ` +
      `FilterConditionSchema declares this position as a FilterCondition. It is refused rather than skipped ` +
      `because skipping it would silently change which documents match.`,
  );
}

/** [#5239] `$and`/`$or` take a list; anything else is refused, never coerced. */
function assertFilterNodeList(value: unknown, key: string, path: string): asserts value is unknown[] {
  if (Array.isArray(value)) return;
  throw unsupportedFilterError(
    `Filter combinator "${key}" at ${path} requires an array of filter conditions, but received a ` +
      `${describeFilterOperand(value)} (${safeShapePreview(value)}). @objectstack/spec FilterConditionSchema ` +
      `declares "${key}" as FilterCondition[].`,
  );
}

/**
 * [#5239] Reduce one filter node to its boolean verdict, validating shapes on
 * the way down.
 *
 * A node is the AND of its entries, so FALSE dominates and a node with no
 * entries at all is TRUE (the empty conjunction) — which is why `{}` is a TRUE
 * disjunct inside `$or` and why `{ $not: {} }` is FALSE.
 *
 * The walk does NOT short-circuit: a `$or: []` sibling must not stop it from
 * reaching — and refusing — a malformed node further along, or the shape gate
 * would depend on key order.
 *
 * Deciding STRUCTURALLY, rather than translating and then asking whether the
 * emitted document came out empty, is the point. "Nothing was emitted" cannot
 * distinguish "the author wrote an empty group" from "something failed to
 * translate"; a structural verdict has no such blind spot.
 *
 * ## [#5659] The algebra is `@objectstack/spec`'s; the REFUSALS are this driver's
 *
 * Every paragraph above describes a ruling four consumers had to agree on and
 * implemented four times — here, in `driver-sql` (whose copy this one was
 * written to mirror, down to the variable names), in `driver-memory`'s matcher,
 * and nearly a fifth time inside `@objectstack/lint`. It lives once now, in
 * {@link reduceFilterVerdict}, proven against the same `FILTER_LOGIC_CASES`
 * table this driver's conformance suite runs. What stays here is WHICH shapes
 * this translator refuses and how it words them, handed over as
 * {@link MONGO_FILTER_VERDICT_HOOKS} and invoked from exactly the positions
 * they were invoked from before.
 */
function reduceFilterNode(node: Record<string, unknown>, path: string): FilterVerdict {
  return reduceFilterVerdict(node, { ...MONGO_FILTER_VERDICT_HOOKS, path });
}

/** [#5239] The verdict of ONE key of a filter node. */
function reduceFilterKey(key: string, value: unknown, path: string): FilterVerdict {
  return reduceFilterKeyVerdict(key, value, { ...MONGO_FILTER_VERDICT_HOOKS, path });
}

/**
 * [#5659] This translator's half of the reduction: the shape refusals, at the
 * positions the shared walk visits them.
 *
 * The two `assert*` functions are wrapped in arrows rather than passed by
 * reference because they are TypeScript assertion functions, whose narrowing is
 * meaningless through a property reference. Nothing else about the call changes.
 */
const MONGO_FILTER_VERDICT_HOOKS: FilterVerdictHooks = {
  assertNodeList: (value, key, path) => assertFilterNodeList(value, key, path),
  assertNode: (value, path) => assertFilterNode(value, path),
  classifyKey: (key, value, here) => classifyFilterKey(key, value, here),
};

/**
 * [#5239] The verdict of ONE **non-combinator** key — and this translator's gate
 * on what a field constraint may not be.
 *
 * `here` is the already-joined path of the key, exactly as the reduction hands
 * it over; the three combinator arms this used to open with are the shared
 * walk's now.
 *
 * MongoDB's own answer to an empty combinator is worth keeping written down,
 * because the reduction is what spares this driver from it: `$and`/`$or` with an
 * empty array is rejected outright (`$and/$or/$nor must be a nonempty array`),
 * so `{ $or: [] }` used to be a 500-shaped throw rather than a verdict.
 */
function classifyFilterKey(key: string, value: unknown, here: string): FilterVerdict {
  // Query-level keys carry no predicate; the emitter skips them and so does the
  // verdict, so the two never disagree about what this node is worth.
  if (QUERY_LEVEL_KEYS.has(key)) return 'true';

  // [#5347] `$null`'s comparand is a boolean by declaration. Checked on THIS
  // walk rather than in the emitter's `$null` arm because the emitter is
  // skipped wholesale by a boolean identity: `{ $or: [ {}, { stage: { $null:
  // 'yes' } } ] }` reduces to TRUE on its first disjunct, so an emitter-side
  // gate would refuse the comparand or ignore it depending on its SIBLINGS —
  // the "gate conditional on evaluation order" #5368 placed driver-sql's and
  // driver-memory's gates on their walks to rule out. #5368 landed this
  // driver's gate in the emitter because no walk existed here yet; #5239's
  // reduction is that walk, so the gate moved with it. `hasOwnProperty` rather
  // than `'$null' in value` so an inherited key can never trip the gate.
  // `{ $null: undefined }` still counts: the key is own and enumerable, and
  // `undefined` is exactly one of the comparands #5347 measured a divergence
  // on.
  if (
    isFilterNode(value) &&
    Object.prototype.hasOwnProperty.call(value, '$null') &&
    typeof value.$null !== 'boolean'
  ) {
    throw nonBooleanNullComparandError(key, value.$null, `${here}.$null`);
  }

  // [#6520] `$icontains`' comparand is a NON-EMPTY string, gated on the WALK for
  // the same reason `$null` is one paragraph up: a gate in the emitter fires or
  // not depending on whether a boolean identity settled the enclosing node
  // first, so `{ $or: [ {}, { name: { $icontains: '' } } ] }` would refuse or
  // not depending on its siblings. The condition and the message are
  // `driver-sql`'s `icontainsComparandError`, word for word — an empty
  // comparand matches every row, and a predicate that constrains nothing WIDENS
  // (#3948).
  if (
    isFilterNode(value) &&
    Object.prototype.hasOwnProperty.call(value, '$icontains') &&
    (typeof value.$icontains !== 'string' || value.$icontains === '')
  ) {
    throw icontainsComparandError(key, value.$icontains, `${here}.$icontains`);
  }

  // A field key always contributes a predicate. This stays `'clause'` even for
  // `{ field: {} }` (a field constrained by zero operators), which this
  // translator emits as `{ field: {} }` — an exact-match on an empty document.
  // That shape is a SEPARATE divergence, ruled REJECT in #5240 and since gated
  // on driver-sql / driver-sqlite-wasm / driver-memory / formula by #5327 —
  // this driver is now the one backend still answering it, tracked by #5376.
  // Classifying it as `'clause'` rather than `'true'` is precisely what keeps
  // this change from silently ruling on it.
  return 'clause';
}

/**
 * [#5158] A `FilterArray` reached the driver unlowered — the twin of
 * `driver-sql`'s and `driver-memory`'s `filterArrayReachedDriverError`, word
 * for word so the three backends answer one condition with one wording, in the
 * ADR-0112 envelope (`400 INVALID_FILTER`) every sibling filter refusal speaks.
 */
function filterArrayReachedDriverError(filters: unknown[]): Error {
  return unsupportedFilterError(
    `A filter ARRAY reached the driver: ${JSON.stringify(filters)}. ` +
    `'where' is a FilterCondition object; the array form ('FilterArray') is input-only ` +
    `authoring sugar and is lowered by @objectstack/spec parseFilterAST() at the engine ` +
    `and protocol doors before any driver sees it (#5158). This driver no longer carries a ` +
    `second compiler for it — call through ObjectQL, or lower the value yourself with ` +
    `parseFilterAST(). Note the INFIX join form ([condA, "or", condB]) has no lowering at ` +
    `all: write the prefix form ["or", condA, condB].`,
  );
}

/**
 * [#4436 / #5240] A filter this driver cannot evaluate, in the ADR-0112
 * envelope every sibling filter refusal across the backends speaks.
 *
 * Extracted from {@link filterArrayReachedDriverError}, which built the same
 * `INVALID_FILTER` / 400 error inline — it was this package's only refusal
 * carrying a wire identity, so there was nothing to share it with until #5347
 * added a second. It is deliberately the SAME envelope as `driver-sql`'s and
 * `driver-memory`'s `unsupportedFilterError`, not a third: #3948 made the
 * backends agree that an uncompilable filter is a refusal, and a suite that
 * swaps one driver for another must see one `400 INVALID_FILTER`, not a coded
 * refusal on three backends and a bare `{ error }` on the fourth.
 *
 * [#5702] The carve-out that used to close this comment is GONE. It read: *"the
 * `default:` arm of {@link translateFieldOperators} still throws a bare `Error`
 * with a `[mongodb]` prefix, outside this envelope. That is #5346's, filed and
 * measured separately."* That arm now routes through this constructor, so this
 * package no longer answers an unknown or retired operator with a 500-shaped
 * body while its three siblings answer `400 INVALID_FILTER` — which was the last
 * place the sentence two paragraphs up was not yet true.
 */
function unsupportedFilterError(message: string): Error {
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_FILTER;
  err.status = 400;
  return err;
}

/**
 * [#5347] `$null` whose comparand is not a boolean.
 *
 * The leading sentence is `driver-sql`'s, verbatim — one condition, one wording
 * (#5240) — and the tail records the measurement that made the refusal the
 * ruling: on one row with `stage: 'won'` and one with `stage: null`,
 * `{ stage: { $null: 'yes' } }` returned the NULL row on driver-sql /
 * driver-sqlite-wasm / Turso local, the VALUED row here and on driver-memory's
 * query path, and BOTH rows through driver-memory's reference matcher. Three
 * readings of one declared operator, none of them anyone's decision — just what
 * a two-branch conditional does with a third value.
 */
function nonBooleanNullComparandError(field: string, value: unknown, path: string): Error {
  return unsupportedFilterError(
    `Operator "$null" on field "${field}" requires a boolean comparand (true or false). ` +
      `Received ${describeFilterOperand(value)} (${safeShapePreview(value)}) at ${path}. ` +
      `@objectstack/spec FieldOperatorsSchema declares $null as a boolean. It is refused rather ` +
      `than coerced because the backends read a non-boolean in OPPOSITE directions — driver-sql ` +
      `compiled IS NULL (anything but false), this driver and driver-memory's query path ` +
      `compiled IS NOT NULL (anything but true), and driver-memory's matcher dropped the ` +
      `constraint entirely. Note "false" the STRING is truthy, so it landed on the side opposite ` +
      `the false it was written to mean (#5347).`,
  );
}

/**
 * [#6520] `$icontains` received a comparand that is not a non-empty string.
 *
 * The twin of `driver-sql`'s and `driver-memory`'s constructor of the same name,
 * word for word: #3948 made the backends agree that an uncompilable filter is a
 * loud refusal rather than a silent match-everything, and a suite that swaps one
 * driver for another has to read one sentence in one envelope. Two rejections in
 * one constructor because they are one mistake at one position — a non-string
 * would have to be coerced into text the query never asked for, and an empty one
 * matches every row.
 */
function icontainsComparandError(field: string, value: unknown, path: string): Error {
  const shown = typeof value === 'string' ? `""` : JSON.stringify(value) ?? String(value);
  return unsupportedFilterError(
    `Operator "$icontains" on field "${field}" at ${path} requires a NON-EMPTY string comparand, ` +
      `received ${shown}. "$icontains" is a case-insensitive LITERAL substring search, so its ` +
      `comparand is the text to look for — an empty one matches every row (a predicate that ` +
      `constrains nothing), and a non-string one would have to be coerced into text this query ` +
      `never asked for.`,
  );
}

/** A short type name for an operand a filter refusal has to describe. */
function describeFilterOperand(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const kind = typeof value;
  if (kind !== 'object') return kind;
  const ctor = (value as { constructor?: { name?: string } }).constructor;
  return ctor?.name && ctor.name !== 'Object' ? ctor.name : 'object';
}

/** A short, non-throwing rendering of an offending value for a message. */
function safeShapePreview(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') return typeof value;
    return json.length > 80 ? `${json.slice(0, 77)}...` : json;
  } catch {
    return typeof value;
  }
}

/**
 * Translate an ObjectStack `where` clause into a MongoDB filter document.
 *
 * The `where` clause can be:
 * 1. A FilterCondition object (MongoDB-style with `$` operators)
 * 2. A plain key-value object for implicit equality
 *
 * An ARRAY is refused (#5158) — see the module header.
 *
 * `temporalKind` resolves the declared temporal type of a field so comparands
 * land in the column's storage form (#4047) — a `Field.datetime` comparand
 * becomes a BSON `Date`, because MongoDB compares across BSON types by type
 * bracket and a string comparand matches no Date row at all. Omitting it keeps
 * the pure shape translation, which is what the standalone export is for.
 */
export function translateFilter(
  where: unknown,
  temporalKind?: TemporalFieldKindResolver,
): Filter<any> {
  if (!where) return {};

  if (Array.isArray(where)) {
    // `[]` still means "no filter" — unchanged.
    if (where.length === 0) return {};
    throw filterArrayReachedDriverError(where);
  }

  if (typeof where !== 'object') return {};

  // [#5239] Shape gate + structural reduction FIRST, over the WHOLE tree. Only
  // a `'clause'` node reaches the emitter, so `translateCondition` never has to
  // ask whether what it built came out empty.
  const node = where as Record<string, unknown>;
  const verdict = reduceFilterNode(node, 'filter');
  if (verdict === 'true') return {};
  if (verdict === 'false') return matchNothing();

  return translateCondition(node, temporalKind, 'filter');
}

/**
 * Translate a FilterCondition object to a MongoDB filter.
 *
 * [#5239] Every combinator key is decided by {@link reduceFilterKey} BEFORE
 * anything is emitted, so an empty group is applied as its boolean IDENTITY
 * rather than dropped: a `'true'` key contributes nothing to the node's AND, a
 * `'false'` key contributes {@link matchNothing}, and only `'clause'` members
 * are translated. That is why every `$and`/`$or` array this function emits is
 * guaranteed non-empty — MongoDB rejects an empty one, and the old code handed
 * it straight through.
 */
function translateCondition(
  condition: Record<string, unknown>,
  temporalKind?: TemporalFieldKindResolver,
  // [#5347] Where in the filter tree this node sits, so a refusal can name the
  // position it refused — the same `filter.$or[0].stage` spelling driver-sql
  // and driver-memory print.
  path = 'filter',
): Filter<any> {
  const mongoFilter: Record<string, unknown> = {};
  const andClauses: Filter<any>[] = [];

  for (const [key, value] of Object.entries(condition)) {
    switch (key) {
      case '$and':
      case '$or': {
        const here = `${path}.${key}`;
        const keyVerdict = reduceFilterKey(key, value, path);
        // TRUE is the AND identity for the node — it adds no condition. FALSE
        // makes the node match nothing.
        if (keyVerdict === 'true') break;
        if (keyVerdict === 'false') {
          andClauses.push(matchNothing());
          break;
        }
        // `'clause'` guarantees at least one branch survives: a TRUE member
        // would have made a `$or` TRUE, a FALSE member would have made a `$and`
        // FALSE, and both were handled above. Dropping the identity members is
        // what makes `{ $or: [{ a: 'x' }, { $or: [] }] }` mean `a = x` rather
        // than an empty `$or` MongoDB refuses.
        const branches = (value as unknown[])
          .map((sub, index) => ({ sub: sub as Record<string, unknown>, index }))
          .filter(({ sub, index }) => reduceFilterNode(sub, `${here}[${index}]`) === 'clause')
          .map(({ sub, index }) => translateCondition(sub, temporalKind, `${here}[${index}]`));
        andClauses.push(key === '$and' ? { $and: branches } : { $or: branches });
        break;
      }

      case '$not': {
        const keyVerdict = reduceFilterKey(key, value, path);
        // NOT FALSE ≡ TRUE — no condition. NOT TRUE ≡ FALSE — zero documents.
        if (keyVerdict === 'true') break;
        if (keyVerdict === 'false') {
          andClauses.push(matchNothing());
          break;
        }
        const inner = translateCondition(
          value as Record<string, unknown>,
          temporalKind,
          `${path}.$not`,
        );
        // MongoDB $not applies per-field; for top-level negation use $nor
        andClauses.push({ $nor: [inner] });
        break;
      }

      default:
        // Skip query-level keys that are not filter conditions
        if (QUERY_LEVEL_KEYS.has(key)) continue;

        if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
          // Check if this is an operator object (has $ keys)
          const objValue = value as Record<string, unknown>;
          const hasOps = Object.keys(objValue).some((k) => k.startsWith('$'));
          if (hasOps) {
            mongoFilter[key] = translateFieldOperators(objValue, temporalKind?.(key), key, `${path}.${key}`);
          } else {
            // Nested object — treat as exact match
            mongoFilter[key] = value;
          }
        } else {
          // Implicit equality
          mongoFilter[key] = coerceTemporalValue(value, temporalKind?.(key));
        }
    }
  }

  if (andClauses.length > 0) {
    if (Object.keys(mongoFilter).length > 0) {
      return { $and: [mongoFilter, ...andClauses] };
    }
    if (andClauses.length === 1) {
      return andClauses[0];
    }
    return { $and: andClauses };
  }

  return mongoFilter;
}

/**
 * Translate ObjectStack field-level operators into MongoDB operators.
 *
 * `kind` is the declared temporal type of the field these operators apply to,
 * so each comparand lands in the field's storage form (#4047). Order matters
 * and is load-bearing: the calendar-day upper-bound rewrite (#3777/#4042) runs
 * on the STRING first — it is a calendar operation — and only the resulting
 * bound is converted to the storage form. Converting first would leave
 * `nextUtcCalendarDay` a `Date` it correctly refuses to widen.
 */
function translateFieldOperators(
  ops: Record<string, unknown>,
  // The shared type, not a hand-copy of its members. This signature spelled
  // the union out literally, so widening the canon to include `time`
  // (ADR-0053 D-C1) left the two out of step and the call site stopped
  // compiling. One definition means the next temporal type is added once.
  kind?: TemporalFieldKind,
  // [#5347] Carried only so a refusal can name the field and the position it
  // refused, the way `driver-sql` and `driver-memory` do.
  field = '<field>',
  path = 'filter',
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const store = (v: unknown) => coerceTemporalValue(v, kind);

  for (const [op, value] of Object.entries(ops)) {
    switch (op) {
      // Direct mappings (ObjectStack → MongoDB are identical)
      case '$eq':
      case '$ne':
      case '$gt':
      case '$gte':
      case '$lt':
      case '$in':
      case '$nin':
        result[op] = store(value);
        break;

      // Value-independent — a presence predicate takes a boolean, not a
      // comparand, so it is never coerced.
      case '$exists':
        result[op] = value;
        break;

      case '$lte': {
        // A bare-day upper bound means "through that whole day" (#4042; the
        // driver-sql twin is #3777): `<= '2026-07-28'` compiles half-open
        // (`< '2026-07-29'`) so instants on the final day stay in;
        // order-equivalent to `<=` for plain `YYYY-MM-DD` date values.
        const nextDay = nextUtcCalendarDay(value);
        if (nextDay != null) result.$lt = store(nextDay);
        else result.$lte = store(value);
        break;
      }

      // String operators → $regex
      case '$contains':
        result.$regex = escapeRegex(String(value));
        result.$options = 'i';
        break;

      case '$notContains':
        result.$not = { $regex: escapeRegex(String(value)), $options: 'i' };
        break;

      case '$startsWith':
        result.$regex = `^${escapeRegex(String(value))}`;
        result.$options = 'i';
        break;

      case '$endsWith':
        result.$regex = `${escapeRegex(String(value))}$`;
        result.$options = 'i';
        break;

      // [#6520] `$icontains` — case-insensitive over ASCII and nothing else.
      //
      // The one arm in this family that does NOT set `$options: 'i'`, and the
      // omission is the whole implementation. Mongo's `i` flag folds the full
      // Unicode range, so it would match `CAFÉ` against `café` — the answer
      // SQLite cannot give and therefore the one the protocol forbids (#4706
      // Q1 = A). The fold lives in the pattern instead, one `[Aa]` class per
      // ASCII letter, from the spec's shared `asciiCaseInsensitiveRegexSource`
      // — the same source `driver-memory`'s mingo path binds.
      //
      // Its four neighbours above ARE `$options: 'i'`, and that is not a
      // precedent to copy: it is them folding Unicode for the case-SENSITIVE
      // `$contains` family, the open defect #6682 tracks on this driver.
      case '$icontains':
        result.$regex = asciiCaseInsensitiveRegexSource(String(value));
        break;

      // Range operator → $gte + upper bound (half-open on a bare-day max,
      // inheriting `$lte`'s whole-day rule — #4042)
      case '$between':
        if (Array.isArray(value) && value.length === 2) {
          result.$gte = store(value[0]);
          const betweenNextDay = nextUtcCalendarDay(value[1]);
          if (betweenNextDay != null) result.$lt = store(betweenNextDay);
          else result.$lte = store(value[1]);
        }
        break;

      // Null check
      //
      // [#5347] The arm used to be a two-branch `if/else` on `value === true`,
      // so EVERY non-boolean comparand fell to the `else` and translated to
      // `$ne: null` — IS NOT NULL. `driver-sql` hung its default on the
      // opposite side (`opValue === false` → IS NULL) and `driver-memory`'s
      // reference matcher on neither (the constraint vanished), so one declared
      // operator had three readings across four backends. Ruled REFUSED on
      // #5347: `FieldOperatorsSchema` declares `$null: z.boolean()`, and there
      // is no reading of a non-boolean here that is not a guess at intent.
      //
      // Since #5239's reduction, the LOAD-BEARING copy of this gate sits in
      // `reduceFilterKey`, on the validating walk: this emitter is skipped
      // wholesale whenever a boolean identity settles the enclosing node
      // (`{ $or: [ {}, { stage: { $null: 'yes' } } ] }` reduces to TRUE before
      // any arm here runs), so a gate only here would refuse or ignore the
      // comparand depending on the shape's SIBLINGS — the evaluation-order
      // dependence #5368 placed driver-sql's gates on its walk to rule out.
      // This arm keeps the check as local defense for its own invariant; both
      // call the one constructor with the same path spelling, so the wire
      // answer is identical whichever fires.
      case '$null':
        if (typeof value !== 'boolean') throw nonBooleanNullComparandError(field, value, `${path}.$null`);
        if (value === true) {
          result.$eq = null;
        } else {
          result.$ne = null;
        }
        break;

      default: {
        // Reject unknown operators instead of passing them through (P0). Keys
        // like `$where` / `$function` / `$expr` / `$accumulator` would reach
        // MongoDB and execute server-side JavaScript or bypass query intent.
        // Every legitimate ObjectQL field operator is allowlisted above.
        //
        // [#5702] Two changes, both about the SHAPE of the refusal rather than
        // its verdict — this arm already refused, including `$regex`, which is
        // why mongo was the one backend already satisfying #4706's requirement 3:
        //
        //  1. It threw a bare `new Error`, with no `code` and no `status`, three
        //     lines from a helper in this same file that sets `INVALID_FILTER` /
        //     400 and whose own comment says "a test suite that swaps one driver
        //     for another must see one `400 INVALID_FILTER`". A 500-shaped body
        //     for a 400-class client mistake is the half of #5324 the refusal
        //     itself does not fix.
        //  2. A RETIRED spelling now gets the spec's prescription instead of the
        //     generic sentence: `$regex`'s author needs `$icontains`, and
        //     "unsupported filter operator" does not say so.
        const retired = RETIRED_FILTER_OPERATORS[op];
        if (retired) {
          const replacement = retired.to ? ` Write "${retired.to}" instead.` : '';
          const alsoRetired = Object.keys(ops).filter(
            (key) => key !== op && RETIRED_FILTER_OPERATORS[key],
          );
          const also = alsoRetired.length
            ? ` The same field constraint also carries the retired ` +
              `${alsoRetired.map((key) => `"${key}"`).join(', ')} — one "${retired.to}" replaces ` +
              `the whole shape, so this is ONE mistake with ONE fix, not one per key.`
            : '';
          throw unsupportedFilterError(
            `Filter operator "${op}" on field "${field}" at ${path} is RETIRED and is no longer ` +
              `translated by this driver.${replacement} ${retired.why}${also}`,
          );
        }
        throw unsupportedFilterError(
          `Unsupported filter operator "${op}" on field "${field}" at ${path}. It is refused ` +
            `rather than passed through to MongoDB, where keys like $where / $function / $expr ` +
            `execute server-side JavaScript or bypass the query's intent (P0).`,
        );
      }
    }
  }

  return result;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
