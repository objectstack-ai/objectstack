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
 * ## A driver is handed the declared driver options and nothing else
 *
 * Since the move, this module also owns the engine → driver hop's key set:
 * `declaredDriverOptionKeys` (the keys `DriverOptionsSchema` declares),
 * `pickDeclaredDriverOptions` (a bag cut to those keys — what
 * `buildDriverOptions` now returns, and what the engine's raw `execute` hands
 * its driver) and `mergeDriverOptionsIntoHookView` (the `after*` hook view of
 * `input.options`, which stays the caller's bag with the driver options merged
 * on). The engine builds the driver's options with `buildDriverOptions` and
 * hands a driver that object; the merged view goes to hooks, never to a
 * driver.
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
 *
 * [#30053 codemod] A PRIVATE method's docblock has since moved here,
 * onto its function (`--hand-docs` of `scripts/codemod-split-engine.mjs`),
 * and the class keeps none for it; a public or protected method's docblock
 * stays on the class, the contract, and its function keeps the placeholder.
 */

import { DriverOptionsSchema, isTenancyDisabled } from '@objectstack/spec/data';
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

/**
 * Does this shape member admit only absence? That is a `retiredKey()`
 * tombstone (`z.never()` under its `.optional()`): declared so the removal is
 * audible, never a key a driver is handed. Structural, as the spec's own
 * `acceptsNothing` walker reads it, so it holds however the tombstone helper is
 * spelled.
 */
function admitsOnlyAbsence(member: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  const def = (member as { _zod?: { def?: { type?: string; innerType?: unknown } } } | undefined)?._zod?.def;
  if (!def?.type) return false;
  if (def.type === 'never') return true;
  return def.type === 'optional' || def.type === 'nullable' || def.type === 'default' || def.type === 'readonly'
    ? admitsOnlyAbsence(def.innerType, depth + 1)
    : false;
}

let declaredDriverOptionKeysMemo: ReadonlySet<string> | undefined;

/**
 * The option keys a driver is handed: the ones `DriverOptionsSchema` declares,
 * minus its tombstones. Read off the schema on first use (it is lazy) and never
 * restated here, so a key the spec declares reaches every driver with no edit
 * in this file, and a key it does not declare reaches none.
 */
export function declaredDriverOptionKeys(): ReadonlySet<string> {
  if (declaredDriverOptionKeysMemo === undefined) {
    const shape = DriverOptionsSchema.shape as Record<string, unknown>;
    declaredDriverOptionKeysMemo = new Set(Object.keys(shape).filter((key) => !admitsOnlyAbsence(shape[key])));
  }
  return declaredDriverOptionKeysMemo;
}

/**
 * The engine → driver hop: a copy of `bag` holding its declared driver-option
 * keys ({@link declaredDriverOptionKeys}) and nothing else, or `undefined` when
 * there is no bag. Copied as a spread copies (own enumerable keys), so a
 * declared key keeps exactly the value it had.
 *
 * A caller's option bag is not a driver option bag: it carries the query, the
 * write-observability callbacks and the other engine-level keys of its
 * `Engine*Options` contract, which the engine reads and the driver contract
 * never declared. They are dropped here without a sound — the caller's bag was
 * already judged at the engine's own door, so nothing dropped here is the
 * caller's mistake.
 */
export function pickDeclaredDriverOptions(bag: unknown): Record<string, unknown> | undefined {
  if (bag === null || typeof bag !== 'object') return undefined;
  const source = bag as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of declaredDriverOptionKeys()) {
    if (Object.prototype.propertyIsEnumerable.call(source, key)) picked[key] = source[key];
  }
  return picked;
}

/**
 * `input.options` once the driver options are built — the `after*` phase of
 * the HookContext PHASE contract (`hook.zod.ts`): the caller's bag with the
 * driver options merged on. ADDITIVE, as that contract states: every key the
 * caller's bag carried stays readable to a hook. This view is the hooks', and
 * only the hooks': the driver is handed `driverOptions` itself.
 *
 * Answers the caller's own bag, the same object, when the driver options add
 * nothing to it, and a COPY of `driverOptions` when there is no caller bag —
 * never `driverOptions` itself, so the hooks' view and the driver's bag are
 * never one object, whatever order a later edit puts a hook and a driver
 * call in.
 */
export function mergeDriverOptionsIntoHookView(
  callerBag: unknown,
  driverOptions: Record<string, unknown> | undefined,
): unknown {
  if (driverOptions === undefined) return callerBag;
  if (callerBag === null || typeof callerBag !== 'object') return { ...driverOptions };
  const bag = callerBag as Record<string, unknown>;
  const addsNothing = Object.keys(driverOptions).every(
    (key) => Object.prototype.propertyIsEnumerable.call(bag, key) && bag[key] === driverOptions[key],
  );
  return addsNothing ? callerBag : { ...bag, ...driverOptions };
}

