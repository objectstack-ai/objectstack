// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5869] The engine's binding of the comparand-SHAPE gate for the LIST-SHAPED
 * filter operators, at its single filter collection point — plus the
 * unmaterializable-FIELD gate (#8296) that answers a different question about
 * the same predicate.
 *
 * ## The shape rule itself has moved (#9228) — this file only binds it
 *
 * `assertListComparandShapes` below is a DELEGATING WRAPPER. The rule "a list
 * operator takes a list" has exactly one implementation, and it is
 * `@objectstack/spec/data`'s `filter-comparand-shape.ts`, whose module note
 * carries the divergence table, the #5499 freeze argument and the
 * deliberately-not-refused list. Read that file for the rule; read this
 * function for the engine's two call sites and its wording contract.
 *
 * The gate shipped here (PR #6209) because the engine's lowering seam is the
 * one place every query passes through *on its way to a driver through the
 * engine*. That last clause was the hole: a caller that lowers a filter with
 * `parseFilterAST` and calls a driver directly — `InMemoryDriver.find()`, which
 * is what an embedder does and what this repo's own driver conformance suites
 * do — never reaches this seam. mingo's coercion of a non-array `$in`/`$nin`
 * operand hid it until mingo 7.2.3 removed the coercion; from 7.2.4 on the same
 * input escapes as a raw `TypeError` with no `code` and no `status`. So the
 * rule moved one layer down to the face `parseFilterAST` itself can reach —
 * the routing PR #8234 settled for the sibling comparand-TYPE question
 * ("enforced once at the shared compile face for all five drivers") — and this
 * wrapper keeps the engine's `find('deal'): ` prefix on the refusal.
 *
 * ## Why the wrapper is not deleted along with the body
 *
 * The engine calls the gate on BOTH branches of `lowerWhereFilterArray`, with
 * its own `object` / `operation` pair, and `engine-filter-array-lowering.test.ts`
 * pins the assembled prefix. Keeping the four-argument signature here means the
 * engine's call sites, its message and its verdicts are untouched by the move:
 * one implementation, one wording, no second copy.
 */

import { StandardErrorCode } from '@objectstack/spec/api';
import {
  assertListComparandShapes as assertListComparandShapesAt,
  isVirtualSearchField,
  classifyDottedFilterHead,
} from '@objectstack/spec/data';

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
 * Refuse every list-shaped operator whose comparand cannot be one — the
 * engine's binding of `@objectstack/spec/data`'s `assertListComparandShapes`.
 *
 * [#9228] The walk, the wording and the `INVALID_FILTER` / 400 envelope all
 * live in the spec module now; the ONE thing this wrapper adds is the engine's
 * caller prefix (`find('deal'): `), assembled from the `object` / `operation`
 * pair the engine has at its collection point and the spec face does not.
 * `parseFilterAST` runs the same gate one step earlier for callers that never
 * reach an engine, and it takes the same `context` argument, so an array-form
 * `where` refused during lowering still carries this prefix.
 *
 * Read-only and allocation-free on the overwhelmingly common path (a filter
 * with no list operator walks its own keys and returns). Runs on every engine
 * read and write, so it stays a walk rather than a schema parse.
 */
export function assertListComparandShapes(
  object: string,
  operation: string,
  node: unknown,
  path = 'where',
): void {
  assertListComparandShapesAt(node, `${operation}('${object}')`, path);
}

/**
 * [#8296] FILTER on a field whose value is computed on read — refused HERE, on
 * the engine's own filter seam, and no longer only at the REST ingress.
 *
 * `formula` is the one field type no driver materialises a column for. Three
 * query axes can name a field, and until this landed only two of them said so:
 * SORT answers `400 INVALID_SORT` (#6994 at ingress, #7095 at this engine
 * boundary) and SEARCH answers `400 INVALID_FIELD` (#6674) — while FILTER
 * accepted the same field, handed the predicate to a driver with no column for
 * it, and answered 200 with zero rows. Measured on a real `ObjectQL`, base
 * cb43296ef, `is_open` a `formula` over the stored `status` column:
 *
 * ```
 * engine.find(o,    { where: { is_open: true  } }) -> []  200, no error
 * engine.find(o,    { where: { is_open: false } }) -> []  200, no error
 * engine.findOne(o, { where: { is_open: true  } }) -> null
 * engine.count(o,   { where: { is_open: true  } }) -> 0
 * CONTROL find(o,   { where: { status: 'open' } }) -> 4 rows
 * ```
 *
 * BOTH directions returning nothing is what makes this worse than the sort
 * axis' dropped ORDER BY: a filter changes the row SET, and the `false`
 * direction is the dangerous one — the same predicate against a STORED boolean
 * returns every row, so a filter meaning "not yet done" silently becomes "no
 * records at all". The rows are not merely misordered; they are absent, and the
 * response is indistinguishable from an empty table. The formula READS
 * correctly in that same response (`applyFormulaPlan` hydrates it after the
 * driver returns), so the field is visibly populated and simultaneously
 * unfilterable.
 *
 * WHY A REFUSAL AND NOT A SILENT ZERO: the standing maintainer ruling of
 * 2026-08-12 — if the platform cannot honour a declaration, refuse it at the
 * latest checkpoint that can see the whole picture, name the offending key
 * path, and never answer 200. Same direction as ADR-0032 (no silent failure)
 * and as the sort axis' #7095 ruling one axis over.
 *
 * WHY AT THIS SEAM AND NOT ONLY AT INGRESS: #7095 had to add
 * `assertOrderByIsMaterializable` inside this package because a saved report's
 * `query.orderBy` is forwarded verbatim into `engine.find` and never passes the
 * REST door. Filters travel the SAME path — `plugin-reports`' `executeReport`
 * calls `this.engine.find(report.object_name, { where: q.filter, … })` — so an
 * ingress-only fix would have left the author-reachable half open. This gate
 * runs inside `lowerWhereFilterArray`, the one seam EVERY caller-supplied
 * `where` passes through (`find` / `findOne` / `count` / `aggregate` / `update`
 * / `delete`), which is what makes a new verb unable to miss it by omission.
 *
 * ORDERING: it judges the CALLER's own `where`, before the middleware chain
 * composes RLS / sharing / tenant predicates onto `opCtx.ast.where`. That is
 * deliberate — an injected read filter is the platform's own, not a
 * declaration the caller can fix, and refusing one would turn a policy into a
 * 400 nobody can act on.
 *
 * SCOPE — the unmaterializable verdict and, since #8371, the DOTTED-head
 * verdict. An UNKNOWN filter field is still not judged here: that is the
 * ingress gate's first verdict (`assertFilterFieldsExist`, #7534), the engine
 * deliberately keeps its registry-less tolerance, and widening this door to it
 * is a separate posture change on a second verdict, exactly as #7095 declined
 * to inherit sort's `unknown` leg. The dotted verdict IS inherited (unlike
 * sort's) because it is author-reachable through the exact same forwarded
 * surfaces as the virtual one — a saved report's `query.filter` never passes
 * the ingress — and because the #8371 measurement showed the refused head
 * classes (relation / virtual / scalar) match zero rows on every backend, so
 * this door refuses nothing a driver could have served. A dotted key whose
 * head this door cannot classify — structured/JSON (the ruling's deliberate
 * carve-out: live on two of three backends), arrays, files, heads absent from
 * the field map — passes through unchanged.
 *
 * A registry-less host (`schema.fields` undefined) returns early, exactly as
 * the ingress gate returns early when `resolveQueryFields` cannot answer: a
 * door that cannot see the field map must not invent a verdict about it.
 *
 * The wording deliberately shares its remedy sentence with the ingress door,
 * duplicated rather than imported because `metadata-protocol` is assembled FROM
 * an engine, so the engine cannot import from it without inverting the
 * layering (the same argument `assertOrderByIsMaterializable` records). The
 * agreement pin in `query-expression-conformance.test.ts` is what keeps the
 * duplication honest.
 */
export function assertFilterIsMaterializable(
  object: string,
  operation: string,
  schema: unknown,
  where: unknown,
): void {
  const fields = (schema as { fields?: Record<string, unknown> } | undefined)?.fields;
  if (!fields || typeof fields !== 'object') return;
  const { named, dotted } = collectFilterFieldNames(where);
  if (named.length === 0 && dotted.length === 0) return;

  // [#8371] The DOTTED verdict, before the virtual one — mirroring the ingress
  // door's `unknown` > `dotted` > unmaterializable ladder, so a dotted path
  // whose head is a formula field gets the same answer at both doors (the
  // dotted one: it is wrong about the shape too, and the shape is what the
  // caller wrote). Judged by the ONE classification both doors share
  // (`classifyDottedFilterHead`, `@objectstack/spec/data`): relation, virtual
  // and plain-scalar heads matched ZERO rows on all three drivers in the
  // #8371 measurement, so this refusal takes nothing from anyone — it renames
  // a silent wrong answer into a loud one. A head the classifier answers
  // `null` for — structured/JSON (⛔ the ruling's deliberate carve-out, live
  // on memory and mongodb), arrays, files, or a head not in this field map —
  // passes through unchanged, the same fail-open direction the collector
  // documents.
  const judgedDotted = dotted.filter(
    (f) => classifyDottedFilterHead(fields[f.split('.')[0]] as never) !== null,
  );
  if (judgedDotted.length > 0) {
    const first = judgedDotted[0];
    const head = first.split('.')[0];
    const headDef = fields[head] as { type?: unknown } | undefined;
    const headClass = classifyDottedFilterHead(headDef as never);
    const headType = String(headDef?.type ?? '');
    const body = headClass === 'relation'
      ? `filters on '${first}', which follows the relationship '${head}' into another object — `
        + `a filter reaches only columns of '${object}' itself, and '${head}' stores the related `
        + 'record\'s id, not an embedded document'
      : headClass === 'virtual'
        ? `filters on '${first}', a dotted path whose head '${head}' is a virtual ${headType} `
          + `field on '${object}' — its value is computed on read, so no driver materialises a `
          + 'column for the path to reach into'
        : `filters on '${first}', a dotted path into '${head}', a ${headType} field on `
          + `'${object}' that stores a single scalar value — there is nothing beneath it for a `
          + 'path to reach';
    const dottedErr = new Error(
      `ObjectQL.${operation}('${object}') ${body}`
      + (judgedDotted.length > 1 ? ` (also: ${judgedDotted.slice(1).join(', ')})` : '')
      + '. No backend serves the path, so the predicate can only match zero records: the query '
      + 'was refused instead of answered with an empty list.'
      // Deliberately the SAME remedy, in the same words, as the ingress
      // door's dotted refusal and both doors' #8296 virtual refusals. One
      // vocabulary across the doors.
      + ` Denormalise the value onto '${object}' (a stored field, written when the source`
      + ' changes) and filter that.',
    ) as Error & { code?: string; status?: number; field?: string; fields?: string[]; object?: string };
    // Same identity argument as the virtual verdict below: the question is
    // about the NAME (its head's type), so `INVALID_FIELD`/400 — never a new
    // code, per the #8371 ruling's own words.
    dottedErr.status = 400;
    dottedErr.code = StandardErrorCode.enum.INVALID_FIELD;
    dottedErr.field = first;
    dottedErr.fields = judgedDotted;
    dottedErr.object = object;
    throw dottedErr;
  }
  if (named.length === 0) return;
  // Judged by the same `@objectstack/spec/data` predicate the SEARCH axis and
  // the ingress door use, never a list minted here, so gate and drivers cannot
  // disagree about which types have a column. `summary` and `autonumber` are
  // deliberately NOT in it: both get real stored columns and filter correctly.
  const virtual = named.filter((f) => isVirtualSearchField(fields[f] as never));
  if (virtual.length === 0) return;
  const first = virtual[0];
  const type = String((fields[first] as { type?: unknown } | undefined)?.type ?? 'formula');
  const err = new Error(
    `ObjectQL.${operation}('${object}') filters on '${first}', a virtual ${type} field on `
    + `'${object}' — a ${type} value is computed on read, so no driver materialises a column `
    + 'to filter on'
    + (virtual.length > 1 ? ` (also: ${virtual.slice(1).join(', ')})` : '')
    + '. The predicate was not applied as written: it reaches the driver, matches nothing, and '
    + 'returns an empty result in BOTH directions — a false test answers no records where the '
    + 'same test against a stored boolean answers every record.'
    // Deliberately the SAME remedy, in the same words, as the ingress door's
    // formula refusal, with only the verb naming this axis. One vocabulary
    // across the doors: a caller refused at the REST boundary and a caller
    // refused here must not be sent two different ways.
    + ` Denormalise the value onto '${object}' (a stored field, written when the source`
    + ' changes) and filter that.',
  ) as Error & { code?: string; status?: number; field?: string; fields?: string[]; object?: string };
  // `INVALID_FIELD`, not `INVALID_FILTER`, and not a new code: this verdict is
  // about the NAME's type, which is the question the ingress door answers with
  // `INVALID_FIELD` on its neighbouring `unknown` verdict and the SEARCH axis
  // answers with `INVALID_FIELD` for this very field class. `INVALID_FILTER` is
  // this package's VALUE-shape envelope (#5869 / #7047) — a different fact.
  // 400 rather than 500 for the reason `assertOrderByIsMaterializable` records:
  // one condition keeps ONE wire code however the caller reached it, so a host
  // surfacing engine errors over HTTP answers the same envelope on both doors.
  err.status = 400;
  err.code = StandardErrorCode.enum.INVALID_FIELD;
  err.field = first;
  err.fields = virtual;
  err.object = object;
  throw err;
}

/**
 * Every key of a `FilterCondition` that NAMES A FIELD of THIS object, structure
 * discarded — whether a predicate sits under an `$or` changes nothing about
 * whether its column exists.
 *
 * The same three conservative rules the ingress collector applies
 * (`collectFilterFieldKeys`, `metadata-protocol`), for the same reasons:
 *
 * - **A `$`-prefixed key is never a field.** `$and` / `$or` / `$not` are
 *   recursed into; any OTHER `$` key is skipped WITHOUT descending, so an
 *   unrecognised combinator leaves the fields beneath it ungated — a hole, not
 *   a false 400, which is the right failure direction for a gate that exists to
 *   stop wrong answers rather than invent new ones.
 * - **A field key's VALUE is not descended into.** It is an operator bag
 *   (`{$gte: 18}`) or a nested-relation condition (`{owner: {region: 'NA'}}`),
 *   and the latter's keys belong to a DIFFERENT object whose field map this
 *   gate has not resolved.
 * - **A DOTTED key is collected SEPARATELY** (#8371), never merged into
 *   `named`: its verdict is its own (judged on the head's type by
 *   `classifyDottedFilterHead`), and folding it into the undotted list would
 *   hand `'owner.region'` to a virtual check that reads `fields['owner.region']`
 *   — a lookup that can only miss.
 *
 * `depth` is a cheap backstop against a self-referential `where` — in-process
 * callers hand over live objects, and a gate that can hang the read path is
 * worse than the defect it closes.
 */
function collectFilterFieldNames(
  where: unknown,
  out: { named: string[]; dotted: string[] } = { named: [], dotted: [] },
  depth = 0,
): { named: string[]; dotted: string[] } {
  if (depth > 32) return out;
  if (!isFilterNode(where)) return out;
  for (const [key, value] of Object.entries(where)) {
    if (key.startsWith('$')) {
      if (key !== '$and' && key !== '$or' && key !== '$not') continue;
      if (Array.isArray(value)) {
        for (const arm of value) collectFilterFieldNames(arm, out, depth + 1);
      } else {
        collectFilterFieldNames(value, out, depth + 1);
      }
      continue;
    }
    if (key.includes('.')) { out.dotted.push(key); continue; }
    out.named.push(key);
  }
  return out;
}
