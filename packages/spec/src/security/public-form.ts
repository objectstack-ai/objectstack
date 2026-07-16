// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0056 Option A / #3022] Server-managed columns on the anonymous
 * PUBLIC-FORM write surface.
 *
 * A public form submission (`POST /forms/:slug/submit`) is an UNAUTHENTICATED
 * internet-facing insert authorized by the declaration-derived
 * `publicFormGrant`. That grant short-circuits the security middleware
 * (CRUD/FLS/owner/tenant gates), and the static-`readonly` strip (#2948) only
 * covers UPDATE — so nothing downstream guards these columns. They are
 * therefore server-managed on this surface: never client-suppliable,
 * regardless of what the FormView declares.
 *
 * Shared by the REST form routes (`@objectstack/rest` — the writable-field
 * allow-list and the resolved form/schema exposure) and the data-layer grant
 * branch (`@objectstack/plugin-security` — strips them from every insert row
 * before the grant admits the write), so the route filter and the engine
 * boundary can never drift apart.
 *
 * Scope: this is the ANONYMOUS-surface rule only. Authenticated writes keep
 * their existing semantics (e.g. insert may seed `readonly` columns for
 * imports; `owner_id` transfers are governed by the transfer grant).
 */
export const PUBLIC_FORM_SERVER_MANAGED_FIELDS: ReadonlySet<string> = new Set([
  // Row identity — a visitor-chosen primary key invites collision/squatting.
  'id',
  // Ownership anchor (OWD/RLS owner scoping keys off it; #3004-class forge).
  'owner_id',
  // Tenant anchors — a forged value lands the row in another tenant.
  'organization_id',
  'tenant_id',
  // Audit provenance + timestamps.
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  // Soft-delete state.
  'is_deleted',
  'deleted_at',
  // Hidden search-normalization companion column (#2486).
  '__search',
]);
