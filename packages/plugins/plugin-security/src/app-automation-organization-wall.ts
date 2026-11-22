// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An app-authored elevation sees through the organization wall what its
 * caller's plain door sees (ADR-0095 D1, ADR-0123 D1/D2).
 *
 * App-authored automation elevates by declaration: an action body always, a
 * hook by `runAs: 'system'` (or a system context it inherits, or its
 * `ctx.api.sudo()`), a flow by `runAs: 'system'`. Each runs
 * `{ ...the caller's envelope, isSystem: true }`, and the data middleware
 * returns `next()` for `isSystem` ahead of every gate below it, the Layer 0
 * tenant wall among them. Elevation lifts the caller's business rules (Layer
 * 1: object and field permissions, ownership, sharing); it does not lift the
 * organization wall. So the wall that judges the elevation's operation is the
 * caller's own, the one the caller's plain door composes, and the elevation
 * reaches through it exactly what the caller reaches:
 *
 * - a caller with an organization scope keeps the scope the engine already
 *   projects from its context (`organization_id = <active>` under `isolated`,
 *   the membership set under `group`), and nothing here runs for it;
 * - a caller the wall DENIES — no active organization under `isolated`, an
 *   empty membership set under `group`, a person outside every organization
 *   under `single` (ADR-0093 D8.1, as amended) — reads nothing (the wall's
 *   deny sentinel, composed into the read's predicate as the plain door
 *   composes it: zero rows, no error), and every write is refused
 *   `403 PERMISSION_DENIED`, naming the missing active organization
 *   (ADR-0123 D2 and D4).
 *
 * The exemptions are the wall's own, because the verdict is the wall's own:
 * the caller's Layer 0, computed by the one ladder
 * (`computeTenantLayer0Verdict`) over the caller's own context, with the
 * caller's own permission sets. An object outside tenancy, an object with no
 * organization column and a platform operator crossing the wall on an object
 * whose posture permits it are answered as the caller's plain door answers
 * them.
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
 * miss, and is unchanged.
 */

import { isOutsideEveryOrganization, rlsOperationForVerb } from '@objectstack/core';
import type { TenantLayer0Verdict } from '@objectstack/spec/security';

import { PermissionDeniedError } from './errors.js';
import { ELEVATION, SUBJECT, elevationSource, type ElevationSource } from './flow-system-identity-write-refusal.js';
import { RLS_DENY_FILTER } from './rls-compiler.js';

/** The verbs judged as writes: `rlsOperationForVerb` maps `purge` and `restore` onto them. */
const WRITE_CLASS: ReadonlySet<string> = new Set(['insert', 'update', 'delete']);

/** An elevation with a caller, and that caller's own context. */
export interface AppAutomationWallCaller {
  source: ElevationSource;
  /** The elevated context as the caller's plain door reads it: `isSystem` off, everything else kept. */
  callerContext: Record<string, unknown>;
}

/**
 * The caller an app-authored elevation runs for, or `undefined` for every
 * other context: a user's own (not elevated), a platform writer's (no run, no
 * mark), and an elevation that carries no caller.
 */
export function appAutomationWallCaller(context: unknown): AppAutomationWallCaller | undefined {
  if (!context || typeof context !== 'object') return undefined;
  const source = elevationSource(context as { isSystem?: unknown; flowRunId?: unknown });
  if (!source) return undefined;
  const c = context as { userId?: unknown; principalKind?: unknown };
  const hasCaller = (typeof c.userId === 'string' && c.userId !== '') || c.principalKind === 'guest';
  if (!hasCaller) return undefined;
  return { source, callerContext: { ...(context as Record<string, unknown>), isSystem: false } };
}

/**
 * Can the wall deny this caller at all? Only a context with no active
 * organization, or one whose membership set is empty, can be denied: every
 * other caller is scoped by the engine's own projection of the same verdict,
 * so the common elevation (a caller with an active organization) pays no
 * permission-set resolution here.
 */
