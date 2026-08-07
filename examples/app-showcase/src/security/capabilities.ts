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
 * Why it is still authored here now that the platform stamps: it used to be
 * MANDATORY, because `capabilities` was missing from the metadata-array key
 * list the ObjectQL engine registers a stack's collections through, so the
 * registry stamp never reached an app-declared capability and the documented
 * "fallback" was the only provenance there was. #5870 (#4967 Part 2) closed
 * that seam — `registerApp` now stamps `_packageId` on capabilities exactly as
 * it does on permission sets — so this line is once again what the spec says it
 * is: the fallback, kept because it also DEMONSTRATES the field. It names the
 * same id as the stack (`com.example.showcase`), so the stamp that now takes
 * precedence agrees with it.
 */
export const ExportDataCapability = defineCapability({
  name: 'showcase.export_data',
  label: 'Export Showcase Data',
  description: 'Bulk-export showcase records (accounts, invoices) to CSV/XLSX.',
  scope: 'org',
  packageId: 'com.example.showcase',
});

/**
 * A capability that is DEFINED and granted to NOBODY — the falsifiable half of
 * the ADR-0066 three-way separation, and the one a demo usually leaves out.
 *
 * Its whole job is to be required and never held: `showcase_zoo_perm_missing`
 * (and the AND-gate specimen next to it, see ui/actions/predicate-matrix.action.ts),
 * plus the INLINE data-plane bulk def `purge_restricted`
 * (ui/views/project.view.ts, #6257), list it in `requiredPermissions`, so those
 * buttons must be absent for every caller on every one of the four action
 * surfaces. Without a capability nobody
 * holds there is nothing to notice when a surface stops applying the gate —
 * which is exactly how the selection bar shipped ignoring `requiredPermissions`
 * outright (objectui#3492) while three other surfaces honoured it.
 *
 * Deliberately absent from every permission set. If a future set grants it, the
 * two specimens stop testing anything.
 */
export const RestrictedOpsCapability = defineCapability({
  name: 'showcase.restricted_ops',
  label: 'Restricted Showcase Operations',
  description: 'Reserved for the capability-gate specimens — intentionally granted to no permission set.',
  scope: 'org',
  packageId: 'com.example.showcase',
});

export const allCapabilities = [ExportDataCapability, RestrictedOpsCapability];
