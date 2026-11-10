---
'@objectstack/platform-objects': patch
'@objectstack/plugin-auth': patch
---

feat(platform-objects): add and remove an IdP group mapping from Setup

Clause-②: yes (widening)
Metadata-protocol: none

Setup → IdP Group Mappings was a read-only list: the only writers of a group → permission-set mapping were plugin-auth's `POST /api/v1/auth/admin/scim/set-group-mapping` and `/admin/scim/delete-group-mapping`, posted by operator scripts. `sys_idp_group_mapping` now declares three actions that post those two doors, offered to platform administrators only (`current_user.isPlatformAdmin == true`) and gated on `manage_platform_settings` where the action doors read it:

- **Map SSO Group** (list toolbar): an SSO provider's Provider ID, the group as its groups claim sends it (an external ID or a display name), and a permission set picked from the security catalog. It applies at each member's next sign-in through the provider.
- **Map SCIM Group** (list toolbar): the same for a SCIM connection; the group's current members are granted the set at once.
- **Delete Mapping** (each mapping row): asks for confirmation, then deletes the mapping; the grants it made are removed.

Every refusal is the door's own sentence, shown in the action's dialog: a permission set outside the organization boundary (an administrator set, an agent ceiling), a same-group mapping left in another organization (naming the mapping to delete first), SCIM, SSO or the security service not enabled, an unknown mapping. The data API stays list-only and the object stays fully locked, so no generic create, edit or delete appears.

`@objectstack/plugin-auth`: the set-group-mapping door now admits `organizationId` in its body and reads nothing from it. Every `type: 'api'` action aimed at an `/api/v1/auth/` path is forwarded with the caller's active organization stamped as `organizationId`, so the door's closed key set refused every action that posted it. The mapping's organization is still the source's (the SCIM connection's or the SSO provider's), never the stamped one; any other unknown key is still refused `400 VALIDATION_FAILED`.
