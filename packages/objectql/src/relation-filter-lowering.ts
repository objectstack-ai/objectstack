// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20802] The NESTED-RELATION form, SERVED: `{ relation: { field: value } }` —
 * a plain object with no `$`-operator key beneath a relation field of the
 * queried object, whose keys are fields of the related object — is lowered at
 * the engine's filter seam into a filter every driver already answers, and the
 * drivers never see the nested form (ADR-0053 D-D1 item 5, the #5930 ruling's
 * D4 (b): drivers receive lowered input and are not changed).
 *
 * ## The cut, closed (maintainer ruling on #20802, letter A)
 *
 * - **Forward, one level.** The condition names a relation field of the
 *   queried object and fields of the related object. A second relation beneath
 *   it (`{ owner: { account: { name: 'x' } } }`, or the dotted
 *   `{ owner: { 'account.name': 'x' } }`) is refused, loudly. The reverse form
 *   (a parent filtered by its children) is not served here at all.
 * - **Where.** `where`, on every verb that takes one (`find`, `findOne`,
 *   `count`, `aggregate`, `update`, `delete`) and on the judge-only
 *   `judgeFilter`. An aggregation's own `filter` and `having` keep the
 *   no-operator-object refusal: the engine evaluates both itself, over rows it
 *   already holds, and a multi-valued relation has no member test there.
 * - **As the caller.** The related object is read through the engine's own
 *   `find`, under the CALLER's execution context — the related object's CRUD
 *   gate, row scope and field permissions apply exactly as they do to a direct
 *   read of it. A condition on a field the caller cannot read is refused by the
 *   one field-predicate check that refuses it on a direct read (the security
 *   layer's filter-oracle guard, a loud `PERMISSION_DENIED`), never answered
 *   with an empty result. There is no second copy of that rule here.
 * - **Bounded, loudly.** At most {@link RELATION_FILTER_ID_CAP} related ids
 *   feed one condition. The read asks for one more than the cap; when it gets
 *   it, the filter is refused `INVALID_FILTER` / 400 with the two-step route in
 *   the words — ⛔ never a truncated match.
 * - **A multi-valued relation matches on any member.** It is lowered to the
 *   spec's own any-of spelling — an `$or` of one `$contains` per id (the
 *   membership reading, `FILTER_OPERATORS`' `$contains` docblock) — because the
 *   SQL family refuses `$in` over the JSON column a multi-valued relation is
 *   stored in. A single-valued relation is lowered to `$in`.
 *
 * ## What the lowered form means where no related record matches
 *
 * - **No related record matches:** `$in: []` (single-valued) and `{ $or: [] }`
 *   (multi-valued) — FALSE on every driver (the #5322 identities), so the
 *   condition selects no row. ⛔ Never an absent predicate, which would select
 *   every row.
 * - **Under `$not`**, the lowered clause is an ordinary `$in` / `$contains`
 *   leaf, so the shared lowering's NULL-safe `$not` (#5146) applies to it: a
 *   row whose relation is empty, or points at a record the condition does not
 *   match or the caller cannot see, satisfies the negation.
 *
 * ## Where each part lives
 *
 * This module holds the parts that are not a walk: the cap, the structural
 * admission of one condition ({@link admitRelationCondition}), the lowered
 * form ({@link lowerRelationSite}) and the words. The ONE filter walk that
 * finds a condition — with the column's declaration in hand, at the same
 * boundaries as every other arm — is `number-comparand-declared-type-door.ts`'s
 * `walkCondition`; the read that turns a condition into ids is the engine's
 * (`ObjectQL.lowerRelationConditions`).
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/20802
 */

import {
  isMultiValueField,
  REFERENCE_VALUE_TYPES,
  referenceTargetOf,
  type FilterCondition,
} from '@objectstack/spec/data';
import { invalidFilterError } from './filter-comparand-shape.js';
import { isNoOperatorObject, provisionedNoOperatorObjectColumn } from './no-operator-object-door.js';

/**
 * The most related ids one nested-relation condition may feed into the lowered
 * filter. Over it, the condition is refused ({@link relationFilterCapError}),
 * never truncated.
 *
 * One named number for every driver: it sits far below the bound-parameter
 * ceiling of every SQL dialect the platform runs (a single-valued relation
 * binds one parameter per id; a multi-valued one binds one per `$contains`
 * arm), and it is the size past which a caller is better served reading the
 * related object in pages themselves — the route the refusal names.
 */
export const RELATION_FILTER_ID_CAP = 1000;

/** One nested-relation condition the walk found and admitted. */
export interface RelationFilterSite {
  /** The relation field of the queried object — the filter key. */
  readonly field: string;
  /** The field's declared type (`lookup`, `master_detail`, `user`, `tree`). */
  readonly type: string;
  /** The related object the field points at. */
  readonly target: string;
  /** The field stores a list of ids (`multiple: true`). */
  readonly multiple: boolean;
  /** The condition on the related object: the object beneath the field. */
  readonly condition: Record<string, unknown>;
  /** The key path the condition sits at (`where.owner`, `where.$or[1].owner`, …). */
  readonly path: string;
}

/** Why a nested-relation condition cannot be served as written. */
export type RelationConditionRefusalReason =
  | 'unregistered-target'
  | 'empty'
  | 'dotted-key'
  | 'undeclared-key'
  | 'second-level';

/** A condition the admission refused: the site, the reason, and the key at fault. */
export interface RelationConditionRefusal {
  readonly reason: RelationConditionRefusalReason;
  readonly field: string;
  readonly type: string;
  /** `undefined` when the field declares no related object at all. */
  readonly target: string | undefined;
  readonly multiple: boolean;
  readonly path: string;
  /** The condition's own keys, in order. */
  readonly keys: readonly string[];
  /** The key the refusal is about (`dotted-key`, `undeclared-key`, `second-level`). */
  readonly key?: string;
  /** `second-level`: the declared type of the related object's relation field. */
  readonly keyType?: string;
}

/** The admission's answer for one condition. */
export type RelationConditionVerdict =
  | { readonly ok: true; readonly site: RelationFilterSite }
  | { readonly ok: false; readonly refusal: RelationConditionRefusal };

/** What replaces one admitted condition in the lowered filter. */
export type RelationReplacement =
  /** The field's new value (`{ $in: [...] }`), in place. */
  | { readonly kind: 'value'; readonly value: Record<string, unknown> }
  /** A clause AND-ed into the node in place of the field entry (`{ $or: [...] }`). */
  | { readonly kind: 'clause'; readonly clause: FilterCondition };

function declaredFieldsOf(schema: unknown): Record<string, unknown> | null {
  const fields = (schema as { fields?: unknown } | undefined)?.fields;
  return fields !== null && typeof fields === 'object' ? (fields as Record<string, unknown>) : null;
}

function declaredTypeOf(def: unknown): string | undefined {
  const type = (def as { type?: unknown } | null | undefined)?.type;
  return typeof type === 'string' ? type : undefined;
}

/**
 * Admit one nested-relation condition as written, or say why it cannot be
 * served — structurally, from declarations alone: no data is read here, so the
 * judge (`judgeFilter`) and execution give the same verdict.
 *
 * The condition is served when the relation's related object is registered
 * (`schemaOf` answers its declared field map), the condition names at least
 * one field, and every key is a field the related object declares — or a
 * column the platform provisions on every record (`id`, `created_at`,
 * `updated_at`) — undotted, and not itself a relation holding a condition of
 * its own (one level). What each key is compared WITH is the related object's
 * own doors' question, asked when the related object is read.
 */
export function admitRelationCondition(
  field: string,
  def: unknown,
  condition: Record<string, unknown>,
  path: string,
  schemaOf: ((name: string) => unknown) | undefined,
): RelationConditionVerdict {
  const type = declaredTypeOf(def) ?? 'lookup';
  const target = referenceTargetOf(def);
  const multiple = isMultiValueField(def as Parameters<typeof isMultiValueField>[0]);
  const keys = Object.keys(condition);
  const refuse = (
    reason: RelationConditionRefusalReason,
    key?: string,
    keyType?: string,
  ): RelationConditionVerdict => ({
    ok: false,
    refusal: {
      reason, field, type, target, multiple, path, keys,
      ...(key === undefined ? {} : { key }),
      ...(keyType === undefined ? {} : { keyType }),
    },
  });
  const relatedFields = target === undefined || schemaOf === undefined ? null : declaredFieldsOf(schemaOf(target));
  if (target === undefined || relatedFields === null) return refuse('unregistered-target');
  if (keys.length === 0) return refuse('empty');
  for (const key of keys) {
    if (key.includes('.')) return refuse('dotted-key', key);
    const declared = Object.prototype.hasOwnProperty.call(relatedFields, key) ? relatedFields[key] : undefined;
    if (declared === undefined) {
      if (provisionedNoOperatorObjectColumn(key) !== null) continue;
      return refuse('undeclared-key', key);
    }
    const keyType = declaredTypeOf(declared);
    if (keyType !== undefined && REFERENCE_VALUE_TYPES.has(keyType) && isNoOperatorObject(condition[key])) {
      return refuse('second-level', key, keyType);
    }
  }
  return { ok: true, site: { field, type, target, multiple, condition, path } };
}

/**
 * The lowered form of one admitted condition, given the ids of the related
 * records it matched: `$in` on a single-valued relation; on a multi-valued one,
 * an `$or` of one `$contains` per id — the spec's any-of spelling over a stored
 * list, and the only one the SQL family answers (it refuses `$in` over the JSON
 * column). Each id is compared as its text, the `$contains` comparand contract.
 *
 * No ids yield `{ $in: [] }` / `{ $or: [] }`: FALSE, so the condition selects
 * no row — never an absent predicate.
 */
export function lowerRelationSite(site: RelationFilterSite, ids: readonly unknown[]): RelationReplacement {
  if (!site.multiple) return { kind: 'value', value: { $in: [...ids] } };
  return {
    kind: 'clause',
    clause: { $or: ids.map((id) => ({ [site.field]: { $contains: String(id) } })) },
  };
}

/** How the words name the condition: its keys, never its values. */
function describeKeys(keys: readonly string[]): string {
  if (keys.length === 0) return 'no keys';
  const shown = keys.slice(0, 3).map((key) => JSON.stringify(key)).join(', ');
  const more = keys.length > 3 ? `, and ${keys.length - 3} more` : '';
  return `keys ${shown}${more}`;
}

/** The ids route every driver serves: `$in` on a single-valued relation, `$contains` per id on a multi-valued one. */
function idsRoute(field: string, multiple: boolean): string {
  return multiple
    ? `{ "${field}": { "$contains": ID } } for one id, an $or of those for several`
    : `{ "${field}": { "$in": [ID, …] } }`;
}

/**
 * The words of a structural refusal ({@link admitRelationCondition}): the
 * position, the verdict and the route first — the REST door bounds a 4xx
 * message at 500 characters by truncation — and nothing after the route that a
 * caller needs.
 */
export function relationConditionRefusalMessage(refusal: RelationConditionRefusal, context: string): string {
  const { field, type, target, multiple, path, key } = refusal;
  const related = target === undefined ? 'the related object' : `the related object '${target}'`;
  const named = target === undefined ? 'the related object' : `'${target}'`;
  const head =
    `${context}: filter on '${field}' puts a nested-relation condition (${describeKeys(refusal.keys)}) at `
    + `${path}, beneath the declared ${type} field '${field}'`;
  const verdict = 'The filter was NOT applied.';
  const twoStep = `then match '${field}' against its ids: ${idsRoute(field, multiple)}.`;
  switch (refusal.reason) {
    case 'unregistered-target':
      return (
        head
        + (target === undefined
          ? ', and the field declares no related object to read. '
          : `, and no object '${target}' is registered here to read. `)
        + `${verdict} Match '${field}' against ids you hold: ${idsRoute(field, multiple)}.`
      );
    case 'empty':
      return (
        `${head}, and it names no field of ${related}. ${verdict} Name one `
        + `({ "${field}": { "FIELD": VALUE } }), or test that '${field}' has a value: `
        + `{ "${field}": { "$null": false } }.`
      );
    case 'undeclared-key':
      return (
        `${head}, and '${key}' is not a field of ${related}. ${verdict} Name a field it declares: `
        + `{ "${field}": { "FIELD": VALUE } }. A key it does not declare would read as a real empty answer.`
      );
    case 'dotted-key':
      return (
        `${head}, and '${key}' is a dotted path: the condition reaches one level only. ${verdict} `
        + `Read ${named} with that condition yourself, ${twoStep}`
      );
    case 'second-level':
    default:
      return (
        `${head}, and '${key}' is itself a ${refusal.keyType ?? 'relation'} field of ${related} holding a `
        + `condition of its own: one level only. ${verdict} Read ${named} with { "${key}": { … } } yourself, `
        + twoStep
      );
  }
}

/** The structural refusal, in the engine's `INVALID_FILTER` / 400 envelope. */
export function relationConditionError(refusal: RelationConditionRefusal, context: string): Error {
  return invalidFilterError(relationConditionRefusalMessage(refusal, context));
}

/**
 * The cap refusal: the condition matched more related records than
 * {@link RELATION_FILTER_ID_CAP}, so the filter is refused — `INVALID_FILTER` /
 * 400 — rather than run over a cut-off id list that would silently drop
 * matching rows. The words name the cap, the relation and the two-step route.
 */
export function relationFilterCapError(site: RelationFilterSite, context: string, cap: number): Error {
  return invalidFilterError(
    `${context}: the nested-relation condition at ${site.path} matched more than ${cap} records of `
    + `the related object '${site.target}' (the engine's cap), so the filter was NOT applied: a cut-off `
    + `id list would silently drop matching rows. Narrow the condition, or read '${site.target}' yourself `
    + `page by page and match '${site.field}' against its ids: ${idsRoute(site.field, site.multiple)}.`,
  );
}
