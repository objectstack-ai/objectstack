// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25522 cut 12] The driver-options and engine-posture bodies of `ObjectQL`,
 * moved out of `engine.ts` whole: `buildDriverOptions` (the `DriverOptions`
 * every driver call receives: the transaction handle, the tenant scope, the
 * timezone and the tenant-audit fill-ins), `driverReadScope` (the Layer 0
 * verdict projected onto a read's driver scope), `engineLayer0Verdict` (that
 * verdict over the engine's own facts), `wallExemptedOperation` (did the
 * wall's exemption lift this operation's scope), `driverWriteTarget` (the
 * write target of an insert or upsert) and `resolveEnginePosture` (the
 * tenancy posture in force), with the one module helper only they use:
 * `accessibleOrganizationsOf`.
 *
 * A MOVE, not a redesign. Each exported function below is the body of the
 * `ObjectQL` method of the same name as it stood, re-indented one level and
 * otherwise unedited. Each method's docblock stays on the method in
 * `engine.ts`, which is still the contract. The helper moves with its
 * docblock, byte for byte, and is not exported.
 *
 * Nothing stays behind in this section: every member of it moved.
 *
 * ## The transaction seam's same-origin half (ADR-0119, ADR-0067)
 *
 * `buildDriverOptions` threads the open transaction handle only to the driver
 * that owns it (`transactionCoversDriverFor`, which stays in the class). The
 * ADR anchor entry for this file carries that half of the paragraph the
 * `engine.ts` entry carried; the `enforceTransactionOrigin` half stays there.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts`, applied per method as
 * `engine-file-reference-hydration.ts` applies it. The class keeps all six
 * methods with name, modifiers, signature, docblock and position, and each
 * body is one literal of exactly the {@link DriverOptionsHost} members that
 * method reads, plus a `.call`. The fields a body reads (`txStore`,
 * `_registry`, `tenancyPostureProvider`) go as GETTERS, so each read happens
 * when the body makes it, as it did. The methods they call
 * (`isClosedUnitHandle`, `transactionCoversDriverFor`, `driverWriteTarget`,
 * `driverReadScope`, `wallExemptedOperation`, `engineLayer0Verdict`,
 * `resolveEnginePosture`) go as late-bound closures over the instance, so a
 * double or spy set on the engine is still the one a call reaches.
 *
 * This module imports the engine only as a TYPE, so there is no module cycle
 * at run time, and nothing re-exports it, so the published surface does not
 * move.
 */

import { isTenancyDisabled } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import {
  // [ADR-0131 D8] The ONE tenant read predicate, shared with plugin-security's
  // Layer 0 — see {@link buildDriverOptions}.
  computeTenantLayer0Verdict,
} from '@objectstack/core';
import { resolveTenantFieldName } from './tenancy/system-write-organization.js';
import { resolveTenancyPosture } from '@objectstack/types';
import {
  normalizeTenancyPosture,
  TenantLayer0VerdictSchema,
  type TenancyPosture,
  type TenantLayer0Verdict,
} from '@objectstack/spec/security';
import { isFederatedObject } from './federated-object.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and no
 * other; each function's `this` is the `Pick` of the members IT reads. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's type on the class is a change here too, and naming a member the
 * class does not have is a compile error. See the module header for which
 * members are getters.
 */
export interface DriverOptionsHost {
  readonly txStore: ObjectQL['txStore'];
  readonly _registry: ObjectQL['_registry'];
  readonly tenancyPostureProvider: ObjectQL['tenancyPostureProvider'];
  isClosedUnitHandle: ObjectQL['isClosedUnitHandle'];
  transactionCoversDriverFor: ObjectQL['transactionCoversDriverFor'];
  driverWriteTarget: ObjectQL['driverWriteTarget'];
  driverReadScope: ObjectQL['driverReadScope'];
  wallExemptedOperation: ObjectQL['wallExemptedOperation'];
  engineLayer0Verdict: ObjectQL['engineLayer0Verdict'];
  resolveEnginePosture: ObjectQL['resolveEnginePosture'];
}

/**
 * [ADR-0105 D2] The context's organization access set
 * (`ExecutionContext.accessible_org_ids`), stringified — `undefined` when
 * absent or empty, which the verdict reads as "no membership" under `group`.
 */
function accessibleOrganizationsOf(execCtx: ExecutionContext | undefined): string[] | undefined {
  const set = (execCtx as { accessible_org_ids?: unknown } | undefined)?.accessible_org_ids;
  return Array.isArray(set) && set.length > 0 ? set.map(String) : undefined;
}

/** The body of `ObjectQL#buildDriverOptions`; the method's docblock there is its contract. */
export function buildDriverOptions(
  this: Pick<DriverOptionsHost, 'isClosedUnitHandle' | 'txStore' | 'transactionCoversDriverFor' | '_registry' | 'driverWriteTarget' | 'driverReadScope' | 'wallExemptedOperation'>,
  object: string,
  execCtx?: ExecutionContext,
  base?: any,
  scope: { writeTarget?: boolean; recordedVerdict?: unknown } = {},
): any {
  // The open transaction may arrive explicitly via the context, or ambiently
  // via txStore when an internal query runs during a transactional write
  // (ADR-0034). Explicit wins; ambient is the safety net. [#22855] A handle
  // whose unit has closed is no handle: work the unit started and did not
  // await runs unenrolled (`runOpenedUnit`).
  const explicit = execCtx?.transaction;
  const tx = explicit !== undefined && !this.isClosedUnitHandle(explicit)
    ? explicit
    : this.txStore.getStore()?.transaction;
  // [#5351] SAME-ORIGIN GATE. A transaction handle is a property of ONE
  // driver's connection; handing it to a different driver does not put that
  // driver's statement inside the transaction, it executes the statement on
  // the WRONG CONNECTION — measured on knex/SQLite as `no such table` against
  // a database that never held the object. The write path's
  // `enforceTransactionOrigin` has already refused a business write by the
  // time we get here (and let a system ledger through by decision), so this
  // is the structural half: whatever survives to here, the handle only ever
  // reaches the driver that owns it. It covers READS too, which have no gate
  // of their own and were riding the same wrong connection.
  const hasTx = tx !== undefined && this.transactionCoversDriverFor(object, tx);
  const objectSchema = this._registry.getObject(object) as any;
  // `isFederatedObject` is the same predicate every schema-sync seam routes a
  // federated object by — one spelling of "this schema is the remote's",
  // not a second reading of it.
  const isFederated = isFederatedObject(objectSchema);
  const tenantObject = !isTenancyDisabled(objectSchema) && !isFederated;
  const tenantScope = tenantObject
    ? scope.writeTarget
      ? this.driverWriteTarget(execCtx)
      : this.driverReadScope(execCtx, scope.recordedVerdict)
    : undefined;
  const hasTenant = tenantScope !== undefined;
  const hasTz = execCtx?.timezone !== undefined;
  const isSystem = execCtx?.isSystem === true;
  // [ADR-0131 D9/D13] The tenant-audit's scope is the object's SCHEMA: a
  // tenant column (the registered schema's, as `resolveTenantFieldName`
  // reads it) on an object that is not federated. That is the same reading
  // the system-insert rule takes, and there is no second, per-table one —
  // the #13491 ledger that used to narrow this by name retired with D13. An
  // object is outside the audit only by declaring itself outside the
  // machinery (`tenancy.enabled: false`, `systemFields.tenant: false`, no
  // tenant field, `external`), which `scripts/platform-object-tenancy-census.json`
  // enumerates for the platform namespaces.
  const isTenantAuditInScope =
    resolveTenantFieldName(objectSchema) !== null &&
    !isFederated;
  // [ADR-0131 D8 · 8c-1] The wall's exemption, declared to the driver. An
  // exempt platform admin's predicate write reaches the driver with no
  // `tenantId` because the wall lifted the scope on purpose, and the
  // driver's `[tenant-audit]` line tells such a write to declare
  // `bypassTenantAudit: true` — an option no REST caller can set. The
  // exemption is decided once, by `computeTenantLayer0Verdict`, and arrives
  // here as the recorded verdict; this reads it, it does not re-decide it
  // (see {@link wallExemptedOperation}).
  const wallExempt =
    tenantObject && isTenantAuditInScope && !scope.writeTarget &&
    this.wallExemptedOperation(execCtx, scope.recordedVerdict);
  const preserveAudit = (execCtx as any)?.preserveAudit === true;
  if (!hasTx && !hasTenant && !isSystem && !hasTz && !preserveAudit && !wallExempt) return base;
  const opts: any = base && typeof base === 'object' ? { ...base } : {};
  if (hasTx && opts.transaction === undefined) {
    opts.transaction = tx;
  }
  if (hasTenant && opts.tenantId === undefined) {
    opts.tenantId = tenantScope.tenantId;
  }
  if (hasTenant && opts.tenantIds === undefined && tenantScope.tenantIds !== undefined) {
    opts.tenantIds = tenantScope.tenantIds;
  }
  if (hasTz && opts.timezone === undefined) {
    // Thread the business timezone so date-dependent driver generation
    // (autonumber `{YYYYMMDD}` tokens) resolves the calendar day correctly.
    opts.timezone = execCtx!.timezone;
  }
  if (isSystem && opts.bypassTenantAudit === undefined && !isTenantAuditInScope) {
    // [#13491 → ADR-0131 D13] The isSystem mute, cut by the object's
    // schema alone (2026-08-31 ruling, execution point 1: the OBJECT decides,
    // never the caller's flag).
    //
    // It used to mute EVERY elevated write, whatever the object was. The
    // census cited in commit e49d98896's message measured what that cost: 135 of 175 write call sites
    // (77%) were silenced here — at the control's LARGEST gate, sitting
    // ahead of the condition the control is about — and the control has
    // never produced a finding, while all five known instances of the defect
    // were found by a person reading call sites.
    //
    // What still mutes: an object with no tenant field at all (nothing to be
    // unscoped from — the driver would exit at `resolveTenantField` anyway)
    // and a federated one. What does not: any object with a tenant column,
    // platform namespace or not — a name prefix, or a hand-kept list of
    // names, decides nothing here. A caller that means it still passes
    // `bypassTenantAudit: true` explicitly and is honoured above — this
    // branch only fills in a value nobody supplied.
    //
    // ⚠️ Direction, per execution point 3: what this ADDS is a driver WARN
    // line. It changes nothing about what any write touches.
    opts.bypassTenantAudit = true;
  }
  if (wallExempt && opts.bypassTenantAudit === undefined) {
    // The same fill-in-only rule as the isSystem mute above: a caller's own
    // value wins. Diagnostics only — the driver's scope is already the
    // verdict's (no `tenantId`), and this option silences a warning and
    // touches nothing else; on a read it is inert.
    opts.bypassTenantAudit = true;
  }
  if (preserveAudit && opts.preserveAudit === undefined) {
    // Historical import (#3493): let the driver keep a supplied `updated_at`
    // instead of force-stamping now on the update path.
    opts.preserveAudit = true;
  }
  return opts;
}

