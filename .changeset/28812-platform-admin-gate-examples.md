---
'@object-ui/core': patch
---

docs(core): the README's `evaluateExpression` example gates on `user.isPlatformAdmin`, not `user.role === "admin"` (objectstack#28812)

Clause-②: no
Metadata-protocol: none

The example taught `${user.role === "admin"}` as the admin check. `user.role` is better-auth's legacy `sys_user.role` scalar: ObjectStack never writes it, and with the admin plugin on it reads `user` for every user, a platform admin included, so a predicate copied from the example never opens for the people it means. The example now evaluates `${user.isPlatformAdmin === true}`, the documented platform-admin signal (`current_user.isPlatformAdmin == true`, ADR-0068 D4). No code, export or behaviour changes.
