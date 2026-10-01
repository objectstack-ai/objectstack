// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20986] The ONE answer to "which object does this relationship-path hop
 * read?" — for every reader in this package that needs it.
 *
 * A relationship path is a dotted identifier path (`owner.region`,
 * `account.owner.email`): every segment but the last is a relationship field
 * on the object before it, the last is a column. The object each hop reaches
 * is resolved in three tiers, first answer wins:
 *
 * 1. **The cube's declared join** at that path, keyed by the path with its
 *    dots as `__` (`account__owner`) — the key the dataset compiler registers
 *    and both strategies alias the join by. An authored cube that declares a
 *    join keeps it, whatever the field declares.
 * 2. **The relationship field's declared `reference`** — the object it points
 *    to — asked of the host through {@link HopReference}, on the object the
 *    previous hop reached. This is the tier an inferred cube takes: it declares
 *    no join, and a lookup named differently from its target (`owner` →
 *    `crm_person`) reaches the target, never an object named `owner`.
 * 3. **The alias itself** — the legacy same-name convention — when the host
 *    cannot answer: no resolver wired, a field it does not know, or a field
 *    that declares no reference. For a lookup named after its target this is
 *    the object tier 2 would have named.
 *
 * Every reader takes its answer from here — the door's field gate and its
 * admitted and scoped object set (`analytics-service.ts`), the native
 * strategy's join and the read scope it applies to the joined alias, and the
 * engine-aggregate strategy's cross-object plan and the object its FK-expand
 * reads — so the object a hop is ADMITTED and SCOPED as and the object it is
 * JOINED or READ as are the same value by construction. ⛔ No reader resolves
 * a hop on its own: a second copy of this walk is how the alias came to be
 * admitted as an object in the first place.
 */

import type { Cube } from '@objectstack/spec/data';
import type { DatasetScopedStrategyContext, StrategyContext } from './strategies/types.js';

/**
 * `(object, field) => the object `field` on `object` declares as its target`,
 * or `undefined` when the host cannot answer. `AnalyticsService` answers it
 * from `AnalyticsServiceConfig.relationshipResolver`, the declared `reference`
 * of a `lookup` / `master_detail` field that `AnalyticsServicePlugin` reads
 * off the data engine's object schema.
 */
export type HopReference = (object: string, field: string) => string | undefined;

/** One hop of a relationship path, resolved. */
export interface ResolvedHop {
  /** The relationship field this hop walks, on {@link from}. */
  readonly field: string;
  /** The object that declares {@link field}: the base object, or the previous hop's object. */
  readonly from: string;
  /** The join alias: the path up to and including this hop, its dots as `__`. */
  readonly alias: string;
  /** The object this hop reads. */
  readonly object: string;
  /** Which tier named {@link object}: the cube's declared join, the field's declared reference, or the alias. */
  readonly via: 'join' | 'reference' | 'alias';
}

/**
 * Resolve every hop of a relationship path, in order.
 *
 * @param cube        The cube the path is read on (its `joins` are tier 1).
 * @param baseObject  The object the path starts on — the cube's base object.
 * @param hops        The relationship fields, in order: the path's segments minus its column.
 * @param referenceOf The host's answer for tier 2; absent ⇒ tier 3.
 */
export function resolvePathHops(
  cube: Pick<Cube, 'joins'> | undefined,
  baseObject: string,
  hops: readonly string[],
  referenceOf: HopReference | undefined,
): ResolvedHop[] {
  const joins = cube?.joins as Record<string, { name?: unknown } | undefined> | undefined;
  const out: ResolvedHop[] = [];
  let from = baseObject;
  let alias = '';
  for (const field of hops) {
    alias = alias ? `${alias}__${field}` : field;
    const joined = joins?.[alias]?.name;
    let object: string;
    let via: ResolvedHop['via'];
    if (typeof joined === 'string' && joined !== '') {
      object = joined;
      via = 'join';
    } else {
      const reference = referenceOf?.(from, field);
      if (typeof reference === 'string' && reference !== '') {
        object = reference;
        via = 'reference';
      } else {
        object = alias;
        via = 'alias';
      }
    }
    out.push({ field, from, alias, object, via });
    from = object;
  }
  return out;
}

/**
 * The object a dotted relationship path's COLUMN lives on — the last hop's
 * object — for a path written `hop.hop.column`. `baseObject` for a path with
 * no hop.
 */
export function columnObjectOf(
  cube: Pick<Cube, 'joins'> | undefined,
  baseObject: string,
  path: string,
  referenceOf: HopReference | undefined,
): string {
  const hops = path.split('.').slice(0, -1);
  const resolved = resolvePathHops(cube, baseObject, hops, referenceOf);
  return resolved.length > 0 ? resolved[resolved.length - 1].object : baseObject;
}

/**
 * The host's {@link HopReference} a strategy context carries — the
 * `relationshipReference` `AnalyticsService` hands its strategies, the same
 * function its own field gate and admitted and scoped set resolve hops with —
 * or `undefined` for a context built without it, whose hops then read the
 * object named after the relationship (tier 3).
 */
export function relationshipReferenceOf(ctx: StrategyContext): HopReference | undefined {
  const scoped = ctx as DatasetScopedStrategyContext;
  return typeof scoped.relationshipReference === 'function'
    ? (object, field) => scoped.relationshipReference!(object, field)
    : undefined;
}
