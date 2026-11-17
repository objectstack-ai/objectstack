---
'@objectstack/spec': patch
'@objectstack/runtime': patch
---

feat(spec,runtime): an AI route's `req.user` says who is acting and which credential admitted them

Clause-②: yes
Metadata-protocol: none

A door reserved to the person, such as the in-app approval of a pending action that only the person the call ran as may give, can now tell an impersonating administrator or an API key from the person, without reading request headers.

- `@objectstack/spec/contracts` declares the AI-route caller: `AIRouteUser`, the `req.user` an AI route handler receives (the `EvalUser` core, the id and display-name aliases, the two authority channels), and two new facts on it, `impersonatedBy` and `credential`. `AIRouteCredentialKind` is the credential vocabulary: `session`, `api_key` or `oauth`.
- `@objectstack/runtime` fills both on every AI route. `impersonatedBy` is the session's impersonating administrator (`ExecutionContext.impersonatedBy`), carried as is; it is a fact the door judges, never the authorization subject, and absent when the user acts themselves. `credential` is `session` for a signed-in session whether its token rides in the cookie or in an `Authorization: Bearer` header, `api_key` for an API key, and `oauth` for an OAuth token or the in-process forward of an OAuth-connected agent; it is absent when the request recorded no admitting credential, which a door reads as "not a session". Ruled on #34184 (record 6942875153): Q1 A, Q2 A.

Nothing changes for an existing handler: both keys are new, and every other key of `req.user` keeps its value. The REST `/actions` and MCP `run_action` `ctx.user` are unchanged.
