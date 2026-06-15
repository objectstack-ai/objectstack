---
"@objectstack/plugin-auth": patch
---

auth: expose `isPlatformAdmin` on the customSession user payload

The session already derives a coarse `admin` role for platform admins or
active-org admins, but never surfaced the underlying platform-admin signal.
Console action `visible` CEL predicates need it to gate platform-admin-only
object actions (e.g. `sys_environment.change_plan`) without hiding org-admin
actions. Both `customSession` return paths now carry the boolean; org-admins
who are not platform admins correctly get `isPlatformAdmin: false`.
