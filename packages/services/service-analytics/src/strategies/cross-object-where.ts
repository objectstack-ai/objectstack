// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A cross-object `where` on the engine-aggregate path: the dotted member
 * (`'cb_order.status'`) handed to the engine as the nested-relation condition
 * the engine already serves (`{ cb_order: { status: … } }`).
 *
 * ## Why this is the route, and not a join
 *
 * `engine.aggregate()` cannot join, so `ObjectQLStrategy` used to refuse every
 * cross-object `where` leaf, and a dashboard over detail rows could not leave
 * out the rows of a cancelled parent. The engine already answers the same
 * question in another spelling: the nested-relation form, served in `where` on
 * every verb `aggregate` included (`@objectstack/objectql`'s
 * `relation-filter-lowering.ts`). It reads the related object through the
 * engine's own `find`, AS THE CALLER — that object's CRUD gate, row scope and
 * field permissions apply as they do to a direct read — and keeps the rows
 * whose relation field is a record that read admits: a subquery in the same
 * statement where that is provably the same read, otherwise the ids the read
 * returns, refusing a match past the cap (`RELATION_FILTER_ID_CAP`) rather
 * than truncating it. That is "resolve the parent ids first, then filter the
 * base object with `IN`", with the security rule in the one place that owns it. This module only respells the member; it
 * reads no data and judges no permission.
 *
 * ## What a lowered leaf means
 *
 * A dotted leaf `rel.field OP value` is served as "the row's `rel` points at a
 * record the caller can read, and that record's `field` satisfies `OP value`".
 * So:
 *
 * - **No parent, or one the caller cannot read, never matches** — whatever the
 *   operator, `$ne` / `$nin` / `$null: true` included. A row with an empty
 *   `rel` matches no cross-object leaf; to keep such rows, OR in the relation
 *   field itself (`{ $or: [{ 'rel.status': { $ne: 'cancelled' } }, { rel: { $null: true } }] }`).
 * - **No matching parent selects no row**: the engine lowers an empty id set to
 *   the FALSE filter, never to an absent one.
 * - **A field of the parent the caller cannot read is refused**, loudly, by the
 *   engine's own filter-oracle guard (and by this service's field gate before
 *   the strategy runs).
 * - **Leaves on one relation in one conjunction share one condition**
 *   (`{ 'rel.a': 1, 'rel.b': 2 }` is one record with both), so a multi-valued
 *   relation reads "one member satisfies all of them", as the authored nested
 *   form does. Two leaves naming the same parent field stay two conditions.
 * - **Inside `$or`** a lowered leaf keeps its place in the disjunction: the
 *   relation branch is the existential test above, the other branches are
 *   unchanged.
 *
 * ## What stays refused, and why each is refused rather than approximated
 *
 * A leaf this path cannot serve EXACTLY is left as written, and
 * `ObjectQLStrategy.planCrossObject` refuses it with the reason recorded here:
 *
 * - **`multi-hop`** — a path past {@link CROSS_OBJECT_WHERE_MAX_HOPS}
 *   relationships (`a.b.c.d.field`). Up to that limit (ADR-0071's three hops) a
 *   path is respelled as the nested form one relation inside the next
 *   (`a.b.field` → `{ a: { b: { field } } }`), which the engine serves hop by
 *   hop, each hop its related object's own read as the caller; past it the
 *   engine refuses the nested form too.
 * - **`negated`** — a leaf under `$not`, at any depth. Negating the existential
 *   test admits every row whose parent is absent or unreadable, so a parent the
 *   caller cannot read would let its children through. The negation belongs
 *   inside the leaf (`$ne`, `$nin`), where it is evaluated on readable parents.
 * - **`field-reference`** — a `{ $field }` comparand. Inside the related read it
 *   would name the PARENT's column, where the dotted spelling reads as a
 *   comparison with the base row's; the two readings differ and neither is
 *   chosen silently.
 * - **`join-target`** — the cube declares a join for the relation onto a
 *   different object than the field declares as its reference. The engine reads
 *   the declared reference, so serving it would filter by an object other than
 *   the one the cube joins.
 *
 * ## Where the dotted form IS evaluated by a join
 *
 * `NativeSQLStrategy` compiles a dotted member into a `LEFT JOIN` per hop, any
 * number of hops (ADR-0071), on a SQL datasource (`driver-sql`'s SQLite,
 * PostgreSQL, MySQL and SQL Server dialects, and Turso), when it does not
 * decline the query — and it declines, among other shapes, a bucketed time
 * dimension, a federated object, an object an engine middleware is registered
 * for, and a read scope carrying the engine's `ReadableIds` leaf (a
 * `controlled_by_parent` object). Its joined object's read scope is a `WHERE`
 * conjunct, so on a datasource with row-level or tenant scoping a child whose
 * parent is absent or unreadable is not selected there either.
 * {@link CROSS_OBJECT_JOIN_ROUTE} carries that sentence for the refusals.
 */

