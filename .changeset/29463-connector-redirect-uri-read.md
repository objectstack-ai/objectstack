---
'@objectstack/service-automation': patch
---

feat(automation): the connector connection read answers the deployment's OAuth `redirectUri`, and a client-less reconnect of an installer-client instance reuses the kept client

Clause-②: yes (widening)
Metadata-protocol: none

Two answers an administrator connecting an `oauth2` `authorization_code` instance with `clientSource: 'installer'` needs from the connector connection door (`/api/v1/automation/connectors/NAME/connection`):

- **`GET` answers `redirectUri`.** The connection read (`getConnectorConnection`) now sets `ConnectorConnectionState.redirectUri`, the redirect URI the administrator registers with the vendor before any client exists, whatever the connection's `status`. It is the same derivation a begun connect uses: the automation plugin's `connectorOAuthRedirectUri` option, else `/api/v1/automation/connectors/oauth/callback` under `OS_AUTH_URL`, else under `OS_BASE_URL`. With no base to derive it from, the key is absent and the read still answers its status; it is never guessed from the request. A begun connect in that case is refused `503` as before.
- **A reconnect without a client keeps the stored one.** A `POST` that names no client, on an instance that takes the installer's client, now reuses the client the organization's connection keeps (the secret is never read back, so the Console cannot resend it). With no kept client (a first connect, or after a revoke) it is refused `400 VALIDATION_ERROR` as before, and a `POST` that names a client replaces the kept one as before.
