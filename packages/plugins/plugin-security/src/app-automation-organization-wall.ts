// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An app-authored elevation is judged by its caller's organization wall
 * (ADR-0095 D1, ADR-0123 D1/D2).
 *
 * App-authored automation elevates by declaration: an action body always, a
 * hook by `runAs: 'system'` (or a system context it inherits, or its
 * `ctx.api.sudo()`), a flow by `runAs: 'system'`. An action body and a hook
 * run `{ ...the caller's envelope, isSystem: true }`; a flow run's data nodes
 * run the envelope the automation engine builds from the run's own context
 * (`resolveRunDataContext`, service-automation: the user it runs for, that
 * user's active organization, membership set and posture rung). The data
 * middleware returns `next()` for `isSystem` ahead of every gate below it, the
 * Layer 0 tenant wall among them. Elevation lifts the caller's business rules (Layer
 * 1: object and field permissions, ownership, sharing); it does not lift the
 * organization wall. So the elevation's reads and writes are judged by the
 * organization wall of the caller they run for, the one the caller's plain
 * door composes.
 *
 * ## The caller's own wall
 *
 * The verdict is the caller's Layer 0, computed by the one ladder
 * (`computeTenantLayer0Verdict`) over the caller's own context and the
 * caller's own permission sets, so its exemptions are the plain door's: an
 * object outside tenancy, an object with no organization column, a platform
 * operator crossing the wall on an object whose posture permits it, and the
 * verified platform owner's read are answered as that door answers them.
 * Where this module applies the verdict to an operation:
 *
 * - a read takes the wall's filter on its predicate (the deny sentinel, the
 *   active organization, or the `group` membership set), and the verdict is
 *   recorded on the operation, so the engine's own driver scope follows it;
 * - a predicate write takes the same filter, so it matches only rows the
 *   caller's wall admits;
 * - a by-id write is checked against the row it names first, read inside the
 *   transaction the write carries: a row the caller's wall does not admit
 *   answers as a row that is not there;
 * - an insert with no active organization on a walled tenant object is
 *   refused;
 * - a write whose own data names an organization the wall does not admit, and
 *   an update whose own data empties a row's organization, are refused —
 *   judged for every caller;
 * - a caller the wall DENIES — no active organization under `isolated`, an
 *   empty membership set under `group`, a person outside every organization
 *   under `single` (ADR-0093 D8.1, as amended) — reads nothing (zero rows, no
 *   error). Its delete and purge are answered by that read rule, as its plain
 *   door answers them (ADR-0123 D2): a predicate delete matches nothing, and a
 *   by-id delete answers as a row that is not there (`404`). Every other write
 *   is refused `403 PERMISSION_DENIED`, naming the missing active organization
 *   (ADR-0123 D4).
 *
 * The wall reads Layer 0 alone: the permission sets are loaded only where they
 * decide a platform operator's crossing. When the context lacks the facts the
 * wall reads (a decided segment, a hook under a platform write that names a
 * user), they are resolved for the caller by the one resolver the request
 * path uses (`resolveUserAuthzGrants`), once per flow run
 * ({@link RunCallerFactsMemo}). A system run whose own user is its caller
 * carries that user's membership set and rung from run setup.
 *
 * ## Which elevations: the predicate the identity refusal reads
 *
 * `isSystem` AND (`flowRunId` OR the app-automation elevation mark) —
 * {@link elevationSource}, the predicate the identity-assignment and
 * append-only refusals beside it read. A platform writer's own system context
 * (the seeders, better-auth and its reconciliation, a plugin's boot work, the
 * audit writer's `platformSystemApi`) carries neither and is unchanged.
 *
 * ## Which elevations have a caller
 *
 * The rule is the caller's door, so it binds an elevation that carries one:
 * a principal (`userId`), or the guest entry's envelope (ADR-0138). An
 * elevation with no caller at all — a scheduled run, a record-change run fired
 * by a write that carried no user — has no door and no active organization to
 * miss, and is unchanged, in every segment: a run that began for no caller
 * stays unjudged after a human decision too, though the decider is then its
 * attribution user, and so does a run a write of such a segment starts; a run
 * that began for a caller goes on being judged by that caller's wall
 * (`runCallerOf`, `@objectstack/core`).
 */

import { isOutsideEveryOrganization, POSTURE_LADDER, rlsOperationForVerb, runCallerOf } from '@objectstack/core';
import type { TenancyPosture, TenantLayer0Verdict } from '@objectstack/spec/security';

import { PermissionDeniedError } from './errors.js';
import { undeclaredExternalScopeWriteRefusal } from './external-organization-scope.js';
import { RLS_DENY_FILTER } from './rls-compiler.js';
import { ELEVATION, SUBJECT, elevationSource, type ElevationSource } from './flow-system-identity-write-refusal.js';
import { extractSingleId } from './security-plugin-addressed-writes.js';

/** The verbs judged as writes: `rlsOperationForVerb` maps `purge`, `transfer` and `restore` onto them. */
const WRITE_CLASS: ReadonlySet<string> = new Set(['insert', 'update', 'delete']);

/** The removal class (`delete`, and `purge` mapped onto it): answered by the read rule when the wall denies. */
const REMOVAL = 'delete';

/** The organization column the wall's filters and a payload name. */
const ORGANIZATION_FIELD = 'organization_id';

/** An elevation with a caller, and that caller's own context. */
export interface AppAutomationWallCaller {
  source: ElevationSource;
  /** The elevated context as the caller's plain door reads it: `isSystem` off, everything else kept. */
  callerContext: Record<string, unknown>;
  /**
   * A decided flow segment judged by the user its run began for: the
   * segment's own facts are its decider's, so the engine's projection of them
   * is not the caller's wall, and the wall is always asked.
   */
  decided?: true;
}

/**
 * The caller an app-authored elevation runs for, or `undefined` for every
 * other context: a user's own (not elevated), a platform writer's (no run, no
 * mark), an elevation that carries no caller, and a flow run that began for no
 * caller, in every segment.
 */
export function appAutomationWallCaller(context: unknown): AppAutomationWallCaller | undefined {
  if (!context || typeof context !== 'object') return undefined;
  const source = elevationSource(context as { isSystem?: unknown; flowRunId?: unknown });
  if (!source) return undefined;
  // A decided flow segment names the user its run began for (`runCallerOf`):
  // `null` when the run began for no caller, which stays unjudged in every
  // segment; otherwise that user, not the decider, is the caller — and the
  // facts the segment carries are not that user's, so none of them is kept.
  const runCaller = runCallerOf(context);
  if (runCaller === null) return undefined;
  if (runCaller !== undefined && runCaller !== (context as { userId?: unknown }).userId) {
    const { positions: _p, permissions: _s, permissionSetAddresses: _a, accessible_org_ids: _o, posture: _r, principalKind: _k, ...rest } =
      context as Record<string, unknown>;
    return { source, callerContext: { ...rest, userId: runCaller, isSystem: false }, decided: true };
  }
  const c = context as { userId?: unknown; principalKind?: unknown };
  const hasCaller = isPrincipal(c.userId) || c.principalKind === 'guest';
  if (!hasCaller) return undefined;
  return { source, callerContext: { ...(context as Record<string, unknown>), isSystem: false } };
}

function isPrincipal(userId: unknown): userId is string {
  return typeof userId === 'string' && userId !== '';
}

function carriesActiveOrganization(context: Record<string, unknown>): boolean {
  const tenantId = context.tenantId;
  return tenantId !== undefined && tenantId !== null && tenantId !== '';
}

/**
 * Does this context call for the wall's own verdict? True when it carries no
 * active organization, no membership set, or an empty one (the states the
 * wall can deny, or where the caller's union is not carried), and for a
 * platform operator (whose crossing is the wall's to decide). Every other
 * caller is judged by the engine's projection of the same verdict.
 */
export function callerMayLackOrganization(callerContext: Record<string, unknown>): boolean {
  if (!carriesActiveOrganization(callerContext)) return true;
  const set = callerContext.accessible_org_ids;
  if (!Array.isArray(set) || set.length === 0) return true;
  return callerContext.posture === 'PLATFORM_ADMIN';
}

/**
 * Does the context carry the facts the caller's Layer 0 is judged on? The
 * membership set always; and either the permission sets, or a carried posture
 * rung below the platform operator's — the only rung whose crossing the
 * permission sets decide (ADR-0099 D1). A run that carries its caller's set and
 * rung (run setup seeds both) is judged on them with no resolution.
 */
export function carriesDoorFacts(callerContext: Record<string, unknown>): boolean {
  if (!Array.isArray(callerContext.accessible_org_ids)) return false;
  if (Array.isArray(callerContext.permissions)) return true;
  const rung = callerContext.posture;
  return typeof rung === 'string' && rung !== 'PLATFORM_ADMIN' && (POSTURE_LADDER as readonly string[]).includes(rung);
}

/** The refusal: the standard catalog's `PERMISSION_DENIED`, naming what is missing. */
export function appAutomationOrganizationWallRefusal(
  source: ElevationSource,
  object: string,
  operation: string,
  callerContext: Record<string, unknown>,
): PermissionDeniedError {
  // [ADR-0123 D4] The sentence names what is missing: the guest entry has no
  // organization the deployment could derive, a person outside every
  // organization lacks a membership (ADR-0093 D8.1, as amended), every other
  // denied caller an active organization.
  const guest = !isPrincipal(callerContext.userId) && callerContext.principalKind === 'guest';
  const whom = guest
    ? `the guest entry ${SUBJECT[source]} runs for`
    : `the user ${SUBJECT[source]} runs for`;
  const missing = guest
    ? 'resolves no organization'
    : isOutsideEveryOrganization(callerContext)
      ? 'holds no current membership in any organization'
      : 'has no active organization';
  const remedy = guest
    ? 'A guest acts only in the organization the deployment derives for it.'
    : isOutsideEveryOrganization(callerContext)
      ? 'A membership in the organization restores access.'
      : 'Join or select an active organization and retry.';
  return new PermissionDeniedError(
    `[Security] Access denied: '${object}' is scoped to an organization, and ${whom} ${missing} — ` +
      `so this ${operation} has no organization to act in, and ${ELEVATION[source]} does not lift the ` +
      `organization wall. ${remedy}`,
    { operation, object },
    `[ADR-0123 D2] An app-authored elevation is judged by its caller's organization wall: the caller's ` +
      `Layer 0 leaves '${object}' no organization for this ${operation}, so the elevation's ` +
      'reads resolve to nothing, its delete and purge match nothing, and its other writes are refused. System work ' +
      'that runs for no caller is unaffected.',
  );
}

/** The refusal of a write naming an organization the caller's wall does not admit. */
function landingRefusal(source: ElevationSource, object: string, operation: string): PermissionDeniedError {
  return new PermissionDeniedError(
    `[Security] Access denied: this ${operation} names an organization for a '${object}' record that the user ` +
      `${SUBJECT[source]} runs for may not write in, and ${ELEVATION[source]} does not lift the organization wall.`,
    { operation, object, field: ORGANIZATION_FIELD },
  );
}

/** The refusal of an update that would leave a row in no organization. */
function removalRefusal(source: ElevationSource, object: string, operation: string): PermissionDeniedError {
  return new PermissionDeniedError(
    `[Security] Access denied: this ${operation} would leave a '${object}' record in no organization, which the ` +
      `user ${SUBJECT[source]} runs for may not do, and ${ELEVATION[source]} does not lift the organization wall.`,
    { operation, object, field: ORGANIZATION_FIELD },
  );
}

/** A payload row that NAMES an organization (an absent or empty value is the stamp's to fill). */
function namesOrganization(row: Record<string, unknown>): boolean {
  const value = row[ORGANIZATION_FIELD];
  return value !== undefined && value !== null && value !== '';
}

/** A payload row of an update that SETS the organization column empty. */
function emptiesOrganization(row: Record<string, unknown>): boolean {
  if (!Object.prototype.hasOwnProperty.call(row, ORGANIZATION_FIELD)) return false;
  const value = row[ORGANIZATION_FIELD];
  return value === null || value === '';
}

/** The caller's own Layer 0 for one operation, as the plain door computes it. */
export interface CallerLayer0Answer {
  layer0: Record<string, unknown> | null;
  tenantLayer0Verdict: TenantLayer0Verdict;
  /** A platform operator's crossing, and nothing else, made the verdict `none` (ADR-0095 D3). */
  crossedByPlatformAdmin?: boolean;
  /**
   * The verdict is `deny` because the external object states no organization
   * scope (ADR-0015 §10), under this posture — not because the caller lacks
   * an organization; the refusal names the undeclared scope.
   */
  undeclaredExternalScopePosture?: TenancyPosture;
}

/** What {@link applyAppAutomationOrganizationWall} reads, supplied by the security plugin. */
export interface AppAutomationWallDeps {
  /** Is the object federated (ADR-0015)? The engine withholds every driver scope there. */
  isFederated(object: string): boolean;
  /** The caller's context with the door's facts resolved, when it does not carry them. */
  completeCaller(callerContext: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** The caller's own Layer 0 for the operation. */
  callerLayer0(callerContext: Record<string, unknown>, object: string, operation: string): Promise<CallerLayer0Answer>;
  /**
   * Does the row the write names lie inside `layer0`? Read as the platform, by
   * the wall's predicate alone, inside the transaction the write itself
   * carries on `context` — a row the write's own transaction wrote is there.
   */
  rowInScope(object: string, id: string | number | bigint, layer0: Record<string, unknown>, context: unknown): Promise<boolean>;
  /** The answer for a by-id write of a row the caller's wall does not admit: the door's not-found. */
  notFound(object: string, id: string | number | bigint, context: unknown): Error;
}

/**
 * The caller facts the wall resolves, memoised for one flow run: a run's
 * operations share their caller, so its membership set and grants are
 * resolved once per run, not once per operation. Keyed by the run, the user
 * and the active organization; never across runs, and never for an operation
 * that belongs to no run. Bounded and short-lived, and a failed resolution is
 * not kept, so the next operation asks again.
 */
export class RunCallerFactsMemo<T> {
  private readonly entries = new Map<string, { at: number; value: Promise<T> }>();

  constructor(
    private readonly maxEntries = 256,
    private readonly ttlMs = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  resolve(flowRunId: unknown, userId: string, tenantId: string | undefined, load: () => Promise<T>): Promise<T> {
    if (typeof flowRunId !== 'string' || flowRunId === '') return load();
    const key = `${flowRunId}\u0000${userId}\u0000${tenantId ?? ''}`;
    const at = this.now();
    const hit = this.entries.get(key);
    if (hit && at - hit.at < this.ttlMs) return hit.value;
    const value = load();
    this.entries.set(key, { at, value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return value;
  }
}

/** The organizations a verdict admits a new row into, or `undefined` for every organization. */
function admittedOrganizations(verdict: TenantLayer0Verdict): ReadonlySet<string> | undefined {
  if (verdict.kind === 'organization') return new Set([verdict.organizationId]);
  if (verdict.kind === 'organizations') return new Set(verdict.organizationIds);
  if (verdict.kind === 'deny') return new Set();
  return undefined;
}

/** Rows of a write payload, each a plain object. */
function payloadRows(data: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(data) ? data : data === undefined || data === null ? [] : [data];
  return rows.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r));
}

/**
 * Hold an app-authored elevation's operation to its caller's organization
 * wall. Returns for every operation the wall admits, having composed the
 * caller's wall onto its predicate where it has one; throws for a write the
 * wall refuses.
 *
 * Called by the data middleware ahead of its `isSystem` bypass, beside the
 * identity and append-only refusals, so the operation it admits continues to
 * the bypass with the caller's wall on it.
 */
export async function applyAppAutomationOrganizationWall(
  opCtx: {
    object?: unknown;
    operation?: unknown;
    context?: unknown;
    data?: unknown;
    options?: unknown;
    ast?: { where?: unknown } | null;
    tenantLayer0Verdict?: unknown;
  },
  deps: AppAutomationWallDeps,
): Promise<void> {
  const caller = appAutomationWallCaller(opCtx?.context);
  if (!caller) return;
  const object = typeof opCtx.object === 'string' ? opCtx.object : '';
  const operation = typeof opCtx.operation === 'string' ? opCtx.operation : '';
  if (!object || !operation) return;
  const verb = rlsOperationForVerb(operation);
  const isWrite = WRITE_CLASS.has(verb);
  const rows = isWrite && verb !== REMOVAL ? payloadRows(opCtx.data) : [];
  // [ADR-0095 D1] A write whose own data names an organization, or an update
  // whose own data empties the column, is judged for EVERY caller.
  const touchesOrganization = rows.some((row) => namesOrganization(row) || (verb === 'update' && emptiesOrganization(row)));
  // Judged by the wall's own verdict: a federated object, a decided segment
  // (judged by its run's caller), and a write whose own data names or empties
  // the organization.
  const alwaysAsked = deps.isFederated(object) || caller.decided === true || touchesOrganization;
  if (!alwaysAsked && !callerMayLackOrganization(caller.callerContext)) return;

  // The door's facts, resolved for the caller where the context does not
  // carry them (a flow run's envelope carries no permission sets), and the
  // question asked again: a resolved active membership may answer it.
  const callerContext = carriesDoorFacts(caller.callerContext)
    ? caller.callerContext
    : await deps.completeCaller(caller.callerContext);
  if (!alwaysAsked && !callerMayLackOrganization(callerContext)) return;

  const answer = await deps.callerLayer0(callerContext, object, operation);
  const { tenantLayer0Verdict, crossedByPlatformAdmin } = answer;
  // A deny verdict's projection is the deny sentinel, never "no wall".
  const layer0 = tenantLayer0Verdict.kind === 'deny' ? (answer.layer0 ?? RLS_DENY_FILTER) : answer.layer0;
  const denied = tenantLayer0Verdict.kind === 'deny';
  // [ADR-0123 D2] A denied caller's delete and purge are answered by the read
  // rule, as its plain door answers them: the wall's deny filter goes onto a
  // predicate delete (it matches nothing), and a by-id delete answers as a
  // row that is not there. Every other write is refused, naming what is missing.
  if (denied && isWrite && verb !== REMOVAL) {
    // [ADR-0015 §10] An external object that states no organization scope is
    // denied for every caller; the sentence names the undeclared scope, not an
    // active organization the caller may well have.
    if (answer.undeclaredExternalScopePosture) {
      const refusal = undeclaredExternalScopeWriteRefusal(object, operation, answer.undeclaredExternalScopePosture);
      throw new PermissionDeniedError(refusal.message, { operation, object }, refusal.developerMessage);
    }
    throw appAutomationOrganizationWallRefusal(caller.source, object, operation, callerContext);
  }

  if (operation === 'insert') {
    // [ADR-0123 D2, as amended] A new row lands in the active organization:
    // with none, a walled tenant object has nowhere to place it — a crossing
    // operator's insert included, as at the plain door.
    if (!carriesActiveOrganization(callerContext) && (tenantLayer0Verdict.kind !== 'none' || crossedByPlatformAdmin)) {
      throw appAutomationOrganizationWallRefusal(caller.source, object, operation, callerContext);
    }
    // A row that names its organization names one the caller's wall admits.
    const admitted = admittedOrganizations(tenantLayer0Verdict);
    if (admitted) {
      for (const row of rows) {
        if (namesOrganization(row) && !admitted.has(String(row[ORGANIZATION_FIELD]))) {
          throw landingRefusal(caller.source, object, operation);
        }
      }
    }
    return;
  }

  if (layer0 === null) {
    if (opCtx.ast) opCtx.tenantLayer0Verdict = tenantLayer0Verdict;
    return;
  }

  if (isWrite) {
    // A write whose own data names an organization the wall does not admit is
    // refused, and so is an update whose own data empties a row's organization.
    const admitted = admittedOrganizations(tenantLayer0Verdict);
    if (admitted) {
      for (const row of rows) {
        if (namesOrganization(row) && !admitted.has(String(row[ORGANIZATION_FIELD]))) {
          throw landingRefusal(caller.source, object, operation);
        }
        if (verb === 'update' && emptiesOrganization(row)) throw removalRefusal(caller.source, object, operation);
      }
    }
    if (!opCtx.ast) {
      // A by-id write: the row it names is the caller's to write only if the
      // caller's wall admits it; a row it does not admit answers as absent.
      // Read where the write runs: inside the transaction it carries.
      const id = extractSingleId(opCtx);
      // A write that names neither a row nor a predicate (the recycle bin's
      // entry verbs) is refused rather than run past the wall: the bin exempts
      // a system context from the verdict a dispatch records.
      if (id === null) throw appAutomationOrganizationWallRefusal(caller.source, object, operation, callerContext);
      if (denied || !(await deps.rowInScope(object, id, layer0, opCtx.context))) throw deps.notFound(object, id, opCtx.context);
      return;
    }
  } else if (!opCtx.ast) {
    // A read verb that carries no predicate to compose the wall into (none
    // does today: every read dispatches with its `ast`) is refused rather
    // than run past the wall.
    throw appAutomationOrganizationWallRefusal(caller.source, object, operation, callerContext);
  }

  // The predicate: the caller's wall AND-composed onto it, as the plain door
  // composes it (the deny sentinel by reference — the engine and the explain
  // engine recognise it by identity), and the verdict recorded as the door
  // records it, so the engine's driver scope follows the caller's wall.
  const where = opCtx.ast!.where;
  opCtx.ast!.where = where ? { $and: [where, layer0] } : layer0;
  opCtx.tenantLayer0Verdict = tenantLayer0Verdict;
}
