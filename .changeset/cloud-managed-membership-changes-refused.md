---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
---

fix(auth)!: on a cloud-managed environment every organization door that writes or deletes a membership row refuses, add-member excepted; membership is managed by the hosting organisation

Clause-②: no (narrowing) — narrowed: on a cloud-managed environment only (`OS_CLOUD_MANAGED=1`), six organization doors that write or delete a membership row now answer `409 RESOURCE_CONFLICT` to every request and write nothing, where they changed membership: `POST /organization/remove-member`, `POST /organization/update-member-role` (Make Owner calls it), `POST /organization/leave`, `POST /organization/accept-invitation`, `POST /organization/create` (it made the caller the new organization's owner) and `POST /organization/delete` (it ended every membership of the organization). Six refusal sentences are added (`CLOUD_MANAGED_REFUSAL_MESSAGES.removeMember`, `.updateMemberRole`, `.leaveOrganization`, `.acceptInvitation`, `.createOrganization`, `.deleteOrganization`). Their seven actions are hidden while `features.cloudManaged` is on, as the invite actions are (`sys_member.update_member_role`, `remove_member`, `transfer_ownership`; `sys_organization.leave_organization`, `create_organization`, `delete_organization`; `sys_invitation.accept_invitation`), and `PUBLIC_AUTH_FEATURES.cloudManaged.gatedInputs` books the seven paths.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches the organization membership doors or the cloud-managed mode; `content/docs/permissions/authentication.mdx` gains the rule in this change.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped: seven paths join a feature-flag registry list, and the moved answers are runtime refusals at six auth doors under a deployment switch that only hosted environments set, so there is nothing stored for a migration to rewrite and no tombstone. -->

**BREAKING** for a cloud-managed environment (`OS_CLOUD_MANAGED=1`, set only on hosted containers): membership and membership tiers are managed by the organisation that hosts the environment. Every organization door that writes or deletes a membership row refuses every request with `409 RESOURCE_CONFLICT` and writes nothing, as `POST /organization/invite-member` already did: Remove Member, Change Role and Make Owner, Leave Organization, Accept Invitation, Create Organization and Delete Organization. Their actions are hidden there.

Who moves: an owner (or administrator) of a cloud-managed environment who changed membership from inside the environment, and a member who left, accepted an invitation, or created or deleted an organization there. Make the change in the hosting organisation instead.

Unchanged: every self-hosted deployment (the variable unset), where every door answers as before; `POST /organization/add-member`, which on a managed environment admits exactly a platform administrator, adding a membership, to restore one the environment lost; and the organization doors that write no membership row (teams, invitations, the active organization, the organization's own fields) or only read.
