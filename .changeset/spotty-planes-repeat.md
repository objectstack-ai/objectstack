---
'@objectstack/plugin-auth': patch
---

`POST /api/v1/auth/admin/revoke-user-session` no longer reports success when it revoked nothing. When the supplied `sessionToken` does not identify any live session — including a session that was already revoked — the endpoint now answers `404` with error code `RESOURCE_NOT_FOUND` (ADR-0112 envelope) instead of `200 { "success": true }` over a delete that removed no record. The refusal is only ever given to callers who pass the admin plugin's own `session: ["revoke"]` permission check; unauthenticated and unauthorized callers keep the previous `401`/`403` answers byte-for-byte, so no session-existence information is exposed below the permission line. A revoke that does identify a live session still answers `200 { "success": true }` and tombstones the session with reason `admin`, unchanged.
