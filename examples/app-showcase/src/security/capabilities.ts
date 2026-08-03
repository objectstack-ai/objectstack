// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Package-level capability declarations (ADR-0066 D1).
 *
 * `defineCapability` is the FORMAL, EXPLICIT way for a package to DEFINE an
 * authorization capability of its own — the counterpart, on the declaration
 * side, of the platform's curated capabilities (`manage_users`, `setup.access`,
 * …). Collected on the stack's `capabilities` array, each declaration is seeded
 * into `sys_capability` at boot with `managed_by:'package'` + `package_id`
 * provenance, so the registry can attribute and uninstall it — instead of the
 * old back-door where a capability only existed IMPLICITLY as an untitled
 * placeholder derived from whatever a permission set referenced.
 *
 * The three-way separation (ADR-0066): a capability is NOT a contract.
 *   • DEFINE it here (`defineCapability`).
 *   • GRANT it on a permission set (`systemPermissions`) — see
 *     `OpsPermissionSet` which carries `showcase.export_data`.
 *   • REQUIRE it on a resource (`requiredPermissions`) — a resource that lists
 *     the capability is denied unless the caller's granted sets carry it.
 */

import { defineCapability } from '@objectstack/spec';

/**
 * Bulk data export. Org-scoped: a power that operates within the caller's
 * organization. Granted to Operations (see permission-sets.ts); a future export
 * endpoint/action would gate itself with `requiredPermissions:
 * ['showcase.export_data']`.
 *
 * `packageId` is the ADR-0086 D3 AUTHOR-DECLARED provenance — the documented
 * fallback the seeder reads when the registry has not stamped `_packageId`
 * (`cap._packageId ?? cap.packageId` in `bootstrapDeclaredCapabilities`).
 * Without an owning package the declaration is NOT materialized into
 * `sys_capability` (a `managed_by:'package'` row with no `package_id` would
 * make uninstall undefined), which left `OpsPermissionSet` granting a
 * capability that never existed — one boot `warn` and an inert security
 * declaration.
 *
 * Why it is authored here rather than inferred: the registry stamp never
 * reaches an app-declared capability, because `capabilities` is missing from
 * the metadata-array key list the ObjectQL engine registers a stack's
 * collections through — so the "fallback" is in practice mandatory. That is a
 * PLATFORM gap, filed as #4967 (together with the sharper half: a refused
 * declaration is still counted as declared, which suppresses the back-compat
 * derivation and leaves the capability existing nowhere), not something the
 * showcase should work around. Declaring `packageId` is the spec's own
 * sanctioned entry point, so this both fixes the app and demonstrates the
 * field; when the platform stamps `_packageId` that takes precedence and this
 * stays consistent with it.
 */
export const ExportDataCapability = defineCapability({
  name: 'showcase.export_data',
  label: 'Export Showcase Data',
  description: 'Bulk-export showcase records (accounts, invoices) to CSV/XLSX.',
  scope: 'org',
  packageId: 'com.example.showcase',
});

export const allCapabilities = [ExportDataCapability];
