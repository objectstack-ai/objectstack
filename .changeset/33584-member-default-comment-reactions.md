---
'@objectstack/plugin-security': patch
---

fix(plugin-security): `member_default` grants read and create on `sys_comment_reaction`, so a stock member can react to the comments they can read

Clause-②: no
Metadata-protocol: none

The record page offers every member a reaction control on each comment, but no shipped permission set named `sys_comment_reaction`, so a member with only the platform baseline was refused (`403`) both adding a reaction (`POST /api/v1/data/sys_comment_reaction`) and listing them. `member_default` now carries `sys_comment_reaction` with read and create only. No row policy is added, and edit and delete stay off.

Which rows a member reaches is unchanged and is still `@objectstack/plugin-audit`'s comment gate: reactions are listed and read only on comments the caller can read, a reaction on any other comment is refused (`403 RECORD_NOT_ACCESSIBLE`), and `user_id` is taken from the session. A member removes only their own reaction, through `DELETE /api/v1/comments/reactions/:id`. Another member's reaction is refused there (`403`) and on the data door, which needs a delete bit the baseline does not carry.

`external_default` is unchanged: a portal user still needs an explicit grant to react.
