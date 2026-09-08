// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Read-side tenant scoping for the in-memory driver (#16589).
 *
 * ## The defect this closes
 *
 * Two predicates decided "is this object tenant-scoped", and they disagreed on
 * the DEFAULT case. `Engine.buildDriverOptions` scopes unless the object opts
 * OUT (`execCtx?.tenantId !== undefined && !isTenancyDisabled(objectSchema) &&
 * !isFederated`), while this package's `declaresTenantScope` refuses only
 * an explicit opt-IN (`tenancy.enabled === true`). An object that omits the
 * `tenancy` block — the common case — is therefore scoped by the engine and
 * invisible to the boot guard, and this driver then did nothing with the scope:
 * `tenantId`, `tenantIds` and `organization_id` occurred nowhere in
 * `memory-driver.ts`. The read path knew nothing about tenants; the
 * unique-constraint path did.
 *
 * The measured consequence: on one app, seven objects, same build, same seed,
 * same account, the four objects that omit the block returned 12/30/40/14 rows
 * on the in-memory driver against 0 on sqlite, and neither driver said a word.
 * The three that declare `tenancy.enabled: false` agreed exactly — the split
 * line WAS the declaration.
 *
 * ## Why implement rather than refuse
 *
 * The standing criterion for one operation with two implementations that
 * disagree is that the GOVERNED side wins — here `driver-sql`, which enforces
 * the scope. Making the boot guard adopt the engine's predicate instead would
 * refuse every app that omits the block, which is refusal, not alignment.
 *
 * The failure direction is what makes it worth code rather than a doc note:
 * toward exposure in the place where isolation is TESTED. A suite asserting
 * "tenant A cannot see tenant B's rows" passed trivially here — not because
 * isolation worked, but because both tenants' rows came back to everyone and
 * the assertion had been written against a single tenant's fixture. ⚠️ Every
 * isolation measurement previously taken on this driver is void and has to be
 * re-taken.
 *
 * ## The semantics are `driver-sql`'s, not a simpler invention
 *
 * Read off `SqlDriver.applyTenantScope` (`packages/drivers/driver-sql/src/
 * sql-driver.ts`) and reproduced arm for arm, because the spec's own
 * `DriverOptions.tenantIds` docblock states them once for every driver that
 * implements native scoping — "scope reads/updates/deletes/aggregates with
 * `IN`, keeping any NULL-tenant global-row carve-out the equality path has;
 * absent or empty → fall back to `tenantId` equality (fail toward isolation,
 * never toward exposure)":
 *
 * | fact | `driver-sql` | here |
 * |:---|:---|:---|
 * | no `tenantId` (`undefined` / `null` / `''`) | builder untouched | no predicate |
 * | object has no tenant column | builder untouched | no predicate |
 * | non-empty `tenantIds` | `col IN (…) OR col IS NULL` | membership OR global |
 * | otherwise | `col = :tenantId OR col IS NULL` | equality OR global |
 *
 * The NULL arm is the #2734 rule and it is load-bearing rather than lenient: a
 * row with no organization is a GLOBAL/platform row (bootstrap-seeded
 * permission sets, business units, pre-org first-boot seeds), it belongs to no
 * OTHER tenant, and strict equality made every tenant admin read ZERO RBAC rows
 * on a fresh deployment. A row stamped with a DIFFERENT organization stays
 * invisible. In this store the absence of the key is that same fact, so
 * `undefined` and `null` are one arm.
 *
 * ## What this is NOT
 *
 * ⛔ Not write-side tenancy. `driver-sql` stamps the tenant column on insert
 * (`injectTenantOnInsert`); nothing here does, so a row created without an
 * explicit organization lands org-less and is then global by the rule above.
 * That asymmetry is exactly why the boot guard still refuses a walled posture
 * and an object declaring `tenancy.enabled: true` — this module is the read
 * half of #6915's Route A, not the whole of it, and ⛔ it does not weaken that
 * gate.
 *
 * ⛔ Not a chokepoint `scripts/check-tenant-chokepoint.mjs` can re-derive. That
 * gate keys on `this.getBuilder(object, options)`, the single constructor of
 * every knex query in the `SqlDriver` family; this driver builds no query at
 * all, it filters an array, so the gate's criterion has nothing to key on here
 * and its scope paragraph stays accurate. The doors are held instead by
 * `memory-tenant-scope.test.ts`, which exercises each one.
 */

