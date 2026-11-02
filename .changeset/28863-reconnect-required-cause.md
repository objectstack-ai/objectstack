---
'@objectstack/service-automation': patch
---

fix(service-automation): a connection marked "reconnect required" says the cause that actually happened (#28863)

Clause-②: no — prose, and the stored `status_reason` text of two refresh paths. No accept set, status value, error code or export changes meaning.
Metadata-protocol: none

A connector connection becomes `reconnect_required` four ways: the authorization server refuses the grant on refresh (`invalid_grant`); it issued no refresh token; the connection keeps no client to refresh with; or the upstream refuses the connection's token while an `mcp` instance discovers its tools. The connection's stored reason, the `sys_connector_connection.status` field help and the `ConnectorConnectionStore#markReconnectRequired` docblock all named only the first.

- **The stored reason, per path.** `reconnectRequiredReason` takes an optional cause (`'refused'`, `'no_refresh_token'`, `'no_client'`; `'refused'` when none is given, the old sentence unchanged). The no-refresh-token path now stores "…its authorization server issued no refresh token, so an access token the connection has to renew cannot be renewed…", and the no-client path "…its connection keeps no client to refresh with, so an access token it has to renew cannot be renewed…". Neither says the server refused anything, and neither says the access token expired: a refresh also runs on a cache miss and on a dispatch's 401, while the token may still be valid. The dispatch's 503 refusal carries the same sentence.
- **The field help and the docblock** list all four causes and point to `status_reason` for which one happened.
- Unchanged: the refused path's sentence, the MCP discovery path's own reason, and every status, code and write.
