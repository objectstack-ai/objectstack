---
'@objectstack/spec': minor
---

feat(spec)!: the connector write door refuses an inline secret on every instance auth kind; the metadata read redacts connector credential positions

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered connector-instance-auth-inline-secret-refused -->

**BREAKING** accept-set narrowing on a provider-bound connector instance's `auth`, at every authoring door that parses `DeclarativeConnectorEntrySchema`: `defineStack({ connectors })`, `os validate` / `os compile`, and the metadata save door `PUT /api/v1/meta/connector/:name`.

- **Before.** The four static instance-auth kinds (`none`, `bearer`, `api-key`, `basic`) were plain objects: an undeclared key was dropped at parse and the entry still validated. The three ADR-0143 kinds (`oauth2`, `app-credential`, `signed`) already refused one.
- **Now.** All seven kinds refuse an undeclared key with a located error at `auth` (`unrecognized_keys`; at the save door `422 INVALID_METADATA`, the envelope an inline `authentication` already met there). An inline secret — `token` on `bearer`, `key` on `api-key`, `password` on `basic`, and their usual spellings — meets the `credentialRef` prescription; `none` names no credential and says so. The refusal ADR-0143 D3 records for every variant now holds for the static kinds too.
- **Read half (additive).** `connector` joins `datasource` as a built-in of the metadata-type redactor registry (`getMetadataTypeRedactor('connector')`), so every read exit that serves a stored body through that registry — the `/meta` item, list and layered reads and the metadata protocol's reads among them — withholds a stored connector's credential positions: every `auth` key its kind does not declare, every key of a runtime `authentication` block but `type`, and the provider header and environment maps (`providerConfig.headers`, `providerConfig.defaultHeaders`, `providerConfig.transport.headers`, `providerConfig.transport.env`), each map whole. A save of the served form keeps the stored values (the metadata protocol's carry-forward), and the runtime keeps reading the unredacted execution view, so a materialized connector still sends its headers.
- **Unchanged.** A static kind resolves its secret from `credentialRef` alone at materialization, as before; nothing ever read an undeclared key, so no connector's behaviour moves.

## FROM → TO

```ts
// before — parsed green; the inline value was never used
auth: { type: 'bearer', credentialRef: 'BILLING_API_TOKEN', token: '…' },

// after — refused at `auth` with the credentialRef prescription; keep the reference only
auth: { type: 'bearer', credentialRef: 'BILLING_API_TOKEN' },
```

Set the secret under the name `credentialRef` gives — an environment variable in the open tier, or Setup → Connector credentials — and delete the inline key. There is deliberately no automatic rewrite: the inline value may be the only copy of the secret its author holds. The upgrade guide entry is `connector-instance-auth-inline-secret-refused`.
