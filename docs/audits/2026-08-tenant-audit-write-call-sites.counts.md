<!-- GENERATED — DO NOT EDIT BY HAND. -->
<!-- Regenerate: node scripts/tenant-audit-census.mjs --write -->

# Tenant-audit census — every write call site (generated)

Every application-surface write call site against a tenancy-enabled object, as
`scripts/tenant-audit-census.mjs` derives it from the tree. **The prose, the
method and the deviations from the figures this replaced are on the page**
(`content/docs/permissions/tenant-audit-census.mdx`); this file has no prose to
preserve and is regenerated whole.

⛔ **Never hand-patch a row or a number here** — fix the code, or the census, and
regenerate. `scripts/check-tenant-audit-census.mjs` fails the build when this file
and the tree disagree.

Rows are aggregated by (file, verb, object, tenancy, context posture) and carry no
line numbers, so a pure displacement cannot move them. Run the generator with
`--json` for per-site `file:line`.

⚠️ **On a merge conflict here, regenerate — never resolve by hand.** Two branches
that each add a write call site produce rows git merges cleanly and totals that
merge cleanly and WRONG. This file is deliberately NOT `merge=os-regen`: that
driver resolves an artefact's `gen:`/`check:` scripts in `@objectstack/spec`
only, and these are root-level tooling. The gate is the backstop — a wrongly
merged file fails `check-tenant-audit-census`, so the error is loud rather than
silent, and `node scripts/tenant-audit-census.mjs --write` is the resolution.

## Totals

| Measure | Value |
|---|---:|
| Write call sites | 215 |
| Object name statically decidable | 143 |
| Object name chosen at run time | 72 |
| Against a tenancy-enabled object | 143 |
| Against an object declaring tenancy off | 0 |
| Threading a tenant context | 131 |
| Provably carrying none | 17 |
| …and decidably tenancy-enabled | 9 |
| Options argument unreadable | 67 |
| …and decidably tenancy-enabled | 32 |
| Threading a decidably elevated context | 97 |
| Threading a decidably non-elevated context | 0 |
| Threading a context of undecidable elevation | 101 |
| Sources scanned | 534 |
| Engine-shaped types recognised | 56 |
| Declared objects in the registry | 297 |
| Same-named calls subtracted as non-engine | 119 |

## Every site

