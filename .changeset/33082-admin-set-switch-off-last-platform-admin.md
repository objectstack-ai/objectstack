---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: the last platform administrator can no longer switch `admin_full_access` off when nobody could switch it back on

Clause-②: yes (narrowing) — a write to `sys_metadata_activation` that switches the `admin_full_access` permission set off (`POST /security/_activation/permission/admin_full_access` with `{"enabled":false}`, or the same ledger row inserted or updated off) is now refused 403 `PERMISSION_DENIED` when it would leave no unbanned platform administrator, even though an organization owner or admin is still standing. Before, the guard counted that owner and let the write land.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) — nothing stored or authorable moves; a refused write is the whole change -->

**BREAKING** for a deployment whose platform administrators all hold their standing through the Default Organization's `admin_full_access` grants (the stock `single` deployment with no `OS_PLATFORM_OWNER_EMAIL`): switching that permission set off is now refused. Switching it off ends every grant-anchored platform administrator at once, and the only door that switches it back on asks for `manage_metadata`, which an organization owner or admin does not hold, so a landed switch-off left the deployment with no in-product way back (a re-seed or database surgery). What to do: if the set really must be switched off, first declare a platform owner in `OS_PLATFORM_OWNER_EMAIL` (a verified address); that owner keeps `manage_metadata` and can switch the set back on. Under a walled posture the set anchors nobody, and nothing changes there. Every other last-admin-guard verdict is unchanged. (#33082)
