---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
---

feat(spec): `alipay-v3` joins the `signed` connector-instance auth schemes, with response verification (ADR-0143 D2.3, #26710)

Clause-②: yes (widening)
Metadata-protocol: added

<!-- adr-0087: not-required (no-migration-prescription) One member is added to the closed signing-scheme list and one shape to the `signed` union. The signer registry's third parameter changes from the key string to an object carrying the key and an optional vendor public key; that function is internal to the automation service and in no release yet (it ships with the pending `26710-signed-connector-auth-aliyun` changeset). Nothing an author wrote before is refused or re-shaped, so there is nothing for a migration to rewrite. -->

A declarative connector instance can now declare Alipay's OpenAPI v3 signature as its signing scheme. Its responses are verified too. It joins the Alibaba Cloud and Tencent Cloud schemes.

- **`@objectstack/spec`**
  - `ConnectorSigningSchemeSchema` gains `alipay-v3`.
  - The `signed` union gains its closed shape: `{ type: 'signed', scheme: 'alipay-v3', keyId, credentialRef, vendorPublicKeyRef }`.
    - `keyId` is the app id.
    - `credentialRef` names the application private key.
    - `vendorPublicKeyRef` names the Alipay public key that every response is verified with. It is required.
  - The same publish refusals apply as for the other schemes: inline key spellings by name, an authored `signature`, and `signed` on `provider: 'mcp'`. Also refused:
    - `appPrivateKey`, by name;
    - `alipayPublicKey`, which is answered with `vendorPublicKeyRef`.

    `appId` is answered with `keyId`. An unknown scheme's refusal now lists all three schemes.
- **`@objectstack/service-automation`**
  - Every request is signed `ALIPAY-SHA256withRSA` with a fresh nonce and timestamp.
  - Every response below status 400 must carry a valid Alipay signature, an empty body included. A signed error response is verified too. A response that fails either check fails the dispatch, and its body is never returned.
  - The vendor public key resolves through the same chain as `credentialRef`. An instance whose public key is missing is degraded with that reference named. The credential door lists both references against the instance.
  - A key that is not an RSA key fails boot, naming which reference, never the value.
  - The keys never leave the host.
