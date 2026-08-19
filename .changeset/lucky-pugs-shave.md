---
'@objectstack/plugin-auth': patch
---

Platform admins can ban and unban users again.

`POST /api/v1/auth/admin/ban-user` and `POST /api/v1/auth/admin/unban-user` are
now served by ObjectStack with the ADR-0068 platform-admin gate instead of
better-auth's `admin` plugin, which authorizes on the legacy
`user.role === 'admin'` scalar that ADR-0068 D2 stopped synthesizing. On any
deployment with the admin plugin on (SCIM forces it, ADR-0071) the `sys_user`
Ban / Unban actions returned `403 YOU_ARE_NOT_ALLOWED_TO_BAN_USERS` for every
platform admin; they now succeed, and refuse a plain member with
`403 PERMISSION_DENIED` and an anonymous caller with `401 UNAUTHENTICATED`.

The break-glass guard that refuses to ban the last local-password login is
unchanged and still applies.
