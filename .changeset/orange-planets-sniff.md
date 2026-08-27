---
'@objectstack/spec': minor
'@objectstack/plugin-security': minor
---

`OrgScopingEntitlement` grows two per-deployment wall-shaping keys, both declared by the mounted `org-scoping` runtime and consumed by plugin-security when arming the Layer 0 organization wall, both fail-closed (absent ⇒ byte-identical behaviour):

- `platformGlobalObjects?: readonly string[]` — objects THIS deployment declares platform-global; Layer 0 does not wall them here (read filtering, the ADR-0123 D2 no-active-org write refusal, the forge guard, and the Layer 1 wildcard-`organization_id` policy drop all follow, because they read the same per-object security meta). Exact machine names only; a junk shape is refused loudly and exempts nothing.
- `suppressUnboundedOrgAdminGrant?: boolean` — the walled-posture `organization_admin` auto-grant hands out `organization_admin_no_bypass` (no unbounded `viewAllRecords`/`modifyAllRecords`) instead; the superseded-variant reconcile converges standing grants in both directions.

New spec exports: `PlatformGlobalObjectsSchema`, `PlatformGlobalObjects`, `OrgScopingEntitlementSchema`.
