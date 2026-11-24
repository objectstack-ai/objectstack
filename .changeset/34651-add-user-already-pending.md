---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

feat(identity): the Add User result says when the address was already pending

Clause-②: yes (widening)
Metadata-protocol: none

On a cloud-managed environment, Setup → Users → Add User now says when the address you added was already waiting for its first sign-in, including when you sent only an email. Before, that answer looked exactly like a fresh add.

- `POST /api/v1/auth/admin/add-sso-user` answers `pendingAgain: true` on a re-add of a person who is still pending, and leaves the key out on a fresh add. It never answers `false`. `alreadyPending` is unchanged and is still on every answer, so nothing an API reader reads today changes.
- The `sys_user.add_sso_user` result dialog gains an "Already pending" row that reads `pendingAgain`. The dialog skips a field whose path is absent from the answer, so the row is drawn only on a re-add; a fresh add shows no `false` row.
