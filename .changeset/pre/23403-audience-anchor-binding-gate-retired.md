---
'@objectstack/plugin-security': patch
---

refactor(plugin-security): the audience-anchor binding gate on `sys_position_permission_set` is deleted

Clause-②: no

`SecurityPlugin`'s private engine-middleware gate that refused binding a high-privilege permission set to the `everyone` or `guest` position guarded writes to `sys_position_permission_set` only. C3 stage 8 (#23222) unregistered that object, so no write has reached the gate since. The gate, its call in the middleware and its three unit cases are removed.

No behaviour changes, and nothing exported changes. The anchor tier itself (`describeAnchorForbiddenBits` from `@objectstack/spec/security`) still applies wherever a binding is made: when an `everyone` suggestion is confirmed (`confirmAudienceBindingSuggestion`), and on every derivation of the `everyone` anchor. No door binds a set to `guest`.
