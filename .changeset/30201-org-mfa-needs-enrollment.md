---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: an organization cannot require multi-factor authentication while two-factor enrollment is off, and the MFA gate never holds a user who has no way to enroll (#30201)

Clause-②: no (narrowing) — a write that turns `sys_organization.require_mfa` on is refused `400 VALIDATION_FAILED` while the two-factor feature is off, a value an administrator could save before. Nothing is widened.
Metadata-protocol: none
Skills-docs: follow-up owed — content/docs/permissions/authentication.mdx (the `mfa_required` row says `require_mfa` is settable per organization with no condition; it needs two-factor on)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, and no stored row is read, rewritten, converted or dropped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a runtime accept set on one platform-owned data column, `sys_organization.require_mfa`, judged against the deployment's two-factor state at write time; the remedy is a deployment or settings change (turn two-factor on), which no ledger entry can derive. The other categories are closed on facts: the bumped package publishes (not unpublished); no ADR-0087 id covers this column and this diff adds none (not registered, not already-registered); no published export is added, removed or retyped, so no interface or type narrows (not runtime-export-retired, runtime-interface-only or type-surface-only). -->

**BREAKING** accept-set narrowing on `sys_organization.require_mfa` writes, served by every data door (the organization's edit form, REST, MCP), on a deployment where two-factor is off.

- **Before.** An administrator could tick Require Multi-Factor Auth on an organization while two-factor was off (the default, `features.twoFactor: false`), and it saved. Once the grace period ended, every member, the owner included, was held `403 MFA_REQUIRED` and sent to enroll, and the enrollment endpoint (`POST /api/v1/auth/two-factor/enable`) answered 404: the twoFactor plugin that serves it was never turned on. Nobody could undo it from inside the product, because Setup sits behind the same gate. The global switch never had this hole: the `auth.mfa_required` setting turns the requirement and the plugin on as one piece.
- **Now.** A write whose payload turns `require_mfa` on is refused while two-factor is off, with one `fields[]` entry on `require_mfa` (`invalid_value`) saying why, who would have been locked out, and the two ways forward. It applies to every write context, the system's included, on the by-id door, a multi-row update and an insert. Clearing the column and writing other columns pass as before, and every write passes once two-factor is on (read per write, so no restart is needed).
- **The gate.** ADR-0069 D3's MFA gate holds a user only while they can enroll. With two-factor off, an MFA requirement (an organization's `require_mfa`, or `auth.mfa_required` under an `OS_AUTH_TWO_FACTOR=false` pin, or a host that sets `mfaRequired` without `plugins.twoFactor`) holds nobody and starts no grace clock, and the server says so once in a warning with the remedy. An organization row stored with `require_mfa = true` before this release therefore locks no one out; it starts holding unenrolled members once two-factor is turned on.
- **One answer.** Whether two-factor is on is decided in one place, the same `OS_AUTH_TWO_FACTOR` env, then `plugins.twoFactor`, then off, for the plugin list, `features.twoFactor` in `/api/v1/auth/config`, the gate and the write refusal.
- **Unchanged.** An enrolled user is never held. With two-factor on, the requirement and its grace period behave exactly as before. The `auth.mfa_required` setting still turns two-factor on with the requirement.

**The remedy.** To require multi-factor authentication for one organization, turn two-factor enrollment on for the deployment first, with `OS_AUTH_TWO_FACTOR=true`, and then tick the organization's box. Turning on the `auth.mfa_required` setting instead requires it for every organization and turns enrollment on with it.
