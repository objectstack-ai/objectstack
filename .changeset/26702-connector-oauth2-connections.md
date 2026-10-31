---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
'@objectstack/runtime': minor
---

feat(service-automation): `oauth2` connector instances are served per dispatch, and an administrator connects an `authorization_code` one for their organization (ADR-0143 S1, part of #26702)

Clause-②: yes
Metadata-protocol: added

ADR-0143 S0 (#28137) let a declarative connector instance declare `auth: { type: 'oauth2', ... }`, and this server held every such instance degraded. This slice serves it.

- **`@objectstack/service-automation`**: an `oauth2` instance is materialized with a `credentialHandle` and no static `auth` (D4). The handle obtains the access token from `tokenUrl` (a confidential client authenticates with HTTP Basic, a public client sends its `client_id`), keeps it in memory only, refreshes it within the 30-second skew margin and once on a `401`, and shares one token request among concurrent dispatches. With a cluster service a refresh runs under the cluster lock. An unreachable or `5xx` token endpoint is `CONNECTOR_UPSTREAM_UNAVAILABLE`.
  - `client_credentials` needs nothing more than the client secret its `credentialRef` names.
  - `authorization_code` keeps its refresh token in a new object, `sys_connector_connection` (D3): one row per organization and instance, the token a `Field.secret`, never an access token, never a sign-in account (D6). An instance nobody connected is degraded "not connected", never a failed boot. A refused grant (`invalid_grant`) marks the row `reconnect_required` and degrades the instance until it is connected again. A dispatch uses its run's organization's connection; a run with no organization uses the only one, or is refused `422` when there are several.
  - A provider opts in with `registerConnectorProvider(key, factory, { credentialHandle: true })`, saying it asks the handle on every request. An `oauth2` instance on any other provider stays degraded, so it is never called without its token. The built-in `rest`, `openapi` and `mcp` providers do not opt in yet (S2), and `app-credential` stays degraded until S2.
  - A new plugin option, `connectorOAuthRedirectUri`, fixes the redirect URI; otherwise it is `OS_BASE_URL` (or `OS_AUTH_URL`) plus `/api/v1/automation/connectors/oauth/callback`.
- **`@objectstack/spec`**: `IAutomationService` gains four optional members, `getConnectorConnection`, `beginConnectorConnection`, `completeConnectorConnection` and `revokeConnectorConnection`, with their request and result types (`ConnectorConnectionState`, `ConnectorConnectionBegin`, …). `sys_connector_connection` joins the `service-automation` platform object names.
- **`@objectstack/runtime`**: the connection door (D5), every route needing `manage_metadata`:
  - `GET` / `POST` / `DELETE /api/v1/automation/connectors/:name/connection` answer the organization's connection status, begin a connect (a fresh `state` and an `S256` PKCE challenge bound to the caller's user and organization, answered as the vendor's authorization URL), or revoke it. They take no query parameter.
  - `GET /api/v1/automation/connectors/oauth/callback` is the vendor's redirect. Its query set is closed (`code`, `state`, `error`, `error_description`, `error_uri`, `iss`), each parameter once. The `state` is used once, and a callback from another user or organization is refused before its code is exchanged.
  - No answer, refusal or log line carries a token, a code, a verifier or a client secret.
