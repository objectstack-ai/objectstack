---
'@object-ui/app-shell': patch
---

fix(app-shell): the condition builder offers `user.isPlatformAdmin` instead of `user.isAdmin` and `user.role`

Clause-②: no
Metadata-protocol: none

The no-code condition builder's subject list offered `user.isAdmin` and `user.role`. Neither builds an admin gate. `user.isAdmin` is not a member of the identity the browser evaluates against, so a row on it faults: a field or action `visible` gate then shows the item to everyone, and a navigation gate hides it from everyone. `user.role` is better-auth's legacy scalar, which ObjectStack never writes and which reads `user` for a signed-in platform admin too.

The list now offers `user.isPlatformAdmin`, the platform-admin flag the identity carries on every branch (`false` when signed out), and no longer offers `user.role`. The raw editor's example placeholder teaches `user.isPlatformAdmin` as well. A stored condition on either old subject still opens in row mode with its subject intact and is never rewritten. A new test evaluates every offered `user.*` subject against the real expression scope, so the list cannot drift from it again.
