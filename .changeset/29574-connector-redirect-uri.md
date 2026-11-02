---
'@objectstack/spec': patch
---

feat(spec): `ConnectorConnectionState` declares `redirectUri`, the deployment's derived OAuth redirect URI

Clause-②: yes (widening)
Metadata-protocol: none

An administrator connecting an `authorization_code` connector instance with an installer-supplied client (`clientSource: 'installer'`) must register this deployment's redirect URI with the vendor before there is a client to connect with. The server derives that URI, but no answer carried it. `ConnectorConnectionState` (`@objectstack/spec/contracts`) now declares one optional key for it:

- **`redirectUri?: string`** is the absolute URL of `GET /api/v1/automation/connectors/oauth/callback`, derived by the server and fixed per deployment: the automation plugin's `connectorOAuthRedirectUri` option, else that path under `OS_AUTH_URL`, else under `OS_BASE_URL`. It is never taken from a request, and no connection request takes it.
- **Present** on the connection read (`getConnectorConnection`) whenever the server can derive it, whatever the connection's `status`. **Absent** when the deployment has no base to derive it from (a connect is then refused `503`), and never guessed from the request's origin. Only an `authorization_code` instance has a connection, so no other grant carries it.
- **Declared ahead of the service.** This release adds the contract only: until the automation service sets the key, no answer carries it. Nothing an implementer or caller writes today stops compiling.
