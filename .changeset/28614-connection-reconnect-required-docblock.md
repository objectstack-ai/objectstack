---
'@objectstack/spec': patch
---

Clause-②: no
Metadata-protocol: none

`ConnectorConnectionState.status`'s docblock no longer says `reconnect_required` means only that the authorization server refused the grant. It now names every way the grant stops working: the authorization server refused it on refresh, the connection keeps nothing to renew an expired access token with (no refresh token was issued, or no client to refresh with), or the upstream refused the connection's token while an `mcp` instance discovered its tools; `statusReason` says which. Comment only; no behaviour change.