/** The body of `ObjectQL#driverReadScope`; the method's docblock there is its contract. */
export function driverReadScope(
  this: Pick<DriverOptionsHost, 'engineLayer0Verdict'>,
  execCtx: ExecutionContext | undefined,
  recordedVerdict: unknown,
): { tenantId: string; tenantIds?: string[] } | undefined {
  const activeOrganization =
    execCtx?.tenantId !== undefined && execCtx.tenantId !== null && String(execCtx.tenantId) !== ''
      ? String(execCtx.tenantId)
      : undefined;
  const recorded = recordedVerdict === undefined ? undefined : TenantLayer0VerdictSchema.safeParse(recordedVerdict);
  const verdict = recorded?.success ? recorded.data : this.engineLayer0Verdict(execCtx, activeOrganization);
  switch (verdict.kind) {
    case 'none':
      return undefined;
    case 'organization':
      return { tenantId: verdict.organizationId };
    case 'organizations':
      return { tenantId: activeOrganization ?? verdict.organizationIds[0], tenantIds: [...verdict.organizationIds] };
    case 'deny':
      return activeOrganization !== undefined ? { tenantId: activeOrganization } : undefined;
  }
}

/** The body of `ObjectQL#engineLayer0Verdict`; the method's docblock there is its contract. */
export function engineLayer0Verdict(
  this: Pick<DriverOptionsHost, 'resolveEnginePosture'>,
  execCtx: ExecutionContext | undefined,
  activeOrganization: string | undefined,
): TenantLayer0Verdict {
  return computeTenantLayer0Verdict({
    tenancyPosture: this.resolveEnginePosture(),
    organizationId: activeOrganization,
    accessibleOrgIds: accessibleOrganizationsOf(execCtx),
    // Left to the driver, which resolves the tenant column from the
    // table it actually built (`resolveTenantField`): an object with no
    // such column is unscoped there whatever this says. `undefined` is
    // the verdict's "assume a tenant object", as Layer 0 reads an
    // unresolved field set.
    objectHasOrgIdField: undefined,
    tenancyDisabled: false,
    // The engine holds no permission sets: no exemption is ITS to grant.
    posturePermitsCrossTenant: false,
    isPlatformAdmin: false,
  });
}

