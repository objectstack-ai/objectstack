---
'@objectstack/spec': minor
'@objectstack/types': patch
'@objectstack/service-automation': patch
---

feat(spec)!: `oauth2` and `app-credential` join declarative connector-instance auth, and the runtime `oauth2` variant is retired (ADR-0143 S0, #28137)

Clause-②: yes (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered connector-auth-config-oauth2-retired -->

An upstream that takes no static credential (an OAuth 2.0 API, a Feishu, DingTalk or WeCom app) had no open-tier way to be declared: the instance `auth` stopped at four static kinds, and the runtime `authentication` shape had an `oauth2` variant that held a client secret and a refresh token inline and that nothing ran. ADR-0143 opens the grant-bearing kinds on the instance, with the secret as a reference.

- **`@objectstack/spec`**: `ConnectorInstanceAuthSchema` gains `oauth2` (D2.1), one strict shape per `grant` (`authorization_code` with PKCE always on, `client_credentials` for a confidential client), and `app-credential` (D2.2, `vendor` `feishu` / `dingtalk` / `wecom`, `appId`, a required `credentialRef`). The publish door refuses a missing `tokenUrl`, `clientId` or `authorizationUrl` at its key under `auth`, except on `provider: 'mcp'` over `http`, where the MCP authorization flow discovers them. An inline `clientSecret`, `refreshToken`, `accessToken` or `appSecret` is refused by name with the `credentialRef` prescription. `signed` is not a member (#26710). `ConnectorOAuth2Schema` is removed from `ConnectorAuthConfigSchema` (D7), and `ResolvedConnectorAuth` stays the four static kinds. The per-dispatch handle types (`ConnectorCredentialHandle`, `BorrowedConnectorCredential`, `BorrowedConnectorAuth`, `ConnectorCredentialRequest`) move into `@objectstack/spec/integration`, and `ConnectorProviderContext` gains an optional `credentialHandle` (D4). The D3 entry `connector-auth-config-oauth2-retired` names the removal for `os migrate meta`.
- **`@objectstack/types`**: re-exports the four handle types from `@objectstack/spec/integration`; the same names, structurally unchanged.
- **`@objectstack/service-automation`**: this server does not run the per-dispatch token resolution yet (ADR-0143 S1). A grant-bearing instance is held **degraded** with a reason that names its kind, and its upstream is never called without the credential. A datasource that borrows it through `external.connector` is refused with `422`, naming the kind.

**BREAKING** for a connector that writes `authentication: { type: 'oauth2', ... }`.

- **Before.** `authentication: { type: 'oauth2', authorizationUrl, tokenUrl, clientId, clientSecret, refreshToken }` was accepted, with the secret and the refresh token inline, and no runtime obtained or refreshed a token from it.
- **Now.** `ConnectorAuthConfigSchema` refuses it at `type`, with a prescription naming ADR-0143 D7 and the replacement. No first-party source declares it.
- **Fix.** Declare the grant on a declarative instance's `auth`, with the secret as a reference: `auth: { type: 'oauth2', grant: 'authorization_code', authorizationUrl, tokenUrl, scopes, clientId, credentialRef: 'VENDOR_CLIENT_SECRET' }`, or `grant: 'client_credentials'` without `authorizationUrl`. Code that registers a connector with a token it already holds passes `{ type: 'bearer', token }`.
