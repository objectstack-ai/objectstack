---
'@objectstack/plugin-security': minor
---

feat(plugin-security): organization administrators assign positions and permission sets to their own members, inside the organization boundary

Clause-②: no

ADR-0090 D12 (as amended for ADR-0131 D3) names three kinds of administrator. This release enforces the second one, the organization administrator: a holder of `organization_admin` or `organization_admin_no_bypass` for the active organization who is not a platform administrator.

- **What an organization administrator may now do.** Create and remove `sys_user_position` and `sys_user_permission_set` rows of its own organization, for that organization's members. Every permission set the row distributes must be inside the organization boundary: the granted set, or each set the assigned position carries (including the set of the position's own name). A set is inside when its `objects['*']` entry carries neither `viewAllRecords` nor `modifyAllRecords`, it has no `adminScope`, and every name in its `systemPermissions` is a capability declared `scope: 'org'`. `admin_full_access`, both organization-administrator sets and the three MCP agent ceilings are outside by name. An assignment row is never edited in place: remove it and create the one you mean. A row inserted with no organization lands in the caller's organization.
- **What is refused, and how.** An out-of-boundary write answers `403 PERMISSION_DENIED`, and the message names the set and the condition it failed. The same refusal covers a row of another organization, removal of an organization-less row, a business unit of another organization, an edit in place and a filter delete. Assigning a user who is not a member of the organization is refused `400 VALIDATION_FAILED` as before, for every writer. So is assigning a built-in identity position (`platform_admin`, `org_owner`, `org_admin`, `org_member`). Organization membership rows stay platform-administrator-only.
- **Overrides.** `organization_admin`, and so `organization_admin_no_bypass`, now carries `allowCreate` and `allowDelete` on both assignment tables. `allowEdit` stays `false`.
- **The two doors.** `GET /security/my-delegable-scope` reports an organization administrator with `isTenantAdmin: false`, every unit of its organization as placeable, and only in-boundary positions as assignable. The walled `organization_admin` was reported as tenant-level before. Explaining another user's access now admits an organization administrator explaining a member of its own organization.
- **Unchanged.** Platform administrators keep today's behaviour. Delegated (`adminScope`) administrators keep D12's subtree, allowlist and strict containment. Everyone else is denied as before. No spec key, no endpoint and no membership-model change.
