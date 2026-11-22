<!-- GENERATED — DO NOT EDIT BY HAND. -->
<!-- Regenerate: node scripts/tenant-audit-census.mjs --write -->

# `plugins/plugin-auth` — tenant-audit census shard (generated)

The write call sites in `packages/plugins/plugin-auth/`, as `scripts/tenant-audit-census.mjs`
derives them from the tree: this package's totals and every one of its sites.
One file per package, and no total across packages is committed anywhere —
`node scripts/check-tenant-audit-census.mjs` prints the census totals. The
method is in [the ledger index](../../2026-08-tenant-audit-write-call-sites.counts.md). ⛔ Never hand-patch
a row or a number here — fix the code, or the census, and regenerate.

## Totals in this package

| Measure | Value |
|---|---:|
| Write call sites | 107 |
| Object name statically decidable | 58 |
| Object name chosen at run time | 49 |
| Object name spelled inline | 47 |
| Object name spelled through a `const` | 11 |
| Object name is an `object: string` parameter | 4 |
| Object name is some other run-time expression | 45 |
| Against a tenancy-enabled object | 56 |
| Against an object declaring tenancy off | 2 |
| Threading a tenant context | 63 |
| Provably carrying none (options read, no context key) | 15 |
| …and decidably tenancy-enabled | 3 |
| Options argument unreadable | 29 |
| …and decidably tenancy-enabled | 16 |
| Threading a decidably elevated (`isSystem`) context | 45 |
| Threading a decidably non-elevated context | 0 |
| Threading a context of undecidable elevation | 47 |
| Receiver carried a readable engine type | 80 |
| Receiver erased, placed by the object NAME | 24 |
| Receiver erased, placed by an `object: string` PARAMETER | 2 |
| Receiver erased, placed by an `UNTYPED_RECEIVERS` row | 1 |

## Subtractions the census could NOT defend — enforced

| what | count |
|---|---:|
| Write calls subtracted with no defensible reason | 0 |
| …whose declared type text states an engine door anyway | 0 |

## Every site

