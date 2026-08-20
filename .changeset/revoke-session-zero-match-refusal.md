---
'@objectstack/plugin-auth': patch
---

`POST /api/v1/auth/revoke-session` no longer reports success when it revokes nothing. A request whose `token` does not identify a session belonging to the caller now answers `404` with error code `RESOURCE_NOT_FOUND`, instead of `200 { status: true }` over a skipped delete. A token that matches nothing and a token that belongs to another user answer identically, so the refusal discloses no session-existence information. Requests that do identify the caller's own session are unchanged and still answer `200 { status: true }`.
