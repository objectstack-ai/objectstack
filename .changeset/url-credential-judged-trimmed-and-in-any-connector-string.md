---
'@objectstack/spec': minor
---

feat(spec)!: a URL is judged after trimming surrounding whitespace; a credential query parameter is refused in any string of a connector entry

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered url-credential-judged-trimmed-and-in-any-connector-string -->

**BREAKING** accept-set narrowing at the two metadata doors that judge a URL credential: an authored connector instance (`DeclarativeConnectorEntrySchema` — `defineStack({ connectors })`, `os validate` / `os compile`, the artifact load, `PUT /api/v1/meta/connector/:name`) and a datasource driver config's URL keys (`config.url` on postgres, mysql, mongo and turso, turso `config.syncUrl`) at every door that parses the datasource.

- **One value-level rule at both doors.** A URL is judged where a URL parser reads it: after its leading and trailing C0 control characters and spaces are trimmed. A connector URL holding a userinfo, and a datasource URL holding a userinfo password, are refused whatever surrounds them; a bare username in a datasource URL stays accepted.
- **A credential query parameter is refused in any string of a connector entry.** The connector query rule is the single value-level parse the datasource doors already run, applied to every string under `providerConfig` and `auth` — whether or not it starts with a scheme. Same names as before (`api_key`, `token`, `access_token`, `key`, `secret`, `signature` and the rest of the connector list, matched case-insensitively on the decoded name, plus the instance's own `auth.paramName`), same located refusal (`422 INVALID_METADATA` at the save door, one issue per string, naming the parts, never the value).
- **Read.** The connector read redactor and the datasource read redactor rewrite exactly what the write refuses, at the position the write judged, and serve every other character as stored. The datasource read locates a userinfo password by the write door's own boundary parse.
- **Unchanged.** `ConnectorSchema` (a plugin's `registerConnector` def) keeps its posture; a header or environment map under `providerConfig` is still judged by neither door; a stored row is never re-judged: a save of its served form keeps the stored value, and an edit of the served value stores exactly the edit.

## FROM → TO

```ts
// before — parsed green; now refused at providerConfig.note
{ name: 'billing_api', label: 'Billing API', type: 'api', provider: 'rest',
  providerConfig: { baseUrl: 'https://api.billing.example.com/v1', note: 'sandbox: append ?api_key=… to try it' },
  auth: { type: 'none' } },

// after — the note holds no credential, and the key is a reference
{ name: 'billing_api', label: 'Billing API', type: 'api', provider: 'rest',
  providerConfig: { baseUrl: 'https://api.billing.example.com/v1', note: 'sandbox: the key is BILLING_API_KEY' },
  auth: { type: 'api-key', credentialRef: 'BILLING_API_KEY', paramName: 'api_key' } },
```

For a datasource, keep the URL credential-free (`mysql://app@db.internal:3306/app`) and bind the password through the Setup → Datasources connection form's secret field, or reference it with `external.credentialsRef`. There is deliberately no automatic rewrite: the value in the string may be the only copy of the secret. The upgrade guide entry is `url-credential-judged-trimmed-and-in-any-connector-string`.