export function callerMayLackOrganization(callerContext: Record<string, unknown>): boolean {
  const tenantId = callerContext.tenantId;
  if (tenantId === undefined || tenantId === null || tenantId === '') return true;
  const set = callerContext.accessible_org_ids;
  return Array.isArray(set) && set.length === 0;
}

/** The refusal: the standard catalog's `PERMISSION_DENIED`, naming the missing active organization. */
export function appAutomationOrganizationWallRefusal(
  source: ElevationSource,
  object: string,
  operation: string,
  callerContext: Record<string, unknown>,
): PermissionDeniedError {
  // [ADR-0123 D4] The sentence names what is missing: a person outside every
  // organization lacks a membership (ADR-0093 D8.1, as amended), every other
  // denied caller an active organization.
  const missing = isOutsideEveryOrganization(callerContext)
    ? 'holds no current membership in any organization'
    : 'has no active organization';
  return new PermissionDeniedError(
    `[Security] Access denied: '${object}' is scoped to an organization, and the user ${SUBJECT[source]} runs for ` +
      `${missing} — so this ${operation} has no organization to act in, and ${ELEVATION[source]} does not lift ` +
      'the organization wall. Join or select an active organization and retry.',
    { operation, object },
    `[ADR-0123 D2] An app-authored elevation sees through the organization wall exactly what its caller's plain ` +
      `door sees: the caller's Layer 0 denies '${object}', so its reads resolve to nothing and its writes are ` +
      'refused. System work that runs for no caller, and a caller with an active organization, are unaffected.',
  );
}

/** What {@link applyAppAutomationOrganizationWall} reads about the caller: its own Layer 0 for the operation. */
export type CallerLayer0 = (
  callerContext: Record<string, unknown>,
  object: string,
  operation: string,
) => Promise<{ layer0: Record<string, unknown> | null; tenantLayer0Verdict: TenantLayer0Verdict }>;

/**
 * Hold an app-authored elevation's operation to its caller's organization
 * wall. Returns for every operation the wall admits, having composed the
 * wall's deny sentinel into a denied read's predicate; throws the refusal for
 * a denied write, and for a denied read that carries no predicate to compose
 * it into (none does today: every read verb dispatches with its `ast`).
 *
 * Called by the data middleware ahead of its `isSystem` bypass, beside the
 * identity and append-only refusals, so the operation it admits continues to
 * the bypass unchanged.
 */
export async function applyAppAutomationOrganizationWall(
  opCtx: { object?: unknown; operation?: unknown; context?: unknown; ast?: { where?: unknown } | null; tenantLayer0Verdict?: unknown },
  callerLayer0: CallerLayer0,
): Promise<void> {
  const caller = appAutomationWallCaller(opCtx?.context);
  if (!caller || !callerMayLackOrganization(caller.callerContext)) return;
  const object = typeof opCtx.object === 'string' ? opCtx.object : '';
  const operation = typeof opCtx.operation === 'string' ? opCtx.operation : '';
  if (!object || !operation) return;
  const { tenantLayer0Verdict } = await callerLayer0(caller.callerContext, object, operation);
  if (tenantLayer0Verdict.kind !== 'deny') return;
  if (WRITE_CLASS.has(rlsOperationForVerb(operation)) || !opCtx.ast) {
    throw appAutomationOrganizationWallRefusal(caller.source, object, operation, caller.callerContext);
  }
  // The read: the wall's deny sentinel, by reference (the engine and the
  // explain engine recognise it by identity), AND-composed onto the predicate
  // exactly as the caller's plain door composes it. Recorded as the plain
  // door records it, so a reader of the verdict learns the wall's decision.
  const where = opCtx.ast.where;
  opCtx.ast.where = where ? { $and: [where, RLS_DENY_FILTER] } : RLS_DENY_FILTER;
  opCtx.tenantLayer0Verdict = tenantLayer0Verdict;
}
