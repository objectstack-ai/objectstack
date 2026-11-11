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
 * `external`). But `Engine.syncObjectSchema` returns EARLY for a federated
 * object and issues no DDL: the remote schema is owned externally. So for a federated
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

/**
 * Is `schema` a federated (ADR-0015 `external`) object binding a remote table?
 * The platform provisions no storage for one, so nothing it injects is real.
 *
 * Re-exported, not restated: `@objectstack/core`'s binding is the runtime's one
 * answer (it reads the spec's `platformProvisionsStorage`), and this module path
 * keeps exporting it so every importer here resolves to that same function.
 *
 * {@link hasPhantomTenantAnchor} — the provenance test this module's docs
 * describe — is re-exported the same way. It lives in `@objectstack/core`'s
 * security module beside `externalOrganizationScopeOf`, the one reading of an
 * external object's organization scope, which it feeds and which a service
 * asks without loading this plugin (`external-organization-scope.ts`). Its
 * identity comparison against `TENANT_SCOPE_FIELD_DEF` (`@objectstack/metadata-core`)
 * is unchanged: exact and flat, and any mismatch answers `false`, toward
 * isolation (see "Direction of an inexact match" above).
 */
export { hasPhantomTenantAnchor, isFederatedObject } from '@objectstack/core';
