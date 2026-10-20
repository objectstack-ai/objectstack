---
'@objectstack/platform-objects': minor
'@objectstack/plugin-audit': minor
---

feat(platform-objects)!: the platform identity objects declare their default row scope (#24341)

Clause-②: no (narrowing)

Twenty-three platform objects now declare `defaultRowScope`, each with the row policy the shipped permission sets of `@objectstack/plugin-security` carried for it, moved verbatim: the seven SCIM projections (`sys_scim_user`, `sys_scim_subject`, `sys_scim_projection_grant`, `sys_scim_identity_tombstone`, `sys_scim_group`, `sys_scim_group_member`, `sys_scim_connection_binding`), `sys_verification` and `sys_jwks`, `sys_organization`, `sys_user`, `sys_session`, `sys_account`, `sys_team_member`, `sys_two_factor`, `sys_user_preference`, `sys_api_key`, `sys_device_code`, `sys_oauth_access_token`, `sys_oauth_refresh_token`, `sys_oauth_consent`, `sys_oauth_application` (`@objectstack/platform-objects`) and `sys_audit_log` (`@objectstack/plugin-audit`, which owns the ledger). `sys_user` is the one merge: the key holds one policy, so its two shipped policies are joined into `id == current_user.id || id in current_user.org_user_ids`, a `select` policy. The platform-global objects (`sys_metadata*`, `sys_job*`, `sys_migration*`, `sys_platform_setting`, `sys_presence`, `sys_flow_dispatch`) declare none.

The security plugin's row-policy collection applies an object's declared default when the permission sets the caller holds carry no row policy for that object and operation. On each object and operation the shipped sets either still carry the same policy or, where they no longer carry a copy (the `@objectstack/plugin-security` entry names the thirteen), collect the object's identical default, so a holder of them reads exactly what it read before.

**BREAKING — what moves for consumers.** This narrows what a principal reads on these objects when its sets carry no row policy for them, shipped as `minor` under the launch-window convention for accept-set narrowings.

- FROM: a principal holding no platform baseline (a deployment that sets the security plugin's `fallbackPermissionSet: null`) whose sets grant read on an identity object and carry no row policy for it read every row of that object.
- TO: it reads the object's declared default: its own rows (`user_id == current_user.id`); on `sys_user`, its own row plus the members of the organisation it acts in; on `sys_organization`, its own organisation; no row on `sys_verification`, `sys_jwks`, `sys_scim_group`, `sys_scim_group_member` and `sys_scim_connection_binding`; on `sys_audit_log`, its organisation's entries where organisation scoping is on (the platform's tenant policies, this one included, are stripped where it is off).
- Fix: to give such a principal more rows, give one of its permission sets a `rowLevelSecurity` policy for the object. A policy a held set carries is used as authored, and the default is not added to it.

**Unchanged.**

- A deployment with the platform baseline (`member_default`, the default) serves every human exactly what it served before, on every one of the 23 objects and every operation: each human holds the baseline, and on each object and operation the baseline either carries a policy or collects the object's identical default. Measured on a booted composition with a member, a viewer, an organisation admin, a user in no organisation and the platform administrator, before and after the declarations.
- An MCP agent acting for a user reads the same rows, and gets the same explain output, as before. Its ceiling set carries no row policy, and the security plugin does not collect an object's declared default on a delegated principal's own side of the intersection (see the `@objectstack/plugin-security` entry), so the agent's rows stay bounded by its delegator's side alone. Measured on a booted composition, before and after the declarations, for the agents of a member, a viewer, an organisation admin and the platform administrator; the platform administrator's agent still reads every row.
- The platform administrator's superuser bypass is decided before any row policy is collected.
- No export, option or stored shape moves.

<!-- adr-0087: not-required (no-migration-prescription) declarations of a row scope on platform objects, each the policy the shipped permission sets already carry: no authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. What narrows is the rows a principal with no baseline and no row policy of its own reads, and the repair is a deployer's choice of a `rowLevelSecurity` policy, which no ledger entry can derive. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id covers row scopes (not already-registered); and the change is a runtime row scope, not an interface, a type or an export (not runtime-interface-only, type-surface-only or runtime-export-retired). -->
