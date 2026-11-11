---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: a user a SCIM directory provisions reads `idp_provisioned` from the moment SCIM creates it, and users a directory provisioned earlier are marked once at boot

Clause-②: yes (narrowing) — every refusal keyed on a directory-owned identity (`sys_user.source = 'idp_provisioned'`) now applies to SCIM-provisioned users: `POST /api/v1/auth/admin/set-user-manager` answers `403 PERMISSION_DENIED` with reason `idp_provisioned`, `admin/set-user-password` on a cloud-managed environment refuses them, and the self-service local-credential actions are hidden for them (ADR-0135 D4, D5.2).
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, no export changes, and `sys_user.source` keeps its two values. The stored rows the rule covers are marked by the boot pass itself, so there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing for SCIM-provisioned users (ADR-0135 D4).

- A user a SCIM connection creates, re-links through a tombstone or reprovisions reads `sys_user.source = 'idp_provisioned'` ("IdP-Provisioned" in Setup), written in the same transaction as the SCIM write: if the mark cannot be written, the SCIM request fails and the identity provider retries it.
- At boot, every user that owns a `sys_scim_subject` row and does not already read `idp_provisioned` is marked. The pass logs how many users it marked and writes nothing on a later boot.
- A user who holds a local password keeps `env_native`: setting a password on a directory-provisioned user still flips it to `env_native`, and a later SCIM sync or boot leaves that value.

**Who moves.** An administrator who sets a SCIM-provisioned user's manager in Setup is refused; set it in the identity provider instead, which writes it on its next sync.
