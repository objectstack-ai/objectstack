---
"@objectstack/spec": minor
"@objectstack/plugin-security": minor
---

fix(plugin-security,spec): the `403 PERMISSION_DENIED` from the object CRUD gate stops handing a business user internal authorization vocabulary

An operation the caller's permission sets do not grant is correctly refused with
`403 PERMISSION_DENIED`, and the transport was never the problem. What reached
the end user was: `Error.message` is the body's human-readable string on every
transport (`mapDataError`'s `body.error`, the dispatcher's `error.message`) and
Console renders it verbatim in a toast. So an operator in a fully localized app
read

```
[Security] Access denied: operation 'delete' on object 'app_child_object'
is not permitted for positions [org_member, everyone]
```

English-only; naming a table they have never seen; ending in `positions [...]`,
internal authorization vocabulary that reads as a contradiction to someone who
does hold rights on the record they clicked. It is not confined to obviously
unauthorized actions either — `cascadeDeleteRelations` re-authorises every
cascade CHILD independently, so an ordinary delete of a parent the app
deliberately granted can surface a 403 naming a child object the operator never
addressed.

The error now carries two messages because it has two audiences:

- `message` — the user's half, rendered in `ExecutionContext.locale` through the
  shared operation-message catalog (`@objectstack/spec/system`, the mechanism
  built for `DELETE_RESTRICTED`), overridable per deployment under
  `errors.permission_denied`. It names no object, no operation and no position,
  in any of the four shipped locales.
- `developerMessage` — the developer's half, the previous sentence byte for
  byte. It is LOGGED at the throw site, not shipped to the client.

That last point is where this deliberately diverges from its sibling.
`DELETE_RESTRICTED` ships its developer half over the wire because the same body
already carries the API names it mentions; the 403 body does not. REST's
`mapDataError` builds `{ error, code, object? }` for a permission denial and
never reads `error.details`, so the positions, the operation and (on a cascade)
the child object's API name reach a client through nothing but the message —
shipping a `developerMessage` there would have ADDED a disclosure rather than
removed one. `developerMessage` is therefore a sibling of `details`, never a
member of it, because `details` is the field the runtime dispatcher serialises.

Enforcement is untouched: same 403, same `PERMISSION_DENIED`, same decision
logic, and the structured `details` payload (`operation`, `object`, `positions`,
`permissionSets`) is byte-identical to before.
