---
'@objectstack/formula': minor
'@objectstack/spec': patch
---

feat(formula): `current_user.hasCapability(name)` — a page predicate can ask whether the viewer holds a system capability, from the same list the action gate reads

Clause-②: yes (widening)

- **The predicate.** The CEL standard library registers `hasCapability` beside `can`, receiver-only, so the one spelling is `current_user.hasCapability('<name>')` (the `user` / `ctx.user` / `os.user` aliases work too). It answers `true` when the name is in the acting subject's held system capabilities and `false` when it is not. A name no action declares is just a string: there is no registry lookup.
- **The data.** `EvalContext` gains `systemPermissions` (type `EvalSystemPermissions`, a list of capability names): the `systemPermissions` array of the published `/auth/me/permissions` response, unchanged — the list an action's `requiredPermissions` is checked against (ADR-0066 D4). `PermissionBinding` gains the same field, optional. Pass it beside `permissions`:

  ```ts
  celEngine.evaluate(expr, { user, permissions: toEvalPermissions(me.objects), systemPermissions: me.systemPermissions });
  ```

- **Loud, like `can`.** With no `systemPermissions` on the context the call fails (`ok: false`, `kind: 'runtime'`) rather than answering; an empty list is a real answer and evaluates to `false`. A non-list, a non-string or empty name, or a receiver that is not the acting subject fails the same way. A bare `hasCapability(name)` does not resolve.
- **The authoring gate.** The visibility-predicate rule's function-existence check reads the evaluation environment, so a page `visibleWhen` calling `current_user.hasCapability(…)` now passes `os validate`, `os lint` and `os build`, where before it was refused as an unknown function (`visibility-predicate-unknown-function`). An invented sibling (`hasCapabilities`) is still refused.
- **`can` points at it.** `current_user.can(object, verb)` with a verb outside the object-permission vocabulary still fails, and its message now names `current_user.hasCapability('<name>')` for a capability question.
- **Docs.** The page component `visibleWhen` describe names `current_user.hasCapability('<name>')` as the way to gate a component on a capability: `visibleWhen` hides, `requiredPermissions` refuses.
- **Hosts.** A host that evaluates page predicates supplies the list for the predicate to answer; one that does not makes it fail, and a failing page `visibleWhen` renders the component.
