// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7858] Provenance for the `owner_id` anchor a FEDERATED object carries but
 * does not have.
 *
 * ## The fact this module exists for
 *
 * `applySystemFields` (the ObjectQL registry) injects `owner_id` into every
 * object that has not opted out — **including federated ones** (ADR-0015
 * `external`) — while `Engine.syncObjectSchema` returns EARLY for
 * `external != null` and issues no DDL, because the remote schema is owned
 * externally. So for a federated object `owner_id` exists in the registered
 * schema and **nowhere else**. Measured on a booted showcase stack at
 * `origin/main` @ `b54aaab`, with a federated object carrying no ADR-0090 D1
 * grandfather stamp (i.e. taking the secure-default `private` OWD):
 *
 * ```
 *   measure_ext_nostamp (external → remote table `customers`)
 *     registered fields: organization_id, created_at, created_by, updated_at,
 *                        updated_by, owner_id, owning_business_unit_id,
 *                        name, email, region
 *     remote columns:    name, email, region, lifetime_value  (+ the remote pk)
 *
 *   buildReadFilter(…, __readScope='own')  = {"owner_id":"usr_member_1"}
 *   buildReadFilter(…, __readScope='unit') = {"owner_id":"usr_member_1"}
 * ```
 *
 * `SharingService.buildReadFilter` / `buildWriteFilter` decide by asking "does
 * this object carry an `owner_id` field?" (`hasOwnerField`) and are therefore
 * answered YES about a column the query will never find. They then AND-compose
 * `owner_id = <caller>` (or the ADR-0057 DEPTH-widened `$in`) onto a read whose
 * backing table has no `owner_id`. The failure is **dialect-dependent**: SQLite
 * reinterprets the unresolvable identifier as a string literal, so the
 * comparison is constant-false — 0 rows, no error, HTTP 200 — while
 * Postgres/MySQL raise `column "owner_id" does not exist`. Either way a
 * federated object under the secure-default OWD is unreadable by any principal
 * whose read scope is narrower than `org`, and nothing reports why.
 *
 * ## Why PROVENANCE and not "is it federated?"
 *
 * A federated object MAY legitimately expose a real remote `owner_id` column by
 * declaring it — and then ownership scoping is meaningful and must keep working.
 * Switching ownership scoping off for every `external` object would silently
 * widen reads on federated objects that genuinely have an owner column.
 *
 * So the question is not "is this object federated?" but "is this object's
 * `owner_id` the anchor the PLATFORM injected, or a column the AUTHOR
 * declared?" — identity against the shipped declaration, never a pattern match
 * on a public grammar. Here the shipped declaration is {@link OWNER_FIELD_DEF}
 * itself: `applySystemFields` spreads it verbatim
 * (`additions.owner_id = { ...OWNER_FIELD_DEF }`) and a declared field of the
 * same name suppresses the injection entirely (`if (wantOwner &&
 * !schema.fields?.owner_id)`), so a registered def that equals the constant can
 * only have come from the platform.
 *
 * Deliberately NOT an authorable "this column is phantom" flag: provenance is a
 * fact about who wrote the column, and letting metadata claim it would hand
 * authors a switch that turns their own record-level scoping off.
 *
 * ## Direction of an inexact match
 *
 * Any mismatch — the registry adds a key, a parse stamps a default, the field
 * arrives in the array shape without a recognisable body — answers `false`
 * ("not the platform's anchor"), which leaves ownership scoping enforcing
 * exactly as it does today. The fail direction is toward scoping, never toward
 * exposure.
 *
 * ## Relationship to the plugin-security sibling
 *
 * `@objectstack/plugin-security` carries a structurally identical module for the
 * TENANT anchor (`federated-phantom-anchors.ts`, #7835), and #7738 / PR #7833
 * withheld `DriverOptions.tenantId` for `external` objects one layer down in
 * `@objectstack/objectql`. Three consumers, one producer. The duplication is
 * deliberate and temporary: this plugin does not depend on
 * `@objectstack/plugin-security` (it declares the narrow slices it probes —
 * see `SharingSecurityProbe`), so importing that copy would create a plugin
 * dependency edge to save nine lines. The maintainer's 2026-08-12 ruling on
 * #7865 chose direction **B** — the registry keeps injecting and grows a
 * machine-readable provenance marker, and consumer guards converge on that
 * marker **as they are touched**. When that marker lands, this module and its
 * plugin-security twin collapse into one read of it; keeping the two shaped
 * identically is what makes that collapse mechanical.
 */

// [#6562] The injected-column DEFINITION table lives in `@objectstack/metadata-core`
// (the registry that provisions the columns reads the same one, and the `/meta` read
// path consumes it too). Importing the constant — rather than restating its shape
// here — is what makes the provenance test track the producer instead of a copy that
// can drift silently. `@objectstack/objectql` re-exports it, but only from
// `registry.js`, not from its package entry point, so `metadata-core` is the
// importable home; its own dependencies are `{ @objectstack/spec, zod }`, so this
// adds no cycle.
import { OWNER_FIELD_DEF } from '@objectstack/metadata-core';

/** The one column ownership scoping ever emits a predicate for. */
const OWNER_COLUMN = 'owner_id';

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
 * every value in {@link OWNER_FIELD_DEF} is a primitive — so a flat comparison
 * is exact rather than a shortcut, and an extra or missing key is a mismatch
 * (see "Direction of an inexact match" in the module docs).
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
 * Does this object's `owner_id` exist only in the registry — i.e. is it the
 * platform's injected anchor on an object whose storage the platform never
 * provisioned?
 *
 * `true` ⇒ record-level ownership scoping must treat the object as carrying NO
 * owner column, because it does not (see the module docs). `false` for every
 * local object (the platform DID provision the column there) and for a
 * federated object whose author declared a real remote `owner_id`.
 */
export function hasPhantomOwnerAnchor(schema: unknown): boolean {
  if (!isFederatedObject(schema)) return false;
  return equalsShippedDef(readFieldDef(schema, OWNER_COLUMN), OWNER_FIELD_DEF);
}
