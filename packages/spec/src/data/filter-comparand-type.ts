// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7872] The Filter Protocol's **comparand-type door** — the one place that
 * decides which JS types a LITERAL comparand may have, for every driver.
 *
 * ## The ruling this enforces
 *
 * Maintainer, 2026-08-12 (#7872): the shared filter-compilation face in
 * `packages/spec` defines the accepted comparand-type set as the **measured
 * superset — `string | number | bigint | boolean | null | Date`** — and
 * refuses everything else loudly at the compile face. The earlier "any
 * JSON-representable literal" wording was explicitly rejected: `bigint` is not
 * JSON-representable yet was accepted by four of five drivers, so the set is
 * defined from measurement (#7956's divergence matrix), not from a JSON slogan.
 *
 * ## Why a door, and why here
 *
 * The four-driver divergence matrix (#7956, measured on `main`) found two camps
 * and one hole: the SQL family (`driver-sql`, the inherited
 * `driver-sqlite-wasm`, `driver-turso` both transports) had converged twice
 * independently on exactly this allow-list, in the ADR-0112 envelope;
 * `driver-memory` crashed on `BigInt` (a raw mingo `TypeError` out of
 * `Query.compile`) and answered silent zero rows for five other types; and
 * `driver-mongodb` let the BSON encoder silently EDIT the document —
 * `{qty: undefined}` encoded to `{}`, a filter that matches EVERY row (the
 * matrix's worst cell: an amplifying, disclosure-shaped wrong answer when a
 * tenant or RLS predicate sits in the same object). Both driver families that
 * lack a policy are under the #5499 investment freeze, so the policy cannot be
 * grown per driver; it is promoted here, to the face the SQL family already
 * agrees with, and the frozen drivers inherit it by receiving already-validated
 * input (they sit behind the engine's lowering seam — see
 * `@objectstack/objectql`'s `lowerWhereFilterArray` — and behind
 * {@link parseFilterAST}, which calls this walk on everything it returns).
 *
 * ## `bigint` is accepted — and NARROWED, copy-on-write
 *
 * `bigint` is in the accepted set (4/5 drivers execute it; `RemoteTransport`
 * enumerates it as legal on purpose and a test pins the binding). But
 * `driver-memory`'s engine (mingo) cannot serialize one at any value, and a
 * `bigint` beyond ±2^53 silently loses precision on any backend that stores
 * doubles — a comparison that runs and answers the wrong rows. So the door
 * accepts a `bigint` whose value is exactly representable as a JS number and
 * REWRITES it to that number (the same declared-conversion pattern as
 * `RemoteTransport`'s `Date` → ISO 8601), and refuses one beyond ±2^53 loudly
 * rather than letting the precision loss answer silently. This is what makes
 * "each of the six accepted types compiles on every driver path" true on the
 * memory path too, without touching the frozen driver: after this door, no
 * `bigint` reaches mingo at all. Direct driver callers (not going through the
 * platform's doors) keep the drivers' native `bigint` binding, which stays
 * pinned in `driver-turso`'s own suite.
 *
 * ## What is a LITERAL comparand — the positions this door judges
 *
 * The six-type set governs literal comparands and nothing else:
 *
 * - the implicit-equality comparand — `{ qty: V }` — when `V` is not filter
 *   STRUCTURE (see below);
 * - a declared operator's scalar comparand — `{ qty: { $eq: V } }`, and every
 *   other key of `FieldOperatorsSchema`;
 * - each MEMBER of a list operator's array — `$in` / `$nin` / `$between` — a
 *   comparand in its own right (#5234's split, applied at the shared face).
 *
 * Deliberately NOT judged, each for a recorded reason:
 *
 * - **Filter structure.** A PLAIN object (prototype `Object.prototype` or
 *   `null`, the `isFilterNode` convention shared with `driver-sql` #5134) in a
 *   field's value position is an operator spec or a nested-relation /
 *   deep-equality condition — `assertListComparandShapes` (#5869) records why
 *   descending into the no-`$`-key form would invent a contract no backend
 *   agrees with. A plain object sitting where a SCALAR belongs — `{ $eq: {…} }`
 *   — IS judged, and refused, which is what the SQL family already did.
 * - **A `FieldReference`** (`{ $field: 'other_column' }`) anywhere: it is not a
 *   literal, and its per-position legality is ruled elsewhere (#5222 compiles
 *   it on the ordering operators; #7596 rules it out of list members by name;
 *   #7597 pins the hand-authored implicit form's fate). The door steps around
 *   every one of those decisions.
 * - **Arrays outside `$in`/`$nin`/`$between`.** An array in an implicit or
 *   scalar-operator position is answered per driver today (`driver-sql` refuses
 *   it with its own message; the document stores give it array-equality
 *   semantics); the matrix did not measure it and the ruling does not name it,
 *   so the door leaves it to the layers that already answer it.
 * - **An operator outside the declared vocabulary** (`$wat`, retired `$regex`):
 *   the unknown-/retired-operator refusals downstream carry the specific
 *   prescriptions (`RETIRED_FILTER_OPERATORS`), which a generic type refusal
 *   here would preempt with a worse message.
 * - **List-operator comparands that are not arrays at all** (`{ $in: 'won' }`):
 *   that is a SHAPE defect, owned by the engine's #5869 gate, whose wording
 *   (#5346/#5348) is pinned by consumers.
 *
 * ## Refusal envelope
 *
 * Every refusal carries `code: 'INVALID_FILTER'` and `status: 400` (ADR-0112
 * class 1 — a caller mistake). The literal is spelled here rather than imported
 * from `../api/errors.zod` because `api/` imports from `data/` and the reverse
 * edge would be a cycle; `filter-comparand-type.test.ts` pins the literal to
 * `StandardErrorCode.enum.INVALID_FILTER` so the two cannot drift. Messages
 * front-load operator, field, path, received type and the accepted set, and end
 * with the "NOT applied" sentence, inside the 500-char client bound (#5423).
 *
 * @see FILTER_COMPARAND_TYPE_CASES — the conformance table every driver runs.
 * @see https://github.com/objectstack-ai/objectstack/issues/7872 (the ruling)
 * @see https://github.com/objectstack-ai/objectstack/issues/7956 (the matrix)
 */

/**
 * The accepted comparand-type set, as type names. The order is the SQL
 * family's established message order, which {@link ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE}
 * renders and the drivers' own refusals now quote instead of hand-copying.
 */
export const ACCEPTED_FILTER_COMPARAND_TYPES = [
  'string',
  'number',
  'bigint',
  'boolean',
  'null',
  'Date',
] as const;

/**
 * The accepted set as the sentence fragment the platform's refusals share —
 * byte-identical to the wording `driver-turso`'s `RemoteTransport` pinned in
 * its own suite before this door existed, so reconciling that driver to the
 * door changes no message.
 */
export const ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE =
  'a string, number, bigint, boolean, null or Date';

/**
 * The largest `bigint` magnitude the door will narrow to a JS number: 2^53,
 * the last integer `number` represents exactly (`Number.MAX_SAFE_INTEGER` is
 * 2^53 − 1, and 2^53 itself is still exact). Beyond it, `Number(v) !== v` and
 * a comparison built on the narrowed value would answer the wrong rows without
 * a word — the silent-wrong-answer direction the whole door exists to refuse.
 */
export const FILTER_COMPARAND_BIGINT_EXACT_LIMIT = 2n ** 53n;

/**
 * Is `value` one of the six accepted literal comparand types?
 *
 * This predicate is the SET, single-sourced: `driver-sql`'s
 * `isBindableComparand` / `isRenderableTextComparand` and `driver-turso`'s
 * `RemoteTransport.serializeComparand` delegate their type membership here
 * (each keeps its own envelope and its recorded driver-local extras — binary
 * bindables, the unreachable `undefined` arm — declared at the use site).
 *
 * Note `bigint` answers TRUE at any magnitude: membership is a TYPE question.
 * The magnitude rule belongs to {@link normalizeFilterComparandTypes}, which is
 * where a bigint is narrowed or refused.
 */
export function isAcceptedFilterComparand(value: unknown): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'bigint':
    case 'boolean':
      return true;
    default:
      return value instanceof Date;
  }
}

/**
 * The declared field-operator vocabulary, split by what the comparand IS.
 * `filter-comparand-type.test.ts` reconciles the union of these two sets
 * against `FieldOperatorsSchema`'s own keys, so an operator added to the
 * schema cannot silently skip the door.
 */
const SCALAR_COMPARAND_OPERATORS: ReadonlySet<string> = new Set([
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte',
  '$contains', '$notContains', '$startsWith', '$endsWith', '$icontains',
  '$like', '$ilike',
  '$null', '$exists',
]);

const LIST_COMPARAND_OPERATORS: ReadonlySet<string> = new Set([
  '$in', '$nin', '$between',
]);

/**
 * Filter STRUCTURE rather than a comparand: a PLAIN object — prototype
 * `Object.prototype` or `null`. The same load-bearing prototype check as
 * `driver-sql`'s `isFilterNode` (#5134): a `Date`, a `Map` or a class instance
 * satisfies `typeof x === 'object'` while being data, not structure.
 */
function isFilterNode(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * A `FieldReferenceSchema` comparand — `{ $field: 'other_column' }`. Matches
 * `parseFilterAST`'s `isFieldReferenceComparand` and `driver-sql`'s
 * `fieldReferenceOf`: the `$field` value must be a string, or the object is
 * not a reference on any path.
 */
function isFieldReference(value: unknown): boolean {
  return isFilterNode(value) && typeof value.$field === 'string';
}

/** The word the refusal uses for the offending value's type. */
function describeComparandType(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'an array';
  const kind = typeof value;
  if (kind === 'function') return 'a function';
  if (kind === 'symbol') return 'a Symbol';
  if (kind !== 'object') return `a ${kind}`;
  const ctor = (value as { constructor?: { name?: string } }).constructor;
  return ctor?.name && ctor.name !== 'Object' ? `a ${ctor.name} instance` : 'a plain object';
}

/**
 * A short, bounded rendering of the offending value — for a human reading a
 * 400, not a dump. Bounded because the whole message is truncated at the
 * 500-char client bound (#5423), so everything load-bearing is front-loaded.
 */
function preview(value: unknown): string {
  let text: string;
  try {
    if (typeof value === 'bigint') text = `${value}n`;
    else if (typeof value === 'symbol' || typeof value === 'function') text = String(value);
    else text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/**
 * The wire envelope every filter refusal on the platform carries — ADR-0112
 * class 1. See the module note for why the code is a literal here.
 */
function invalidComparandError(context: string | undefined, message: string): Error {
  const err = new Error(`${context ? `${context}: ` : ''}${message}`) as Error & {
    code?: string;
    status?: number;
  };
  err.code = 'INVALID_FILTER';
  err.status = 400;
  return err;
}

const NOT_APPLIED =
  'The filter was NOT applied, and an unapplied filter would have returned the UNFILTERED result set.';

/** `undefined` gets its own sentence — it is the one refused value that arrives by ACCIDENT. */
function undefinedComparandRefusal(context: string | undefined, path: string): Error {
  return invalidComparandError(
    context,
    `Filter comparand at ${path} is undefined. { key: undefined } cannot be told apart from an ` +
      `omitted key, yet the two mean OPPOSITE things (a predicate vs no constraint) — one ` +
      `backend even encoded it as MATCH EVERYTHING. Write null for the null predicate, or omit ` +
      `the key. A comparison value must be ${ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE}. ` +
      NOT_APPLIED,
  );
}

function comparandTypeRefusal(context: string | undefined, path: string, value: unknown): Error {
  return invalidComparandError(
    context,
    `Filter comparand at ${path} is ${describeComparandType(value)} (${preview(value)}), which ` +
      `no driver can compare. A comparison value must be ` +
      `${ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE}. Refusing rather than guessing: the backends ` +
      `disagreed on this input (crash / zero rows / silently edited query). ${NOT_APPLIED}`,
  );
}

function bigintPrecisionRefusal(context: string | undefined, path: string, value: bigint): Error {
  return invalidComparandError(
    context,
    `Filter comparand at ${path} is the bigint ${preview(value)}, whose magnitude exceeds 2^53 ` +
      `— it has no exact JS-number form, so a comparison built on it would silently answer the ` +
      `wrong rows on double-storing backends. Compare within ±2^53, or store and compare the ` +
      `value as a string. A comparison value must be ` +
      `${ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE}. ${NOT_APPLIED}`,
  );
}

/** The verdict for one literal comparand position. */
type ComparandVerdict =
  | { kind: 'keep' }
  | { kind: 'narrow'; value: number }
  | { kind: 'refuse'; error: Error };

/**
 * Judge one LITERAL comparand. `skip` answers (as `keep`) the shapes the door
 * deliberately does not judge — see the module note's list.
 */
function judgeLiteralComparand(
  context: string | undefined,
  path: string,
  value: unknown,
): ComparandVerdict {
  if (value === undefined) return { kind: 'refuse', error: undefinedComparandRefusal(context, path) };
  if (typeof value === 'bigint') {
    if (value <= FILTER_COMPARAND_BIGINT_EXACT_LIMIT && value >= -FILTER_COMPARAND_BIGINT_EXACT_LIMIT) {
      return { kind: 'narrow', value: Number(value) };
    }
    return { kind: 'refuse', error: bigintPrecisionRefusal(context, path, value) };
  }
  if (isAcceptedFilterComparand(value)) return { kind: 'keep' };
  // Not judged: arrays (per-driver semantics outside the list operators),
  // field references, and plain-object filter STRUCTURE — the caller routes
  // those before asking. What reaches this line is a non-plain object
  // (Map / Set / class instance), a Symbol or a function.
  if (Array.isArray(value) || isFieldReference(value)) return { kind: 'keep' };
  return { kind: 'refuse', error: comparandTypeRefusal(context, path, value) };
}

/**
 * Walk one `FilterCondition` and enforce the comparand-type set on every
 * literal comparand position; narrow exact-range bigints copy-on-write.
 *
 * Returns the SAME reference when nothing narrowed (the overwhelmingly common
 * path allocates nothing — the same contract as the engine's lowering seam);
 * throws the ADR-0112 `INVALID_FILTER` / 400 envelope on the first refused
 * comparand.
 *
 * `context` is an optional caller prefix (`find('deal')`) matching the
 * engine's refusal wording contract (#5346); the spec-level callers pass none.
 */
export function normalizeFilterComparandTypes<T>(node: T, context?: string, path = 'where'): T {
  if (!isFilterNode(node)) return node;
  let out: Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(node)) {
    const here = `${path}.${key}`;
    let next: unknown = value;
    if (key === '$and' || key === '$or') {
      if (Array.isArray(value)) {
        let copy: unknown[] | undefined;
        value.forEach((child, index) => {
          const normalized = normalizeFilterComparandTypes(child, context, `${here}[${index}]`);
          if (normalized !== child) {
            copy ??= [...value];
            copy[index] = normalized;
          }
        });
        if (copy) next = copy;
      }
    } else if (key === '$not') {
      next = normalizeFilterComparandTypes(value, context, here);
    } else if (!key.startsWith('$')) {
      next = normalizeFieldSpec(context, here, value);
    }
    // Any other `$` key at node level is a logical operator this door does not
    // judge — an unknown one is already refused downstream, by name.
    if (next !== value) {
      out ??= { ...(node as Record<string, unknown>) };
      out[key] = next;
    }
  }
  return (out ?? node) as T;
}

/** One field constraint: `{ field: <spec> }`. */
function normalizeFieldSpec(context: string | undefined, path: string, spec: unknown): unknown {
  // A plain object is filter STRUCTURE: an operator spec, a nested-relation /
  // deep-equality condition (not descended into — see the module note), or a
  // field reference (stepped around — #7597 owns its fate).
  if (isFilterNode(spec)) {
    if (isFieldReference(spec)) return spec;
    const keys = Object.keys(spec);
    if (!keys.some((key) => key.startsWith('$'))) return spec;
    let out: Record<string, unknown> | undefined;
    for (const [op, comparand] of Object.entries(spec)) {
      let next: unknown = comparand;
      if (SCALAR_COMPARAND_OPERATORS.has(op)) {
        next = applyVerdict(judgeLiteralComparand(context, `${path}.${op}`, comparand), comparand);
      } else if (LIST_COMPARAND_OPERATORS.has(op) && Array.isArray(comparand)) {
        // Each member is a comparand in its own right (#5234). A non-array
        // comparand here is a SHAPE defect owned by the engine's #5869 gate.
        let copy: unknown[] | undefined;
        comparand.forEach((member, index) => {
          const verdict = judgeLiteralComparand(context, `${path}.${op}[${index}]`, member);
          if (verdict.kind === 'refuse') throw verdict.error;
          if (verdict.kind === 'narrow') {
            copy ??= [...comparand];
            copy[index] = verdict.value;
          }
        });
        if (copy) next = copy;
      }
      if (next !== comparand) {
        out ??= { ...spec };
        out[op] = next;
      }
    }
    return out ?? spec;
  }
  // Everything else in a field's value position is the implicit-equality
  // LITERAL comparand.
  return applyVerdict(judgeLiteralComparand(context, path, spec), spec);
}

function applyVerdict(verdict: ComparandVerdict, value: unknown): unknown {
  if (verdict.kind === 'refuse') throw verdict.error;
  return verdict.kind === 'narrow' ? verdict.value : value;
}
