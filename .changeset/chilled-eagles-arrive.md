---
"@objectstack/client": patch
---

`auth.login` and `auth.register` now deliver the `SessionResponse` envelope they declare.

Both methods annotate their return as `SessionResponse`, whose base `BaseResponseSchema` declares
`success` as a required boolean. Both carried an inline lift that filled `data` and never wrote
`success`, so neither delivered the type it advertises and every consumer keying on the envelope
flag — `ObjectStackClient.unwrapResponse` keys on exactly this — read `undefined` rather than
`true` or `false`. They now run the same lift `auth.me` / `auth.refreshToken` use, so the family
cannot deliver two different envelopes again.

The credential is unchanged: `data.token` is still the token the route puts in the response body,
byte-identical, and `login` / `register` still arm the client's bearer token from it.

Known residue, unchanged by this release: `data.session` is still absent from what these two
methods return. `POST /sign-in/email` and `POST /sign-up/email` serve no session object, id or
expiry in the body or in any header, so the member is not obtainable without a second
`GET /get-session` call — read it from `auth.me()`. Nothing is synthesized in its place.
