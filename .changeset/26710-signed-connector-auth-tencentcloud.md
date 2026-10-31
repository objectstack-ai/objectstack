---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
---

feat(spec): `tencentcloud-tc3-hmac-sha256` joins the `signed` connector-instance auth schemes (ADR-0143 D2.3, #26710)

Clause-②: yes (widening)
Metadata-protocol: added

<!-- adr-0087: not-required (no-migration-prescription) One member is added to the closed signing-scheme list and one shape to the `signed` union; the signer seam's `scheme` member is typed as that list instead of any string; that interface is in no release yet (it ships with the pending `26710-signed-connector-auth-aliyun` changeset), so no published surface narrows. Nothing an author wrote before is refused or re-shaped, so there is nothing for a migration to rewrite. -->

A declarative connector instance can now declare Tencent Cloud's API 3.0 signature (v3) as its signing scheme. It joins Alibaba Cloud's V3 signature, which shipped with the `signed` kind.

- **`@objectstack/spec`**
  - `ConnectorSigningSchemeSchema` gains `tencentcloud-tc3-hmac-sha256`.
  - The `signed` union gains its closed shape, `{ type: 'signed', scheme: 'tencentcloud-tc3-hmac-sha256', keyId, credentialRef }`. `keyId` is the SecretId. The SecretKey is only ever a `credentialRef`.
  - The same publish refusals apply as for the first scheme: an inline key spelling by name, an authored `signature`, and `signed` on `provider: 'mcp'`. `secretId` is answered with `keyId`. An unknown scheme's refusal now lists both shipped schemes.
  - `ConnectorRequestSigner.scheme` is typed as `ConnectorSigningScheme` rather than `string`. The interface ships for the first time in this release, together with the first scheme.
- **`@objectstack/service-automation`**
  - The signer registry binds a `tencentcloud-tc3-hmac-sha256` instance's key to its TC3-HMAC-SHA256 signer.
  - Every attempt is signed with a fresh `X-TC-Timestamp`, over `content-type` and `host`. The scope's service is the first label of the endpoint host.
  - A request without a content type is signed and sent as `application/x-www-form-urlencoded`.
  - The key never leaves the host.
