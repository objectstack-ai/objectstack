// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0103 — engine-owned write guard for the `engine-owned` / `append-only`
 * buckets.
 *
 * `managedBy: 'engine-owned'` (and the locked default of `append-only`) mean
 * *engine-owned*: rows a platform service owns end to end
 * (the approval engine, the sharing engine, the job runner, the messaging
 * pipeline, …), written only via
 * `isSystem` / a service `SYSTEM_CTX` / a context-less engine call. Until this
 * guard that promise was enforced by nothing but UI affordances and default
 * permission sets — a wildcard admin could raw-write these rows through the
 * generic data API (ADR-0049 violation), exactly the hole ADR-0092's identity
 * write guard closed for `better-auth`.
 *
 * This is the `engine-owned`/`append-only` counterpart, keyed off the SAME
 * contract the UI and the `apiMethods` reconciliation use —
 * {@link resolveCrudAffordances} — rather than the raw bucket string. An object is
 * engine-owned precisely when its resolved affordances grant no write; a member
 * that opens a verb via `userActions` (e.g. an `append-only` table that permits
 * an amendment) passes this guard and its real authz — the `DelegatedAdminGate`,
 * RLS self-grants, permission sets — adjudicates the principal, unchanged. The
 * admin/user-writable platform tables (the RBAC link tables,
 * `sys_user_preference`, the messaging config grids) live in `system-data` since
 * #3355, a writable-default bucket this guard does not cover at all.
 *
 * A write is USER-CONTEXT when its context carries a real `userId` and is not
 * `isSystem`. `isSystem` and context-less engine/service writes bypass by
 * construction — that is exactly how the legitimate engine writers reach these
 * tables (the messaging service's raw-engine writes carry no session; the
 * metadata-protocol repository threads only a transaction handle; approval /
 * job / sharing services stamp `SYSTEM_CTX`).
 *
 * Denials raise {@link PermissionDeniedError} (HTTP 403), the same sentinel the
 * rest of `SecurityPlugin` throws. `better-auth` is deliberately NOT handled
 * here — it keeps plugin-auth's identity write guard, whose field-whitelist and
 * session-snapshot-refresh semantics differ.
 */

import { resolveCrudAffordances } from '@objectstack/spec/data';
import { PermissionDeniedError } from './errors.js';

/**
 * Buckets whose DEFAULT affordance row is engine-owned (no user writes): the
 * explicit `engine-owned` bucket (ADR-0103) and `append-only`, whose locked
 * audit-log default is engine-owned too. Both are guarded, and any member that
 * opens a verb via `userActions` passes below.
 *
 * `system` used to sit here as well — its locked default made it engine-owned by
 * accident of the v16 additive split, while the 8 objects actually in it all
 * re-opened their writes via `userActions` and so passed this guard anyway. #3355
 * renamed that residue to `system-data` with a WRITABLE default, which puts it
 * with `platform` / `config`: buckets whose default grants the write have nothing
 * for a fail-closed guard to close on, and their authz is adjudicated by the
 * DelegatedAdminGate / RLS / permission sets. Net enforcement change: none — the
 * 8 objects passed before and pass now, for the same resolved-affordance reason.
 */
export const ENGINE_OWNED_BUCKETS: ReadonlySet<string> = new Set(['engine-owned', 'append-only']);

/**
 * Engine write operation → the {@link resolveCrudAffordances} flag it needs.
 * Read ops (`find`/`findOne`/`count`/`aggregate`/…) are absent and always pass.
 * Aligned with the `DelegatedAdminGate` governed-operation set and the registry's
 * `MANAGED_WRITE_VERB_AFFORDANCE`.
 *
 * ⚠️ This is the UI-intent axis (verb → *affordance*), NOT the API-tightening
 * axis. What the automatic API *admits* is decided by the verb → *primitive*
 * derivation in `@objectstack/spec/data` (`resolveEffectiveApiMethods`, #3391) —
 * a separate table on a separate axis (ADR-0103). Merging the two is deferred to
 * the enum-shrink (P2 of #3391); keep them distinct until then.
 */
const WRITE_OP_AFFORDANCE: Record<string, 'create' | 'edit' | 'delete'> = {
  insert: 'create',
  update: 'edit',
  upsert: 'edit',
  transfer: 'edit',
  delete: 'delete',
  purge: 'delete',
  restore: 'delete',
};

/** Minimal shape read off a registered schema. */
export interface EngineOwnedSchemaLike {
  name?: string;
  managedBy?: string;
  userActions?: unknown;
}

/**
 * A write is user-context when it carries a real user and is not system
 * elevated. Context-less engine calls (no session) and `isSystem` plugin/system
 * writes both bypass by construction.
 */
function isUserContextWrite(context: any): boolean {
  return Boolean(context?.userId) && context?.isSystem !== true;
}

/**
 * Fail-closed on a user-context generic write to an engine-owned
 * `engine-owned`/`append-only` object. No-op for: reads, non-engine-owned
 * buckets, system/context-less writes, and objects whose `userActions` open the
 * verb.
 *
 * @param schema     the registered schema (or undefined — unknown objects pass)
 * @param operation  the engine operation (`insert`/`update`/`delete`/…)
 * @param context    the operation execution context
 */
export function assertEngineOwnedWriteAllowed(
  schema: EngineOwnedSchemaLike | undefined | null,
  operation: string,
  context: any,
): void {
  const bucket = schema?.managedBy;
  if (!bucket || !ENGINE_OWNED_BUCKETS.has(bucket)) return;

  const need = WRITE_OP_AFFORDANCE[operation];
  if (!need) return; // read / non-write op

  if (!isUserContextWrite(context)) return; // isSystem or context-less → bypass

  const affordances = resolveCrudAffordances(schema as any);
  if (affordances[need]) return; // userActions opened it → writable set

  throw new PermissionDeniedError(
    `[Security] Access denied: '${schema?.name ?? 'object'}' is engine-owned ` +
      `(managedBy:'${bucket}', ADR-0103) — direct ${operation} via the data API is disabled. ` +
      `These rows are written only by their owning platform service; interact via the ` +
      `object's domain actions instead.`,
    { operation, object: schema?.name, managedBy: bucket },
  );
}
