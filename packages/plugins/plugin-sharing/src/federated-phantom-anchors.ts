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
 * on a public grammar. [#27425] And past provenance, one more declaration
 * counts: an `external.columnMap` entry that maps a remote column onto
 * `owner_id` names the column that carries the owner, so the anchor is not
 * phantom either.
 *
 * Both halves are read from `@objectstack/spec/data`, never restated here:
 * {@link isOwnerAnchorUnprovable} is the one reader of "no owner is provable
 * from declared metadata" (the provenance verdict
 * `resolveInjectedColumnProvenance(schema, 'owner_id') ===
 * 'injected-unprovisioned'` plus the `columnMap` arm), and lint's
 * `hasUnprovableOwnerAnchor` reads the same function, so the author-time
 * warning and this runtime narrowing cannot drift apart.
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
 * `@objectstack/objectql`. Per the maintainer's 2026-08-12 ruling on #7865
 * (direction **B** — the registry keeps injecting and consumers converge on the
 * spec's provenance marker as they are touched), this module has converged:
 * it holds no copy of the identity comparison and no `columnMap` reader of its
 * own. The tenant twin converges the same way when next touched; it has no
 * `columnMap` arm to carry.
 */

import { isOwnerAnchorUnprovable, platformProvisionsStorage } from '@objectstack/spec/data';

/**
 * Is `schema` a federated (ADR-0015 `external`) object binding a remote table?
 * The platform provisions no storage for one, so nothing it injects is real.
 * The spec's `platformProvisionsStorage` is the one spelling of that predicate
 * (#7865's convergence map), so this reads it rather than restating it.
 */
export function isFederatedObject(schema: unknown): boolean {
  return !platformProvisionsStorage(schema);
}

/**
 * Does this object's `owner_id` exist only in the registry — i.e. is it the
 * platform's injected anchor on an object whose storage the platform never
 * provisioned, with nothing declared naming a remote column for it?
 *
 * `true` ⇒ no owner predicate can be proven for the object: nothing declared
 * says a remote column answers to `owner_id`, even where a driver happens to
 * return one of its own accord. [#27425] Record-level scoping then NARROWS —
 * the read and bulk write scopes admit no row by ownership below `org` — and
 * never widens. `false` for every local object (the platform DID provision the
 * column there), for a federated object whose author declared a real remote
 * `owner_id`, and for one whose `external.columnMap` maps a remote column onto
 * `owner_id`. The built-in SQL drivers apply that map and serve the column; a
 * driver that does not apply it returns no `owner_id`, so the owner predicate
 * scoping composes matches no row — the fail direction stays closed either way.
 */
export function hasPhantomOwnerAnchor(schema: unknown): boolean {
  return isOwnerAnchorUnprovable(schema);
}