/** The body of `ObjectQL#wallExemptedOperation`; the method's docblock there is its contract. */
export function wallExemptedOperation(
  this: Pick<DriverOptionsHost, 'engineLayer0Verdict'>,
  execCtx: ExecutionContext | undefined,
  recordedVerdict: unknown,
): boolean {
  if (recordedVerdict === undefined) return false;
  const recorded = TenantLayer0VerdictSchema.safeParse(recordedVerdict);
  if (!recorded.success || recorded.data.kind !== 'none') return false;
  const activeOrganization =
    execCtx?.tenantId !== undefined && execCtx.tenantId !== null && String(execCtx.tenantId) !== ''
      ? String(execCtx.tenantId)
      : undefined;
  return this.engineLayer0Verdict(execCtx, activeOrganization).kind !== 'none';
}

/** The body of `ObjectQL#driverWriteTarget`; the method's docblock there is its contract. */
export function driverWriteTarget(
  this: Pick<DriverOptionsHost, 'resolveEnginePosture'>,
  execCtx: ExecutionContext | undefined,
): { tenantId: string; tenantIds?: string[] } | undefined {
  if (execCtx?.tenantId === undefined) return undefined;
  const tenantIds =
    this.resolveEnginePosture() === 'group' ? accessibleOrganizationsOf(execCtx) : undefined;
  return { tenantId: execCtx.tenantId as string, ...(tenantIds ? { tenantIds: [...tenantIds] } : {}) };
}

/** The body of `ObjectQL#resolveEnginePosture`; the method's docblock there is its contract. */
export function resolveEnginePosture(
  this: Pick<DriverOptionsHost, 'tenancyPostureProvider'>,
): TenancyPosture {
  const injected = normalizeTenancyPosture(this.tenancyPostureProvider?.());
  if (injected) return injected;
  try {
    return resolveTenancyPosture();
  } catch {
    return 'isolated';
  }
}
