---
'@objectstack/spec': minor
---

feat(spec)!: an authored connector URL holds no credential part; the connector read withholds the credential parts of an `auth` endpoint too

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered connector-entry-url-credential-refused -->

**BREAKING** accept-set narrowing on an authored connector entry (`DeclarativeConnectorEntrySchema`), at every door that parses it: `defineStack({ connectors })`, `os validate` / `os compile`, the metadata plugin's artifact load at boot and on reload, and the metadata save door `PUT /api/v1/meta/connector/:name`.

- **Before.** A URL under `providerConfig` or `auth` parsed green whatever it held.
- **Now.** A URL holding a userinfo (`user@` or `user:password@` before the host) or a credential query parameter with a value (`api_key`, `token`, `access_token`, `key`, `secret`, `signature` and the rest of the connector redactor's list, matched case-insensitively on the decoded name, plus the instance's own `auth.paramName`) is refused: one issue per URL, located at the URL (`providerConfig.baseUrl`, `providerConfig.transport.url`, `providerConfig.spec`, `auth.tokenUrl`, `auth.authorizationUrl`, `auth.resource`, and any other URL at any depth under `providerConfig`, array elements included), naming the parts it holds and prescribing `auth: { type, credentialRef }`; at the save door `422 INVALID_METADATA`, and nothing is stored. There is no rule per provider: a URL is recognised by its value.
- **One judgement, both doors.** The write door and the read redactor share one definition of a URL credential part, so the door refuses exactly what the read withholds. A URL inside a header or environment map (`providerConfig.headers`, `defaultHeaders`, `transport.headers`, `transport.env`) is judged by neither: the read withholds those maps whole.
- **Read half.** The built-in `connector` redactor now also rewrites the credential parts out of the `auth` endpoints (`tokenUrl`, `authorizationUrl`, `resource`), the rest of each URL served byte for byte and the position named in `redactedKeys`, as it already did under `providerConfig`.
- **Unchanged.** `ConnectorSchema` — the def a plugin hands to `registerConnector` — keeps its posture. A stored row is never re-judged at materialization, so a connector stored before this refusal keeps dispatching; a save of its served form keeps the stored URL (the metadata protocol's carry-forward), and an edit of the served URL stores exactly the edit.

## FROM → TO

```ts
// before — parsed green; the secret lived in the URL
{ name: 'billing_api', label: 'Billing API', type: 'api', provider: 'rest',
  providerConfig: { baseUrl: 'https://billing.example.com/v1?api_key=…' },
  auth: { type: 'none' } },

// after — refused at providerConfig.baseUrl; the URL is credential-free and the key is a reference
{ name: 'billing_api', label: 'Billing API', type: 'api', provider: 'rest',
  providerConfig: { baseUrl: 'https://billing.example.com/v1' },
  auth: { type: 'api-key', credentialRef: 'BILLING_API_KEY', paramName: 'api_key' } },
```

Set the secret under the name `credentialRef` gives (an environment variable in the open tier, or Setup → Connector credentials) and delete it from the URL. There is deliberately no automatic rewrite: the value in the URL may be the only copy of the secret. The upgrade guide entry is `connector-entry-url-credential-refused`.
