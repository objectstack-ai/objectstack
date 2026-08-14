---
'@objectstack/plugin-security': minor
---

Setup can no longer create — or rename a row to — a `sys_capability` whose `name` is in
the platform's curated set (`PLATFORM_CAPABILITY_NAMES`). **An authoring call that
previously answered 200 now refuses**: the admin-door data write (`insert`, and `update`
that renames TO a curated name) is rejected at the security middleware with
`403 PERMISSION_DENIED` and a message naming the colliding curated name. The affected
names are the curated registry's members, currently: `manage_users`, `manage_org_users`,
`manage_metadata`, `manage_platform_settings`, `setup.access`, `setup.write`,
`studio.access`, `manage_sharing`, `export_data` (maintainer ruling on #8552, applying
the "refuse a declaration the platform cannot honour" principle — such a row can never
be the curated capability, and it blocks the platform's own definition from ever
seeding).

What is NOT changed:

- creating capabilities with non-curated names stays open, in every deployment shape
  (including the community NULL-organization-bucket shape with no org stamper);
- existing colliding rows are deliberately left to the operator (no adoption, no
  provenance backfill — ruling options 2/3 are rejected): they can still be edited, and
  renamed AWAY from the curated name (a payload repeating the row's own unchanged name
  is not a rename and is not refused);
- the curated seeder's decline-and-warn behaviour on existing collisions stands; its
  per-boot `blockedCurated` warning now also carries one operator-facing remediation
  line (rename or remove the blocking row, then restart, and the platform definition
  seeds);
- boot/system writes (`isSystem`) — the seeders and package publish — are unaffected.
