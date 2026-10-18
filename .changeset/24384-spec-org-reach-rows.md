---
'@objectstack/spec': minor
---

`MEMBERSHIP_REACH` (`@objectstack/spec/identity`) gains two rows, so `requiresMembershipReach` accepts two more names: `update_organization` (better-auth's `/organization/update`, statement `organization: ['update']`, reached by `owner` and `admin`) and `delete_organization` (`/organization/delete`, statement `organization: ['delete']`, reached by `owner` alone). Both are read off better-auth's own default role statements, like the existing rows, and plugin-auth's reach-table test holds each equal to the installed vendor door. An action declaring `requiresMembershipReach: 'update_organization'` is lowered to `visible: "'org_owner' in current_user.positions || 'org_admin' in current_user.positions"`; `'delete_organization'` lowers to `"'org_owner' in current_user.positions"`. Existing rows and their lowering are unchanged.

`PUBLIC_AUTH_FEATURES.multiOrgEnabled.gatedInputs` no longer lists `sys_organization.actions.change_slug`, because the platform object no longer declares that action (see `@objectstack/platform-objects`).

Clause-②: yes (widening)
