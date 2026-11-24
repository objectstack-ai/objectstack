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
 * ({@link plannedRelationLeafVerdict}), never by asking the security service
 * a second, narrower question. The driver applies its tenant wall to the
 * related table with the OUTER read's options (ADR-0139 D3), so the leaf is
 * composed only when those options are the related read's own; with that,
 * a related record is in the subquery exactly when the id read would have
 * returned it.
 *
 * ## Taken only where it is provably the same read as the id read
 *
 * Every other case reads the related ids as the caller and matches the field
 * with `$in`, under the cap — the id read the engine has always run, unchanged
 * ({@link relationSemiJoinServes}, then the planned read's own outcome, then
 * the executor boundary's comparison):
 *
 * - **Before planning** — the registry already answers: the related object
 *   has a restriction no planned `where` can carry: an object-scoped
 *   middleware or an `afterFind` hook on the related object (both act after
 *   its driver call), another datasource than the read's object, a federated
 *   related object, a related object of another tenancy class than the
 *   read's object under a walled posture (its driver options differ). The
 *   related read is dispatched once. (A read whose driver compiles no
 *   subquery is not a fallback: it is refused before this point.)
 * - **After planning** — the related read did not reach exactly one driver
 *   call, or came back with rows the driver never returned (a middleware
 *   answered without the driver, or added rows after it).
 * - **At the executor boundary** — the outer read's driver options differ
 *   from the ones the related read's own driver call was given
 *   ({@link sameReadDriverOptions}) in a way only the request decides (a
 *   per-object verdict recorded for the caller): the subquery is compiled
 *   with the outer read's options, so only identical options make it the
 *   related read's own statement. The ids are then read there, as the
 *   caller, under the cap.
 *
 * A hop that falls back after planning (either of the last two) dispatches
 * the related read twice: its middleware chain and `beforeFind` hooks run
 * for the planned read and again for the id read.
 *
 * ## What the semi-join means at its edges
 *
 * - **No related record matches** (or none the caller can read): the
 *   subquery is empty, `IN` is FALSE, the row is not selected.
 * - **An empty relation** (`NULL`) is never `IN` any subquery: the row is not
 *   selected, whatever the condition's operator, `$ne` included — exactly as
 *   `IN` over the id list.
 * - **The planned scope is the deny sentinel**: `$in: []`, as the id read
 *   over it answers.
 *
 * ## Who evaluates the leaf
 *
 * The composed leaf is ADR-0139's: `driver-sql` (every dialect, Turso and
 * the WASM SQLite face included) compiles it into a nested subquery;
 * `driver-memory` evaluates it in process. Each says so with the
 * `DriverCapabilities.readableIdsLeaf` bit ({@link driverCompilesReadableIdsLeaf}).
 * A driver without the bit (MongoDB, OData) is never handed one by this
 * lowering: the condition is refused before anything is planned or read
 * (`relation-filter-lowering.ts`#`relationSemiJoinDriverRefusal`), `INVALID_FILTER` / 400, rather
 * than reaching the driver and failing there as a composition fault.
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
import { postureEnforcesWall, type TenancyPosture } from '@objectstack/spec/security';
import { isDriverTenantScopedSchema } from './engine-driver-options.js';
import { isFederatedObject } from './federated-object.js';

/**
 * The key of the internal read option that turns a `find` into a PLAN: when
 * `options[RELATION_SCOPE_PLAN]` holds a {@link RelationScopePlan}, `find`
 * hands it the final driver `where` and driver options in place of the
 * driver call and answers the plan's own empty `rows`.
 * A symbol, so no wire request, JSON body or spread author input can carry
 * it; never exported from the package.
 */
export const RELATION_SCOPE_PLAN: unique symbol = Symbol('objectql.relationScopePlan');

/** What a planned read is handed: where to put its driver call, and what to answer. */
export interface RelationScopePlan {
  /** Called at the driver call with exactly what the driver would have been handed. */
  capture(where: FilterCondition | undefined, driverOptions: unknown): void;
  /** The answer the planned read gives in place of the driver's: an empty array of this plan's own. */
  readonly rows: unknown[];
}

/**
 * Whether `driver` compiles (or, in process, evaluates) a composed
 * `ReadableIds` leaf: its `DriverCapabilities.readableIdsLeaf` bit, `true`
 * exactly. Absence is `false` — a driver that declares nothing is never
 * handed a leaf by the relation lowering. The one reader of the bit: the
 * nested-relation `where` refusal (`relation-filter-lowering.ts`#`relationSemiJoinDriverRefusal`),
 * the semi-join plan ({@link relationSemiJoinServes}) and the analytics
 * relation-group refusal (`relation-group-join.ts`) all ask it here.
 */
export function driverCompilesReadableIdsLeaf(driver: { readonly supports?: unknown } | undefined): boolean {
  const supports = driver?.supports;
  return supports !== null && typeof supports === 'object' && (supports as { readableIdsLeaf?: unknown }).readableIdsLeaf === true;
}

/** The driver's name as an author reads it in a refusal: its `name`, or `unnamed`. */
export function driverNameOf(driver: { readonly name?: unknown } | undefined): string {
  return typeof driver?.name === 'string' && driver.name !== '' ? driver.name : 'unnamed';
}

/** What {@link relationSemiJoinServes} reads off the engine. */
export interface RelationSemiJoinServesHost {
  uncomposableReadableIdsParent(object: string, parent: string): unknown;
  hasHooksFor(event: string, object: string): boolean;
  getDriver(object: string): { readonly name?: unknown; readonly supports?: unknown } | undefined;
  /** The registered schema of `object` (`undefined` when none is registered). */
  getObjectSchema(object: string): unknown;
  /** The tenancy posture in force, as the engine's driver options read it. */
  resolveEnginePosture(): TenancyPosture;
}

/**
 * Whether a read of `object` may PLAN its relation condition on `target` as a
 * semi-join at all. `false` keeps the id read. Registry facts only — nothing
 * is read and the caller's context is not consulted:
 *
 * - `target` is in neither of ADR-0139 D5's remaining classes for `object`
 *   (an object-scoped read middleware narrows its rows after its driver call;
 *   it is bound to another datasource than `object`);
 * - no `afterFind` hook is registered for `target` (a hook may filter the
 *   rows the id read returns, after its driver call);
 * - `target` is not federated (ADR-0015 `external`): the driver prepares a
 *   federated object's remote catalog facts for the object a read door is
 *   reading, and a subquery's object is not that object;
 * - under a walled posture, `object` and `target` are of the same tenancy
 *   class ({@link isDriverTenantScopedSchema}): otherwise one read's driver
 *   options carry a tenant scope the other's do not, and the executor
 *   boundary would fall back after the related read was already planned —
 *   dispatching it a second time. Deciding it here dispatches it once.
 * - `object`'s driver compiles the composed leaf ({@link driverCompilesReadableIdsLeaf});
 *   a read on one that does not never gets here on a read verb — it is
 *   refused first (`relation-filter-lowering.ts`#`relationSemiJoinDriverRefusal`).
 */
export function relationSemiJoinServes(this: RelationSemiJoinServesHost, object: string, target: string): boolean {
  if (this.uncomposableReadableIdsParent(object, target) !== undefined) return false;
  if (this.hasHooksFor('afterFind', target)) return false;
  const targetSchema = this.getObjectSchema(target);
  if (isFederatedObject(targetSchema)) return false;
  if (
    postureEnforcesWall(this.resolveEnginePosture()) &&
    isDriverTenantScopedSchema(this.getObjectSchema(object)) !== isDriverTenantScopedSchema(targetSchema)
  ) return false;
  return driverCompilesReadableIdsLeaf(this.getDriver(object));
}

/** What a planned related read answered for one leaf. */
interface PlannedRelationScope {
  /** The captured driver `where`. */
  readonly where: FilterCondition | undefined;
  /** The captured driver options of the related read's own driver call. */
  readonly driverOptions: unknown;
  /** The id read, as the caller, under the cap — for an outer read whose options differ. */
  readonly readIds: () => Promise<unknown[]>;
}

const plannedScopes = new WeakMap<object, PlannedRelationScope>();

/**
 * Plan the related read and build the `ReadableIds` leaf over `target` whose
 * scope is its final driver `where`. `plan(p)` runs that read, handing `p` to
 * it as the {@link RELATION_SCOPE_PLAN} option; a refusal from it propagates,
 * as the id read's would. `readIds` is the id read itself.
 *
 * Answers `null` — read the ids instead — unless the read reached exactly one
 * driver call and its answer came back with no row in it. A middleware that
 * answered without the driver, or that added rows after it, is a read the
 * planned `where` does not describe. A middleware that reshapes the rows
 * (the field mask maps each row to a masked copy) changes no id and is not
 * one. A read rule that narrows the related object's rows after its driver
 * call bounds a relation condition only when it is registered for that
 * object, as ADR-0139 D5.2 bounds a `ReadableIds` parent: an object-keyed
 * middleware or an `afterFind` hook, for which {@link relationSemiJoinServes}
 * keeps the id read.
 */
export async function planRelationSemiJoinLeaf(
  target: string,
  plan: (p: RelationScopePlan) => Promise<unknown>,
  readIds: () => Promise<unknown[]>,
): Promise<ReturnType<typeof ReadableIds.of> | null> {
  const captured: Array<{ where: FilterCondition | undefined; driverOptions: unknown }> = [];
  const rows: unknown[] = [];
  const answer = await plan({ rows, capture: (where, driverOptions) => { captured.push({ where, driverOptions }); } });
  if (captured.length !== 1 || !Array.isArray(answer) || answer.length !== 0 || rows.length !== 0) return null;
  const leaf = ReadableIds.of(target);
  plannedScopes.set(leaf, { ...captured[0], readIds });
  return leaf;
}

/** Whether this module built `leaf` (a planned relation semi-join leaf). */
export function isPlannedRelationLeaf(leaf: unknown): boolean {
  return leaf !== null && typeof leaf === 'object' && plannedScopes.has(leaf);
}

/**
 * Driver option keys that never change which rows a read returns: they are
 * not compared. Every other key — the tenant scope, the transaction, the
 * timezone, and any key added later — must be equal.
 */
const ROW_NEUTRAL_DRIVER_OPTIONS: ReadonlySet<string> = new Set(['bypassTenantAudit', 'traceContext', 'timeoutMs', 'skipCache']);

const isBlank = (v: unknown): boolean => v === undefined || v === null || v === '';

/**
 * Whether the outer read's driver options are the related read's own, for
 * every key that can change the rows a read returns — then the subquery the
 * driver compiles with the outer options is the related read's own statement.
 * Arrays compare element-wise; everything else by identity.
 */
export function sameReadDriverOptions(outer: unknown, related: unknown): boolean {
  const a = (outer !== null && typeof outer === 'object' ? outer : {}) as Record<string, unknown>;
  const b = (related !== null && typeof related === 'object' ? related : {}) as Record<string, unknown>;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (ROW_NEUTRAL_DRIVER_OPTIONS.has(key)) continue;
    const x = a[key];
    const y = b[key];
    if (isBlank(x) && isBlank(y)) continue;
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length || x.some((v, i) => v !== y[i])) return false;
      continue;
    }
    if (x !== y) return false;
  }
  return true;
}

