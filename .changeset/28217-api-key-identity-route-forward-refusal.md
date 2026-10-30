---
'@objectstack/runtime': patch
---

fix(runtime): an API-key caller of an api action whose target is an identity route is refused by name, before the forward

Clause-②: no (a call that was already refused now says why and is refused before its target is called; no credential is newly accepted anywhere, and no error code, status name, answer member or package export is added)
Metadata-protocol: none

A same-origin `type: 'api'` action is forwarded by the action doors (`POST /actions/:object/:action` and MCP `run_action`) with the caller's own credentials, so its target authorizes the same principal the door admitted. An identity route (under `/api/v1/auth/`, for example the `sys_user` Ban User action's target) reads its caller only from its own signed-in session and admits no API key. So a caller the door admitted by API key reached it as nobody, and got the identity route's anonymous `401` ("Sign in first") although it had authenticated.

- **Now.** Both doors refuse that call before the target is called, with `401` and the standard `UNAUTHENTICATED` code, and a sentence naming the action, its identity endpoint, and that the endpoint accepts a signed-in session only, not an API key. Nothing is run.
- **Unchanged.** Which credentials an identity route accepts. A signed-in session (session token or cookie) is forwarded to it through the door exactly as before, and an API-key caller is still forwarded to every other target (the data door, a declared endpoint) and served.