import { findCrossFieldComparand } from '../comparand-shape.js';
import { resolvePathHops, type HopReference } from '../hop-object.js';
import type { Cube } from '@objectstack/spec/data';

/**
 * The most relationships a dotted `where` leaf may traverse and still be
 * respelled: ADR-0071's hop limit, the one the engine's nested-relation form
 * carries (`@objectstack/objectql`'s `RELATION_CONDITION_MAX_HOPS`).
 */
export const CROSS_OBJECT_WHERE_MAX_HOPS = 3;

/** Why a cross-object `where` leaf is left for the strategy to refuse. */
export type UnservedCrossObjectReason = 'multi-hop' | 'negated' | 'field-reference' | 'join-target';

/** One dotted leaf respelled as a nested-relation condition. */
export interface ServedCrossObjectLeaf {
  /** The key as the `where` wrote it (a member name or the dotted field). */
  readonly member: string;
  /** The resolved dotted field (`cb_order.status`). */
  readonly field: string;
  /** The relation field of the base object the condition sits beneath. */
  readonly relation: string;
  /** Every relation field the path traverses, the base object's first (`[relation]` for one hop). */
  readonly path: readonly string[];
  /** The related object the hop reads. */
  readonly object: string;
}

/** One dotted leaf left as written, and why. */
export interface UnservedCrossObjectLeaf {
  readonly reason: UnservedCrossObjectReason;
  /** `join-target`: the object the cube joins and the object the field declares. */
  readonly joined?: string;
  readonly declared?: string;
}

export interface CrossObjectWhereLowering {
  /**
   * The `where` with every servable cross-object leaf respelled beneath its
   * relation field. The input condition itself (same object) when there was
   * nothing to respell.
   */
  readonly where: Record<string, unknown> | null;
  readonly served: readonly ServedCrossObjectLeaf[];
  /** Keyed by resolved dotted field, as the strategy's member view is. */
  readonly unserved: ReadonlyMap<string, UnservedCrossObjectLeaf>;
}

export interface CrossObjectWhereReader {
  readonly cube: Cube;
  readonly baseObject: string;
  readonly referenceOf: HopReference | undefined;
  /** The member's resolved field name (`ObjectQLStrategy.resolveFieldName(…, 'any')`). */
  resolveField(member: string): string;
  /** Is the resolved field a relationship traversal (`ObjectQLStrategy.isCrossObjectField`)? */
  isCrossObject(field: string): boolean;
}

/**
 * The one sentence every refusal of a cross-object member on this path uses to
 * say where the dotted form is evaluated by a join. See the module header.
 */
export const CROSS_OBJECT_JOIN_ROUTE =
  'The native-SQL strategy joins a dotted member, through every hop, on a SQL datasource ' +
  '(the driver-sql SQLite, PostgreSQL, MySQL and SQL Server dialects, and Turso), unless it ' +
  'declines the query: a bucketed time dimension, a federated object, an object an engine ' +
  'middleware is registered for, or a controlled_by_parent read scope sends the query to this ' +
  'strategy instead.';

