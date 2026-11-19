---
'@objectstack/platform-objects': patch
---

feat(platform-objects): Setup → Users can take a pending person back out on a managed environment

Clause-②: no
Metadata-protocol: none

`sys_user` gains a row action, `remove_sso_user` (Remove Pending User), on the Users list row and the user record header. It posts the row's id as `userId` to plugin-auth's `admin/remove-sso-user`, which removes a person added ahead of their first sign-in and cancels their invitation at the hosting organization. It is offered only where that door answers: to a platform administrator, on a cloud-managed environment, on a row that is still pending (`source` is `idp_pending`). A confirmation dialog asks first and says that no one is removed when the person has signed in meanwhile or the hosting organization cannot be reached. The door itself is unchanged. Its labels are added to the translation bundles, translated for zh-CN, ja-JP and es-ES.
