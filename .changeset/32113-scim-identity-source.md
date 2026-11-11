---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

fix(plugin-auth)!: a user a SCIM directory provisions reads `idp_provisioned` from the moment SCIM creates it, and users a directory provisioned earlier are marked once at boot

Clause-②: yes (narrowing) — every refusal and hidden action keyed on a directory-owned identity (`sys_user.source = 'idp_provisioned'`) now applies to a SCIM-provisioned user who holds no local password: `POST /api/v1/auth/admin/set-user-manager` answers `403 PERMISSION_DENIED` with reason `idp_provisioned`; the admin bulk import (`POST /api/v1/auth/admin/import-users`) refuses that user's `manager_id` link through the same refusal; `admin/set-user-password` on a cloud-managed environment answers `409 RESOURCE_CONFLICT`; the Setup "Set Manager" row action is hidden; and the self-service Change Password, Change Email and Delete My Account actions are hidden (ADR-0135 D4, D5.2).
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, no export changes, and `sys_user.source` keeps its two values. The stored rows the rule covers are marked by the boot pass itself, so there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing for SCIM-provisioned users (ADR-0135 D4).

- A user a SCIM connection creates, re-links through a tombstone or reprovisions reads `sys_user.source = 'idp_provisioned'` ("IdP-Provisioned" in Setup), written in the same transaction as the SCIM write. On a create or another active write the mark fails closed: if it cannot be written, the SCIM request fails, nothing persists, and the identity provider retries it. On a deactivation or a `DELETE` the account is disabled first and the mark after it is best-effort, so a mark that cannot be written never leaves a deprovisioned account enabled; it is logged at `error` and re-run by the next active write and the boot pass.
- At boot, every user that owns a `sys_scim_subject` row and does not already read `idp_provisioned` is marked. The pass logs how many users it marked and writes nothing on a later boot.
- A user who holds a local password keeps `env_native`: setting a password on a directory-provisioned user still flips it to `env_native`, and a later SCIM sync or boot leaves that value.
- `sys_user.source`'s description names SCIM directory provisioning beside federated SSO (`@objectstack/platform-objects`).

**Who moves: the manager of a SCIM-provisioned user.** For a SCIM-provisioned user with no local password, the admin set-manager endpoint, the Setup "Set Manager" button and the bulk import's `manager_id` column all refuse ("directory wins, per identity"). The platform does not write the manager from SCIM: it declares the SCIM `manager` attribute without projecting it onto `sys_user.manager_id`, and an existing `manager_id` value stays as it is. An approval node whose `manager` rung resolves to nobody for such a user can declare `onEmptyApprovers: 'fallback'` with a `fallbackApprovers` list; the other remedy is a provisioning path your deployment supplies that writes the column.
