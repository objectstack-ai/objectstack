// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { platformProvisionsStorage } from '@objectstack/spec/data';

/**
 * The tenancy-scope predicates a layer below the engine has to ask too: which
 * column an object is tenant-scoped by ({@link resolveTenantFieldName}, with
 * its fallback {@link DEFAULT_TENANT_FIELD}), and whether its schema belongs to
 * a remote database ({@link isFederatedObject}).
 *
 * ## Why they live here, in `@objectstack/core`
 *
 * The engine asked them first (`@objectstack/objectql`, which re-exports these
 * exact bindings from `tenancy/system-write-organization.ts` and
 * `federated-object.ts`, so every existing import keeps resolving to them).
 * The import runner (`utils/import-runner.ts`) asks them too: its match lookup
 * scopes a read by the caller's organization on the column the engine would
 * stamp a created row with, and it runs in this package, which the engine
 * depends on. A second spelling of a tenancy rule is the defect, so the rule
 * moved down to the layer both askers already depend on, the relocation
 * `resolveSystemWriteOrganization` made under ADR-0138 D4.
 */

/**
 * The tenant column the kernel injects into every tenant-scoped object
 * (`TENANT_SCOPE_FIELD_DEF`, `registry.ts`), and the fallback every layer
 * assumes when an object declares no `tenancy.tenantField`.
 */
export const DEFAULT_TENANT_FIELD = 'organization_id';

/**
 * Resolve the column an object is tenant-scoped by, or `null` when it is not
 * tenant-scoped at all.
 *
 * ## ⭐ This is the one tenancy-scope predicate (ADR-0131 D9 / D13)
 *
 * It decides both of the engine's tenancy cuts for an object, read on the
 * registered schema — the authored one plus the columns `applySystemFields`
 * injects, which is the schema the engine actually holds: whether an
 * organization-less system insert is judged by the system-write rule
 * (`Engine.resolveSystemInsertOrganization`), and whether an elevated write's
 * tenant-audit stays live (`Engine.buildDriverOptions`). Non-null ⇒ in scope,
 * whatever the object's name. There is no per-table list beside it: the
 * #13491 ledger that once narrowed the audit by name retired with D13, so an
 * object leaves scope only by DECLARING it on its own schema
 * (`tenancy.enabled: false`, `systemFields.tenant: false`, no tenant field).
 *
 * Which platform-namespace objects that leaves outside, and the declaration
 * that puts each there, is derived — never restated here — by
 * `scripts/platform-object-tenancy-census.mjs` into
 * `scripts/platform-object-tenancy-census.json`, which
 * `scripts/check-platform-object-tenancy-census.mjs` holds to the tree. ⛔ Do
 * not quote its counts in this comment: a hand-written count here went stale
 * once already, with CI green.
 *
 * The twin of `SqlDriver.computeTenantField`, same precedence and same reading:
 * an explicit `tenancy.enabled: false` opt-out wins over any column-presence
 * heuristic (ADR-0066 / `isTenancyDisabled`), then a declared
 * `tenancy.tenantField` that the object really has, then the kernel-injected
 * `organization_id`. It is re-spelled rather than imported because the engine
 * must not depend on a driver — but it has to stay the same rule: a disagreement
 * here would mean the engine resolves an organization for a column the driver
 * does not scope by, or refuses a write the driver would have filed globally.
 */
export function resolveTenantFieldName(schema: unknown): string | null {
  const s = schema as
    | { fields?: Record<string, unknown>; tenancy?: { enabled?: boolean; tenantField?: unknown } }
    | null
    | undefined;
  if (s?.tenancy?.enabled === false) return null;
  const fields = s?.fields;
  if (!fields || typeof fields !== 'object') return null;
  const declared = s?.tenancy?.tenantField;
  if (typeof declared === 'string' && declared !== '' &&
      Object.prototype.hasOwnProperty.call(fields, declared)) {
    return declared;
  }
  if (Object.prototype.hasOwnProperty.call(fields, DEFAULT_TENANT_FIELD)) return DEFAULT_TENANT_FIELD;
  return null;
}

/**
 * Is `schema` a federated object (ADR-0015 `external`), one whose schema is
 * owned by the REMOTE database?
 *
 * This is the ONE spelling of that question for `@objectstack/objectql`'s
 * schema-sync seams (which re-exports this binding) and the import runner. A federated object is never a DDL target: its storage belongs to the
 * remote, so a sync binds it with the driver's DDL-free
 * `registerExternalObject` (the object -> remote-table mapping and the
 * coercion maps a read needs) and never calls `syncSchema`. Three seams make
 * that decision, and all three ask this predicate, so they cannot drift apart:
 *
 * - the boot sync, `ObjectQLPlugin.syncRegisteredSchemas` (and its DDL-free
 *   sibling and the `kernel:ready` reconciliation);
 * - the runtime sync, `ObjectQL.syncSchemas`, which install-local installs,
 *   rehydrates and template seeding run after registering objects;
 * - the single-object sync, `ObjectQL.syncObjectSchema`.
 *
 * They did drift (#21777). The runtime sync had no federated branch, so it sent
 * DDL to every federated object in the registry. The driver refused it, as
 * designed for an external-schema datasource, and the refusal was logged as
 * the #4632 durability ERROR, although nothing durable was lost. Every
 * install-local install on a showcase host printed that false alarm.
 *
 * It is a PRESENCE test on the object's own `external` block, and deliberately
 * not a reading of the datasource's `schemaMode`. An object with no `external`
 * block is not federated, whatever datasource it lands on. If its DDL is
 * refused, that is a real lost sync, and it keeps the ERROR.
 *
 * ## It reads the spec's predicate and restates nothing
 *
 * `@objectstack/spec/data`'s `platformProvisionsStorage` is the one spelling
 * of "the platform provisions this object's storage" (the #7865 convergence
 * map), and a federated object is exactly one it does not. So this binding is
 * its negation, and every runtime layer asks this binding (plugin-security and
 * plugin-sharing re-export it under their own module paths) rather than
 * re-spelling the `external` test. A change to what "federated" means is then
 * one edit in the spec. On an input that is not an object record (`null`,
 * `undefined`, an array, a primitive) the spec answers "provisioned", so this
 * answers "not federated", as the presence test it replaced did.
 */
export function isFederatedObject(schema: unknown): boolean {
  return !platformProvisionsStorage(schema);
}
