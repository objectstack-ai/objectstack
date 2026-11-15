---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): `POST /api/v1/auth/admin/create-user` reports the membership the store holds for the new account

Clause-②: no
Metadata-protocol: none

`membershipCreated`, in the answer and in the `user.admin_created` audit row, now says the new account holds a membership after the call, whichever writer made the row during this creation. The account did not exist before the call, so any membership it holds was made by this creation.

- Single-org posture: the `user.create.after` membership reconciler (the default-organization join) binds the new user while the account is being created, so the endpoint's own reconcile finds the row and yields. That used to answer `membershipCreated: false` next to the `organizationId` while `sys_member` held the row; it now answers `true`. When the endpoint inserts the row itself it answers `true`, as before.
- Multi-org (walled) posture: a row already in the administrator's current organization is still respected (no second add-member), and is now reported as `membershipCreated: true` for the same reason.
- Unchanged: under `membershipPolicy: 'invite-only'` on the single-org posture the answer and audit row carry no `organizationId` and `membershipCreated: false`, and no `sys_member` row is written. A bind that fails, finds no target organization, or meets an AI service account still answers `false`.
