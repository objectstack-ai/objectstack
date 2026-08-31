---
'@objectstack/plugin-auth': patch
---

`ensureDefaultOrganization` resolves the platform admin through the L4 config-derived standing when no cross-tenant grant row exists (#13514 follow-through): the walled bootstrap mints no `sys_user_permission_set` row any more, so the ADR-0081 D1 default-org bootstrap dead-ended on `no_admin` forever on walled deployments — the enterprise organizations package invokes this same helper there. The fallback asks the same public predicates the derivation site asks (`resolvePlatformAdminEmails` + `isConfiguredPlatformAdminEmail` + the #11343 verified-email allow-list), oldest verified owner wins, and the grant row stays primary where it exists.
