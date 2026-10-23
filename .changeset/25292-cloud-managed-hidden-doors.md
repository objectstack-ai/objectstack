---
'@objectstack/platform-objects': patch
---

feat(platform-objects): the console hides the six doors that add people while `features.cloudManaged` is on

Clause-②: no
Metadata-protocol: none

A cloud-managed environment's people arrive from the organisation's identity provider, so the console no longer offers the ways to add them by hand there. While `GET /api/v1/auth/config` serves `features.cloudManaged: true`, these actions are hidden:

- `invite_user` on `sys_user`, `sys_member`, `sys_invitation` and `sys_organization`;
- `sys_user.create_user`;
- `sys_user.set_user_password`. This one is hidden in the console only: the server keeps answering it for a local (`env_native`) account, so the break-glass admin stays editable.

Each action keeps the gate it already had (`organization` or `admin`), and the new gate is added beside it, so nothing changes where the flag is off.
