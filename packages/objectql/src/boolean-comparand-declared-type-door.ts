// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21333] The BOOLEAN-comparand arm of the engine's one field-aware filter
 * walk — the boolean twin of the number-comparand door (#20351), at the same
 * seam, the same positions and the same three filter positions (`where` on
 * both spellings, the per-aggregation `filter`, `having`).
 *
 * ## What it answers
 *
 * A comparand against a declared boolean field (`boolean`, `toggle`, a
 * `formula` returning `boolean`):
 *
 * - `true` / `false` pass, as written;
 * - `1` / `0`, `"1"` / `"0"` and `"true"` / `"false"` NARROW to `true` /
 *   `false`, copy-on-write, so every backend receives the one boolean each
 *   spelling names — a bare query parameter (`?active=true`) is always a
 *   string, and before this arm `"true"` matched no row on any driver while
 *   `1` matched no row on InMemoryDriver;
 * - any other string (`"yes"`, `"TRUE"`, `""`, a `{placeholder}`) is refused
 *   `INVALID_FILTER` / 400, naming the field and its declared type, before
 *   any driver is resolved;
 * - [#21382] and so is a number other than `1` / `0`, a `Date` and an array
 *   (at a scalar slot or as a list member) — before, each reached the drivers
 *   as written: PostgreSQL answered `2` or a `Date` with a 500, the others
 *   with an empty 200, and an array `$in` member split 200 / 400 across
 *   drivers. A `bigint` is read as the number it names. The spec's verdict
 *   was widened; this file changed only in these words, because the arm
 *   already routed every comparand to it and carried the refused value as
 *   written.
 *
 * The contract — the accepted spellings, the pure verdict, the refusal words,
 * the case table — is lane (1), `@objectstack/spec/data`'s
 * `filter-boolean-comparand-declared-type.ts`. ⛔ Nothing here reads a
 * spelling: the verdict does.
 *
 * ## Why an arm and not a door of its own
 *
 * `number-comparand-declared-type-door.ts`'s `walkCondition` is the one filter
 * walk the engine runs at all three positions with each column's declaration
 * in hand, and every position-specific fact (the site kind, the relation arm,
 * the copy-on-write discipline, the depth bound and the combinators descended)
 * lives in it. A second walk would redraw every one of those boundaries. So
 * the walk asks this arm at each field key the number arm does not judge (the
 * two classes are disjoint), exactly as it asks the no-operator-object arm
 * (`no-operator-object-door.ts`) — and, like that module, ⛔ nothing here
 * walks a filter.
 *
 * ## One door for every surface
 *
 * Every REST spelling reaches the walk unchanged: the `POST …/query` body's
 * `where`, the `filter` / `$filter` JSON and the `FilterArray` sugar
 * (`parseFilterAST` lowers it first), and the bare query parameters, which
 * `metadata-protocol`'s `findData` folds into an implicit `where` of strings.
 * ⛔ No per-door coercion: the REST layer and the protocol hand the strings
 * through, and this arm is the only place one becomes a boolean.
 *
 * @see booleanComparandDoorVerdict — the pure verdict (lane 1, `@objectstack/spec`).
 * @see https://github.com/objectstack-ai/objectstack/issues/21333
 */

import {
  booleanComparandDoorVerdict,
  booleanComparandFieldVerdict,
  booleanComparandRefusalMessage,
  type BooleanComparandDoorFieldMeta,
  type BooleanComparandRefusalSite,
} from '@objectstack/spec/data';

/** A comparand the arm refuses: the site the contract's words are written from. */
export type NonBooleanComparand = BooleanComparandRefusalSite;

/** The arm's answer for one comparand: kept (possibly narrowed), or refused at a site. */
export type BooleanArmAnswer =
  | { readonly refused: false; readonly value: unknown }
  | { readonly refused: true; readonly site: NonBooleanComparand };

/**
 * The field meta the arm judges, or `null` when it does not judge this
 * declaration — the spec's field verdict decides (`deferred` and
 * `not-judged` are both "nothing to judge here"), never a list here.
 */
export function booleanArmFieldMeta(meta: BooleanComparandDoorFieldMeta | null): BooleanComparandDoorFieldMeta | null {
  return meta !== null && booleanComparandFieldVerdict(meta) === 'judged' ? meta : null;
}

/**
 * One comparand at a judged position: the spec's verdict, routed. Whatever the
 * comparand is — a string, a number, a `Date`, an array (#21382) — the verdict
 * alone decides; this function only turns its answer into an outcome.
 * `aggregated` is the walk's site fact — `having`'s columns are the aggregated
 * row's, not a declared field — and only ever written when true.
 */
export function judgeBooleanComparand(
  meta: BooleanComparandDoorFieldMeta,
  field: string,
  comparand: unknown,
  path: string,
  aggregated: boolean,
): BooleanArmAnswer {
  const verdict = booleanComparandDoorVerdict(meta, comparand);
  if (verdict.verdict === 'narrows') return { refused: false, value: verdict.value };
  if (verdict.verdict !== 'door-refusal') return { refused: false, value: comparand };
  return {
    refused: true,
    site: {
      field,
      declaredType: meta.type,
      ...(meta.returnType === undefined ? {} : { returnType: meta.returnType }),
      path,
      value: comparand,
      form: verdict.form,
      ...(aggregated ? { aggregated: true as const } : {}),
    },
  };
}

/** The arm's refusal words — the contract's, behind the engine's caller prefix. */
export function nonBooleanComparandRefusalMessage(site: NonBooleanComparand, context: string): string {
  return booleanComparandRefusalMessage(site, context);
}
