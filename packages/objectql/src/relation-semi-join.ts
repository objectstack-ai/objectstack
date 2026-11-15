// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The nested-relation condition, served as an IN-DATABASE SEMI-JOIN on a
 * single-valued relation: `{ account: { status: { $ne: 'cancelled' } } }` on
 * `order` reaches the driver as ONE statement,
 * `account IN (SELECT id FROM account WHERE <account's read scope> AND
 * status <> 'cancelled' AND <tenant wall>)`, with no id list read first and
 * no cap on how many related records match.
 *
 * ## How the related half is built: the related object's own read, planned
 *
 * The condition is handed to the engine's own `find` on the related object,
 * under the CALLER's execution context, exactly as the id-reading lowering
 * did — the related object's CRUD gate, every read middleware (row-level
 * scope, the filter-oracle guard on the condition's fields), the
 * `beforeFind` hooks, its comparand doors and its value lowering all run.
 * Only the last step differs: at the driver call, the read is PLANNED, not
 * executed. The final `where` the driver would have been handed — the
 * condition AND-ed with every scope the pipeline injected, its own
 * `ReadableIds` leaves already composed — is captured
 * ({@link RELATION_SCOPE_PLAN}), and no driver is asked.
 *
 * That captured `where` becomes the scope of a `ReadableIds` leaf over the
 * related object, which the outer read carries as the relation field's `$in`
 * comparand. The engine's executor boundary composes it with THAT scope
 * ({@link plannedRelationScopeOf}), never by asking the security service a
 * second, narrower question — so a related record is in the subquery exactly
 * when a direct read of the related object with this condition would return
 * it. The tenant wall is the driver's own, applied to the related table with
 * the outer read's options (ADR-0139 D3).
 *
 * ## What the semi-join means at its edges
 *
 * - **No related record matches** (or none the caller can read): the
 *   subquery is empty, `IN` is FALSE, the row is not selected.
 * - **An empty relation** (`NULL`) is never `IN` any subquery: the row is not
 *   selected, whatever the condition's operator, `$ne` included.
 * - **The related read stopped before its driver call** (a middleware that
 *   answered without asking the driver): nothing was planned, and the leaf is
 *   answered `$in: []` — FALSE, fail-closed, ⛔ never "no restriction".
 * - **The related object lives on another datasource** than the read's
 *   object: refused by name before anything runs — no driver evaluates a
 *   subquery across two datasources.
 *
 * ## Who evaluates the leaf
 *
 * The composed leaf is ADR-0139's: `driver-sql` (every dialect) and Turso
 * compile it into a nested subquery; `driver-memory` evaluates it in
 * process; a driver that compiles no such leaf (`driver-mongodb`,
 * `driver-odata`) refuses it with its ADR-0139 D3 refusal. There is no
 * staged id-read fallback for those drivers.
 *
 * ## Forgery
 *
 * The planned scope lives in a module-private `WeakMap` keyed by the identity
 * of a leaf only this module builds. A caller who writes `ReadableIds.of(P)`
 * gets an ordinary leaf, composed with P's read scope as ADR-0139 says; no
 * caller can name a leaf this map holds, and a copy of one is a different
 * object the map does not hold.
 */

import { ReadableIds, RLS_DENY_FILTER, type FilterCondition } from '@objectstack/spec/data';

/**
 * The key of the internal read option that turns a `find` into a PLAN: when
 * `options[RELATION_SCOPE_PLAN]` holds a function, `find` calls it with the
 * final driver `where` in place of the driver call and answers `[]`.
 * A symbol, so no wire request, JSON body or spread author input can carry
 * it; never exported from the package.
 */
export const RELATION_SCOPE_PLAN: unique symbol = Symbol('objectql.relationScopePlan');

/** The sink a planned read hands its final driver `where` to. */
export type RelationScopePlanSink = (where: FilterCondition | undefined) => void;

/** What a planned related read answered for one leaf. */
interface PlannedRelationScope {
  /** `true` once the related read reached its driver call. */
  readonly planned: boolean;
  /** The captured `where` (meaningful only when {@link planned}). */
  readonly where: FilterCondition | undefined;
}

const plannedScopes = new WeakMap<object, PlannedRelationScope>();

/**
 * Build the `ReadableIds` leaf over `target` whose scope is the planned
 * related read's `where`. `plan(sink)` runs that read, handing `sink` to it as
 * the {@link RELATION_SCOPE_PLAN} option; a refusal from it propagates.
 */
export async function planRelationSemiJoinLeaf(
  target: string,
  plan: (sink: RelationScopePlanSink) => Promise<unknown>,
): Promise<ReturnType<typeof ReadableIds.of>> {
  let planned = false;
  let where: FilterCondition | undefined;
  await plan((final) => {
    planned = true;
    where = final;
  });
  const leaf = ReadableIds.of(target);
  plannedScopes.set(leaf, { planned, where });
  return leaf;
}

/**
 * The scope the executor boundary composes `leaf` with when this module built
 * it: `{ scope }` (possibly `undefined`, no restriction beyond the tenant
 * wall — never the case for a non-empty condition), or `null` for `$in: []`
 * (nothing was planned, or the planned read was the deny sentinel).
 * `undefined` when this module did not build `leaf`: an ordinary ADR-0139
 * leaf, composed through the security service.
 */
export function plannedRelationScopeOf(
  leaf: unknown,
): { readonly scope: FilterCondition | undefined } | null | undefined {
  if (leaf === null || typeof leaf !== 'object') return undefined;
  const entry = plannedScopes.get(leaf);
  if (entry === undefined) return undefined;
  if (!entry.planned || entry.where === (RLS_DENY_FILTER as unknown)) return null;
  return { scope: entry.where };
}
