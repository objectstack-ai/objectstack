---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/plugin-security': minor
'@objectstack/plugin-auth': minor
'@objectstack/platform-objects': minor
---

feat: an `external` organization role for portal users, who read their own identity rows and reach data only through explicit grants

Clause-②: yes (widening)
Metadata-protocol: added

A supplier's or a customer's portal user can now be added to an organization with the `external` role. It is a member of the organization (it has a `sys_member` row) but a separate population: before this change such a user had to be a plain `member`, and the member baseline's fellow-member scope let it read every employee and every other supplier's users through `GET /data/sys_user`.

- **`@objectstack/spec`:** `MEMBERSHIP_ROLE_EXTERNAL` (`'external'`) joins the closed membership-role vocabulary, with an `External` option. It projects to the new reserved identity `BUILTIN_IDENTITY_ORG_EXTERNAL` (`'org_external'`), and its invitation grant row is `'any'`, because it confers less than `member`.
- **`@objectstack/core`:** the authorization resolver reads the stamp from `sys_member.role` in the active organization. An `external` holder holds `org_external` and not the `everyone` anchor, so the deployment's defaults bound there (`member_default`, an app's `isDefault` set, accepted package defaults) do not reach it. The stamp is per organization, and with no active organization an external membership withholds the anchor.
- **`@objectstack/plugin-security`:** a new shipped set, `external_default`, is bound by the `org_external` position. It carries `member_default`'s own-row self-service grants without the fellow-member directory scope, plus the holder's own `sys_member` row. The plugin's additive baseline is swapped for it on an external context.
- **`@objectstack/plugin-auth`:**
  - better-auth registers `external` beside owner/admin/member, with no organization statement.
  - A role list carrying `external` with another role is refused at write on `sys_member` and `sys_invitation` (`400 VALIDATION_FAILED`, `invalid_value` on `role`).
  - An external is never placed in the organization's business units. A business-unit membership, a position anchored at one of its units, an invitation conferring `external` with a `business_unit_id`, and a change to `external` while a placement stands are all refused. An organization-wide position or a permission set is how an external gets access.
  - `GET /organization/list-members` and `GET /organization/get-full-organization` answer an external caller its own member row and the invitations addressed to its own email only.
- **`@objectstack/platform-objects`:** the `External` option label on the membership role pickers, translated.

`org_external` is a reserved name from this release on, so a position can no longer be named `org_external`.