function isPlainCondition(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

/**
 * Respell the servable cross-object leaves of an authored `where` (the output of
 * `lowerAnalyticsWhere`, so the `FilterArray` spelling has already become the
 * object one). Copy-on-write: a condition with no cross-object leaf comes back
 * as the same object, so a base-only query reaches the engine byte-identical.
 */
export function lowerCrossObjectWhere(
  where: Record<string, unknown> | null,
  reader: CrossObjectWhereReader,
): CrossObjectWhereLowering {
  const served: ServedCrossObjectLeaf[] = [];
  const unserved = new Map<string, UnservedCrossObjectLeaf>();
  if (!where) return { where, served, unserved };

  const walk = (cond: Record<string, unknown>, negated: boolean): Record<string, unknown> => {
    let out: Record<string, unknown> | undefined;
    const write = (key: string, value: unknown): void => {
      out ??= { ...cond };
      out[key] = value;
    };
    // One condition per relation field, in first-seen order; a second leaf on
    // a parent field the condition already names starts a condition of its own.
    const byRelation = new Map<string, Array<Record<string, unknown>>>();

    for (const [key, spec] of Object.entries(cond)) {
      if (key === '$and' || key === '$or') {
        if (!Array.isArray(spec)) continue;
        let copy: unknown[] | undefined;
        spec.forEach((child, index) => {
          if (!isPlainCondition(child)) return;
          const next = walk(child, negated);
          if (next !== child) (copy ??= [...spec])[index] = next;
        });
        if (copy) write(key, copy);
        continue;
      }
      if (key === '$not') {
        if (!isPlainCondition(spec)) continue;
        const next = walk(spec, true);
        if (next !== spec) write(key, next);
        continue;
      }
      if (key.startsWith('$')) continue;

      const field = reader.resolveField(key);
      if (!reader.isCrossObject(field)) continue;
      const segments = field.split('.');
      if (segments.length - 1 > CROSS_OBJECT_WHERE_MAX_HOPS) {
        unserved.set(field, { reason: 'multi-hop' });
        continue;
      }
      if (negated) {
        unserved.set(field, { reason: 'negated' });
        continue;
      }
      const reference = findCrossFieldComparand({ [key]: spec });
      if (reference && reference.ref !== '$now') {
        unserved.set(field, { reason: 'field-reference' });
        continue;
      }
      const relations = segments.slice(0, -1);
      const attr = segments[segments.length - 1];
      const hops = resolvePathHops(reader.cube, reader.baseObject, relations, reader.referenceOf);
      // Every hop the cube joins must join the object its field declares: the
      // engine reads the declared reference, hop by hop.
      const misjoined = hops.find((h) => {
        if (h.via !== 'join') return false;
        const declared = reader.referenceOf?.(h.from, h.field);
        return declared !== undefined && declared !== '' && declared !== h.object;
      });
      if (misjoined) {
        unserved.set(field, {
          reason: 'join-target', joined: misjoined.object, declared: reader.referenceOf?.(misjoined.from, misjoined.field),
        });
        continue;
      }

      out ??= { ...cond };
      delete out[key];
      // One condition per relation PATH: leaves through the same relations
      // share the record at its end (`a.b.x` and `a.b.y` are one `b` with both).
      const pathKey = relations.join('.');
      const conditions = byRelation.get(pathKey) ?? [];
      const open = conditions.find((c) => !Object.prototype.hasOwnProperty.call(c, attr));
      if (open) open[attr] = spec;
      else conditions.push({ [attr]: spec });
      byRelation.set(pathKey, conditions);
      served.push({ member: key, field, relation: hops[0].field, path: relations, object: hops[0].object });
    }

    if (byRelation.size === 0) return out ?? cond;
    // `a.b` → `{ a: { b: CONDITION } }`: each relation holds the next one's condition.
    const nest = (path: string, condition: Record<string, unknown>): Record<string, unknown> =>
      path.split('.').reduceRight<Record<string, unknown>>((inner, relation) => ({ [relation]: inner }), condition);
    const relationConditions = [...byRelation].flatMap(([path, conditions]) =>
      conditions.map((condition) => nest(path, condition)),
    );
    const result = out ?? { ...cond };
    const prior = result.$and;
    // ANDed beside the rest of this conjunction, never merged into a key the
    // conjunction already names (the relation field may carry its own
    // constraint, `{ cb_order: { $null: false } }`, or an authored nested form).
    result.$and =
      prior === undefined
        ? relationConditions
        : Array.isArray(prior)
          ? [...prior, ...relationConditions]
          : [{ $and: prior }, ...relationConditions];
    return result;
  };

  const rewritten = walk(where, false);
  return { where: rewritten, served, unserved };
}
