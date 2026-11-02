---
'@objectstack/spec': patch
---

docs(spec): `ConnectorConnectionState.status` no longer says a connection with no refresh token is marked because its access token expired

Clause-②: no
Metadata-protocol: none

Comment only. The `reconnect_required` JSDoc said such a connection "keeps nothing to renew an expired access token with". A refresh also runs on a cache miss (a fresh replica, or a `revision` another replica moved) and on a dispatch's 401, so a connection with no refresh token, or no client to refresh with, is marked even while its access token is still valid. The JSDoc now reads "keeps nothing to renew an access token it has to renew with", the wording the runtime's own `markReconnectRequired` doc and the `sys_connector_connection.status` description use, and the sense of the `status_reason` the runtime stores ("an access token the connection has to renew cannot be renewed").