import type { DriverOptions } from '@objectstack/spec/data';
import { isTenancyDisabled } from '@objectstack/spec/data';
import { tenantFieldOf, type UniqueAwareSchema } from './memory-unique-constraint.js';

/** A row of the backing store. */
type StoredRow = Record<string, any>;

/**
 * Answers "may this caller see this row" — `null` when nothing is scoped, which
 * is the unscoped/admin path and the overwhelmingly common one.
 */
export type TenantRowPredicate = (row: StoredRow) => boolean;

/**
 * The tenant column for `object`, recorded with the sticky explicit-opt-out
 * that `SqlDriver.computeAndRecordTenantField` keeps (#3249).
 *
 * A schema carrying a `tenancy` declaration is authoritative: it sets or clears
 * the opt-out. A schema WITHOUT one is a partial re-registration — the
 * lifecycle archive path calls `syncSchema` with only `{ name, fields }` — and
 * must not let the implicit `organization_id` heuristic re-scope a table that
 * was declared platform-global, which would HIDE its org-less rows from every
 * caller that carries a tenant.
 *
 * The column itself is resolved by {@link tenantFieldOf}, this package's one
 * spelling of "what is this object walled by" — already pinned arm for arm
 * against `SqlDriver.computeTenantField` by `memory-unique-constraint.test.ts`.
 * ⛔ Never add a second spelling here: a disagreement between the uniqueness
 * key and the read scope would partition the same table two different ways.
 *
 * @param object the object name, keyed the same way the driver keys its store
 * @param schema the schema as `syncSchema` received it
 * @param optOut the driver's sticky opt-out record, mutated here
 */
export function recordTenantField(
  object: string,
  schema: unknown,
  optOut: Set<string>,
): string | null {
  const declared = (schema as { tenancy?: unknown } | null | undefined)?.tenancy;
  if (declared != null) {
    if (isTenancyDisabled(schema)) optOut.add(object);
    else optOut.delete(object);
    return tenantFieldOf(schema as UniqueAwareSchema | null | undefined);
  }
  if (optOut.has(object)) return null;
  return tenantFieldOf(schema as UniqueAwareSchema | null | undefined);
}

/**
 * The row predicate a caller's `DriverOptions` asks for, or `null` for no
 * scoping at all.
 *
 * `null` rather than a tautology on purpose: it lets each door keep its
 * existing fast path byte for byte, so an unscoped call — every call that
 * exists today — does no per-row work and cannot change behaviour.
 */
export function tenantScopePredicate(
  tenantField: string | null,
  options?: DriverOptions,
): TenantRowPredicate | null {
  const tenantId = options?.tenantId;
  // Same early-out as `applyTenantScope`: without a tenant this is the
  // unscoped/admin path — legacy callers, seed scripts and cross-org tooling
  // keep working.
  if (tenantId === undefined || tenantId === null || tenantId === '') return null;
  if (!tenantField) return null;

  // [ADR-0105 D2 / #3623] Union scope under the `group` posture. A malformed or
  // empty set falls through to the equality path: fail toward isolation, never
  // toward exposure.
  const raw = (options as { tenantIds?: unknown } | undefined)?.tenantIds;
  const union = Array.isArray(raw)
    ? raw.filter((v: unknown): v is string => typeof v === 'string' && v !== '')
    : [];

  if (union.length > 0) {
    const allowed = new Set(union.map(String));
    return (row: StoredRow) => {
      const value = row?.[tenantField];
      if (value === undefined || value === null) return true;
      return allowed.has(String(value));
    };
  }

  const wanted = String(tenantId);
  return (row: StoredRow) => {
    const value = row?.[tenantField];
    if (value === undefined || value === null) return true;
    return String(value) === wanted;
  };
}
