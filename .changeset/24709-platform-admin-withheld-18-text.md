---
'@objectstack/plugin-security': patch
---

fix(plugin-security): the platform-admin promotion WITHHELD warning says what 18.0 supports for a v17 database, not a migration 18.0 refuses

Clause-②: no

- **The boot warning "[security] platform-admin promotion WITHHELD: an unscoped grant exists whose permission-set name (sys_user_permission_set.permission_set) was never written"** used to end with a way on: "The organization-ownership migration's id-to-name rewrite (ADR-0131 D10) names it; the next pass after that reads it by name." 18.0 refuses that migration on every database, so the operator was sent to a refusal. The warning now ends with the sentence the boot refusal and the drop-gate refusal of `os migrate apply --allow-destructive` carry: "18.0 supports fresh installs only and does not upgrade a v17 database: keep a v17 database on a 17.x release until the 18.x release that carries the upgrade path."
- **Unchanged:** the withholding itself (an unscoped grant that names no set is still read as an administrator who may already exist, and no second platform-admin grant is minted), the facts the warning states (which column was never written, that the grant predates it, that the set it holds can no longer be read), the log level and the `info` fallback when the logger has no `warn`, and the returned `admin_grant_unnamed` result.
- **Removed from the warning:** the pointer to the organization-ownership migration's rewrite and the promise that the next pass reads the grant by name afterwards. Both described the 18.x upgrade path, which 18.0 does not carry.
