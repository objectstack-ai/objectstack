---
'@objectstack/platform-objects': patch
---

fix(platform-objects): the Setup Users list and the user record's highlight chips stop showing better-auth's legacy `role` scalar as the platform role (#28105)

Clause-②: no
Metadata-protocol: none

`sys_user.role` is the column better-auth's admin plugin needs. ObjectStack never writes it: when the plugin is off it is empty, and when it is on the plugin stamps `user` on every new user, the seeded platform admin included. Platform-admin standing comes from ADR-0068 D2 (the `OS_PLATFORM_OWNER_EMAIL` list, or an unscoped `admin_full_access` grant under the `single` posture), not from this column. So a "Platform Role: user" cell on a platform admin was wrong, and it read as authoritative to people and to agents.

- **Users list.** The `all_users` view drops the `role` column. Its columns are now name, email, phone, email verified, banned, identity source and created. `banned` stays (#27863).
- **User record page.** The `record:highlights` chip strip on `sys_user_detail` drops `role`. It shows email, phone and email verification. The details grid still hides `role`, so the record page does not draw it.
- **The field is unchanged.** `sys_user.role` stays a readonly text field in its Admin group, with the same label, storage and description, readable through the data API. Nothing synchronises platform-admin standing into it, and the better-auth `defaultRole` stamp and the import / create-user pass-through are untouched.

A list column that shows real platform-admin standing is tracked separately (#28793).