/**
 * Build the DriverOptions blob passed to every IDataDriver call.
 *
 * # The tenant read scope is the wall's verdict (ADR-0131 D8)
 *
 * The driver's native tenant scope — `tenantId` (equality) and `tenantIds`
 * (the `group` union), which `applyTenantScope` compiles — is the Layer 0
 * verdict projected onto `DriverOptions`, never a second derivation beside
 * it. One function decides ({@link computeTenantLayer0Verdict},
 * `@objectstack/core`), and the engine reads it from one of two places:
 *
 * - **the verdict the wall RECORDED on this operation**
 *   ({@link OperationContext.tenantLayer0Verdict}, passed in as
 *   `scope.recordedVerdict`) — present where the security layer composed its
 *   wall onto the predicate: a read, or a predicate write. It already carries
 *   what only that layer can know (the exempt `PLATFORM_ADMIN` on a
 *   posture-permitting object, the verified platform owner's read, the
 *   delegator's intersection), so the driver reaches exactly the rows Layer 0
 *   admits;
 * - **otherwise, the same function over the engine's own facts** — the
 *   posture in force ({@link resolveEnginePosture}), the context's active
 *   organization and access set, the object's tenancy — with no admin
 *   exemption, since the engine holds no permission sets. That covers a
 *   system context, a by-id write, and a composition with no security layer
 *   mounted.
 *
 * Projected: `none` (the `single` posture; a non-tenant, tenancy-disabled or
 * federated object; an exempt platform admin) → no scope; `organization` →
 * `tenantId`; `organizations` → `tenantIds`, with the active organization as
 * `tenantId` (the driver keys its scope on `tenantId` being present); `deny`
 * → the active organization if there is one — the narrowest scope a driver
 * can express, and where the wall ran its deny sentinel is already in the
 * predicate. Under `single` the driver therefore no longer narrows a read to
 * the active organization: the posture is one tenant, and isolation inside it
 * was never the driver's to add (ADR-0131 D11).
 *
 * # The write target is not a read scope
 *
 * An insert (`scope.writeTarget`) keeps the active organization as
 * `tenantId` in EVERY posture — `injectTenantOnInsert` stamps the row with
 * it, the counter scopes by it, and an upsert's identity probe refuses a
 * merge into another organization's row by it — and the `group` membership
 * set beside it, unchanged.
 *
 * # Withheld for two object postures
 *
 * 1. **`tenancy.enabled: false`** (ADR-0066 platform-global posture, e.g.
 *    `sys_license`): stamping the caller's active-org tenantId there would
 *    org-scope a global catalog at the driver, and its NULL-org rows would
 *    vanish for authenticated org-context reads while anonymous reads still
 *    see them (#3249).
 *
 * 2. **`external != null`** — a federated object (ADR-0015), whose schema
 *    is owned by the REMOTE database (#7738). The driver turns `tenantId`
 *    into `organization_id = :tenant`, and
 *    against a remote table that carries no such column that is a SQL error
 *    on Postgres/MySQL — or worse on SQLite, whose quoted-identifier
 *    fallback reinterprets the unresolvable identifier as the string
 *    literal `'organization_id'`, makes both disjuncts constant-false, and
 *    answers **0 rows with HTTP 200**: a correctly-bound external object
 *    silently reads empty.
 *
 *    Note the reason is NOT "the remote happens to lack the column". The
 *    column the driver detects is the platform's OWN: `applySystemFields`
 *    (`resolveInjectedSystemColumns`) injects `organization_id` into every
 *    object it registers, with no `external` branch, and
 *    `SqlDriver.registerExternalObject` is DDL-free by design and runs no
 *    introspection — so it computes the tenant column from the platform's
 *    field set, never from the remote's. On a federated object
 *    `organization_id`'s presence is therefore always the injection and
 *    never evidence about the remote, which leaves the engine no ground on
 *    which to scope by it. Tenant isolation for federated data belongs to
 *    the remote and to the layers above (RBAC/RLS, the datasource binding),
 *    not to a predicate the platform guesses onto someone else's table.
 *
 * # Declared keys only
 *
 * The result holds the keys `DriverOptionsSchema` declares and nothing else
 * (`pickDeclaredDriverOptions`, `engine-driver-options.ts`). `base` is
 * usually a caller's whole option bag — the query, the write-observability
 * callbacks and the other engine-level keys ride in it — and only its
 * declared keys are kept: an explicitly-passed `base.tenantId` /
 * `base.transaction` / `base.bypassTenantAudit` is deliberate caller intent
 * and still wins, under every verdict; everything else in the bag is the
 * engine's, never a driver's. That is why a verb hands its driver THIS
 * object and keeps `input.options` as the hooks' additive view
 * (`mergeDriverOptionsIntoHookView`). System / isSystem callers may still
 * cross tenants by clearing `tenantId` themselves on the resulting object;
 * this helper does not mask the system path.
 */
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
  // A driver is handed the keys `DriverOptionsSchema` declares and nothing
  // else: the declared keys of `base` (a caller's explicit `tenantId` /
  // `bypassTenantAudit` / `transaction` still win below), never the rest of
  // the bag it rode in on. See {@link pickDeclaredDriverOptions}.
  const declared = pickDeclaredDriverOptions(base);
  if (!hasTx && !hasTenant && !isSystem && !hasTz && !preserveAudit && !wallExempt) return declared;
  const opts: any = declared ?? {};
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

