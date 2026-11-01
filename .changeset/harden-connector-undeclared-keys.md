---
'@objectstack/spec': minor
---

feat(spec)!: an authored connector entry refuses a top-level key it does not declare; the connector read withholds URL credential parts and a non-object `auth`

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered connector-entry-undeclared-key-refused -->

**BREAKING** accept-set narrowing on an authored connector entry (`DeclarativeConnectorEntrySchema`), at every door that parses it: `defineStack({ connectors })`, `os validate` / `os compile`, the metadata plugin's artifact load at boot and on reload, and the metadata save door `PUT /api/v1/meta/connector/:name`.

- **Before.** The entry was a plain object: a top-level key it does not declare parsed green and meant nothing to the runtime.
- **Now.** The entry is closed. Such a key is refused by name with a located error (`unrecognized_keys` at the entry; at the save door `422 INVALID_METADATA`). A credential-shaped key (`apiKey`, `token`, `secret`, `password`, …) meets the `auth.credentialRef` prescription, and a provider setting written at the top level (`baseUrl`, `spec`, `transport`, `headers`, …) is pointed at `providerConfig`. The ADR-0010 protection envelope stays declared, so a package-stamped entry still parses. An artifact `os build` wrote carries no undeclared key (it serializes the parsed stack), so only a hand-assembled artifact can meet the refusal at boot.
- **Unchanged.** `ConnectorSchema` — the def a plugin hands to `registerConnector`, and the shape `defineConnector()` parses — keeps its posture. Nothing in the runtime ever read an undeclared entry key, so no connector's behaviour moves.
- **Read half.** The built-in `connector` redactor also withholds, on every read exit that serves a stored body through the metadata-type redactor registry: the userinfo and the credential query parameters of every URL under `providerConfig` (`baseUrl`, `transport.url`, a URL `spec`, and any other URL a provider keeps at object depth), the rest of each URL served byte for byte; and an `auth` or `authentication` value that is not an object, whole. A save of the served form keeps the stored value (the metadata protocol's carry-forward), and the runtime keeps reading the unredacted execution view.
- `redactUrlCredentialQueryParams` (`@objectstack/spec/data`) takes an optional parameter-name list; its default, and every existing caller, is unchanged.

## FROM → TO

```ts
// before — parsed green; neither key was read by anything
{ name: 'billing_api', label: 'Billing API', type: 'api', provider: 'rest',
  baseUrl: 'https://billing.example.com', apiKey: '…',
  auth: { type: 'bearer', credentialRef: 'BILLING_API_TOKEN' } },

// after — refused by name; the provider setting moves under providerConfig, the secret moves out of metadata
{ name: 'billing_api', label: 'Billing API', type: 'api', provider: 'rest',
  providerConfig: { baseUrl: 'https://billing.example.com' },
  auth: { type: 'bearer', credentialRef: 'BILLING_API_TOKEN' } },
```

Set the secret under the name `credentialRef` gives (an environment variable in the open tier, or Setup → Connector credentials) and delete the key. There is deliberately no automatic rewrite: an undeclared key may be a provider setting whose home depends on the provider, or the only copy of a secret. The upgrade guide entry is `connector-entry-undeclared-key-refused`.
