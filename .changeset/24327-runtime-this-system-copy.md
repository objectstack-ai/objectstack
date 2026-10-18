---
'@objectstack/runtime': patch
---

Clause-②: no

Ten user-facing strings the runtime's HTTP doors answer no longer call the system the caller is in
"this environment". The permission-set clone door's success notice (`PERMISSION_SET_CLONE_NOTICE`, the
`notice` beside the copy) now says the copy is "a new permission set authored in this system", the
wording the console's clone hint uses. The other nine drop the noun: `/mcp` and `/mcp/skill` on a
deployment that opts out answer `404` "MCP server is not enabled"; a share-link request with no
share-link service answers `501` "Sharing is not configured"; and the webhook-redelivery, approval
action-page and inbound automation-hook doors answer `501` "… no webhooks service is registered." (or
approvals, or trigger-api) when the service is missing, and "… the registered webhooks service does not
implement handleRedeliver." (or `handleActionPage`, or `handleInboundHook`) when it lacks its member.
Only the human-readable text moves: every HTTP status, error code and response shape is what it was.
