---
'@objectstack/platform-objects': patch
---

fix(platform-objects): the `sys_session.revoke_reason` description names `admin_password_reset`, the value an administrator's forced password reset writes on the sessions it revokes. Description text only; nothing is accepted or refused differently.
