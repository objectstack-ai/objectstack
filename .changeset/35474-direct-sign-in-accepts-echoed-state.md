---
'@objectstack/plugin-auth': patch
---

fix(auth): the direct sign-in door accepts the `state` an identity provider passes back after a sign-out

Clause-②: no
Metadata-protocol: none

With direct sign-in on and `afterSignOut: 'identity-provider'`, a sign-out that carried a `state` came back from the identity provider's logout to `GET /api/v1/auth/sign-in/direct?state=…`, and the door answered `400 VALIDATION_ERROR` instead of showing the identity provider's sign-in page, so the person was left on an error. The door now accepts one `state` and ignores it: it starts a new sign-in with its own state, as it does without one. A `state` sent twice is still refused `400`, like a repeated `callbackURL`, and any other unknown query parameter is refused as before. The shipped Console sends no `state`, so its sign-out is unchanged.
