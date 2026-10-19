---
'@objectstack/spec': minor
'@objectstack/platform-objects': minor
'@objectstack/plugin-email': minor
'@objectstack/plugin-auth': minor
'@objectstack/cli': patch
---

feat(plugin-email,plugin-auth): identity mail — verification, password reset, magic link, the email-change notice, an account invitation — is recorded in `sys_identity_email`, a deployment-level sibling of `sys_email` with no organization column

Clause-②: yes (widening)

ADR-0131 D7, ruling of record 6257510973 (letter Q2 A). Expand-first: this release adds the new log and its write path, and keeps reading every row and job an 18.0 install left behind. It moves and deletes nothing.

- **The new object.** `sys_identity_email` (`@objectstack/platform-objects`, registered by `EmailServicePlugin`) has `sys_email`'s fields, so the row shape is the same, and `systemFields: { tenant: false }`, so it has no organization column. It is append-only, readable over `get` / `list`, and gated by `manage_platform_settings` (like `sys_job`), because its rows carry password-reset and sign-in links.
- **The contract.** `SendEmailInput` and `SendTemplateInput` (`@objectstack/spec/contracts`) gain `identityMail?: boolean`. With `true`, the mail service writes the row to `sys_identity_email`. Without it, the row goes to `sys_email`, as before. `identityMail: true` together with an `organizationId` is refused as `VALIDATION_FAILED` and recorded as a rejected row in `sys_identity_email`. The organization is not written.
- **One pipeline, both logs.** The queue worker, the outbox drain hook, the boot outbox sweep, attachment reclamation and the internal-header readback read a row from the log it lives in. A delivery or reclaim job for a `sys_identity_email` row carries `object: 'sys_identity_email'` beside `rowId`. A job with no `object` reads `sys_email`, which covers every job an 18.0 process queued. A job naming anything else is refused at `error` and touches no row. `EmailPersistence.insert` / `update` / `readHeadersJson` take the log as an optional last argument. A custom implementation that ignores it keeps every row in its one store. `@objectstack/plugin-email` exports `TENANT_EMAIL_OBJECT`, `IDENTITY_EMAIL_OBJECT`, `EMAIL_LOG_OBJECTS`, `isEmailLogObject` and `EmailLogObject`.
- **plugin-auth.** The five identity sends say `identityMail: true` and name no organization, under every posture. Before, they carried the Default Organization under `single` and nothing under a wall. The organization invitation (`auth.invitation`) is tenant mail. It still carries its organization and still lands in `sys_email`.
- **What a reader of `sys_email` sees.**
  - **Before.** Identity mail was a `sys_email` row: stamped with the Default Organization under `single`, organization-less under a wall.
  - **Now.** New identity mail is a `sys_identity_email` row. Rows already in `sys_email` stay there and are still delivered, swept and reclaimed.
  - **Remedy.** A report, export or query that looks for verification or reset mail reads both logs. For example: `ql.find('sys_identity_email', { where: { related_object: 'sys_user', related_id: userId } })` beside the same query on `sys_email`.
- **Inventory.** `os migrate organization-ownership`'s inventory lists `sys_identity_email` as deployment-level (column-drop fate, nothing to attribute). Moving the identity rows already in `sys_email` is an 18.x upgrade-ceremony step, not part of this release.