| file | verb | object | tenancy | tenant context | n |
|---|---|---|---|---|---:|
| `packages/plugins/plugin-auth/src/admin-import-users.ts` | `insert` | `sys_audit_log` | enabled | options unreadable | 1 |
| `packages/plugins/plugin-auth/src/admin-import-users.ts` | `update` | `sys_user` | enabled | options unreadable | 2 |
| `packages/plugins/plugin-auth/src/admin-import-users.ts` | `insert` | `sys_user_position` | enabled | context, elevation undecidable | 1 |
| `packages/plugins/plugin-auth/src/admin-set-user-manager.ts` | `update` | `sys_user` | enabled | context, elevation undecidable | 1 |
| `packages/plugins/plugin-auth/src/admin-user-endpoints.ts` | `insert` | `sys_audit_log` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/admin-user-endpoints.ts` | `update` | `sys_user` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/admin-user-endpoints.ts` | `insert` | `sys_user_permission_set` | enabled | context, elevation undecidable | 1 |
| `packages/plugins/plugin-auth/src/adopt-membership.ts` | `update` | `SystemObjectName.MEMBER` | undecidable | PROVABLY NONE | 1 |
| `packages/plugins/plugin-auth/src/audience-gate-test-support.ts` | `insert` | `sys_invitation` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/auth-manager-database-hooks.ts` | `update` | `sys_user` | enabled | options unreadable | 2 |
| `packages/plugins/plugin-auth/src/auth-manager-membership-admission.ts` | `insert` | `sys_user_permission_set` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/auth-manager-password-session-policy.ts` | `update` | `sys_account` | enabled | options unreadable | 1 |
| `packages/plugins/plugin-auth/src/auth-manager-password-session-policy.ts` | `update` | `sys_session` | enabled | options unreadable | 3 |
| `packages/plugins/plugin-auth/src/auth-manager-password-session-policy.ts` | `update` | `sys_two_factor` | enabled | options unreadable | 1 |
| `packages/plugins/plugin-auth/src/auth-manager-password-session-policy.ts` | `update` | `sys_user` | enabled | options unreadable | 3 |
| `packages/plugins/plugin-auth/src/auth-manager-sign-in-lockout.ts` | `update` | `sys_user` | enabled | options unreadable | 3 |
| `packages/plugins/plugin-auth/src/auth-manager.ts` | `update` | `sys_session` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/auth-manager.ts` | `delete` | `sys_verification` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/auth-manager.ts` | `insert` | `sys_verification` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/auth-plugin.ts` | `update` | `sys_oauth_application` | enabled | PROVABLY NONE | 1 |
| `packages/plugins/plugin-auth/src/auth-plugin.ts` | `update` | `sys_user` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/auth-plugin.ts` | `update` | `SystemObjectName.USER` | undecidable | elevated | 1 |
| `packages/plugins/plugin-auth/src/credential-change-ends-reset-tokens.ts` | `delete` | `VERIFICATION` | undecidable | PROVABLY NONE | 3 |
| `packages/plugins/plugin-auth/src/default-organization-invariant.ts` | `insert` | `sys_organization` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/demo-staff.ts` | `update` | `sys_user` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/demo-staff.ts` | `insert` | `sys_user_permission_set` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/demo-staff.ts` | `insert` | `sys_user_position` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/dev-seed-credential-retirement.ts` | `delete` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-auth/src/dev-seed-credential.ts` | `update` | `SystemObjectName.USER` | undecidable | elevated | 1 |
| `packages/plugins/plugin-auth/src/ensure-default-organization.ts` | `insert` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-auth/src/ensure-default-organization.ts` | `update` | `sys_member` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/forced-reset-revocation.ts` | `update` | `object` | undecidable | options unreadable | 1 |
| `packages/plugins/plugin-auth/src/forced-reset-revocation.ts` | `delete` | `SystemObjectName.ACCOUNT` | undecidable | elevated | 1 |
| `packages/plugins/plugin-auth/src/forced-reset-revocation.ts` | `update` | `SystemObjectName.API_KEY` | undecidable | elevated | 1 |
| `packages/plugins/plugin-auth/src/forced-reset-revocation.ts` | `update` | `SystemObjectName.SESSION` | undecidable | elevated | 1 |
| `packages/plugins/plugin-auth/src/idp-group-mapping-admin.ts` | `delete` | `IDP_GROUP_MAPPING_OBJECT` | undecidable | PROVABLY NONE | 1 |
| `packages/plugins/plugin-auth/src/idp-group-mapping-admin.ts` | `insert` | `IDP_GROUP_MAPPING_OBJECT` | undecidable | options unreadable | 1 |
| `packages/plugins/plugin-auth/src/idp-group-mapping-admin.ts` | `insert` | `sys_audit_log` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/idp-group-mapping-admin.ts` | `delete` | `sys_user_permission_set` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/idp-group-mapping-match.ts` | `update` | `IDP_GROUP_MAPPING_OBJECT` | undecidable | PROVABLY NONE | 1 |
| `packages/plugins/plugin-auth/src/idp-locale-claim.ts` | `update` | `sys_user` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/mcp-client-last-use.ts` | `update` | `sys_oauth_consent` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/member-role-canonical.ts` | `update` | `MEMBER_OBJECT` | undecidable | elevated | 1 |
| `packages/plugins/plugin-auth/src/membership-backfill-ledger.ts` | `insert` | `DATA_MIGRATION_FLAG_OBJECT` | undecidable | elevated | 1 |
| `packages/plugins/plugin-auth/src/membership-ended-session.ts` | `update` | `SystemObjectName.SESSION` | undecidable | elevated | 2 |
| `packages/plugins/plugin-auth/src/objectql-adapter.ts` | `delete` | `m` | undecidable | options unreadable | 1 |
| `packages/plugins/plugin-auth/src/objectql-adapter.ts` | `insert` | `m` | undecidable | options unreadable | 1 |
| `packages/plugins/plugin-auth/src/objectql-adapter.ts` | `update` | `m` | undecidable | options unreadable | 1 |
| `packages/plugins/plugin-auth/src/objectql-adapter.ts` | `delete` | `objectName` | undecidable | PROVABLY NONE | 5 |
| `packages/plugins/plugin-auth/src/objectql-adapter.ts` | `insert` | `objectName` | undecidable | options unreadable | 2 |
| `packages/plugins/plugin-auth/src/objectql-adapter.ts` | `update` | `objectName` | undecidable | options unreadable | 5 |
| `packages/plugins/plugin-auth/src/operator-password-reset.ts` | `delete` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-auth/src/operator-password-reset.ts` | `update` | `SystemObjectName.ACCOUNT` | undecidable | elevated | 1 |
| `packages/plugins/plugin-auth/src/operator-password-reset.ts` | `update` | `SystemObjectName.USER` | undecidable | elevated | 1 |
| `packages/plugins/plugin-auth/src/organization-delete.ts` | `delete` | `sys_team` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/organization-delete.ts` | `delete` | `sys_team_member` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/organization-delete.ts` | `delete` | `sys_user_permission_set` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/password-reset-ends-added-access.ts` | `delete` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-auth/src/password-reset-ends-added-access.ts` | `update` | `SystemObjectName.API_KEY` | undecidable | elevated | 1 |
| `packages/plugins/plugin-auth/src/pending-sso-users.ts` | `insert` | `sys_user` | enabled | context, elevation undecidable | 1 |
| `packages/plugins/plugin-auth/src/pending-sso-users.ts` | `insert` | `sys_user_permission_set` | enabled | context, elevation undecidable | 1 |
| `packages/plugins/plugin-auth/src/pending-sso-users.ts` | `insert` | `sys_user_position` | enabled | context, elevation undecidable | 1 |
| `packages/plugins/plugin-auth/src/reconcile-membership.ts` | `insert` | `sys_member` | enabled | context, elevation undecidable | 1 |
| `packages/plugins/plugin-auth/src/scim-connection-admin.ts` | `insert` | `sys_audit_log` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/scim-connection-service.ts` | `insert` | `sys_scim_connection_credential` | enabled | PROVABLY NONE | 1 |
| `packages/plugins/plugin-auth/src/scim-connection-service.ts` | `update` | `sys_scim_connection_credential` | enabled | elevated | 2 |
| `packages/plugins/plugin-auth/src/scim-deactivation-key-revocation.ts` | `update` | `SystemObjectName.API_KEY` | undecidable | context, elevation undecidable | 1 |
| `packages/plugins/plugin-auth/src/scim-group-projection.ts` | `delete` | `sys_user_permission_set` | enabled | PROVABLY NONE | 1 |
| `packages/plugins/plugin-auth/src/scim-group-projection.ts` | `insert` | `sys_user_permission_set` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/scim-identity-source.ts` | `update` | `sys_user` | enabled | context, elevation undecidable | 1 |
| `packages/plugins/plugin-auth/src/service-account-doors.ts` | `insert` | `sys_api_key` | disabled | context, elevation undecidable | 1 |
| `packages/plugins/plugin-auth/src/service-account-doors.ts` | `insert` | `USER_OBJECT` | undecidable | context, elevation undecidable | 1 |
| `packages/plugins/plugin-auth/src/service-account-lifecycle.ts` | `update` | `API_KEY_OBJECT` | undecidable | context, elevation undecidable | 3 |
| `packages/plugins/plugin-auth/src/service-account-lifecycle.ts` | `delete` | `MEMBER_OBJECT` | undecidable | context, elevation undecidable | 1 |
| `packages/plugins/plugin-auth/src/service-account-lifecycle.ts` | `update` | `USER_OBJECT` | undecidable | context, elevation undecidable | 1 |
| `packages/plugins/plugin-auth/src/service-account-owner-leaves.ts` | `update` | `sys_user` | enabled | context, elevation undecidable | 1 |
| `packages/plugins/plugin-auth/src/session-tombstone.ts` | `update` | `objectName` | undecidable | options unreadable | 1 |
| `packages/plugins/plugin-auth/src/sso-client-secret.ts` | `update` | `sys_sso_provider` | disabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/sso-provider-lifecycle.ts` | `delete` | `IDP_GROUP_MAPPING_OBJECT` | undecidable | PROVABLY NONE | 1 |
| `packages/plugins/plugin-auth/src/sso-provider-lifecycle.ts` | `delete` | `sys_user_permission_set` | enabled | elevated | 1 |
| `packages/plugins/plugin-auth/src/sys-session-revoke.ts` | `update` | `SystemObjectName.SESSION` | undecidable | elevated | 1 |
| `packages/plugins/plugin-auth/src/user-ban-write.ts` | `update` | `sys_user` | enabled | context, elevation undecidable | 1 |
| `packages/plugins/plugin-auth/src/user-session-admission.ts` | `update` | `sys_user` | enabled | elevated | 2 |
