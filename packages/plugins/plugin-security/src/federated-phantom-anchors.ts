// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7835] Provenance for the platform anchors a FEDERATED object carries but
 * does not have.
 *
 * ## The fact this module exists for
 *
 * `applySystemFields` (the ObjectQL registry) injects `organization_id`,
 * `owner_id`, `owning_business_unit_id` and the audit `*_by` lookups into every
 * object that has not opted out — **including federated ones** (ADR-0015
 * `external`). But `Engine.syncObjectSchema` returns EARLY for `external != null`
 * and issues no DDL: the remote schema is owned externally. So for a federated
 * object those columns exist in the registered schema and **nowhere else**.
 * Measured on the shipped showcase at `origin/main` @ `b54aaab`:
 *
 * ```
 *   showcase_ext_customer (external → remote table `customers`)
 *     registered fields: organization_id, created_at, created_by, updated_at,
 *                        updated_by, owner_id, owning_business_unit_id,
 *                        name, email, region, lifetime_value
 *     remote columns:    name, email, region, lifetime_value  (+ the remote pk)
 * ```
 *
 * Every consumer that decides something by asking "does this object carry
 * column X?" is therefore answered YES about a column the query will never
 * find. `computeTenantLayer0Filter` is one such consumer: it reads
 * `objectHasOrgIdField` and, under a walled posture, AND-composes
 * `organization_id = <active org>` onto the read. On a federated object that
 * predicate cannot resolve, and the failure is **dialect-dependent**: SQLite
 * reinterprets the unresolvable identifier as a string literal, so the
 * comparison is constant-false — 0 rows, no error, HTTP 200 — while
 * Postgres/MySQL raise `column "organization_id" does not exist`. The wall
 * fails OPEN as a wall (it isolates nothing) and CLOSED as a read (the
 * federated object simply stops answering).
 *
 * This is the plugin-security sibling of #7738 / PR #7833, which withheld
 * `DriverOptions.tenantId` for `external` objects one layer down in
 * `@objectstack/objectql`. That fix cannot reach here: Layer 0 is a `where`
 * predicate composed into the query AST, not a driver option.
 *
 * ## Why PROVENANCE and not "is it federated?"
 *
 * A federated object MAY legitimately expose a real remote `organization_id`
 * column by declaring it — and then the tenant wall is meaningful and must keep
 * working. Suppressing Layer 0 for every `external` object would delete a wall
 * that was doing its job.
 *
 * So the question is not "is this object federated?" but "is this object's
 * `organization_id` the anchor the PLATFORM injected, or a column the AUTHOR
 * declared?" — the same provenance discipline `platform-tenant-policies.ts`
 * records for ADR-0105 finding F1 and `platform-ownership-policies.ts` for
 * #5492: identity against the shipped declaration, never a pattern match on a
 * public grammar. Here the shipped declaration is
 * {@link TENANT_SCOPE_FIELD_DEF} itself — `applySystemFields` spreads it
 * verbatim (`additions.organization_id = { ...TENANT_SCOPE_FIELD_DEF }`) and an
 * authored field of the same name suppresses the injection entirely, so a
 * registered def that equals the constant can only have come from the platform.
 *
 * Deliberately NOT an authorable "this column is phantom" flag: provenance is a
 * fact about who wrote the column, and letting metadata claim it would hand
 * authors a switch that turns their own tenant wall off.
 *
 * ## Direction of an inexact match
 *
 * Any mismatch — the registry adds a key, a parse stamps a default, the field
 * arrives in the array shape without a recognisable body — answers `false`
 * ("not the platform's anchor"), which leaves Layer 0 enforcing exactly as it
 * does today. The fail direction is toward isolation, never toward exposure.
 */

// [#6562] The injected-column DEFINITION table lives in `@objectstack/metadata-core`
// (the registry that provisions the columns re-exports it from there, and the `/meta`
// read path consumes the same one). Importing the constant — rather than restating
// its shape here — is what makes the provenance test track the producer instead of a
// copy that can drift silently.
import { TENANT_SCOPE_FIELD_DEF } from '@objectstack/metadata-core';

/** The one column Layer 0 ever emits a predicate for. */
const TENANT_SCOPE_COLUMN = 'organization_id';

/** Pick a field definition out of either registered `fields` shape. */
function readFieldDef(schema: unknown, name: string): unknown {
  const fields = (schema as { fields?: unknown } | null | undefined)?.fields;
  if (Array.isArray(fields)) {
    return fields.find((f) => (f as { name?: unknown } | null)?.name === name);
  }
  if (fields && typeof fields === 'object') {
    return (fields as Record<string, unknown>)[name];
  }
  return undefined;
}

/**
 * Structural identity against the shipped constant. Flat by construction —
 * every value in {@link TENANT_SCOPE_FIELD_DEF} is a primitive — so a flat
 * comparison is exact rather than a shortcut, and an extra or missing key is a
 * mismatch (see "Direction of an inexact match" above).
 *
 * The array shape carries an additional `name` key that the object shape
 * expresses as the map key; it is excluded so both shapes reach the same
 * verdict about the same column.
 */
function equalsShippedDef(def: unknown, shipped: Readonly<Record<string, unknown>>): boolean {
  if (!def || typeof def !== 'object' || Array.isArray(def)) return false;
  const actual = { ...(def as Record<string, unknown>) };
  delete actual.name;
  const shippedKeys = Object.keys(shipped);
  if (Object.keys(actual).length !== shippedKeys.length) return false;
  return shippedKeys.every((k) => actual[k] === shipped[k]);
}

/**
 * Is `schema` a federated (ADR-0015 `external`) object binding a remote table?
 * The platform provisions no storage for one, so nothing it injects is real.
 */
export function isFederatedObject(schema: unknown): boolean {
  return (schema as { external?: unknown } | null | undefined)?.external != null;
}

/**
 * Does this object's `organization_id` exist only in the registry — i.e. is it
 * the platform's injected anchor on an object whose storage the platform never
 * provisioned?
 *
 * `true` ⇒ Layer 0 must treat the object as carrying NO tenant column, because
 * it does not (see the module docs). `false` for every local object (the
 * platform DID provision the column there) and for a federated object whose
 * author declared a real remote `organization_id`.
 */
export function hasPhantomTenantAnchor(schema: unknown): boolean {
  if (!isFederatedObject(schema)) return false;
  return equalsShippedDef(readFieldDef(schema, TENANT_SCOPE_COLUMN), TENANT_SCOPE_FIELD_DEF);
}
