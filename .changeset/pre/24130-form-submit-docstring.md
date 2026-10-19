---
'@objectstack/rest': patch
---

docs(rest): the public form routes' docstring says what authorizes an anonymous submit — the form's own declaration (`publicFormGrant`), not a `guest_portal` permission set — and that nothing falls open without one (#24130)

Clause-②: no

The docstring of `RestServer#registerFormEndpoints`, which ships in `@objectstack/rest`'s published declarations, said the submit route delegates security to a `guest_portal` permission set on its execution context, that a deployment without that set "falls open", and that secure-by-default deployments must pair the form routes with one. None of that is what runs. The submit hands the engine a `publicFormGrant` scoped to the form's target object, and the security plugin admits on that grant alone, before any permission set resolves: the create and the read-back on that object only, every other operation and object refused, the server-managed anchors stripped from the payload. The grant never falls open and admits the same operations whether or not a `guest_portal` set is registered. The docstring now says this, and says what the `guest_portal` name on the context does reach: where a deployment registers a set under it, that set is what the grant's result masker reads over the record the grant hands back, and the submit answers the created id only.

Text only; nothing the form routes do changes.
