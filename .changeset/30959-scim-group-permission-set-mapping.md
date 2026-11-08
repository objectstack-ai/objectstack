---
'@objectstack/plugin-auth': patch
'@objectstack/plugin-security': patch
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
---

feat(plugin-auth): a SCIM group push grants the ordinary permission set its group mapping names

Clause-②: yes (widening)
Metadata-protocol: none

An identity provider that pushes a group over SCIM now changes what its members may do. A platform administrator saves a mapping from one SCIM connection's group to one permission set with `POST /api/v1/auth/admin/scim/set-group-mapping` (`connectionId`, `groupExternalId` or `groupDisplayName`, `permissionSet`), and deletes one with `POST /api/v1/auth/admin/scim/delete-group-mapping` (`mappingId`). Both run the platform-admin gate the SCIM credential door runs. The rows live in the new platform object `sys_idp_group_mapping`, which the data API only lists.

When a group's membership changes, `@better-auth/scim`'s projection grants each member the mapped set in the organization that owns the connection, inside the SCIM transaction, written by the connection (`svc:scim:CONNECTION_ID` in the audit trail). Removing a member removes that grant. A group nobody mapped grants nothing. A grant the projection did not make, such as one an administrator made by hand, is never removed. Saving or deleting a mapping applies it to the group's current members at once.

A mapping can never make anyone an administrator. The save refuses, with `400 VALIDATION_FAILED` on `permissionSet`, every set outside the organization boundary: `admin_full_access`, the organization-administrator sets, the agent ceiling sets, a set with a superuser wildcard or an `adminScope`, and a set with a capability not scoped to the organization. The judgement is plugin-security's own delegated-administration predicate, now served as the optional `ISecurityService.organizationBoundaryFailure(setName)` member. Without a security service the save is refused `503` and nothing is granted.

The break-glass guard's refusal no longer tells operators that "the SCIM group mapping is too broad": a group mapping never moves administrator standing, so the sentence now says to grant another account standing first.
