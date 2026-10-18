---
'@objectstack/runtime': patch
---

Clause-②: no

Six user-facing strings the runtime's HTTP doors answer no longer call the system the caller is in
"this environment". The permission-set clone door's success notice (`PERMISSION_SET_CLONE_NOTICE`, the
`notice` beside the copy) now says the copy is "a new permission set authored in this system", the
wording the console's clone hint uses. The other five drop the noun: `/mcp` and `/mcp/skill` on a
deployment that opts out answer `404` "MCP server is not enabled"; a share-link request with no
share-link service answers `501` "Sharing is not configured"; and webhook redelivery answers `501`
"Webhook redelivery is not available: no webhooks service is registered. …" or "… the registered webhooks
service does not implement handleRedeliver." Only the human-readable text moves: every HTTP status,
error code and response shape is what it was.