| file | verb | object | tenancy | tenant context | n |
|---|---|---|---|---|---:|
| `packages/plugins/plugin-approvals/src/approval-service.ts` | `update` | `object` | undecidable | context, elevation undecidable | 1 |
| `packages/plugins/plugin-approvals/src/approval-service.ts` | `insert` | `sys_approval_action` | enabled | elevated | 13 |
| `packages/plugins/plugin-approvals/src/approval-service.ts` | `delete` | `sys_approval_approver` | enabled | elevated | 2 |
| `packages/plugins/plugin-approvals/src/approval-service.ts` | `insert` | `sys_approval_approver` | enabled | elevated | 2 |
| `packages/plugins/plugin-approvals/src/approval-service.ts` | `insert` | `sys_approval_request` | enabled | elevated | 1 |
| `packages/plugins/plugin-approvals/src/approval-service.ts` | `update` | `sys_approval_request` | enabled | elevated | 8 |
| `packages/plugins/plugin-approvals/src/approval-service.ts` | `insert` | `sys_approval_token` | enabled | elevated | 1 |
| `packages/plugins/plugin-approvals/src/approval-service.ts` | `update` | `sys_approval_token` | enabled | elevated | 1 |
| `packages/plugins/plugin-approvals/src/backfill-platform-row-organizations.ts` | `update` | `objectPlan.object` | undecidable | context, elevation undecidable | 1 |
| `packages/plugins/plugin-audit/src/auth-event-audit.ts` | `insert` | `sys_audit_log` | enabled | options unreadable | 1 |
| `packages/plugins/plugin-audit/src/read-audit.ts` | `insert` | `sys_audit_log` | enabled | options unreadable | 1 |
| `packages/plugins/plugin-auth/src/admin-import-users.ts` | `insert` | `sys_audit_log` | enabled | options unreadable | 1 |
| `packages/plugins/plugin-auth/src/admin-import-users.ts` | `update` | `sys_user` | enabled | options unreadable | 2 |
| `packages/plugins/plugin-auth/src/admin-user-endpoints.ts` | `insert` | `sys_audit_log` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/admin-user-endpoints.ts` | `update` | `sys_user` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/adopt-membership.ts` | `update` | `SystemObjectName.MEMBER` | undecidable | PROVABLY NONE | 1 |
| `packages/plugins/plugin-auth/src/auth-manager.ts` | `update` | `sys_account` | enabled | options unreadable | 1 |
| `packages/plugins/plugin-auth/src/auth-manager.ts` | `update` | `sys_session` | enabled | options unreadable | 3 |
| `packages/plugins/plugin-auth/src/auth-manager.ts` | `update` | `sys_two_factor` | enabled | options unreadable | 1 |
| `packages/plugins/plugin-auth/src/auth-manager.ts` | `update` | `sys_user` | enabled | options unreadable | 8 |
| `packages/plugins/plugin-auth/src/auth-manager.ts` | `insert` | `sys_user_permission_set` | enabled | options unreadable | 1 |
| `packages/plugins/plugin-auth/src/auth-plugin.ts` | `update` | `sys_oauth_application` | enabled | PROVABLY NONE | 1 |
| `packages/plugins/plugin-auth/src/auth-plugin.ts` | `update` | `sys_user` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/auth-plugin.ts` | `update` | `SystemObjectName.USER` | undecidable | elevated | 1 |
| `packages/plugins/plugin-auth/src/backfill-account-issuer.ts` | `update` | `sys_account` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/ensure-default-organization.ts` | `insert` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-auth/src/member-role-canonical.ts` | `update` | `MEMBER_OBJECT` | undecidable | elevated | 1 |
| `packages/plugins/plugin-auth/src/objectql-adapter.ts` | `delete` | `m` | undecidable | options unreadable | 1 |
| `packages/plugins/plugin-auth/src/objectql-adapter.ts` | `insert` | `m` | undecidable | options unreadable | 1 |
| `packages/plugins/plugin-auth/src/objectql-adapter.ts` | `update` | `m` | undecidable | options unreadable | 1 |
| `packages/plugins/plugin-auth/src/objectql-adapter.ts` | `delete` | `objectName` | undecidable | PROVABLY NONE | 5 |
| `packages/plugins/plugin-auth/src/objectql-adapter.ts` | `insert` | `objectName` | undecidable | options unreadable | 2 |
| `packages/plugins/plugin-auth/src/objectql-adapter.ts` | `update` | `objectName` | undecidable | options unreadable | 5 |
| `packages/plugins/plugin-auth/src/phone-sms-texts.ts` | `insert` | `sys_notification_template` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/reconcile-membership.ts` | `insert` | `sys_member` | enabled | context, elevation undecidable | 1 |
| `packages/plugins/plugin-auth/src/scim-connection-service.ts` | `insert` | `sys_scim_connection_credential` | enabled | PROVABLY NONE | 1 |
| `packages/plugins/plugin-auth/src/session-tombstone.ts` | `update` | `objectName` | undecidable | options unreadable | 1 |
| `packages/plugins/plugin-email/src/attachment-reclaim.ts` | `update` | `sys_email` | enabled | elevated | 1 |
| `packages/plugins/plugin-email/src/bootstrap-declared-email-templates.ts` | `insert` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-email/src/bootstrap-declared-email-templates.ts` | `update` | `object` | undecidable | elevated | 2 |
| `packages/plugins/plugin-email/src/email-plugin.ts` | `insert` | `sys_email` | enabled | elevated | 1 |
| `packages/plugins/plugin-email/src/email-plugin.ts` | `update` | `sys_email` | enabled | elevated | 1 |
| `packages/plugins/plugin-email/src/email-plugin.ts` | `insert` | `sys_email_template` | enabled | elevated | 1 |
| `packages/plugins/plugin-email/src/email-plugin.ts` | `update` | `sys_email_template` | enabled | elevated | 1 |
| `packages/plugins/plugin-pinyin-search/src/companion-projection.ts` | `update` | `schema.name` | undecidable | elevated | 1 |
| `packages/plugins/plugin-reports/src/report-service.ts` | `delete` | `sys_report_schedule` | enabled | elevated | 2 |
| `packages/plugins/plugin-reports/src/report-service.ts` | `insert` | `sys_report_schedule` | enabled | elevated | 1 |
| `packages/plugins/plugin-reports/src/report-service.ts` | `update` | `sys_report_schedule` | enabled | elevated | 2 |
| `packages/plugins/plugin-reports/src/report-service.ts` | `delete` | `sys_saved_report` | enabled | elevated | 1 |
| `packages/plugins/plugin-reports/src/report-service.ts` | `insert` | `sys_saved_report` | enabled | elevated | 1 |
| `packages/plugins/plugin-reports/src/report-service.ts` | `update` | `sys_saved_report` | enabled | elevated | 2 |
| `packages/plugins/plugin-security/src/auto-org-admin-grant.ts` | `delete` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-security/src/auto-org-admin-grant.ts` | `insert` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-security/src/bootstrap-builtin-positions.ts` | `insert` | `object` | undecidable | context, elevation undecidable | 1 |
| `packages/plugins/plugin-security/src/bootstrap-builtin-positions.ts` | `update` | `object` | undecidable | context, elevation undecidable | 1 |
| `packages/plugins/plugin-security/src/bootstrap-declared-positions.ts` | `insert` | `object` | undecidable | context, elevation undecidable | 1 |
| `packages/plugins/plugin-security/src/bootstrap-declared-positions.ts` | `update` | `object` | undecidable | context, elevation undecidable | 1 |
| `packages/plugins/plugin-security/src/bootstrap-platform-admin.ts` | `insert` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-security/src/bootstrap-platform-admin.ts` | `update` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-security/src/bootstrap-system-capabilities.ts` | `insert` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-security/src/bootstrap-system-capabilities.ts` | `update` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-security/src/claim-seed-ownership.ts` | `update` | `schema.name` | undecidable | elevated | 1 |
| `packages/plugins/plugin-security/src/cleanup-package-permissions.ts` | `delete` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-security/src/invitation-placement.ts` | `insert` | `sys_user_position` | enabled | elevated | 1 |
| `packages/plugins/plugin-security/src/normalize-managed-by.ts` | `update` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-security/src/permission-set-overlay-discard.ts` | `delete` | `sys_metadata` | enabled | context, elevation undecidable | 1 |
| `packages/plugins/plugin-security/src/permission-set-projection.ts` | `insert` | `object` | undecidable | context, elevation undecidable | 1 |
| `packages/plugins/plugin-security/src/permission-set-projection.ts` | `update` | `object` | undecidable | context, elevation undecidable | 1 |
| `packages/plugins/plugin-security/src/permission-set-projection.ts` | `delete` | `sys_permission_set` | enabled | elevated | 1 |
| `packages/plugins/plugin-security/src/security-plugin.ts` | `insert` | `sys_position_permission_set` | enabled | context, elevation undecidable | 1 |
| `packages/plugins/plugin-security/src/suggested-audience-bindings.ts` | `delete` | `sys_audience_binding_suggestion` | enabled | context, elevation undecidable | 2 |
| `packages/plugins/plugin-security/src/suggested-audience-bindings.ts` | `insert` | `sys_audience_binding_suggestion` | enabled | context, elevation undecidable | 1 |
| `packages/plugins/plugin-security/src/suggested-audience-bindings.ts` | `update` | `sys_audience_binding_suggestion` | enabled | context, elevation undecidable | 3 |
| `packages/plugins/plugin-security/src/suggested-audience-bindings.ts` | `insert` | `sys_position_permission_set` | enabled | context, elevation undecidable | 1 |
| `packages/plugins/plugin-sharing/src/primary-bu-projection.ts` | `update` | `sys_user` | enabled | elevated | 2 |
| `packages/plugins/plugin-sharing/src/record-orphan-cleanup.ts` | `delete` | `table` | undecidable | options unreadable | 2 |
| `packages/plugins/plugin-sharing/src/share-link-service.ts` | `insert` | `sys_share_link` | enabled | elevated | 1 |
| `packages/plugins/plugin-sharing/src/share-link-service.ts` | `update` | `sys_share_link` | enabled | elevated | 2 |
| `packages/plugins/plugin-sharing/src/sharing-plugin.ts` | `update` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-sharing/src/sharing-rule-service.ts` | `delete` | `sys_record_share` | enabled | options unreadable | 3 |
| `packages/plugins/plugin-sharing/src/sharing-rule-service.ts` | `delete` | `sys_sharing_rule` | enabled | options unreadable | 1 |
| `packages/plugins/plugin-sharing/src/sharing-rule-service.ts` | `insert` | `sys_sharing_rule` | enabled | elevated | 1 |
| `packages/plugins/plugin-sharing/src/sharing-rule-service.ts` | `update` | `sys_sharing_rule` | enabled | elevated | 1 |
| `packages/plugins/plugin-sharing/src/sharing-service.ts` | `delete` | `sys_record_share` | enabled | elevated | 2 |
| `packages/plugins/plugin-sharing/src/sharing-service.ts` | `insert` | `sys_record_share` | enabled | elevated | 1 |
| `packages/plugins/plugin-sharing/src/sharing-service.ts` | `update` | `sys_record_share` | enabled | elevated | 1 |
| `packages/plugins/plugin-webhooks/src/bootstrap-declared-webhooks.ts` | `insert` | `subscriptionsObject` | undecidable | options unreadable | 1 |
| `packages/plugins/plugin-webhooks/src/bootstrap-declared-webhooks.ts` | `update` | `subscriptionsObject` | undecidable | options unreadable | 1 |
| `packages/plugins/plugin-webhooks/src/migrate-webhook-secrets.ts` | `update` | `subscriptionsObject` | undecidable | options unreadable | 1 |
| `packages/services/service-automation/src/builtin/crud-nodes.ts` | `delete` | `objectName` | undecidable | context, elevation undecidable | 1 |
| `packages/services/service-automation/src/builtin/crud-nodes.ts` | `insert` | `objectName` | undecidable | context, elevation undecidable | 1 |
| `packages/services/service-automation/src/builtin/crud-nodes.ts` | `update` | `objectName` | undecidable | context, elevation undecidable | 1 |
| `packages/services/service-automation/src/flow-dispatch-store.ts` | `insert` | `sys_flow_dispatch` | enabled | elevated | 1 |
| `packages/services/service-automation/src/suspended-run-store.ts` | `delete` | `sys_automation_run` | enabled | elevated | 2 |
| `packages/services/service-automation/src/suspended-run-store.ts` | `insert` | `sys_automation_run` | enabled | elevated | 2 |
| `packages/services/service-automation/src/suspended-run-store.ts` | `update` | `sys_automation_run` | enabled | elevated | 2 |
| `packages/services/service-datasource/src/datasource-admin-plugin.ts` | `delete` | `sys_metadata` | enabled | PROVABLY NONE | 1 |
| `packages/services/service-datasource/src/datasource-admin-plugin.ts` | `insert` | `sys_metadata` | enabled | PROVABLY NONE | 1 |
| `packages/services/service-datasource/src/datasource-admin-plugin.ts` | `update` | `sys_metadata` | enabled | PROVABLY NONE | 2 |
| `packages/services/service-datasource/src/datasource-secret-binder.ts` | `delete` | `sys_secret` | enabled | PROVABLY NONE | 1 |
| `packages/services/service-datasource/src/datasource-secret-binder.ts` | `insert` | `sys_secret` | enabled | PROVABLY NONE | 1 |
| `packages/services/service-job/src/db-job-adapter.ts` | `insert` | `sys_job` | enabled | elevated | 1 |
| `packages/services/service-job/src/db-job-adapter.ts` | `update` | `sys_job` | enabled | elevated | 3 |
| `packages/services/service-job/src/db-job-adapter.ts` | `insert` | `sys_job_run` | enabled | elevated | 1 |
| `packages/services/service-job/src/db-job-adapter.ts` | `update` | `sys_job_run` | enabled | elevated | 1 |
| `packages/services/service-messaging/src/inbox-channel.ts` | `insert` | `objectName` | undecidable | options unreadable | 1 |
| `packages/services/service-messaging/src/inbox-channel.ts` | `insert` | `receiptObject` | undecidable | PROVABLY NONE | 1 |
| `packages/services/service-messaging/src/messaging-service.ts` | `insert` | `RECEIPT_OBJECT` | undecidable | PROVABLY NONE | 1 |
| `packages/services/service-messaging/src/messaging-service.ts` | `update` | `RECEIPT_OBJECT` | undecidable | options unreadable | 1 |
| `packages/services/service-messaging/src/messaging-service.ts` | `insert` | `sys_notification` | enabled | options unreadable | 1 |
| `packages/services/service-messaging/src/sql-http-outbox.ts` | `insert` | `this.objectName` | undecidable | options unreadable | 1 |
| `packages/services/service-messaging/src/sql-http-outbox.ts` | `update` | `this.objectName` | undecidable | options unreadable | 4 |
| `packages/services/service-messaging/src/sql-outbox.ts` | `insert` | `this.objectName` | undecidable | options unreadable | 1 |
| `packages/services/service-messaging/src/sql-outbox.ts` | `update` | `this.objectName` | undecidable | options unreadable | 5 |
| `packages/services/service-queue/src/db-queue-adapter.ts` | `delete` | `sys_job_queue` | enabled | context, elevation undecidable | 2 |
| `packages/services/service-queue/src/db-queue-adapter.ts` | `insert` | `sys_job_queue` | enabled | context, elevation undecidable | 1 |
| `packages/services/service-queue/src/db-queue-adapter.ts` | `update` | `sys_job_queue` | enabled | context, elevation undecidable | 6 |
| `packages/services/service-settings/src/config-change-audit.ts` | `insert` | `sys_audit_log` | enabled | context, elevation undecidable | 1 |
| `packages/services/service-settings/src/settings-service-plugin.ts` | `insert` | `objectName` | undecidable | options unreadable | 1 |
| `packages/services/service-settings/src/settings-service-plugin.ts` | `update` | `objectName` | undecidable | options unreadable | 2 |
| `packages/services/service-settings/src/settings-service-plugin.ts` | `delete` | `sys_secret` | enabled | elevated | 1 |
| `packages/services/service-settings/src/settings-service-plugin.ts` | `insert` | `sys_secret` | enabled | options unreadable | 1 |
| `packages/services/service-settings/src/settings-service-plugin.ts` | `update` | `sys_secret` | enabled | options unreadable | 1 |
| `packages/services/service-settings/src/settings-service-plugin.ts` | `insert` | `sys_setting_audit` | enabled | PROVABLY NONE | 1 |
| `packages/services/service-settings/src/settings-service.ts` | `insert` | `this.objectName` | undecidable | options unreadable | 1 |
| `packages/services/service-settings/src/settings-service.ts` | `update` | `this.objectName` | undecidable | options unreadable | 1 |
| `packages/services/service-storage/src/attachment-lifecycle.ts` | `update` | `sys_file` | enabled | elevated | 3 |
| `packages/services/service-storage/src/backfill-file-references.ts` | `update` | `object` | undecidable | options unreadable | 1 |
| `packages/services/service-storage/src/backfill-file-references.ts` | `update` | `object` | undecidable | elevated | 1 |
| `packages/services/service-storage/src/backfill-file-references.ts` | `insert` | `sys_file` | enabled | context, elevation undecidable | 1 |
| `packages/services/service-storage/src/backfill-sys-file-organizations.ts` | `update` | `sys_file` | enabled | context, elevation undecidable | 1 |
| `packages/services/service-storage/src/file-reference-lifecycle.ts` | `insert` | `sys_file` | enabled | context, elevation undecidable | 1 |
| `packages/services/service-storage/src/file-reference-lifecycle.ts` | `update` | `sys_file` | enabled | elevated | 2 |
| `packages/services/service-storage/src/metadata-store.ts` | `delete` | `sys_file` | enabled | options unreadable | 1 |
| `packages/services/service-storage/src/metadata-store.ts` | `insert` | `sys_file` | enabled | options unreadable | 1 |
| `packages/services/service-storage/src/metadata-store.ts` | `update` | `sys_file` | enabled | options unreadable | 1 |
| `packages/services/service-storage/src/metadata-store.ts` | `delete` | `sys_upload_session` | enabled | options unreadable | 1 |
| `packages/services/service-storage/src/metadata-store.ts` | `insert` | `sys_upload_session` | enabled | options unreadable | 1 |
| `packages/services/service-storage/src/metadata-store.ts` | `update` | `sys_upload_session` | enabled | options unreadable | 1 |
