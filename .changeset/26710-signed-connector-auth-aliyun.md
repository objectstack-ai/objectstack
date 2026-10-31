---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
'@objectstack/connector-rest': minor
'@objectstack/connector-openapi': minor
---

feat(spec): `signed` joins declarative connector-instance auth, with `aliyun-acs3-hmac-sha256` as its first scheme (ADR-0143 D2.3, #26710)

Clause-②: yes (widening)
Metadata-protocol: added

<!-- adr-0087: not-required (no-migration-prescription) One member is added to the instance-auth union and optional members to the provider context and materialization. Nothing an author or a provider wrote before is refused or re-shaped, so there is nothing for a migration to rewrite. -->

An upstream that authenticates every request by a signature over the request itself, rather than by a token it is sent, had no way to be declared on a connector instance. ADR-0143 D2.3 adds that kind, `signed`, with a closed list of schemes. A scheme joins the list only together with its signer and its vendor test vectors. This release ships one scheme: Alibaba Cloud's OpenAPI V3 signature.

- **`@objectstack/spec`**
  - `ConnectorInstanceAuthSchema` gains `{ type: 'signed', scheme, keyId, credentialRef }`, a closed shape for each scheme. `keyId` is the public key identifier. The signing key is only ever a `credentialRef`.
  - The publish door refuses an unknown or missing `scheme` at `auth.scheme`, naming the value it got and the schemes that ship. It refuses an inline `secret`, `privateKey`, `secretKey` or `accessKeySecret` by name, with the `credentialRef` prescription, and an authored `signature`. It refuses `signed` on `provider: 'mcp'` at `auth.type`.
  - `@objectstack/spec/integration` gains the request-signer seam: `ConnectorRequestSigner` (`sign`, plus an optional `verifyResponse` for schemes that sign their responses), `ConnectorProviderContext.requestSigner`, and `ConnectorMaterialization.requestSignerApplied`.
  - `connectorFetchOptions` takes an optional signer and signs every attempt `resilientFetch` makes, retries included. `readConnectorResponse` runs the scheme's response verification before parsing.
  - With no signer, both behave exactly as before.
- **`@objectstack/service-automation`**
  - A `signed` instance's key resolves through the same credential chain as the static kinds, with the same degrade on an unresolved reference.
  - The key is bound to the scheme's signer at materialization, and the provider receives only the signer.
  - The service refuses to serve a `signed` instance on a provider that does not acknowledge the signer, so such an instance never calls its upstream unsigned.
  - A datasource that borrows a `signed` instance through `external.connector` is refused with `422`.
- **`@objectstack/connector-rest`, `@objectstack/connector-openapi`**
  - Both apply a handed request signer to every request and acknowledge it.
  - A static credential together with a signer is refused.
  - `bearer`, `api-key` and `basic` requests are unchanged.
