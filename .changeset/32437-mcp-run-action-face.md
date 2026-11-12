---
'@objectstack/mcp': patch
---

fix(mcp): `run_action` takes the face `list_actions` lists, so an action bound to several objects can be run by its listed row

Clause-②: yes (widening)
Metadata-protocol: none

`list_actions` lists one row per binding, so a name the platform binds to several objects, such as `invite_user` on `sys_user`, `sys_organization`, `sys_member` and `sys_invitation`, appeared four times. The bare name was refused as ambiguous, and the one identifier each row carried that names its binding, its ADR-0150 D6 `face` (`sys_member-invite_user`), answered `RESOURCE_NOT_FOUND` from `run_action`.

`run_action` now takes a listed face as `actionName`. The face is read back against the caller's own `list_actions` rows, with the same visibility filter and the same refused-face rule, and that one binding runs by its name, `objectName` and `namespace`. A face the caller's listing does not carry answers `RESOURCE_NOT_FOUND` (404) and nothing runs. A face sent with an `objectName` or `namespace` that names another binding answers `VALIDATION_ERROR` (400). Both tool descriptions now say to pass the row's face when a name is listed on several rows.

Unchanged: the listed rows, a call by name with `objectName` or `namespace`, a unique bare name, and the refusal of an ambiguous bare name. No action name can contain `-`, so a face never collides with a name.
