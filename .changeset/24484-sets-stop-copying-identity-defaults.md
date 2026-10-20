---
'@objectstack/plugin-security': patch
---

fix(plugin-security): the shipped permission sets stop copying the row scope thirteen identity objects declare as their own default

Clause-②: no

`organization_admin` (and so `organization_admin_no_bypass`), `member_default` and `viewer_readonly` no longer carry their copies of the row policy that thirteen identity objects declare as their `defaultRowScope`. The thirteen are the seven SCIM projection tables (`sys_scim_user`, `sys_scim_subject`, `sys_scim_projection_grant`, `sys_scim_identity_tombstone`, `sys_scim_group`, `sys_scim_group_member`, `sys_scim_connection_binding`), `sys_verification` and `sys_jwks`, and the `select` self scope of `sys_account`, `sys_team_member`, `sys_oauth_access_token` and `sys_oauth_refresh_token`. Each copy was byte-identical to its object's declaration. The row-policy collection applies an object's declared default wherever the caller's held sets carry no policy for that object and operation, so every holder of the shipped sets reads exactly the rows it read before. That holds with the platform baseline and without it (`fallbackPermissionSet: null`), under the walled and the `single` posture, and for an MCP agent acting for a holder.

Explain now names the object's default (`via: 'object_default'`) where it named the set's policy on those thirteen objects.

**Kept in the sets.**

- `sys_user`'s two policies, and every `all`-spelled self scope (`sys_session`, `sys_two_factor`, `sys_user_preference`, `sys_api_key`, `sys_device_code`, `sys_oauth_consent`, `sys_oauth_application`, `sys_organization`). A member's `update` and `delete` collection holds the `'*'` ownership floor, so the object's default is never collected there, and these copies are what scope a member's writes to their own rows.
- `sys_audit_log_org`. Where no organization wall is enforced, the platform's own tenant policies are stripped by provenance, and that provenance is read off these sets. The copy is what makes the ledger's identical default the platform's policy, so `single` keeps serving the ledger unscoped.

**If an application set authors a row policy for one of these thirteen objects**, that policy is used as authored and the object's default is not added beside it. Before, a holder who also held a shipped set had that set's copy OR-ed in, so an authored scope that left out the holder's own rows was widened back to them. Now the authored policy alone decides on that object and operation. Measured: no package or example in this repository authors such a policy.
