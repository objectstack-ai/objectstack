---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
---

fix(auth)!: a cloud-managed environment refuses remove-member and update-member-role; membership and roles are managed by the hosting organisation

Clause-②: no (narrowing) — narrowed: on a cloud-managed environment only (`OS_CLOUD_MANAGED=1`), `POST /organization/remove-member` and `POST /organization/update-member-role` now answer `409 RESOURCE_CONFLICT` to every request, where they removed the member or changed their role; Make Owner sends the owner role to update-member-role, so it is refused too. Two refusal sentences are added (`CLOUD_MANAGED_REFUSAL_MESSAGES.removeMember` and `.updateMemberRole`). The `sys_member` actions `update_member_role`, `remove_member` and `transfer_ownership` are hidden while `features.cloudManaged` is on, as the invite actions are, and `PUBLIC_AUTH_FEATURES.cloudManaged.gatedInputs` books the three paths.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches the organization membership doors or the cloud-managed mode; `content/docs/permissions/authentication.mdx` gains the rule in this change.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped: three paths join a feature-flag registry list, and the moved answers are runtime refusals at two auth doors under a deployment switch that only hosted environments set, so there is nothing stored for a migration to rewrite and no tombstone. -->

**BREAKING** for a cloud-managed environment (`OS_CLOUD_MANAGED=1`, set only on hosted containers): membership and membership roles are managed by the organisation that hosts the environment. `POST /organization/remove-member` (Remove Member) and `POST /organization/update-member-role` (Change Role, and Make Owner, which calls it) refuse every request with `409 RESOURCE_CONFLICT` and write nothing, as `POST /organization/invite-member` already did; the three row actions are hidden there.

Who moves: an owner (or administrator) of a cloud-managed environment who changed membership from inside the environment. Remove the person, or change their role, in the hosting organisation instead.

Unchanged: every self-hosted deployment (the variable unset), where both doors answer as before; and `POST /organization/add-member`, which stays open on a managed environment to a platform administrator, to restore a membership the environment lost.