/**
 * [ADR-0131 D8] The driver's native read scope for one operation — the Layer
 * 0 verdict projected onto `DriverOptions` (see {@link buildDriverOptions}).
 * `undefined` is "no scope"; the caller has already excluded a
 * tenancy-disabled or federated object.
 *
 * A recorded verdict that does not parse as `TenantLayer0VerdictSchema`
 * reads as absent — never as an organization — and the engine then decides
 * over its own facts, which carry no admin exemption: fail toward the wall.
 */
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

/**
 * The Layer 0 verdict over the engine's OWN facts — what {@link driverReadScope}
 * falls back to where no wall was recorded. The one ladder,
 * `computeTenantLayer0Verdict`, with the exemption's facts withheld.
 */
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

/**
 * [ADR-0131 D8 · 8c-1] Did the wall's EXEMPTION lift this operation's scope?
 * True when the recorded verdict is `none` while the same ladder over the
 * engine's own facts — every rung but the exemption — would have walled it.
 * That is plugin-security's own `crossedByPlatformAdmin` test (the ladder
 * asked a second time with only the exemption withheld), with the engine's
 * existing fallback ({@link engineLayer0Verdict}, what an unrecorded
 * operation is scoped by) as the second asking: no rung is computed beside
 * the one ladder, and a `single` posture answers `none` both ways, so it is
 * no crossing. The #12974 owner bypass records `none` on READS only, where
 * the declaration is inert.
 *
 * Absence is not exemption: a by-id write, a system context or a stack with
 * no security layer records nothing, and answers false. A recorded value
 * that does not parse answers false too — junk never lifts anything.
 */
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

/**
 * The write target of an insert or upsert: the active organization, in every
 * posture, with the `group` membership set beside it — the scope the
 * driver's insert readback and upsert identity probe narrow by (ADR-0105 D5:
 * the active organization is where a write lands).
 */
export function driverWriteTarget(
  this: Pick<DriverOptionsHost, 'resolveEnginePosture'>,
  execCtx: ExecutionContext | undefined,
): { tenantId: string; tenantIds?: string[] } | undefined {
  if (execCtx?.tenantId === undefined) return undefined;
  const tenantIds =
    this.resolveEnginePosture() === 'group' ? accessibleOrganizationsOf(execCtx) : undefined;
  return { tenantId: execCtx.tenantId as string, ...(tenantIds ? { tenantIds: [...tenantIds] } : {}) };
}

/**
 * [#8844] The tenancy posture IN FORCE for this engine, by the same two-step
 * `app-plugin.organizationWallActive` uses and for the same reason: the
 * injected provider is the `tenancy` service's answer (what is actually
 * ENFORCED, degraded boots included), and the env resolution is what the
 * operator ASKED for — the best fact available to a lean embedding that
 * mounts no SecurityPlugin.
 *
 * ⛔ Never `resolveMultiOrgEnabled()`: ADR-0105 D1 demoted that boolean to a
 * back-compat INPUT of `resolveTenancyPosture()`, so it reads `false` on a
 * deployment configured the documented way and would put a fully walled
 * install on the single-tenant branch below — the third recurrence of that
 * shape is what `app-plugin` documents.
 *
 * Read live per call, never cached: nothing here may freeze a verdict a later
 * boot phase can still change. `resolveTenancyPosture()` THROWS on an
 * unrecognized `OS_TENANCY_POSTURE` (deliberately — a typo'd posture must not
 * silently remove the wall); a write is not the place that refusal belongs,
 * and an unreadable posture is exactly the case where guessing `single` would
 * be worst, so it degrades to the walled reading and the write is refused.
 */
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