/** How the executor boundary answers a planned leaf. */
export type PlannedRelationLeafVerdict =
  | { readonly kind: 'compose'; readonly scope: FilterCondition | undefined }
  | { readonly kind: 'empty' }
  | { readonly kind: 'read'; readonly readIds: () => Promise<unknown[]> };

/**
 * The executor boundary's answer for `leaf` in a read whose driver is handed
 * `outerDriverOptions`: `compose` with the planned scope when the options are
 * the related read's own; `empty` (`$in: []`) when the planned scope is the
 * deny sentinel, whatever the options (an empty set stays empty); otherwise
 * `read` — the ids, read as the caller under the cap. `undefined` when this
 * module did not build `leaf`: an ordinary ADR-0139 leaf, composed through the
 * security service.
 */
export function plannedRelationLeafVerdict(leaf: unknown, outerDriverOptions: unknown): PlannedRelationLeafVerdict | undefined {
  if (leaf === null || typeof leaf !== 'object') return undefined;
  const entry = plannedScopes.get(leaf);
  if (entry === undefined) return undefined;
  if (entry.where === (RLS_DENY_FILTER as unknown)) return { kind: 'empty' };
  if (!sameReadDriverOptions(outerDriverOptions, entry.driverOptions)) return { kind: 'read', readIds: entry.readIds };
  return { kind: 'compose', scope: entry.where };
}
