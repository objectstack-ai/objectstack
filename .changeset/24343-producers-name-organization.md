---
"@objectstack/plugin-audit": minor
"@objectstack/service-settings": minor
"@objectstack/plugin-auth": patch
"@objectstack/verify": patch
---

fix: framework writes on tenant-column objects name the organization they can derive (ADR-0131 D9)

Clause-②: yes (widening)

A write on a tenant-column object with no organization is derived under `single` and refused under a wall (ADR-0131 D9). Before the engine stops letting such writes through, each of these producers now names the organization it can derive itself. Under `single` that is the Default Organization, which is the owner the engine would derive anyway, so no reader changes. Under a wall the row names an organization only where the producer has one. The rows it cannot attribute are written exactly as before.

- **`@objectstack/plugin-auth`.** The self-registration grant (`sys_user_permission_set`) and the auth mails about a user (verification, password reset, account invitation, magic link, change-email notice → `sys_email`) read one derivable organization: the `tenancy` service's `defaultOrgId()`. Under `single` that is the Default Organization. Under a wall it is none, because the registrant belongs to no organization yet. The verification and reset mails used to persist with no organization even under `single`.
- **`@objectstack/plugin-audit`.** An activity row (`sys_activity`) about a record with no organization of its own (a `sys_user`, a platform setting), written with no session organization (a sign-up), takes the Default Organization under `single`. The record's own organization and then the session's still win. The ledger's `tenant_id` attribution is unchanged. New optional `AuditWriterOptions.getDefaultOrganizationId()`; `AuditPlugin` wires it to the `tenancy` service.
- **`@objectstack/service-settings`.** The `sys_secret` ciphertext and the `sys_setting_audit` history row of a `tenant` or `user` value carry that value's organization, which is the same owner as its `sys_setting` row. A `global` value's rows name none. New optional `organization_id` on `SettingsSecretStore.insert`'s row and `organizationId` on `SettingsAuditWriter.write`'s entry; the built-in writers persist them. A failed `sys_setting_audit` write is now reported at `error`, not `warn`: the settings write succeeds while its history row is lost. The first report names the consequence and the fix. `buildSettingAuditWriter`'s logger argument reports through `error` when the sink carries it and through its declared `warn` otherwise (the argument stays optional; a sink passed to it declares `warn`, as `PluginContext.logger` does).
- **`@objectstack/verify`.** The RLS probe and position personas' grants (`sys_user_permission_set`, `sys_user_position`) belong to the organization the persona is a member of (the Default Organization under `single`). They used to be written with an explicit `organization_id: null`. A persona that belongs to no organization, or to several, names none.
